// Cash entry rules (DOMAIN.md "Cash Entry"): the currency the pad opens in,
// zero-decimal currencies, the pad's keys, the Shortcut's words, the Again
// chips and the saved line.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashAgainChips,
  chooseCashCurrency,
  describeSavedCash,
  formatCashAmount,
  formatCashFigure,
  groupCashPadText,
  isValidCashAmountMinor,
  isZeroDecimalCurrency,
  padTextToMinor,
  pressCashPadKey,
  readCashFigure,
  readCashRequestId,
  readCashSpokenText,
  tidyCashDescription,
  tripOnToday,
  ZERO_DECIMAL_CURRENCIES
} from "../src/domain/cash-entry.ts";

const bali = { id: "trip-bali", name: "Bali trip", startDate: "2026-11-14", endDate: "2026-11-24", currency: "IDR" };

test("the currency is the trip on today's, else the last cash currency in 7 days, else the wallet's", () => {
  assert.deepEqual(
    chooseCashCurrency({ today: "2026-11-17", trips: [bali], recentCash: [{ date: "2026-11-16", currency: "THB" }], walletCurrency: "SGD" }),
    { currency: "IDR", reason: "trip", trip: { id: "trip-bali", name: "Bali trip" } }
  );
  assert.deepEqual(
    chooseCashCurrency({ today: "2026-11-30", trips: [bali], recentCash: [{ date: "2026-11-20", currency: "IDR" }, { date: "2026-11-24", currency: "THB" }], walletCurrency: "SGD" }),
    { currency: "THB", reason: "recent", trip: null }
  );
  assert.deepEqual(
    chooseCashCurrency({ today: "2026-12-10", trips: [bali], recentCash: [{ date: "2026-12-02", currency: "THB" }], walletCurrency: "SGD" }),
    { currency: "SGD", reason: "wallet", trip: null },
    "a payment 8 days ago is not recent"
  );
});

test("a trip with no currency, a put-away trip or an undated one never sets the currency", () => {
  const today = "2026-11-17";
  const recentCash = [{ date: "2026-11-15", currency: "KRW" }];
  assert.equal(chooseCashCurrency({ today, trips: [{ ...bali, currency: null }], recentCash, walletCurrency: "SGD" }).currency, "KRW");
  assert.equal(chooseCashCurrency({ today, trips: [{ ...bali, putAway: true }], recentCash: [], walletCurrency: "SGD" }).currency, "SGD");
  assert.equal(chooseCashCurrency({ today, trips: [{ ...bali, startDate: null, endDate: null }], recentCash: [], walletCurrency: "SGD" }).currency, "SGD");
  // A trip with no currency is still named, for the pad's line.
  assert.deepEqual(chooseCashCurrency({ today, trips: [{ ...bali, currency: null }], recentCash: [], walletCurrency: "SGD" }).trip, { id: "trip-bali", name: "Bali trip" });
});

test("with two trips on today, the one that started last wins", () => {
  const ubud = { id: "trip-ubud", name: "Ubud weekend", startDate: "2026-11-16", endDate: "2026-11-18", currency: "USD" };
  assert.equal(tripOnToday([bali, ubud], "2026-11-17").id, "trip-ubud");
  assert.equal(tripOnToday([bali, ubud], "2026-11-20").id, "trip-bali");
  assert.equal(tripOnToday([bali, ubud], "2026-12-01"), null);
});

test("zero-decimal currencies are one config list, IDR included", () => {
  for (const code of ["IDR", "KRW", "JPY", "VND"]) {
    assert.equal(isZeroDecimalCurrency(code), true, code);
  }
  assert.equal(isZeroDecimalCurrency("idr"), true);
  for (const code of ["SGD", "USD", "THB", "MYR", "EUR"]) {
    assert.equal(isZeroDecimalCurrency(code), false, code);
  }
  assert.ok(Object.isFrozen(ZERO_DECIMAL_CURRENCIES));
});

test("an amount must be positive, whole minor units, and whole units in a zero-decimal currency", () => {
  assert.equal(isValidCashAmountMinor(3_500_000, "IDR"), true);
  assert.equal(isValidCashAmountMinor(3_500_050, "IDR"), false, "no cents in rupiah");
  assert.equal(isValidCashAmountMinor(350, "SGD"), true);
  assert.equal(isValidCashAmountMinor(0, "SGD"), false);
  assert.equal(isValidCashAmountMinor(-350, "SGD"), false);
  assert.equal(isValidCashAmountMinor(3.5, "SGD"), false);
  assert.equal(isValidCashAmountMinor("350", "SGD"), false);
  assert.equal(isValidCashAmountMinor(100_000_000_001, "SGD"), false);
});

test("the pad has 000 and no decimal key in a zero-decimal currency", () => {
  let text = "";
  for (const key of ["3", "5", "000"]) text = pressCashPadKey(text, key, "IDR");
  assert.equal(text, "35000");
  assert.equal(pressCashPadKey(text, ".", "IDR"), "35000", "the dot does nothing in rupiah");
  assert.equal(padTextToMinor(text, "IDR"), 3_500_000);
  assert.equal(groupCashPadText(text), "35,000");
  assert.equal(pressCashPadKey("", "000", "IDR"), "", "no leading zeros");
  assert.equal(pressCashPadKey("", "0", "IDR"), "");
  assert.equal(pressCashPadKey("35000", "back", "IDR"), "3500");
  assert.equal(pressCashPadKey("999999999999", "1", "IDR"), "999999999999", "at most 12 figures");
});

