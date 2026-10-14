// The Ask page's side of money answers (docs/flows/ask-flow.md "Money
// questions"): the adapter that reads the answer route (ask-api.js) against
// the real Worker, the skew check's actions limited to the existing routes
// in their suggested order, the chip row a money answer or a check owns
// (ask-chips.js), and the conversation store keeping both across a reload.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { readMoneyAnswerResponse, requestMoneyAnswer, resolveSkewCandidate } from "../src/client/ask-api.js";
import { buildAskChips, buildChipRow, findActiveItem } from "../src/client/ask-chips.js";
import { createAskConversationStore, parseStoredConversations, ASK_CONVERSATION_STORAGE_KEY } from "../src/client/ask-conversation-store.js";
import { skewCheckLabels } from "../src/client/ask-skew-check.js";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

const chat = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };
const context = { today: "2026-10-12", viewId: "household", people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }], accounts: [], categories: [] };
const actions = new Proxy({}, { get: (_, name) => (...args) => [name, ...args] });
const labels = (row) => row.items.map((item) => item.label);

const settlementCandidate = {
  id: "settlement:chk-1:e-out:e-in",
  kind: "settlement",
  confidence: "high",
  amountMinor: 15000,
  currency: "SGD",
  fromPerson: { id: "person-serene", name: "Serene" },
  toPerson: { id: "person-ethan", name: "Ethan" },
  entryIds: ["e-out", "e-in"],
  outflowEntry: { id: "e-out", date: "2026-05-22", description: "PAYNOW TRANSFER TO ETHAN", accountName: "DBS Multiplier Account", amountMinor: 15000 },
  inflowEntry: { id: "e-in", date: "2026-05-22", description: "PAYNOW FROM SERENE", accountName: "OCBC 360 Account", amountMinor: 15000 },
  skew: { spendingMinor: 15000, incomeMinor: 15000 },
  suggestedActions: [
    { action: "link_transfer", method: "POST", path: "/api/transfers/link", body: { fromEntryId: "e-out", toEntryId: "e-in" } },
    { action: "match_settlement_checkpoint", method: "POST", path: "/api/splits/checkpoints/match", body: { checkpointId: "chk-1", transactionId: "e-out" } }
  ]
};

function recordingFetch(reply = () => ({ ok: true })) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const result = reply(url, body);
    return new Response(JSON.stringify(result), { status: result.ok === false ? 400 : 200, headers: { "content-type": "application/json" } });
  };
  return { calls, impl };
}

test("Mark as settlement posts the suggested actions in order through the existing routes", async () => {
  const { calls, impl } = recordingFetch();
  assert.deepEqual(await resolveSkewCandidate(settlementCandidate, { fetchImpl: impl }), { ok: true, error: "" });
  assert.deepEqual(calls, [
    { url: "/api/transfers/link", body: { fromEntryId: "e-out", toEntryId: "e-in" } },
    { url: "/api/splits/checkpoints/match", body: { checkpointId: "chk-1", transactionId: "e-out" } }
  ]);
});

test("a group settle-up is recorded, then linked to its transfer entry", async () => {
  const { calls, impl } = recordingFetch((url) => (url === "/api/splits/settlements/create" ? { ok: true, settlementId: "settle-9" } : { ok: true }));
  const candidate = {
    ...settlementCandidate,
    suggestedActions: [
      { action: "reclassify_as_transfer", method: "POST", path: "/api/entries/update-classification", body: { entryId: "e-out", entryType: "transfer", transferDirection: "out", categoryName: "Transfer" } },
      { action: "record_group_settle_up", method: "POST", path: "/api/splits/settlements/create", body: { groupId: "g-bali", date: "2026-05-12", fromPersonName: "Serene", toPersonName: "Ethan", amountMinor: 4200, currency: "SGD", paymentMethod: "bank", paymentStatus: "recorded" }, linkTransactionId: "e-out" }
    ]
  };
  assert.equal((await resolveSkewCandidate(candidate, { fetchImpl: impl })).ok, true);
  assert.deepEqual(calls.map((call) => call.url), ["/api/entries/update-classification", "/api/splits/settlements/create", "/api/splits/matches/link-settlement"]);
  assert.deepEqual(calls[2].body, { settlementId: "settle-9", transactionId: "e-out" });
});

test("an action outside the known routes is refused before anything is sent, and a failure stops the rest", async () => {
  const { calls, impl } = recordingFetch();
  const foreign = { ...settlementCandidate, suggestedActions: [{ action: "link_transfer", method: "POST", path: "/api/entries/delete", body: { entryId: "e-out" } }] };
  const refused = await resolveSkewCandidate(foreign, { fetchImpl: impl });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "This can't be sorted from here. Open Splits or Entries to fix it.");
  assert.equal((await resolveSkewCandidate({ ...settlementCandidate, suggestedActions: [] }, { fetchImpl: impl })).ok, false);
  assert.equal(calls.length, 0);

  const failing = recordingFetch(() => ({ ok: false, error: "Those entries are already linked." }));
  assert.deepEqual(await resolveSkewCandidate(settlementCandidate, { fetchImpl: failing.impl }), { ok: false, error: "Those entries are already linked." });
  assert.equal(failing.calls.length, 1);
});

