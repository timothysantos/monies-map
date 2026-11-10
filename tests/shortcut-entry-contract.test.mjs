import assert from "node:assert/strict";
import test from "node:test";

import {
  hasOversizedShortcutDescription,
  normalizeShortcutAmount,
  normalizeShortcutCurrency,
  normalizeShortcutDate,
  normalizeShortcutDescription,
  normalizeShortcutRequestId,
  parseShortcutCreateBody
} from "../src/domain/shortcut-entry-contract.ts";

test("shortcut amount accepts Wallet currency text without losing cents", () => {
  assert.deepEqual(normalizeShortcutAmount(undefined, "SGD\u00a012.34"), {
    amountMinor: 1234,
    currency: "SGD"
  });
  assert.deepEqual(normalizeShortcutAmount(undefined, "S$1,234.56"), {
    amountMinor: 123456,
    currency: "SGD"
  });
  assert.deepEqual(normalizeShortcutAmount(undefined, "$6.90"), {
    amountMinor: 690
  });
  assert.deepEqual(normalizeShortcutAmount(420), { amountMinor: 420 });
});

test("shortcut amount rejects ambiguous, negative, over-precise, and unsafe values", () => {
  assert.equal(normalizeShortcutAmount(undefined, "12,34"), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "1.234,56"), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "€12.34"), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "SGD 12.345"), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "-SGD 12.34"), undefined);
  assert.equal(normalizeShortcutAmount(1234, "SGD 12.35"), undefined);
  assert.equal(normalizeShortcutAmount(12.5), undefined);
  assert.equal(normalizeShortcutAmount(Number.MAX_SAFE_INTEGER + 1), undefined);
});

test("shortcut amount reads a dot as the thousands mark when the groups are exactly three digits", () => {
  // Overseas terminals (and a typed answer) often write IDR with dots.
  assert.deepEqual(normalizeShortcutAmount(undefined, "Rp150.000"), { amountMinor: 15_000_000, currency: "IDR" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "IDR 150.000"), { amountMinor: 15_000_000, currency: "IDR" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "IDR\u00a01.234.567"), { amountMinor: 123_456_700, currency: "IDR" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "1.234.567"), { amountMinor: 123_456_700 });
  assert.deepEqual(normalizeShortcutAmount(undefined, "Rp.150.000"), { amountMinor: 15_000_000, currency: "IDR" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "Rp 1.500"), { amountMinor: 150_000, currency: "IDR" });
  // A single dot group with no Rupiah sign stays ambiguous and is refused.
  assert.equal(normalizeShortcutAmount(undefined, "150.000"), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "SGD 12.345"), undefined);
  // The existing readings are untouched.
  assert.deepEqual(normalizeShortcutAmount(undefined, "IDR 150,000"), { amountMinor: 15_000_000, currency: "IDR" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "19.82"), { amountMinor: 1982 });
  assert.deepEqual(normalizeShortcutAmount(undefined, "SGD 1.84"), { amountMinor: 184, currency: "SGD" });
  assert.deepEqual(normalizeShortcutAmount(undefined, "150.5"), { amountMinor: 15050 });
});

test("shortcut amount still refuses dot numbers that are not clean thousands", () => {
  for (const text of [
    "1.23.456", "1.2345", "12.345.67", "1.234.56", "0.000", "1.234.567,89", "0.123",
    "-5.00", "-IDR 150.000", "(Rp150.000)", "IDR 150.000 IDR 20.000", "1,234.567", "1.234,567"
  ]) {
    assert.equal(normalizeShortcutAmount(undefined, text), undefined, text);
  }
  // Two decimal places are cents, never thousands.
  assert.deepEqual(normalizeShortcutAmount(undefined, "150.00"), { amountMinor: 15_000 });
  // A blank answer is not an amount.
  assert.equal(normalizeShortcutAmount(undefined, ""), undefined);
  assert.equal(normalizeShortcutAmount(undefined, "  "), undefined);
});

test("shortcut date accepts the shared ISO contract and legacy day-first text", () => {
  assert.equal(normalizeShortcutDate("2026-08-22T19:07:30+08:00"), "2026-08-22");
  assert.equal(normalizeShortcutDate("22/8/26"), "2026-08-22");
  assert.equal(normalizeShortcutDate("8/9/26"), "2026-09-08");
  assert.equal(normalizeShortcutDate("31/02/2026"), undefined);
  assert.equal(normalizeShortcutDate("August 22, 2026"), undefined);
  assert.equal(normalizeShortcutDate("2026-08-22Tnot-a-time"), undefined);
});

test("shortcut descriptions are compact, bounded, and can fall back to merchant or name", () => {
  assert.equal(normalizeShortcutDescription(" ", "  FairPrice\n Finest  "), "FairPrice Finest");
  assert.equal(normalizeShortcutDescription(undefined, undefined, "Fallback name"), "Fallback name");
  assert.equal(normalizeShortcutDescription("A".repeat(501)), undefined);
  assert.equal(hasOversizedShortcutDescription("A".repeat(501)), true);
});

test("shortcut request identifiers and currencies use explicit bounded formats", () => {
  assert.equal(normalizeShortcutRequestId("apple-pay-2026-08-22T19:07:30.123+08:00"), "apple-pay-2026-08-22T19:07:30.123+08:00");
  assert.equal(normalizeShortcutRequestId("short"), undefined);
  assert.equal(normalizeShortcutCurrency("sgd"), "SGD");
  assert.equal(normalizeShortcutCurrency("S$"), undefined);
});

test("shortcut body parsing rejects malformed JSON shapes before route logic", () => {
  assert.deepEqual(parseShortcutCreateBody([]), {
    ok: false,
    error: "Shortcut request body must be a JSON object."
  });
  assert.deepEqual(parseShortcutCreateBody({ amount: { value: 12.34 }, offsetsCategory: "false" }), {
    ok: false,
    error: "Invalid shortcut field types: amount, offsetsCategory."
  });
  assert.deepEqual(parseShortcutCreateBody({ amount: "12.34", clientVersion: "v".repeat(81) }), {
    ok: false,
    error: "Shortcut clientVersion must be 80 characters or fewer."
  });
  assert.deepEqual(parseShortcutCreateBody({ amount: "SGD 12.34", merchant: "FairPrice" }), {
    ok: true,
    body: { amount: "SGD 12.34", merchant: "FairPrice" }
  });
});
