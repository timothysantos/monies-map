// Many receipts at once (docs/flows/ask-flow.md "Many receipts at once"):
// the queue model, the reading loop with fake readers, and what the
// conversation store keeps of it (never a photo). Invented receipts only.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addReceiptPhotos,
  finishReceipt,
  nextReadyReceipt,
  openReceipt,
  readStoredReceipts,
  receiptProgress,
  reviewSkippedReceipts,
  setReceiptMatch
} from "../src/client/ask-receipt-queue.js";
import { holdReceiptPhoto, hasReceiptPhoto, matchRequestOf, readReceiptMatchResponse, runReceiptQueue } from "../src/client/ask-receipt-batch.js";
import { createAskConversationStore, parseStoredConversations, ASK_CONVERSATION_STORAGE_KEY, isConversationInProgress } from "../src/client/ask-conversation-store.js";
import { buildReceiptChips, findActiveItem, withReceiptChips } from "../src/client/ask-chips.js";

function read(merchant, totalMinor, { currency = "SGD", date = "2026-11-12", source = "ai" } = {}) {
  return {
    source,
    merchant: { value: merchant, confidence: "high" },
    date: { value: date, confidence: "high" },
    total: { amountMinor: totalMinor, currency, confidence: "high" },
    cardLast4: null,
    lineItems: [],
    questions: []
  };
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}

test("the same photo twice in a go is left out, not read twice; a later go remembers it by fingerprint", () => {
  let queue = addReceiptPhotos(null, [{ id: "r1", fingerprint: "aaa" }, { id: "r2", fingerprint: "bbb" }, { id: "r3", fingerprint: "aaa" }]);
  assert.deepEqual(queue.items.map((item) => [item.id, item.status, item.duplicateOf?.itemId ?? null]), [["r1", "waiting", null], ["r2", "waiting", null], ["r3", "duplicate", "r1"]]);
  for (const id of ["r1", "r2"]) queue = finishReceipt(queue, id, "saved", `txn-${id}`);
  assert.equal(receiptProgress(queue).finished, true);
  // A new go starts afresh but still knows the photos already sent.
  queue = addReceiptPhotos(queue, [{ id: "r4", fingerprint: "bbb" }, { id: "r5", fingerprint: "ccc" }]);
  assert.deepEqual(queue.items.map((item) => [item.id, item.status]), [["r4", "duplicate"], ["r5", "waiting"]]);
  assert.equal(queue.items[0].duplicateOf.itemId, "");
});

test("a receipt matching an entry already saved from a receipt in this conversation is flagged, not drafted twice", () => {
  let queue = addReceiptPhotos(null, [{ id: "r1", fingerprint: "a" }, { id: "r2", fingerprint: "b" }]);
  queue = finishReceipt(queue, "r1", "saved", "txn-new");
  queue = setReceiptMatch(queue, "r2", { kind: "one", option: { id: "txn-new", kind: "entry", change: null } });
  const second = queue.items[1];
  assert.equal(second.status, "duplicate");
  assert.deepEqual(second.duplicateOf, { kind: "entry", itemId: "r1", entryId: "txn-new" });
  // A match on another entry is a normal review.
  queue = addReceiptPhotos(queue, [{ id: "r3", fingerprint: "c" }]);
  queue = setReceiptMatch(queue, "r3", { kind: "one", option: { id: "txn-other", kind: "entry", change: null } });
  assert.equal(queue.items.find((item) => item.id === "r3").status, "waiting");
});

test("review order: one open at a time; a save waits for Next, Not now moves on, and the ones left come back", () => {
  let queue = addReceiptPhotos(null, [{ id: "r1", fingerprint: "" }, { id: "r2", fingerprint: "" }, { id: "r3", fingerprint: "" }]);
  queue = { ...queue, items: queue.items.map((item) => ({ ...item, status: "ready", read: read(`Shop ${item.id}`, 500), match: { kind: "none" } })) };
  assert.equal(nextReadyReceipt(queue).id, "r1");
  queue = openReceipt(queue, "r1");
  assert.equal(receiptProgress(queue).open, 1);
  queue = finishReceipt(queue, "r1", "saved", "txn-1");
  assert.equal(queue.autoNext, false, "a save waits for the person's Next");
  queue = openReceipt(queue, "r2");
  queue = finishReceipt(queue, "r2", "skipped");
  assert.equal(queue.autoNext, true, "Not now goes straight on");
  queue = openReceipt(queue, "r3");
  queue = finishReceipt(queue, "r3", "updated", "txn-3");
  const done = receiptProgress(queue);
  assert.deepEqual([done.finished, done.skipped, done.left], [true, 1, 0]);
  queue = reviewSkippedReceipts(queue);
  assert.equal(nextReadyReceipt(queue).id, "r2");
});

