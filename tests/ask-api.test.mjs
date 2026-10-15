// The Ask page's requests (src/client/ask-api.js) and its on-device
// receipt reading (src/client/ask-receipt-image.js): the reader responses
// it accepts, how it fails soft, that saving and undo use only existing
// routes, and the shared receipt reader behind the OCR fallback.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ASK_ENDPOINTS,
  addSavedEntryToSplits,
  readEntryDraftResponse,
  readReceiptReadResponse,
  requestEntryDraft,
  requestReceiptRead,
  saveCardEntry,
  undoSavedEntry,
  updateSavedEntryCategory
} from "../src/client/ask-api.js";
import { fitWithin, readReceiptTextOnDevice } from "../src/client/ask-receipt-image.js";
import { applyReceiptRead, createAskCard } from "../src/client/ask-card-model.js";
import { readReceiptOcrText } from "../src/domain/receipt-ocr-text.ts";

const cardContext = {
  today: "2026-10-11",
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", currency: "SGD", isActive: true },
    { id: "acct-visa", name: "Sample Visa Card", last4: "2718", currency: "SGD", isActive: true }
  ],
  categories: [{ id: "cat-food", name: "Food & Drinks" }, { id: "cat-other", name: "Other" }],
  defaultAccountPriorityIds: ["acct-ocbc"]
};

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError("no body");
        return next.body;
      }
    };
  };
  return { impl, calls };
}

test("the entry draft reader accepts the branch's nested shape and keeps each field's source", () => {
  const draft = readEntryDraftResponse({
    ok: true,
    draft: {
      fields: {
        description: { value: "Koufu", source: "sentence" },
        amountMinor: { value: 1250, source: "ai" },
        entryType: { value: "expense", source: "default" },
        bogus: { value: "x", source: "sentence" }
      },
      missing: ["accountId"],
      questions: [{ field: "accountId", reason: "missing", options: [] }, { reason: "no field" }],
      transferAccount: { value: { accountId: "a", accountName: "A" }, source: "sentence" }
    },
    ai: { requested: true, available: true }
  });
  assert.deepEqual(Object.keys(draft.fields).sort(), ["amountMinor", "description", "entryType"]);
  assert.equal(draft.fields.amountMinor.source, "ai");
  assert.deepEqual(draft.missing, ["accountId"]);
  assert.deepEqual(draft.questions, [{ field: "accountId", reason: "missing", options: [] }]);
  assert.equal(draft.transferAccount.value.accountId, "a");
});

test("the entry draft reader also accepts the brief's flat shape", () => {
  const draft = readEntryDraftResponse({ date: { value: "2026-09-28", source: "sentence" }, amountMinor: { value: 800, source: "sentence" }, missing: [], questions: [] });
  assert.equal(draft.fields.date.value, "2026-09-28");
  assert.equal(draft.fields.amountMinor.value, 800);
});

test("an empty, failed or unknown draft response reads as nothing", () => {
  assert.equal(readEntryDraftResponse(null), null);
  assert.equal(readEntryDraftResponse({ ok: false, error: "Missing entry draft text" }), null);
  assert.equal(readEntryDraftResponse({ ok: true, draft: { fields: {} } }), null);
  assert.equal(readEntryDraftResponse({ ok: true, draft: { fields: { amountMinor: 12 } } }), null, "a bare value without its source is not a field");
});

test("requestEntryDraft posts the sentence and view, and fails soft on 404, 500, bad JSON and network errors", async () => {
  const ok = fakeFetch([{ status: 200, body: { ok: true, draft: { fields: { description: { value: "Kopi", source: "sentence" } } } } }]);
  const result = await requestEntryDraft({ text: "Kopi $2", viewId: "person-tim", fetchImpl: ok.impl });
  assert.equal(result.ok, true);
  assert.equal(ok.calls[0].url, ASK_ENDPOINTS.entryDraft);
  assert.equal(ok.calls[0].url, "/api/ai-assist/entry-draft");
  assert.deepEqual(ok.calls[0].body, { text: "Kopi $2", viewId: "person-tim" });

  for (const [response, reason] of [
    [{ status: 404, body: { error: "Not found" } }, "unavailable"],
    [{ status: 500, body: { error: "boom" } }, "failed"],
    [{ status: 200, body: undefined }, "unreadable"],
    [new TypeError("Failed to fetch"), "network"]
  ]) {
    const failing = fakeFetch([response]);
    assert.deepEqual(await requestEntryDraft({ text: "x", viewId: "household", fetchImpl: failing.impl }), { ok: false, reason });
  }
});

