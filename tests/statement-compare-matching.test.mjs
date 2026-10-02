// How Settings "Compare statement" pairs statement rows with ledger rows
// (matchStatementCompareRows). Hand-recorded entries carry the day of
// purchase and the user's own wording; statement rows carry the posted day,
// the purchase day in their note, and the bank's wording. The rows below are
// from the sanitized two-card UOB statement
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized).
import assert from "node:assert/strict";
import test from "node:test";

import { matchStatementCompareRows } from "../src/domain/app-repository-checkpoints.ts";

const statement = (id, date, description, signedAmountMinor, txnDate) => ({
  id,
  date,
  description,
  amountMinor: Math.abs(signedAmountMinor),
  signedAmountMinor,
  entryType: signedAmountMinor < 0 ? "expense" : "income",
  ...(txnDate ? { note: `txn date: ${txnDate}` } : {})
});
const ledger = (id, date, description, signedAmountMinor, transactionDate) => ({
  id,
  date,
  description,
  amountMinor: Math.abs(signedAmountMinor),
  signedAmountMinor,
  entryType: signedAmountMinor < 0 ? "expense" : "income",
  ...(transactionDate ? { transactionDate } : {})
});

function pairs(statementRows, ledgerRows) {
  return Object.fromEntries(matchStatementCompareRows(statementRows, ledgerRows).ledgerIdByStatementId);
}

test("rows that already matched keep matching: same posted day, or within three days with close wording", () => {
  assert.deepEqual(pairs(
    [
      statement("s-dimsum", "2026-04-13", "HONG KONG ZHAI DIMI S Singapore", -1140, "2026-04-11"),
      statement("s-ntuc", "2026-04-18", "NTUC FAIRPRICE CO-OP SINGAPORE", -6435, "2026-04-17"),
      statement("s-donki", "2026-05-02", "DON DON DONKI SINGAPORE", -1890, "2026-04-30")
    ],
    [
      // Imported from an earlier export: the posted day and the bank's words.
      ledger("l-dimsum", "2026-04-13", "HONG KONG ZHAI DIMI S Singapore", -1140, "2026-04-11"),
      ledger("l-ntuc", "2026-04-17", "NTUC FAIRPRICE CO-OP", -6435),
      ledger("l-donki", "2026-04-30", "Don Don Donki", -1890)
    ]
  ), { "s-dimsum": "l-dimsum", "s-ntuc": "l-ntuc", "s-donki": "l-donki" });
});

test("a bus fare recorded on the day of travel matches the row the bank posted four days later", () => {
  assert.deepEqual(pairs(
    [statement("s-bus", "2026-05-09", "BUS/MRT 000000000 SINGAPORE", -394, "2026-05-05")],
    [ledger("l-bus", "2026-05-05", "BUS/MRT", -394)]
  ), { "s-bus": "l-bus" });
});

test("a refund worded by hand matches the statement's credit on the same purchase day", () => {
  assert.deepEqual(pairs(
    [statement("s-refund", "2026-05-05", "NTUC FAIRPRICE CO-OP SINGAPORE", 520, "2026-05-04")],
    [ledger("l-refund", "2026-05-04", "NTUC FairPrice refund", 520)]
  ), { "s-refund": "l-refund" });
});

test("an entry in the user's own words matches when it is the only one of that amount within a week", () => {
  assert.deepEqual(pairs(
    [statement("s-shaw", "2026-05-03", "SHAW THEATRES SINGAPORE", -2800, "2026-05-03")],
    [ledger("l-movie", "2026-05-01", "Movie night", -2800)]
  ), { "s-shaw": "l-movie" });
});

test("loose matching never pairs a different amount, a refund with a purchase, or a row more than a week away", () => {
  assert.deepEqual(pairs(
    [
      statement("s-bus", "2026-05-09", "BUS/MRT 000000000 SINGAPORE", -394, "2026-05-05"),
      statement("s-refund", "2026-05-05", "NTUC FAIRPRICE CO-OP SINGAPORE", 520, "2026-05-04"),
      statement("s-shaw", "2026-05-03", "SHAW THEATRES SINGAPORE", -2800, "2026-05-03")
    ],
    [
      ledger("l-bus", "2026-05-05", "BUS/MRT", -395),
      // Recorded as money out: a direction mismatch, left for review.
      ledger("l-refund", "2026-05-04", "NTUC FairPrice refund", -520),
      ledger("l-movie", "2026-04-24", "Movie night", -2800)
    ]
  ), {});
});

test("low-value repeats more than two days apart stay separate purchases, as everywhere else", () => {
  // Coffee under $5 on 1 May is not the coffee the bank shows for 6 May.
  assert.deepEqual(pairs(
    [statement("s-coffee", "2026-05-06", "STARBUCKS SINGAPORE", -450, "2026-05-06")],
    [ledger("l-coffee", "2026-05-01", "Starbucks", -450)]
  ), {});
  // Two days apart is still the same purchase.
  assert.deepEqual(pairs(
    [statement("s-coffee", "2026-05-03", "STARBUCKS SINGAPORE", -450, "2026-05-03")],
    [ledger("l-coffee", "2026-05-01", "Starbucks", -450)]
  ), { "s-coffee": "l-coffee" });
});

test("when two entries could answer a row and neither shares its wording, none is picked", () => {
  assert.deepEqual(pairs(
    [statement("s-shaw", "2026-05-03", "SHAW THEATRES SINGAPORE", -2800, "2026-05-03")],
    [ledger("l-movie", "2026-05-01", "Movie night", -2800), ledger("l-dinner", "2026-05-04", "Dinner", -2800)]
  ), {});
  // A shared word still picks the right one.
  assert.deepEqual(pairs(
    [statement("s-shaw", "2026-05-03", "SHAW THEATRES SINGAPORE", -2800, "2026-05-03")],
    [ledger("l-dinner", "2026-05-03", "Dinner", -2800), ledger("l-shaw", "2026-05-01", "Shaw movie", -2800)]
  ), { "s-shaw": "l-shaw" });
});

test("one entry answers one row: two rides of the same fare need two entries", () => {
  const rides = [
    statement("s-ride-1", "2026-05-07", "BUS/MRT 000000001 SINGAPORE", -394, "2026-05-05"),
    statement("s-ride-2", "2026-05-09", "BUS/MRT 000000002 SINGAPORE", -394, "2026-05-07")
  ];
  assert.deepEqual(pairs(rides, [ledger("l-ride", "2026-05-05", "BUS/MRT", -394)]), { "s-ride-1": "l-ride" });
  assert.deepEqual(
    pairs(rides, [ledger("l-ride-a", "2026-05-05", "BUS/MRT", -394), ledger("l-ride-b", "2026-05-07", "BUS/MRT", -394)]),
    { "s-ride-1": "l-ride-a", "s-ride-2": "l-ride-b" }
  );
});