test("a ready receipt is not offered until the ledger check has answered", () => {
  let queue = addReceiptPhotos(null, [{ id: "r1", fingerprint: "" }]);
  queue = { ...queue, items: [{ ...queue.items[0], status: "ready", read: read("Toast Box", 760), match: null }] };
  assert.equal(nextReadyReceipt(queue), null);
  queue = setReceiptMatch(queue, "r1", { kind: "none" });
  assert.equal(nextReadyReceipt(queue).id, "r1");
});

test("the loop reads one photo at a time, switches to this device once the reader is off and says so once", async () => {
  let queue = addReceiptPhotos(null, ["p1", "p2", "p3"].map((id) => ({ id, fingerprint: id })));
  for (const id of ["p1", "p2", "p3"]) holdReceiptPhoto(id, { size: 10, type: "image/jpeg", id });
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const notes = [];
  await runReceiptQueue("test-loop", {
    read: () => queue,
    update: (change) => { queue = change(queue); },
    today: "2026-11-12",
    prepare: async (file) => ({ blob: { size: 10, id: file.id } }),
    readReceipt: async (blob) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(["reader", blob.id]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      // Over the allowance after the first.
      return blob.id === "p1" ? { ok: true, receipt: read("Toast Box", 760) } : { ok: false, reason: "allowance" };
    },
    deviceReader: { read: async (blob) => { calls.push(["device", blob.id]); return blob.id === "p3" ? null : read("Ya Kun", 540, { source: "ocr" }); }, close: async () => undefined },
    match: async (request) => { calls.push(["match", request.merchant]); return { kind: "none" }; },
    onDeviceNote: (reason) => notes.push(reason)
  });
  assert.equal(maxInFlight, 1, "never two reads at once");
  assert.deepEqual(calls, [["reader", "p1"], ["match", "Toast Box"], ["reader", "p2"], ["device", "p2"], ["match", "Ya Kun"], ["device", "p3"]]);
  assert.deepEqual(notes, ["allowance"]);
  assert.deepEqual(queue.items.map((item) => [item.id, item.status, item.read?.source ?? null]), [["p1", "ready", "ai"], ["p2", "ready", "ocr"], ["p3", "failed", null]]);
  // Read photos are dropped from memory; the failed one stays for Try again.
  assert.deepEqual(["p1", "p2", "p3"].map(hasReceiptPhoto), [false, false, true]);
  assert.equal(queue.readOnDevice, true);
});

test("one unreadable photo is read on the device but the next still goes to the reader", async () => {
  let queue = addReceiptPhotos(null, [{ id: "u1", fingerprint: "" }, { id: "u2", fingerprint: "" }]);
  for (const id of ["u1", "u2"]) holdReceiptPhoto(id, { id });
  const readerCalls = [];
  await runReceiptQueue("test-unreadable", {
    read: () => queue,
    update: (change) => { queue = change(queue); },
    today: "2026-11-12",
    prepare: async (file) => ({ blob: { id: file.id } }),
    readReceipt: async (blob) => { readerCalls.push(blob.id); return blob.id === "u1" ? { ok: false, reason: "unreadable" } : { ok: true, receipt: read("Cafe", 300) }; },
    deviceReader: { read: async () => read("Cafe on device", 300, { source: "ocr" }), close: async () => undefined },
    match: async () => ({ kind: "none" })
  });
  assert.deepEqual(readerCalls, ["u1", "u2"]);
  assert.equal(queue.readOnDevice, false);
});

test("the match request carries only validated fields, and an answer with a change outside the allowed commands is unusable", () => {
  assert.equal(matchRequestOf(read("", 500)), null);
  assert.deepEqual(matchRequestOf(read("Lawson", 324_000, { currency: "JPY" })), { merchant: "Lawson", date: "2026-11-12", totalMinor: 324_000, currency: "JPY", noteLines: [] });
  const bad = readReceiptMatchResponse({ ok: true, match: { kind: "one", option: { id: "txn", kind: "entry", change: { type: "receipt_match", title: "x", month: "2026-11", rows: [], entries: [], save: [{ path: "/api/entries/delete", body: {} }], undo: null } } } });
  assert.deepEqual(bad, { kind: "unchecked" });
  const good = readReceiptMatchResponse({ ok: true, match: { kind: "one", option: { id: "txn", kind: "entry", description: "LAWSON", date: "2026-11-12", amountMinor: 2980, currency: "SGD", certified: true, change: { type: "receipt_match", title: "LAWSON", month: "2026-11", rows: [{ field: "note", before: "", after: "Receipt: paid JPY 3,240." }], entries: [], save: [{ path: "/api/entries/update-note", body: { entryId: "txn", note: "Receipt: paid JPY 3,240." } }], undo: null } } } });
  assert.equal(good.kind, "one");
  assert.equal(good.option.certified, true);
  assert.equal(readReceiptMatchResponse(null).kind, "unchecked");
});

