import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_CURRENCY_ALLOWLIST,
  RECEIPT_READ_JSON_SCHEMA,
  finalizeReceiptRead,
  receiptReadToDraftFields
} from "../src/domain/receipt-read.ts";

// The app validates every value a model (or OCR) reads from a receipt.
// These pin the concrete DTO and each guarded path: a future date, a
// negative or absurd total, a long card number, an unknown currency, and
// an ambiguous date that must become a question with candidates.

const TODAY = "2026-10-11";

function modelRead(overrides = {}) {
  return {
    merchant: "Lumen Grocer Pte Ltd",
    merchantConfidence: "high",
    date: "2026-10-09",
    dateConfidence: "high",
    dateAlternatives: [],
    totalAmount: "23.45",
    currency: "SGD",
    totalConfidence: "high",
    cardDigits: "2718",
    lineItems: [
      { description: "Oat milk 1L", amount: "4.50", quantity: 1 },
      { description: "Member discount", amount: "-0.50", quantity: null }
    ],
    ...overrides
  };
}

test("a clear receipt becomes a complete ReceiptReadDto with no questions", () => {
  assert.deepEqual(finalizeReceiptRead(modelRead(), { today: TODAY, source: "ai" }), {
    source: "ai",
    merchant: { value: "Lumen Grocer Pte Ltd", confidence: "high" },
    date: { value: "2026-10-09", confidence: "high" },
    total: { amountMinor: 2345, currency: "SGD", confidence: "high" },
    cardLast4: "2718",
    lineItems: [
      { description: "Oat milk 1L", amountMinor: 450, quantity: 1 },
      { description: "Member discount", amountMinor: -50, quantity: null }
    ],
    questions: []
  });
});

test("a date in the future beyond a day's tolerance is dropped and asked about", () => {
  const read = finalizeReceiptRead(modelRead({ date: "2026-10-20" }), { today: TODAY, source: "ai" });
  assert.deepEqual(read.date, { value: null, confidence: "low" });
  assert.deepEqual(read.questions, [{ field: "date", reason: "future_date" }]);

  // Tomorrow is allowed: the receipt's time zone can be ahead of UTC.
  const tomorrow = finalizeReceiptRead(modelRead({ date: "2026-10-12" }), { today: TODAY, source: "ai" });
  assert.equal(tomorrow.date.value, "2026-10-12");
  assert.deepEqual(tomorrow.questions, []);
});

test("an impossible or malformed date is rejected rather than guessed", () => {
  for (const date of ["2026-02-30", "09/10/2026", "yesterday", 20261009]) {
    const read = finalizeReceiptRead(modelRead({ date }), { today: TODAY, source: "ai" });
    assert.equal(read.date.value, null, `date ${date}`);
    assert.deepEqual(read.questions, [{ field: "date", reason: "missing" }]);
  }
});

test("a negative, zero or absurd total is rejected and asked about", () => {
  for (const totalAmount of ["-23.45", "0", "0.00", "99999999.00", "12.345", "1,234.50", "abc"]) {
    const read = finalizeReceiptRead(modelRead({ totalAmount }), { today: TODAY, source: "ai" });
    assert.equal(read.total.amountMinor, null, `total ${totalAmount}`);
    assert.equal(read.total.confidence, "low");
    assert.deepEqual(read.questions, [{ field: "total", reason: "invalid_amount" }]);
  }
});

test("a long printed card number keeps only its last four digits", () => {
  for (const cardDigits of ["5000 0000 0000 3141", "************3141", "XXXX-XXXX-XXXX-3141", "3141"]) {
    const read = finalizeReceiptRead(modelRead({ cardDigits }), { today: TODAY, source: "ai" });
    assert.equal(read.cardLast4, "3141");
  }
  assert.equal(finalizeReceiptRead(modelRead({ cardDigits: "49" }), { today: TODAY, source: "ai" }).cardLast4, null);
  assert.equal(finalizeReceiptRead(modelRead({ cardDigits: null }), { today: TODAY, source: "ai" }).cardLast4, null);
});

test("long digit runs in merchant and item text are redacted so no card number leaks", () => {
  const read = finalizeReceiptRead(modelRead({
    merchant: "Card 5000000000003141 Lumen",
    lineItems: [{ description: "Ref 1234567890123 coffee", amount: "3.20", quantity: 1 }]
  }), { today: TODAY, source: "ai" });
  assert.equal(read.merchant.value, "Card [number] Lumen");
  assert.equal(read.lineItems[0].description, "Ref [number] coffee");
});

test("an unknown currency is dropped and asked about, and codes are normalized", () => {
  const unknown = finalizeReceiptRead(modelRead({ currency: "XYZ" }), { today: TODAY, source: "ai" });
  assert.equal(unknown.total.currency, null);
  assert.equal(unknown.total.amountMinor, 2345);
  assert.deepEqual(unknown.questions, [{ field: "currency", reason: "unsupported_currency" }]);

  const lower = finalizeReceiptRead(modelRead({ currency: "idr", totalAmount: "45000" }), { today: TODAY, source: "ai" });
  assert.equal(lower.total.currency, "IDR");
  assert.equal(lower.total.amountMinor, 4_500_000);

  const missing = finalizeReceiptRead(modelRead({ currency: null }), { today: TODAY, source: "ai" });
  assert.deepEqual(missing.questions, [{ field: "currency", reason: "missing" }]);
  assert.ok(RECEIPT_CURRENCY_ALLOWLIST.includes("SGD"));
  assert.ok(!RECEIPT_CURRENCY_ALLOWLIST.includes("XYZ"));
});

