// The Ask page's client adapter (src/client/ask-api.js) against the real
// Worker side: the receipt photo goes through the actual receipt-read route
// (src/server/receipt-read-route.ts) and an entry draft comes from the real
// sentence parser, so a field-name or response-shape drift between the two
// branches fails here rather than in the browser.
import assert from "node:assert/strict";
import test from "node:test";

import { applyEntryDraft, applyReceiptRead, createAskCard } from "../src/client/ask-card-model.js";
import { readEntryDraftResponse, requestEntryDraft, requestReceiptRead } from "../src/client/ask-api.js";
import { parseEntrySentence } from "../src/domain/entry-draft.ts";
import { handleAiAssistRoute } from "../src/server/ai-assistance-routes.ts";

const TODAY = new Date().toISOString().slice(0, 10);
// Just enough of a JPEG for the route's byte sniffing.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

const cardContext = {
  today: TODAY,
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", currency: "SGD", isActive: true },
    { id: "acct-citi", name: "Citi Cash Back Card 2718", currency: "SGD", isActive: true }
  ],
  categories: [{ id: "cat-other", name: "Other" }, { id: "cat-food", name: "Food & Drinks" }],
  defaultAccountPriorityIds: ["acct-ocbc"]
};

function createFakeDb() {
  const statement = () => {
    const self = {
      bind() { return self; },
      async run() { return { success: true, meta: { changes: 1 } }; },
      async all() { return { results: [] }; },
      async first(column) { return column ? null : { used_units: 0 }; },
      async raw() { return []; }
    };
    return self;
  };
  return { prepare: statement, async batch(list) { return list.map(() => ({ results: [] })); } };
}

// A fetch that hands the client's request to the real route handler.
function routeFetch(env) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const request = new Request(new URL(url, "http://127.0.0.1"), init);
    calls.push({ contentType: request.headers.get("content-type") ?? "" });
    const response = await handleAiAssistRoute(request, new URL(request.url), env);
    return response;
  };
  return { impl, calls };
}

const workersAiReading = (read) => ({
  async run() {
    return { choices: [{ message: { role: "assistant", content: JSON.stringify(read) } }] };
  }
});

test("a receipt read by the real route reaches the card with every field the card reads", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no gateway in this test"); });
  const env = {
    DB: createFakeDb(),
    AI_ASSIST_ENABLED: "true",
    AI: workersAiReading({
      merchant: "Lumen Grocer Pte Ltd",
      merchantConfidence: "high",
      date: TODAY,
      dateConfidence: "medium",
      dateAlternatives: [],
      totalAmount: "21.95",
      currency: "SGD",
      totalConfidence: "high",
      cardDigits: "************2718",
      lineItems: [{ description: "Oat milk 1L", amount: "4.50", quantity: 1 }]
    })
  };
  const route = routeFetch(env);

  const result = await requestReceiptRead({ image: new Blob([JPEG], { type: "image/jpeg" }), fetchImpl: route.impl });

  assert.match(route.calls[0].contentType, /^multipart\/form-data/);
  assert.equal(result.ok, true);
  assert.deepEqual(result.receipt, {
    source: "ai",
    merchant: { value: "Lumen Grocer Pte Ltd", confidence: "high" },
    date: { value: TODAY, confidence: "medium" },
    total: { amountMinor: 2195, currency: "SGD", confidence: "high" },
    cardLast4: "2718",
    lineItems: [{ description: "Oat milk 1L", amountMinor: 450, quantity: 1 }],
    questions: []
  });

  const card = applyReceiptRead(createAskCard(cardContext), result.receipt, cardContext);
  assert.equal(card.fields.description, "Lumen Grocer Pte Ltd");
  assert.equal(card.fields.date, TODAY);
  assert.equal(card.fields.amountMinor, 2195);
  assert.equal(card.fields.accountId, "acct-citi", "the printed last four digits pick the wallet");
  assert.deepEqual(card.questions, []);
});

test("the route's AI-off answer comes back as unavailable with its reason, so the page reads on the device", async () => {
  const route = routeFetch({ DB: createFakeDb() });
  const result = await requestReceiptRead({ image: new Blob([JPEG], { type: "image/jpeg" }), fetchImpl: route.impl });
  assert.equal(result.ok, false);
  assert.match(result.reason, /turned off|not configured/);
  assert.notEqual(result.reason, "unreadable");
});

test("an image the route rejects (bytes that are not the declared type) fails soft", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no gateway in this test"); });
  const route = routeFetch({ DB: createFakeDb(), AI_ASSIST_ENABLED: "true", AI: workersAiReading({}) });
  const result = await requestReceiptRead({ image: new Blob([GIF], { type: "image/jpeg" }), fetchImpl: route.impl });
  assert.deepEqual(result, { ok: false, reason: "failed" });
});

test("a real entry draft keeps its fields, sources and structured questions through the adapter", () => {
  const draft = parseEntrySentence("Koufu lunch $12.50 yesterday", {
    today: "2026-10-11",
    accounts: [
      { id: "acct-citi", institutionId: "inst-citi", ownerPersonId: "person-ethan", name: "Citi Cash Back Card", institution: "Citibank", kind: "credit_card", ownerLabel: "Ethan", currency: "SGD", isJoint: false, isActive: true },
      { id: "acct-ocbc", institutionId: "inst-ocbc", ownerPersonId: "person-ethan", name: "OCBC 365 Card", institution: "OCBC", kind: "credit_card", ownerLabel: "Ethan", currency: "SGD", isJoint: false, isActive: true }
    ],
    people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
    categoryNames: ["Food & Drinks", "Other", "Transfer"],
    categoryMatchRules: [],
    defaultAccountPriorityIds: [],
    viewerName: "Ethan"
  });
  const read = readEntryDraftResponse({ ok: true, draft, ai: { requested: false, available: false } });

  assert.ok(read, "the real draft is readable");
  assert.equal(read.fields.amountMinor.value, 1250);
  assert.equal(read.fields.amountMinor.source, "sentence");
  assert.equal(read.fields.date.value, "2026-10-10");
  assert.equal(read.fields.entryType.value, "expense");
  for (const [name, field] of Object.entries(draft.fields)) {
    assert.deepEqual(read.fields[name], { value: field.value, source: field.source }, `${name} survives the adapter`);
  }
  assert.deepEqual(read.missing, draft.missing);
  assert.deepEqual(read.questions, draft.questions.map(({ field, reason, options }) => ({ field, reason, options })));

  const card = applyEntryDraft(createAskCard(cardContext), read, cardContext);
  assert.equal(card.fields.amountMinor, 1250);
  assert.equal(card.fields.date, "2026-10-10");
});

test("requestEntryDraft sends the body the real route reads, and its 400 fails soft", async () => {
  const route = routeFetch({ DB: createFakeDb() });
  assert.deepEqual(await requestEntryDraft({ text: "   ", viewId: "household", fetchImpl: route.impl }), { ok: false, reason: "failed" });
  assert.match(route.calls[0].contentType, /^application\/json/);
});