test("the check's chips name what resolving and keeping do, by kind and by what it skews", () => {
  assert.deepEqual(skewCheckLabels(settlementCandidate), { resolve: "Mark as settlement", keep: "It's real spending", resolved: "Marked as a settlement.", kept: "Kept as spending." });
  assert.deepEqual(skewCheckLabels({ kind: "own_transfer", skew: { spendingMinor: 0, incomeMinor: 50000 } }), { resolve: "Link as transfer", keep: "It's real income", resolved: "Linked as a transfer.", kept: "Kept as income." });
});

test("a money answer leads the chips with its links; an open check offers only its two choices", () => {
  const links = [
    { kind: "entries", label: "Open in Entries", filter: { month: "2026-03" } },
    { kind: "month", label: "Open Month", month: "2026-03", viewId: "household", scope: "direct_plus_shared" }
  ];
  const thread = [{ id: "m1", kind: "me", text: "why was March so expensive?" }, { id: "a1", kind: "money-answer", answer: { links }, wording: { text: "" } }];
  const active = findActiveItem({ thread, card: null });
  assert.deepEqual(active, { kind: "money-answer", itemId: "a1", links });
  const row = buildChipRow({ active, intent: chat, card: null, context, actions });
  assert.deepEqual(labels(row), ["Open in Entries", "Open Month", "Scan receipt", "Paste", "Add entry", "Add expense"]);
  assert.deepEqual(row.items.map((item) => Boolean(item.primary)), [true, false, false, false, false, false]);
  assert.deepEqual(row.items[1].onClick(), ["openAnswerLink", links[1]]);

  const check = { id: "c1", kind: "money-check", text: "why was May so expensive?", request: {}, candidate: settlementCandidate, status: "open" };
  const checkActive = findActiveItem({ thread: [...thread, check], card: null });
  assert.equal(checkActive.kind, "money-check");
  const checkRow = buildChipRow({ active: checkActive, intent: chat, card: null, context, moneyLabels: skewCheckLabels(settlementCandidate), actions });
  assert.deepEqual(labels(checkRow), ["Mark as settlement", "It's real spending"]);
  assert.deepEqual(checkRow.items.map((item) => item.onClick()[0]), ["resolveCheck", "keepCheck"]);

  // A check already answered gives the row back.
  const closed = findActiveItem({ thread: [...thread, { ...check, status: "resolved" }], card: null });
  assert.equal(closed, null);
  assert.deepEqual(labels(buildChipRow({ active: closed, intent: chat, card: null, context, actions })), labels(buildAskChips({ intent: chat, card: null, context, actions })));
});

test("money answers and checks come back after a reload; a malformed one is dropped", () => {
  const storage = new Map();
  const memory = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  const store = createAskConversationStore({ storage: memory });
  const answer = { title: "March spending", lead: { label: "Spent · 64 entries", amountMinor: 1039123, currency: "SGD", tone: "short" }, support: [], lines: [], links: [] };
  store.begin("chat|||", () => ({ intent: chat, thread: [], card: null, cardSlot: 0, composerText: "", pending: null, scrollFromBottom: 0 }));
  store.update("chat|||", (current) => ({
    ...current,
    thread: [
      { id: "m1", kind: "me", text: "why was March so expensive?" },
      { id: "a1", kind: "money-answer", text: "why was March so expensive?", intent: "spending", answer, wording: { text: "March came to $10,391.23.", source: "template" } },
      { id: "c1", kind: "money-check", text: "why was May so expensive?", request: { viewId: "household", scope: "direct_plus_shared", month: "2026-05" }, keepCandidateIds: [], candidate: settlementCandidate, status: "open" },
      { id: "bad", kind: "money-answer", text: "?", answer: { title: "no lead" } }
    ]
  }));
  const [restored] = parseStoredConversations(storage.get(ASK_CONVERSATION_STORAGE_KEY));
  assert.deepEqual(restored.thread.map((item) => item.id), ["m1", "a1", "c1"]);
  assert.deepEqual(restored.thread[1].answer, answer);
  assert.equal(restored.thread[2].candidate.id, settlementCandidate.id);
});