test("the pad keeps two figures after the dot in a currency with cents", () => {
  let text = "";
  for (const key of ["3", ".", "5", "0", "9"]) text = pressCashPadKey(text, key, "SGD");
  assert.equal(text, "3.50");
  assert.equal(padTextToMinor(text, "SGD"), 350);
  assert.equal(pressCashPadKey("", ".", "SGD"), "0.");
  assert.equal(pressCashPadKey("3.5", ".", "SGD"), "3.5");
  assert.equal(pressCashPadKey("3.5", "000", "SGD"), "3.5");
  assert.equal(padTextToMinor("3.", "SGD"), 300);
  assert.equal(padTextToMinor("", "SGD"), null);
  assert.equal(padTextToMinor("0.", "SGD"), null);
});

test("a figure reads thousands marks, refuses cents in rupiah and odd groupings", () => {
  assert.equal(readCashFigure("35000", "IDR"), 3_500_000);
  assert.equal(readCashFigure("35,000", "IDR"), 3_500_000);
  assert.equal(readCashFigure("35.000", "IDR"), 3_500_000, "a dot is the thousands mark in rupiah");
  assert.equal(readCashFigure("1.234.567", "IDR"), 123_456_700);
  assert.equal(readCashFigure("35.5", "IDR"), null, "no cents in rupiah");
  assert.equal(readCashFigure("3.50", "SGD"), 350);
  assert.equal(readCashFigure("1,234.50", "SGD"), 123_450);
  assert.equal(readCashFigure("12,34", "SGD"), null);
  assert.equal(readCashFigure("abc", "SGD"), null);
});

test("the Shortcut reads an amount and words, in any order, with a currency word", () => {
  assert.deepEqual(readCashSpokenText("35000 coffee", "IDR"), { amountMinor: 3_500_000, currency: "IDR", description: "Coffee" });
  assert.deepEqual(readCashSpokenText("coffee 35,000", "IDR"), { amountMinor: 3_500_000, currency: "IDR", description: "Coffee" });
  assert.deepEqual(readCashSpokenText("35000 rupiah iced coffee", "SGD"), { amountMinor: 3_500_000, currency: "IDR", description: "Iced coffee" });
  assert.deepEqual(readCashSpokenText("Rp35.000 parking", "SGD"), { amountMinor: 3_500_000, currency: "IDR", description: "Parking" });
  assert.deepEqual(readCashSpokenText("35000", "IDR"), { amountMinor: 3_500_000, currency: "IDR", description: "" });
  assert.deepEqual(readCashSpokenText("4.5 taxi", "SGD"), { amountMinor: 450, currency: "SGD", description: "Taxi" });
  assert.equal(readCashSpokenText("coffee", "IDR"), null, "no figure, no amount");
  assert.equal(readCashSpokenText("", "IDR"), null);
  assert.equal(readCashSpokenText("35000.50 coffee", "IDR"), null, "cents refused in rupiah");
});

test("descriptions are tidied, capitalised and capped", () => {
  assert.equal(tidyCashDescription("  iced   coffee "), "Iced coffee");
  assert.equal(tidyCashDescription(""), "");
  assert.equal(tidyCashDescription(42), "");
  assert.equal(tidyCashDescription("x".repeat(200)).length, 120);
});

test("request ids are short safe tokens", () => {
  assert.equal(readCashRequestId("cash-20261117103000123"), "cash-20261117103000123");
  assert.equal(readCashRequestId("6f1c2c43-1a2b-4c5d-8e9f-0a1b2c3d4e5f"), "6f1c2c43-1a2b-4c5d-8e9f-0a1b2c3d4e5f");
  assert.equal(readCashRequestId("short"), null);
  assert.equal(readCashRequestId("has spaces in it"), null);
  assert.equal(readCashRequestId("x".repeat(65)), null);
  assert.equal(readCashRequestId(12345678), null);
});

test("amounts show the local sign, whole units without cents", () => {
  assert.equal(formatCashAmount(3_500_000, "IDR"), "Rp 35,000");
  assert.equal(formatCashAmount(3_500_000, "KRW"), "₩35,000");
  assert.equal(formatCashAmount(350, "SGD"), "$3.50");
  assert.equal(formatCashAmount(350, "USD"), "US$3.50");
  assert.equal(formatCashFigure(3_500_000, "IDR"), "35,000");
  assert.equal(formatCashFigure(350, "SGD"), "3.50");
  assert.equal(describeSavedCash({ description: "Coffee", amountMinor: 3_500_000, currency: "IDR" }), "Saved: Coffee, Rp 35,000 cash");
});

test("Again chips: newest first, each shop and amount once, at most four", () => {
  const row = (date, description, amountMinor, categoryName = "Food & Drinks") => ({ date, description, amountMinor, currency: "IDR", categoryName, note: null });
  const chips = buildCashAgainChips([
    row("2026-11-15", "Coffee", 3_500_000),
    row("2026-11-16", "Coffee", 3_500_000),
    row("2026-11-16", "Parking", 500_000, "Transport"),
    row("2026-11-14", "Nasi goreng", 4_500_000),
    row("2026-11-14", "Water", 800_000),
    row("2026-11-13", "Sarong", 12_000_000, "Shopping"),
    row("2026-11-13", "", 100_000)
  ]);
  assert.deepEqual(chips.map((chip) => `${chip.description} ${chip.amountMinor}`), [
    "Coffee 3500000",
    "Parking 500000",
    "Nasi goreng 4500000",
    "Water 800000"
  ]);
  assert.equal(chips[1].categoryName, "Transport");
  assert.deepEqual(buildCashAgainChips([]), []);
});
