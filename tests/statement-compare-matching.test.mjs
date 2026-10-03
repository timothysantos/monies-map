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

// Commuting on one card: $1.99 fares, two a day, the statement printing each
// ride's purchase day.
const ride = (id, posted, bought) => statement(id, posted, "BUS/MRT 000000000 SINGAPORE", -199, bought);
const entry = (id, date) => ledger(id, date, "BUS/MRT", -199);
const commute = [
  ride("s-mon-am", "2026-05-06", "2026-05-04"), ride("s-mon-pm", "2026-05-06", "2026-05-04"),
  ride("s-tue-am", "2026-05-07", "2026-05-05"), ride("s-tue-pm", "2026-05-07", "2026-05-05"),
  ride("s-wed-am", "2026-05-08", "2026-05-06"), ride("s-wed-pm", "2026-05-08", "2026-05-06")
];

function leftOver(statementRows, ledgerRows, options) {
  const result = matchStatementCompareRows(statementRows, ledgerRows, options);
  return {
    rows: statementRows.filter((row) => !result.matchedStatementIds.has(row.id)).map((row) => row.id),
    entries: ledgerRows.filter((row) => !result.matchedLedgerIds.has(row.id)).map((row) => row.id)
  };
}

test("a week of commuting: each ride meets its own day's row, and an unrecorded ride shows on its own day", () => {
  const all = [entry("l-mon-am", "2026-05-04"), entry("l-mon-pm", "2026-05-04"), entry("l-tue-am", "2026-05-05"), entry("l-tue-pm", "2026-05-05"), entry("l-wed-am", "2026-05-06"), entry("l-wed-pm", "2026-05-06")];
  assert.deepEqual(leftOver(commute, all), { rows: [], entries: [] });
  const tuesdayEveningMissing = all.filter((row) => row.id !== "l-tue-pm");
  assert.deepEqual(leftOver(commute, tuesdayEveningMissing), { rows: ["s-tue-pm"], entries: [] });
});

test("a ride typed a day late still meets its row when the real day's ride is also recorded", () => {
  assert.deepEqual(
    leftOver([ride("s-mon", "2026-05-06", "2026-05-04"), ride("s-tue", "2026-05-07", "2026-05-05")], [entry("l-typo", "2026-05-05"), entry("l-tue", "2026-05-05")]),
    { rows: [], entries: [] }
  );
});

test("a ride on the closing day that posts next statement is not paired with an unrecorded ride the day before", () => {
  const options = { statementEndDate: "2026-05-12", unpostedLedgerIds: new Set(["l-12"]) };
  // The 11 May ride is missing; the 12 May entry is the next statement's.
  assert.deepEqual(
    leftOver([ride("s-11", "2026-05-12", "2026-05-11")], [entry("l-12", "2026-05-12")], options),
    { rows: ["s-11"], entries: ["l-12"] }
  );
  // When the bank did post the 12 May ride on this statement, they match.
  assert.deepEqual(
    leftOver([ride("s-12", "2026-05-12", "2026-05-12")], [entry("l-12", "2026-05-12")], options),
    { rows: [], entries: [] }
  );
});
