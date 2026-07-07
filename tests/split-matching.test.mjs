import assert from "node:assert/strict";
import test from "node:test";

import {
  findBestSplitExpenseLedgerCandidate,
  findBestSplitSettlementLedgerCandidate
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