test("the receipt reader accepts the in-progress ReceiptReadDto and the brief's flat one", () => {
  const nested = readReceiptReadResponse({
    ok: true,
    receipt: {
      source: "ai",
      merchant: { value: "KOUFU", confidence: "high" },
      date: { value: "2026-09-28", confidence: "medium" },
      total: { amountMinor: 1250, currency: "SGD", confidence: "high" },
      cardLast4: "4821",
      lineItems: [{ description: "Chicken rice", amountMinor: 550, quantity: 1 }],
      questions: [{ field: "date", reason: "unclear" }]
    }
  });
  assert.deepEqual(nested.merchant, { value: "KOUFU", confidence: "high" });
  assert.deepEqual(nested.total, { amountMinor: 1250, currency: "SGD", confidence: "high" });
  assert.equal(nested.cardLast4, "4821");
  assert.equal(nested.questions.length, 1);

  const flat = readReceiptReadResponse({ merchant: "Tiong Bahru Bakery", date: "2026-09-29", totalMinor: 3860, currency: "SGD", cardLast4: "12345", confidence: { total: "high" } });
  assert.equal(flat.merchant.value, "Tiong Bahru Bakery");
  assert.equal(flat.total.amountMinor, 3860);
  assert.equal(flat.total.confidence, "high");
  assert.equal(flat.cardLast4, null, "only ever four digits");
  assert.equal(readReceiptReadResponse({ ok: true, receipt: { merchant: { value: null }, total: {} } }), null);
});

test("requestReceiptRead sends one image part and reads an AI-off answer as unavailable", async () => {
  const image = new Blob(["jpeg"], { type: "image/jpeg" });
  const ok = fakeFetch([{ status: 200, body: { ok: true, receipt: { merchant: { value: "KOUFU", confidence: "high" }, total: { amountMinor: 1250, currency: "SGD", confidence: "high" }, date: { value: null, confidence: "low" } } } }]);
  const result = await requestReceiptRead({ image, fetchImpl: ok.impl });
  assert.equal(result.ok, true);
  assert.equal(ok.calls[0].url, "/api/ai-assist/receipt-read");
  assert.ok(ok.calls[0].init.body instanceof FormData);
  assert.equal(ok.calls[0].init.body.get("image").type, "image/jpeg");

  // The route's own AI-off answer (receipt-read-route.ts).
  const off = fakeFetch([{ status: 200, body: { ok: true, available: false, reason: "disabled" } }]);
  assert.deepEqual(await requestReceiptRead({ image, fetchImpl: off.impl }), { ok: false, reason: "disabled" });
  const missing = fakeFetch([{ status: 404, body: {} }]);
  assert.deepEqual(await requestReceiptRead({ image, fetchImpl: missing.impl }), { ok: false, reason: "unavailable" });
});

test("saving goes through the existing create route, then the existing split link", async () => {
  const fetch = fakeFetch([
    { status: 200, body: { ok: true, entryId: "txn-9" } },
    { status: 200, body: { ok: true, splitExpenseId: "split-9", splitExpenseMonth: "2026-09" } }
  ]);
  const result = await saveCardEntry({
    date: "2026-09-29", description: "Bakery", accountId: "acct-citi", accountName: "Citi", categoryName: "Other",
    amountMinor: 3860, totalAmountMinor: 3860, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "", splits: [],
    addToSplits: true, splitGroupId: "split-group-none"
  }, { fetchImpl: fetch.impl });
  assert.deepEqual(result, { ok: true, error: "", entryId: "txn-9", splitExpenseId: "split-9", splitExpenseMonth: "2026-09", splitAddError: "", time: null });
  assert.deepEqual(fetch.calls.map((call) => call.url), ["/api/entries/create", "/api/splits/expenses/from-entry"]);
  assert.equal(fetch.calls[0].body.amountMinor, 3860);
  assert.equal(fetch.calls[0].body.ownerName, "Tim");
  assert.deepEqual(fetch.calls[1].body, { entryId: "txn-9", splitGroupId: null });
});

test("a refused save comes back as an error and never links a split", async () => {
  const fetch = fakeFetch([{ status: 400, body: { ok: false, error: "Missing entry create fields" } }]);
  const result = await saveCardEntry({ date: "", description: "", entryType: "expense", ownershipType: "direct", addToSplits: true }, { fetchImpl: fetch.impl });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Missing entry create fields");
  assert.equal(fetch.calls.length, 1);
  const offline = fakeFetch([new TypeError("Failed to fetch")]);
  assert.equal((await saveCardEntry({ entryType: "expense", ownershipType: "direct" }, { fetchImpl: offline.impl })).ok, false);
});

test("undo deletes the split the save created first, then the entry; a split failure stops it", async () => {
  const both = fakeFetch([{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }]);
  assert.equal((await undoSavedEntry({ entryId: "txn-1", splitExpenseId: "split-1" }, { fetchImpl: both.impl })).ok, true);
  assert.deepEqual(both.calls.map((call) => [call.url, call.body]), [
    ["/api/splits/expenses/delete", { splitExpenseId: "split-1" }],
    ["/api/entries/delete", { entryId: "txn-1" }]
  ]);
  const blocked = fakeFetch([{ status: 409, body: { ok: false, error: "This split is settled." } }]);
  assert.deepEqual(await undoSavedEntry({ entryId: "txn-1", splitExpenseId: "split-1" }, { fetchImpl: blocked.impl }), { ok: false, error: "This split is settled." });
  assert.equal(blocked.calls.length, 1, "the entry stays when its split could not go");
  const entryOnly = fakeFetch([{ status: 200, body: { ok: true } }]);
  await undoSavedEntry({ entryId: "txn-2", splitExpenseId: null }, { fetchImpl: entryOnly.impl });
  assert.deepEqual(entryOnly.calls.map((call) => call.url), ["/api/entries/delete"]);
});