test("the store keeps the queue's read fields but never a photo; after a reload a receipt still being read has lost its photo", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  store.begin("chat|||", () => ({ intent: { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" }, thread: [], card: null, cardSlot: 0, composerText: "", pending: null }));
  let queue = addReceiptPhotos(null, [{ id: "s1", fingerprint: "f1" }, { id: "s2", fingerprint: "f2" }]);
  queue = { ...queue, items: [{ ...queue.items[0], status: "ready", read: { ...read("Toast Box", 760), url: "blob:x", image: "data:image/jpeg;base64,AAAA" }, match: { kind: "none" } }, { ...queue.items[1], status: "reading" }] };
  store.update("chat|||", (current) => ({ ...current, receipts: queue, thread: [{ id: "t1", kind: "photos", urls: ["blob:1"] }] }));
  const text = storage.values.get(ASK_CONVERSATION_STORAGE_KEY);
  assert.ok(!/blob:|data:image/.test(text), "no photo or photo URL is stored");
  const [restored] = parseStoredConversations(text);
  assert.deepEqual(restored.receipts.items.map((item) => [item.id, item.status, Boolean(item.lost)]), [["s1", "ready", false], ["s2", "failed", true]]);
  assert.equal(restored.receipts.items[0].read.merchant.value, "Toast Box");
  assert.equal(restored.thread.length, 0, "the photo row is not kept");
  // An unfinished go keeps the conversation in progress (the Ask tab's dot).
  assert.equal(isConversationInProgress(restored), true);
  // Leaving the page drops the photo rows kept in memory too.
  const left = store.leave("chat|||");
  assert.deepEqual(left.thread, []);
});

test("chips: Next receipt leads once one is read and none is open; several fits are asked as chips", () => {
  const base = { items: [{ key: "open-entry", label: "Open this entry", primary: true, onClick() {} }], prompt: "" };
  const actions = { nextReceipt() {}, backToLeftReceipts() {}, receiptIsNew() {}, chooseReceiptEntry() {}, receiptNotNow() {} };
  const row = withReceiptChips(base, { progress: { total: 3, working: true, left: 1, skipped: 0 }, hasReady: true, open: false, actions });
  assert.deepEqual(row.items.map((item) => [item.label, Boolean(item.primary)]), [["Next receipt", true], ["Open this entry", false]]);
  assert.equal(withReceiptChips(base, { progress: { total: 3 }, hasReady: true, open: true, actions }), base);
  const back = withReceiptChips(base, { progress: { total: 3, working: false, left: 0, skipped: 2 }, hasReady: false, open: false, actions });
  assert.equal(back.items[0].label, "Back to the 2 left");

  const which = buildReceiptChips({
    focus: { kind: "receipt-which", receiptId: "r1", options: [
      { id: "txn-1", kind: "entry", description: "TOAST BOX", date: "2026-11-12", amountMinor: 760, currency: "SGD" },
      { id: "tap-1", kind: "tap", description: "TOAST BOX", date: "2026-11-12", amountMinor: null, currency: "SGD" }
    ] },
    today: "2026-11-12",
    actions
  });
  assert.equal(which.prompt, "This receipt looks like one of these entries. Which is it?");
  assert.deepEqual(which.items.map((item) => item.label), ["TOAST BOX, Today, $7.60", "TOAST BOX, Today, no amount yet", "It's a new one", "Not now"]);

  // A receipt's change card is the newest thing: its own chip, not the old card's.
  const active = findActiveItem({ thread: [{ id: "c1", kind: "change-draft", status: "draft", receiptId: "r1" }], card: null, cardSlot: 0, pending: null });
  assert.deepEqual(active, { kind: "receipt-change", itemId: "c1", receiptId: "r1" });
});

test("stored receipts that are not receipts are dropped", () => {
  assert.equal(readStoredReceipts({ items: [{ id: 3, status: "ready" }] }), null);
  assert.equal(readStoredReceipts({ items: [{ id: "x", status: "eaten" }] }), null);
  const kept = readStoredReceipts({ items: [{ id: "x", status: "ready", read: { merchant: {}, total: {}, date: {} }, match: { kind: "none" } }] });
  assert.equal(kept.items[0].status, "ready");
  // Ready with no read is not reviewable: it reads as could not be read.
  assert.equal(readStoredReceipts({ items: [{ id: "y", status: "ready" }] }).items[0].status, "failed");
});