test("the adapter keeps only what the card renders and refuses a malformed answer", () => {
  assert.deepEqual(readMoneyAnswerResponse({ ok: true, supported: false }), { supported: false });
  assert.equal(readMoneyAnswerResponse({ ok: true, supported: true, intent: "weather" }), null);
  assert.equal(readMoneyAnswerResponse({ ok: true, supported: true, intent: "plan", needsConfirmation: true, candidates: [] }), null);
  assert.equal(readMoneyAnswerResponse({ ok: true, supported: true, intent: "plan", answer: { lead: {} }, wording: { text: "x" } }), null);
  assert.equal(readMoneyAnswerResponse({ ok: false }), null);
  const read = readMoneyAnswerResponse({
    ok: true, supported: true, intent: "plan", viewId: "household", scope: "direct_plus_shared", months: ["2026-05"], needsConfirmation: false,
    answer: { title: "May against plan", lead: { label: "Spent", amountMinor: 1, currency: "SGD", tone: "neutral" }, support: [], lines: [], links: [{ kind: "elsewhere" }, { kind: "month", label: "Open Month" }] },
    wording: { text: "May came to $0.01.", source: "something" }
  });
  assert.deepEqual(read.answer.links, [{ kind: "month", label: "Open Month" }]);
  assert.deepEqual(read.wording, { text: "May came to $0.01.", source: "template" });
});

test("the money jobs' answers are read, and their savings bar keeps what was invested and moved", () => {
  const outcome = { incomeMinor: 500_000, spentMinor: 300_000, plannedSpendMinor: 400_000, savingsTargetMinor: 50_000, investedMinor: 30_000, savedMovedMinor: 20_000, plannedInvestMinor: 50_000 };
  for (const intent of ["invested", "saved", "spentVsEarned"]) {
    const read = readMoneyAnswerResponse({
      ok: true, supported: true, intent, viewId: "person-tim", scope: "direct_plus_shared", months: ["2026-05"], needsConfirmation: false,
      answer: { title: "May", lead: { label: "Invested", amountMinor: 30_000, currency: "SGD", tone: "neutral" }, support: [], lines: [], links: [], outcome },
      wording: { text: "x", source: "template" }
    });
    assert.equal(read.intent, intent);
    // Before, the adapter dropped the last three, so the bar showed nothing invested.
    assert.deepEqual(read.answer.outcome, { ...outcome, movedIntoInvestmentsMinor: 0, takenFromInvestmentsMinor: 0 }, intent);
  }
  // An older answer without the money jobs' figures reads them as zero; a
  // bad one is dropped.
  const { investedMinor: _i, savedMovedMinor: _s, plannedInvestMinor: _p, ...monthCards } = outcome;
  const older = readMoneyAnswerResponse({
    ok: true, supported: true, intent: "plan", needsConfirmation: false,
    answer: { title: "May", lead: { label: "Spent", amountMinor: 1, currency: "SGD", tone: "neutral" }, outcome: monthCards },
    wording: { text: "x" }
  });
  assert.deepEqual(older.answer.outcome, { ...monthCards, investedMinor: 0, savedMovedMinor: 0, plannedInvestMinor: 0, movedIntoInvestmentsMinor: 0, takenFromInvestmentsMinor: 0 });
  const bad = readMoneyAnswerResponse({
    ok: true, supported: true, intent: "saved", needsConfirmation: false,
    answer: { title: "May", lead: { label: "Saved", amountMinor: 1, currency: "SGD", tone: "in" }, outcome: { ...outcome, incomeMinor: "lots" } },
    wording: { text: "x" }
  });
  assert.equal("outcome" in bad.answer, false);
});

let showcase;
test.before(async () => {
  showcase = await createSeededTemplate({ vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-05" } });
});
test.after(async () => {
  await showcase?.dispose();
});

test("requestMoneyAnswer reads the real route's answer, and a failure is a calm { ok: false }", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const fetchImpl = (url, init) => worker.fetch(new Request(new URL(url, "http://127.0.0.1"), init), { DB: db, ...showcase.config.vars });
  const result = await requestMoneyAnswer({ text: "where did April go?", viewId: "household", scope: "direct_plus_shared", month: "2026-05", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.answer.intent, "spending");
  assert.equal(result.answer.answer.lead.amountMinor, 366757);
  assert.deepEqual(result.answer.answer.links.map((link) => link.kind), ["entries", "month"]);
  assert.equal(result.answer.wording.source, "template");

  const unsupported = await requestMoneyAnswer({ text: "should I buy a car?", viewId: "household", scope: "direct_plus_shared", month: "2026-05", fetchImpl });
  assert.deepEqual(unsupported, { ok: true, answer: { supported: false } });
  const offline = await requestMoneyAnswer({ text: "where did April go?", viewId: "household", fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.deepEqual(offline, { ok: false, reason: "network" });
  const broken = await requestMoneyAnswer({ text: "where did April go?", viewId: "household", fetchImpl: async () => new Response("oops", { status: 500 }) });
  assert.deepEqual(broken, { ok: false, reason: "failed" });
});