test("the saved card's follow-ups use the existing category and split routes", async () => {
  const fetch = fakeFetch([{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true, splitExpenseId: "split-3" } }]);
  await updateSavedEntryCategory({ entryId: "txn-3", categoryName: "Food & Drinks" }, { fetchImpl: fetch.impl });
  const shared = await addSavedEntryToSplits({ entryId: "txn-3", splitGroupId: "group-dinners" }, { fetchImpl: fetch.impl });
  assert.equal(shared.splitExpenseId, "split-3");
  assert.deepEqual(fetch.calls.map((call) => [call.url, call.body]), [
    ["/api/entries/update-category", { entryId: "txn-3", categoryName: "Food & Drinks" }],
    ["/api/splits/expenses/from-entry", { entryId: "txn-3", splitGroupId: "group-dinners" }]
  ]);
});

test("a receipt photo is drawn no larger than 1600 px on its long edge, never enlarged", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(1170, 2532), { width: 739, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

// The on-device fallback reads Tesseract text with the shared no-AI reader
// (src/domain/receipt-ocr-text.ts), assuming the household currency (SGD)
// when none is printed, so a plain receipt raises no currency question.
const RECEIPT_TODAY = "2026-10-11";

async function readReceiptFixture(name) {
  return readFile(new URL(`./fixtures/receipts/${name}`, import.meta.url), "utf8");
}

test("the on-device reader uses the shared receipt reader with the household currency", async () => {
  const text = await readReceiptFixture("sg-cafe.txt");
  const receipt = readReceiptTextOnDevice(text, { today: RECEIPT_TODAY });
  assert.deepEqual(receipt, readReceiptOcrText(text, { today: RECEIPT_TODAY, defaultCurrency: "SGD" }));
  assert.equal(receipt.source, "ocr");
  assert.equal(receipt.merchant.value, "Kopi & Crumb Cafe");
  assert.deepEqual(receipt.total, { amountMinor: 2338, currency: "SGD", confidence: "medium" });
  assert.equal(receipt.cardLast4, "3141");
  assert.deepEqual(receipt.questions, [], "no printed currency is not a missing currency");
});

test("the on-device reader fills the Ask card from a supermarket receipt and leaves nothing to ask", async () => {
  const receipt = readReceiptTextOnDevice(await readReceiptFixture("sg-supermarket.txt"), { today: RECEIPT_TODAY });
  const card = applyReceiptRead(createAskCard(cardContext), receipt, cardContext);
  assert.deepEqual(
    { description: card.fields.description, date: card.fields.date, amountMinor: card.fields.amountMinor, accountId: card.fields.accountId },
    { description: "LUMEN GROCER PTE LTD", date: "2026-10-09", amountMinor: 2195, accountId: "acct-visa" }
  );
  assert.deepEqual(card.filled, { description: "receipt", date: "receipt", accountId: "receipt", amount: "receipt" });
  assert.deepEqual(card.questions, []);
});

test("a printed foreign currency still beats the household default and waits on the card", async () => {
  const receipt = readReceiptTextOnDevice(await readReceiptFixture("bali-warung.txt"), { today: RECEIPT_TODAY });
  assert.deepEqual(receipt.total, { amountMinor: 14_300_000, currency: "IDR", confidence: "medium" });
  const card = applyReceiptRead(createAskCard(cardContext), receipt, cardContext);
  assert.equal(card.fields.amountMinor, 0);
  assert.deepEqual(card.questions.map((question) => [question.field, question.reason]), [["amountMinor", "foreign_currency"]]);
});

test("the on-device reader asks about an ambiguous date, a smudged one, and reads nothing from blank text", async () => {
  const ambiguous = readReceiptTextOnDevice(await readReceiptFixture("us-diner-ambiguous-date.txt"), { today: RECEIPT_TODAY });
  assert.deepEqual(ambiguous.questions, [{ field: "date", reason: "ambiguous", candidates: ["2026-04-03", "2026-03-04"] }]);
  const ambiguousCard = applyReceiptRead(createAskCard(cardContext), ambiguous, cardContext);
  assert.deepEqual(ambiguousCard.questions.map((question) => [question.field, question.reason, question.options.length]), [["date", "ambiguous", 2]]);

  const smudged = readReceiptTextOnDevice(await readReceiptFixture("smudged-no-total.txt"), { today: RECEIPT_TODAY });
  assert.deepEqual(smudged.questions, [{ field: "date", reason: "missing" }, { field: "total", reason: "unclear" }]);
  assert.equal(smudged.questions.some((question) => question.field === "currency"), false);

  assert.equal(readReceiptTextOnDevice("", { today: RECEIPT_TODAY }), null);
  assert.equal(readReceiptTextOnDevice("~~~ ~~ ~~~", { today: RECEIPT_TODAY }), null);
});
