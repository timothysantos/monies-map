import assert from "node:assert/strict";
import test from "node:test";

import {
  findBestSplitExpenseLedgerCandidate,
  findBestSplitExpenseMatch,
  findBestSplitSettlementLedgerCandidate,
  findBestCrossCurrencySplitExpenseLedgerCandidate,
  findBestCrossCurrencySplitSettlementLedgerCandidate
} from "../src/domain/split-matching.ts";

test("split expense matching prefers same amount, close date, and shared merchant words", () => {
  const match = findBestSplitExpenseLedgerCandidate(
    {
      id: "split-1",
      date: "2026-06-27",
      description: "Zero Coffee",
      totalAmountMinor: 8150
    },
    [
      {
        id: "wrong-type",
        transaction_date: "2026-06-27",
        description: "ZERO COFFEE SINGAPORE SG",
        amount_minor: 8150,
        entry_type: "income"
      },
      {
        id: "best",
        transaction_date: "2026-06-27",
        description: "ZERO COFFEE SINGAPORE SG",
        amount_minor: 8150,
        entry_type: "expense"
      },
      {
        id: "too-far",
        transaction_date: "2026-07-08",
        description: "ZERO COFFEE SINGAPORE SG",
        amount_minor: 8150,
        entry_type: "expense"
      }
    ]
  );

  assert.equal(match?.row.id, "best");
  assert.equal(match?.amountDelta, 0);
  assert.equal(match?.dateDelta, 0);
  assert.equal(match?.overlap, 2);
});

test("split expense matching rejects amount-close rows without merchant overlap", () => {
  const match = findBestSplitExpenseLedgerCandidate(
    {
      id: "split-1",
      date: "2026-06-27",
      description: "Zero Coffee",
      totalAmountMinor: 8150
    },
    [
      {
        id: "different-merchant",
        transaction_date: "2026-06-27",
        description: "BOOKSTORE SINGAPORE",
        amount_minor: 8150,
        entry_type: "expense"
      }
    ]
  );

  assert.equal(match, undefined);
});

test("split settlement matching accepts close transfer rows without merchant text", () => {
  const match = findBestSplitSettlementLedgerCandidate(
    {
      id: "settlement-1",
      date: "2026-06-12",
      amountMinor: 780
    },
    [
      {
        id: "card-spend",
        transaction_date: "2026-06-12",
        description: "GRAB SINGAPORE",
        amount_minor: 780,
        entry_type: "expense"
      },
      {
        id: "transfer",
        transaction_date: "2026-06-13",
        description: "PAYNOW FAST",
        amount_minor: 780,
        entry_type: "transfer"
      }
    ]
  );

  assert.equal(match?.row.id, "transfer");
  assert.equal(match?.dateDelta, 1);
  assert.equal(match?.amountDelta, 0);
});

test("cross-currency card matching uses merchant and date without comparing unlike amounts", () => {
  const match = findBestCrossCurrencySplitExpenseLedgerCandidate(
    {
      id: "tokyo-meal",
      date: "2026-08-10",
      description: "Family ramen Ichiran",
      totalAmountMinor: 20000,
      paymentMethod: "card",
      paymentStatus: "awaiting_statement"
    },
    [
      { id: "too-far", transaction_date: "2026-08-18", description: "ICHIRAN TOKYO", amount_minor: 18250, entry_type: "expense" },
      { id: "best", transaction_date: "2026-08-12", description: "ICHIRAN SHINJUKU JP", amount_minor: 18250, entry_type: "expense" }
    ]
  );

  assert.equal(match?.row.id, "best");
  assert.equal(match?.dateDelta, 2);
  assert.equal(match?.overlap, 1);
  assert.equal(match?.amountDelta, 0);
});

test("cross-currency expense matching rejects cash and already certified evidence", () => {
  const row = [{ id: "ledger", transaction_date: "2026-08-10", description: "ICHIRAN TOKYO", amount_minor: 18250, entry_type: "expense" }];
  assert.equal(findBestCrossCurrencySplitExpenseLedgerCandidate({
    id: "cash", date: "2026-08-10", description: "Ichiran", totalAmountMinor: 20000,
    paymentMethod: "cash", paymentStatus: "recorded"
  }, row), undefined);
  assert.equal(findBestCrossCurrencySplitExpenseLedgerCandidate({
    id: "certified", date: "2026-08-10", description: "Ichiran", totalAmountMinor: 20000,
    paymentMethod: "card", paymentStatus: "certified"
  }, row), undefined);
});