test("an ambiguous date keeps the read value at low confidence and offers validated candidates", () => {
  const read = finalizeReceiptRead(modelRead({
    date: "2026-04-03",
    dateConfidence: "medium",
    dateAlternatives: ["2026-03-04", "2026-13-04", "2026-04-03", "not a date"]
  }), { today: TODAY, source: "ai" });
  assert.deepEqual(read.date, { value: "2026-04-03", confidence: "low" });
  assert.deepEqual(read.questions, [{ field: "date", reason: "ambiguous", candidates: ["2026-04-03", "2026-03-04"] }]);
});

test("a low-confidence or missing field becomes a question, and an old date is flagged", () => {
  const read = finalizeReceiptRead(modelRead({
    merchant: null,
    merchantConfidence: "high",
    date: "2024-01-15",
    totalConfidence: "low"
  }), { today: TODAY, source: "ai" });
  assert.deepEqual(read.questions, [
    { field: "merchant", reason: "missing" },
    { field: "date", reason: "old_date" },
    { field: "total", reason: "unclear" }
  ]);
  assert.equal(read.merchant.confidence, "low");
});

test("line items are bounded, trimmed and stripped of invalid amounts", () => {
  const lineItems = Array.from({ length: 50 }, (_, index) => ({
    description: `  Item ${index}\n  extra  `,
    amount: index === 0 ? "bad" : "1.00",
    quantity: index === 1 ? -3 : 2
  }));
  lineItems.push({ description: "", amount: "1.00", quantity: 1 });
  const read = finalizeReceiptRead(modelRead({ lineItems }), { today: TODAY, source: "ai" });
  assert.equal(read.lineItems.length, 30);
  assert.deepEqual(read.lineItems[0], { description: "Item 0 extra", amountMinor: null, quantity: 2 });
  assert.deepEqual(read.lineItems[1], { description: "Item 1 extra", amountMinor: 100, quantity: null });
});

test("output that is not an object, or reads nothing at all, is unusable", () => {
  for (const value of [null, "text", [], 42]) {
    assert.equal(finalizeReceiptRead(value, { today: TODAY, source: "ai" }), null);
  }
  assert.equal(finalizeReceiptRead({ merchant: null, date: null, totalAmount: null }, { today: TODAY, source: "ai" }), null);
});

test("the model is asked for a strict schema with no free-text prose fields", () => {
  assert.equal(RECEIPT_READ_JSON_SCHEMA.type, "object");
  assert.equal(RECEIPT_READ_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual([...RECEIPT_READ_JSON_SCHEMA.required].sort(), Object.keys(RECEIPT_READ_JSON_SCHEMA.properties).sort());
  assert.equal(RECEIPT_READ_JSON_SCHEMA.properties.lineItems.items.additionalProperties, false);
  assert.equal("questions" in RECEIPT_READ_JSON_SCHEMA.properties, false);
});

// Mapping to the existing /api/entries/create field names, so the
// entry-draft branch can merge with one call.
const ACCOUNTS = [
  { id: "acct-citi", currency: "SGD", last4: "3141", isActive: true },
  { id: "acct-uob", currency: "SGD", last4: "2718", isActive: true },
  { id: "acct-old", currency: "SGD", last4: "1111", isActive: false },
  { id: "acct-dup-a", currency: "SGD", last4: "7777", isActive: true },
  { id: "acct-dup-b", currency: "SGD", last4: "7777", isActive: true }
];

test("a receipt maps to entry create fields and picks the one account with that card ending", () => {
  const read = finalizeReceiptRead(modelRead(), { today: TODAY, source: "ai" });
  assert.deepEqual(receiptReadToDraftFields(read, { accounts: ACCOUNTS }), {
    date: "2026-10-09",
    description: "Lumen Grocer Pte Ltd",
    amountMinor: 2345,
    entryType: "expense",
    accountId: "acct-uob",
    accountMatchedBy: "card_last4"
  });
});

test("no single active account match leaves the account for Default account priority", () => {
  for (const cardDigits of ["1111", "7777", "0000", null]) {
    const read = finalizeReceiptRead(modelRead({ cardDigits }), { today: TODAY, source: "ai" });
    const fields = receiptReadToDraftFields(read, { accounts: ACCOUNTS });
    assert.equal("accountId" in fields, false, `card ${cardDigits}`);
    assert.equal(fields.amountMinor, 2345);
  }
});

test("a foreign-currency total is a currency hint, not an account-currency amount", () => {
  const read = finalizeReceiptRead(modelRead({ currency: "IDR", totalAmount: "45000", cardDigits: "3141" }), { today: TODAY, source: "ai" });
  assert.deepEqual(receiptReadToDraftFields(read, { accounts: ACCOUNTS }), {
    date: "2026-10-09",
    description: "Lumen Grocer Pte Ltd",
    entryType: "expense",
    accountId: "acct-citi",
    accountMatchedBy: "card_last4",
    currencyHint: { currency: "IDR", amountMinor: 4_500_000, needsConversion: true }
  });
});

test("unreadable fields are left out of the draft instead of being filled with guesses", () => {
  const read = finalizeReceiptRead(modelRead({ merchant: null, date: "2027-01-01", totalAmount: "-5.00", cardDigits: null }), { today: TODAY, source: "ai" });
  assert.deepEqual(receiptReadToDraftFields(read, { accounts: [] }), { entryType: "expense" });
});