test("cross-currency group settle-up matching requires pending bank evidence and a nearby transfer", () => {
  const match = findBestCrossCurrencySplitSettlementLedgerCandidate(
    { id: "tokyo-settle", date: "2026-08-20", amountMinor: 30000, paymentMethod: "bank", paymentStatus: "awaiting_statement" },
    [
      { id: "expense", transaction_date: "2026-08-20", description: "PAYNOW", amount_minor: 28000, entry_type: "expense" },
      { id: "transfer", transaction_date: "2026-08-22", description: "PAYNOW JOYCE", amount_minor: 28000, entry_type: "transfer" }
    ]
  );

  assert.equal(match?.row.id, "transfer");
  assert.equal(match?.dateDelta, 2);
});

const flight = { id: "flight", date: "2026-06-24", description: "SINGAPOREAIR Korea KOR KRW", totalAmountMinor: 105_184, currency: "SGD", payerPersonId: "person-tim" };
const bankRow = (overrides = {}) => ({
  id: "row-1",
  transaction_date: "2026-06-24",
  description: "SINGAPORE6182478320308",
  amount_minor: 105_184,
  entry_type: "expense",
  currency: "SGD",
  owner_person_id: "person-tim",
  ...overrides
});

test("exact amount and date with no shared word is suggested, and says why", () => {
  assert.equal(findBestSplitExpenseLedgerCandidate(flight, [bankRow()]), undefined, "the word-only rule alone never found it");
  const match = findBestSplitExpenseMatch(flight, [bankRow()]);
  assert.equal(match?.row.id, "row-1");
  assert.equal(match?.reason, "exact-amount-and-date");
  assert.equal(match?.overlap, 0);
});

test("two exact rows, a one-cent difference, two days apart, a transfer or someone else's account suggest nothing", () => {
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow(), bankRow({ id: "row-2", description: "OTHER" })]), undefined);
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow({ amount_minor: 105_185 })]), undefined);
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow({ transaction_date: "2026-06-26" })]), undefined);
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow({ entry_type: "transfer" })]), undefined);
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow({ owner_person_id: "person-joyce" })]), undefined);
  // A shared account (no owner) is compatible; one day apart is the same payment.
  assert.equal(findBestSplitExpenseMatch(flight, [bankRow({ owner_person_id: null, transaction_date: "2026-06-25" })])?.row.id, "row-1");
});

test("a word match keeps its place: exact with words first, exact alone second, a near word match last", () => {
  const withWord = bankRow({ id: "word", description: "SINGAPOREAIR KOREA 1" });
  const noWord = bankRow({ id: "plain", description: "MERCHANT 7" });
  const nearWord = bankRow({ id: "near", description: "SINGAPOREAIR KOREA 2", amount_minor: 105_284 });
  assert.equal(findBestSplitExpenseMatch(flight, [noWord, withWord])?.row.id, "word");
  assert.equal(findBestSplitExpenseMatch(flight, [noWord, withWord])?.reason, "words");
  assert.equal(findBestSplitExpenseMatch(flight, [nearWord, noWord])?.row.id, "plain");
  assert.equal(findBestSplitExpenseMatch(flight, [nearWord])?.row.id, "near");
  assert.equal(findBestSplitExpenseMatch(flight, [nearWord])?.reason, "words");
  // Two exact rows without words: a tie, so the near word match is all there is.
  assert.equal(findBestSplitExpenseMatch(flight, [noWord, bankRow({ id: "plain2", description: "MERCHANT 8" }), nearWord])?.row.id, "near");
});

test("a foreign-currency card split compares its home amount, and only while it awaits its statement", () => {
  const krw = { ...flight, currency: "KRW", totalAmountMinor: 20_000_000, homeAmountMinor: 105_184, paymentMethod: "card", paymentStatus: "awaiting_statement" };
  assert.equal(findBestSplitExpenseMatch(krw, [bankRow()])?.row.id, "row-1");
  assert.equal(findBestSplitExpenseMatch({ ...krw, homeAmountMinor: 105_185 }, [bankRow()]), undefined);
  assert.equal(findBestSplitExpenseMatch({ ...krw, homeAmountMinor: null }, [bankRow()]), undefined);
  assert.equal(findBestSplitExpenseMatch({ ...krw, paymentMethod: "cash", paymentStatus: "recorded" }, [bankRow()]), undefined);
  assert.equal(findBestSplitExpenseMatch({ ...krw, paymentStatus: "certified" }, [bankRow()]), undefined);
  // A row in yen of the same figure is not the home amount.
  assert.equal(findBestSplitExpenseMatch(krw, [bankRow({ currency: "JPY" })]), undefined);
});
