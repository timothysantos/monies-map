// The Ledger check-up's detectors and runner as pure functions over bounded
// read models (docs/proposals/ledger-checkup.md, docs/audits/ledger-checkup.md).
// Every detector has its positive shape, its tiers, and adversarial negatives:
// legitimate repeats, same-amount purchases on two cards, two real split
// dinners, foreign currency, certified entries, archived records. A finding is
// only shown when its rule can be proven; silence is the default.
import assert from "node:assert/strict";
import test from "node:test";

import { detectDuplicateEntries } from "../src/domain/ledger-checkup/duplicate-entries.ts";
import { detectHygiene } from "../src/domain/ledger-checkup/hygiene.ts";
import { detectPlanProblems } from "../src/domain/ledger-checkup/plan-problems.ts";
import { CHECKUP_DETECTORS } from "../src/domain/ledger-checkup/registry.ts";
import { compareFindings, runLedgerCheckup } from "../src/domain/ledger-checkup/runner.ts";
import { detectDuplicateSplits, detectSettledPeriodErrors } from "../src/domain/ledger-checkup/split-duplicates.ts";
import { detectStaleEstimates } from "../src/domain/ledger-checkup/stale-estimates.ts";
import { buildStatementChain, detectBalanceMismatches, detectStatementGaps, detectStatementJoins } from "../src/domain/ledger-checkup/statements.ts";
import { detectUnmatchedTransfers } from "../src/domain/ledger-checkup/unmatched-transfers.ts";
import { detectWrongCardDuplicates } from "../src/domain/ledger-checkup/wrong-card.ts";
import { buildPlanLinkCandidates } from "../src/client/month-helpers.js";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { checkupContext, emptyFacts, flightEntry, plannedRow, splitRecord, statement, transfer } from "./support/ledger-checkup-facts.mjs";

const context = checkupContext();
const kinds = (findings) => findings.map((item) => `${item.kind}:${item.tier}`);

// ---- 1. Wrong-card Apple Pay duplicates ------------------------------------

const wrongCardAccounts = new Map([
  ["acct-ladys", { id: "acct-ladys", name: "UOB Lady's Card", ownerPersonId: "person-tim", isJoint: false, currency: "SGD" }],
  ["acct-one", { id: "acct-one", name: "UOB One Card", ownerPersonId: "person-tim", isJoint: false, currency: "SGD" }]
]);
const applePay = (id, extra = {}) => ({
  id, accountId: "acct-ladys", date: "2026-10-11", description: "Cold Storage-Star Vist", amountMinor: 180, currency: "SGD",
  originalCurrency: null, ownerPersonId: "person-tim", hasLinks: false, ...extra
});
const bankRow = (id, extra = {}) => ({
  id, accountId: "acct-one", date: "2026-10-11", postDate: "2026-10-12", description: "COLD STORAGE-STAR VISTA SINGAPORE SG", amountMinor: 180, currency: "SGD",
  entryType: "expense", transferGroupId: null, originalCurrency: null, isBankRow: true, isPaired: false, isOpenApplePay: false, importedAt: "2026-10-14T03:00:00Z", ...extra
});
const coverage = (extra = {}) => ({
  accountId: "acct-ladys", first: "2026-07-13", last: "2026-10-13", referenceDate: "2026-10-14", kind: "earlier_import", importedAt: "2026-10-14T03:00:00Z", ...extra
});
const wrongCard = (overrides = {}) => ({
  input: {
    entries: [applePay("txn-aaaa1111")],
    ledger: [bankRow("txn-bbbb2222")],
    fileRows: [],
    listedEntryIds: new Set(),
    coverages: [coverage()],
    accounts: wrongCardAccounts,
    postingLagDays: () => 3,
    ...overrides
  }
});

test("wrong card: the entry, its twin on the other card and the card's own file that does not list it are a HIGH finding with no removal button", () => {
  const [found, ...rest] = detectWrongCardDuplicates(wrongCard(), context);
  assert.equal(rest.length, 0);
  assert.equal(found.id, "wrong_card_duplicate:txn-aaaa1111");
  assert.equal(found.tier, "high");
  assert.equal(found.amountMinor, 180);
  assert.equal(found.occurredOn, "2026-10-11");
  assert.deepEqual(found.personIds, ["person-tim"]);
  assert.match(found.summary, /\$1\.80 Cold Storage-Star Vist on UOB Lady's Card is the same purchase as COLD STORAGE-STAR VISTA SINGAPORE SG on UOB One Card, so UOB Lady's Card shows \$1\.80 too much/);
  assert.deepEqual(found.evidence.map((line) => [line.role, line.shortId, line.accountName]), [["entry", "aaaa1111", "UOB Lady's Card"], ["entry", "bbbb2222", "UOB One Card"], ["fact", undefined, undefined]]);
  assert.deepEqual(found.fix, { label: "Load UOB Lady's Card's bank file again in Imports", path: "/imports" });
});

test("wrong card: negatives stay silent or soften to a note", () => {
  // The card's own file does not cover the day.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ coverages: [coverage({ first: "2026-10-12", last: "2026-10-20" })] }), context), []);
  // No file of the card at all.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ coverages: [] }), context), []);
  // Loaded one day after: still inside the posting lag.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ coverages: [coverage({ referenceDate: "2026-10-12" })] }), context), []);
  // A daily repeat: two same-amount rows on the other card, so no twin is picked.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ ledger: [bankRow("txn-bbbb2222"), bankRow("txn-cccc3333", { date: "2026-10-10" })] }), context), []);
  // A same-amount row on the entry's own card may be the purchase under other words.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ ledger: [bankRow("txn-bbbb2222"), bankRow("txn-dddd4444", { accountId: "acct-ladys", description: "COLD STORAGE" })] }), context), []);
  // Another amount or another shop is not the same purchase.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ ledger: [bankRow("txn-bbbb2222", { amountMinor: 190 })] }), context), []);
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ ledger: [bankRow("txn-bbbb2222", { description: "GRAB* A-8XYZ SINGAPORE SG" })] }), context), []);
  // A foreign currency estimate is never HIGH.
  assert.deepEqual(kinds(detectWrongCardDuplicates(wrongCard({ entries: [applePay("txn-aaaa1111", { originalCurrency: "IDR" })] }), context)), ["wrong_card_duplicate:note"]);
  // An entry already linked to a split is only a note.
  assert.deepEqual(kinds(detectWrongCardDuplicates(wrongCard({ entries: [applePay("txn-aaaa1111", { hasLinks: true })] }), context)), ["wrong_card_duplicate:note"]);
  // No Apple Pay entry, no rule input at all.
  assert.deepEqual(detectWrongCardDuplicates({ input: null }, context), []);
  // Coverage from "this file" has no meaning outside an import.
  assert.deepEqual(detectWrongCardDuplicates(wrongCard({ coverages: [coverage({ kind: "this_file" })] }), context), []);
});

// ---- 2a. Duplicate split expenses ------------------------------------------

const pair = (a, b) => ({ pairs: [{ a, b }], deletedInSettled: [] });
const oneLinked = [splitRecord("exp-manual", { linkedTransactionId: null }), splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), description: "SINGAPORE AIRLINES SINGAPORE SG", createdAt: "2026-06-14T10:00:00Z" })];

test("duplicate split: a hand-typed expense next to a bank-linked one of the same day, amount, payer and shares is HIGH", () => {
  const [found] = detectDuplicateSplits(pair(...oneLinked), context);
  assert.equal(found.id, "duplicate_split:exp-bank+exp-manual");
  assert.equal(found.tier, "high");
  assert.equal(found.amountMinor, 105_184);
  assert.deepEqual(found.personIds, ["person-joyce", "person-tim"]);
  assert.match(found.summary, /Singapore Airlines flights \(\$1,051\.84, 12 Jun\) in Okaeri trip is in Splits twice, once typed in by hand and once from the bank record/);
  assert.equal(found.fix.path, "/splits?view=household&month=2026-06&split_group=split-group-trip");
  assert.equal(found.evidence.length, 2);
});

test("duplicate split: the wording need not match when the Splits matcher would put the typed record on that very bank row", () => {
  // "Flights to Okaeri" typed by hand, the bank row says SINGAPORE AIRLINES: no word in common, but the exact amount on the exact day on the payer's card.
  const [found] = detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Flights to Okaeri" }),
    splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1", linkedEntry: flightEntry() })
  ), context);
  assert.equal(found.tier, "high");
  // The same day, but the bank row is another amount: the matcher says no.
  assert.deepEqual(kinds(detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Flights to Okaeri" }),
    splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1", linkedEntry: flightEntry({ amountMinor: 100_000 }) })
  ), context)), ["duplicate_split:check"]);
  // The bank row is a different day (the card posted later): still within a day it matches, three days away it does not.
  assert.equal(detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Flights to Okaeri" }),
    splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1", linkedEntry: flightEntry({ date: "2026-06-13" }) })
  ), context)[0].tier, "high");
  assert.equal(detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Flights to Okaeri" }),
    splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1", linkedEntry: flightEntry({ date: "2026-06-15" }) })
  ), context)[0].tier, "check");
});

test("duplicate split: two real purchases are never a finding", () => {
  // Two dinners, each matched to its own bank row.
  const dinners = pair(
    splitRecord("exp-1", { description: "Sushi Tei dinner", linkedTransactionId: "txn-1" }),
    splitRecord("exp-2", { description: "Sushi Tei dinner", linkedTransactionId: "txn-2" })
  );
  assert.deepEqual(detectDuplicateSplits(dinners, context), []);
  // Same key but different shares and different words: two different costs.
  assert.deepEqual(detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Taxi", linkedTransactionId: "txn-1" }),
    splitRecord("exp-2", { description: "Dinner", shares: [{ personId: "person-tim", amountMinor: 100_000 }, { personId: "person-joyce", amountMinor: 5_184 }] })
  ), context), []);
  // Two hand-typed ones with different words.
  assert.deepEqual(detectDuplicateSplits(pair(splitRecord("exp-1", { description: "Taxi" }), splitRecord("exp-2", { description: "Dinner" })), context), []);
});

test("duplicate split: softer shapes are a check, and a covered pair belongs to the settled-period detector", () => {
  // The bank row is on Joyce's card although Tim paid, and no word is shared: the Splits matcher would not offer it, so check, not high.
  const elsewhere = pair(splitRecord("exp-1", { description: "Trip flights" }), splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1", linkedEntry: flightEntry({ ownerPersonId: "person-joyce" }) }));
  assert.deepEqual(kinds(detectDuplicateSplits(elsewhere, context)), ["duplicate_split:check"]);
  // The link's entry is missing from the read: nothing to compare, check.
  assert.deepEqual(kinds(detectDuplicateSplits(pair(splitRecord("exp-1"), splitRecord("exp-2", { description: "SQ 321", linkedTransactionId: "txn-1" })), context)), ["duplicate_split:check"]);
  // The same words typed twice by hand: a double entry, a check.
  assert.deepEqual(kinds(detectDuplicateSplits(pair(splitRecord("exp-1"), splitRecord("exp-2")), context)), ["duplicate_split:check"]);
  // Two payments the same day for the same amount: can be real, a check at most.
  const payments = pair(
    splitRecord("set-1", { kind: "settlement", description: "Payment", payerPersonId: "person-joyce", toPersonId: "person-tim", shares: [] }),
    splitRecord("set-2", { kind: "settlement", description: "Payment", payerPersonId: "person-joyce", toPersonId: "person-tim", shares: [], createdAt: "2026-06-13T00:00:00Z" })
  );
  assert.deepEqual(kinds(detectDuplicateSplits(payments, context)), ["duplicate_split:check"]);
  // Covered by a settle-up: not this detector's.
  const covered = pair(
    splitRecord("exp-manual", { coveredBy: { kind: "checkpoint", id: "cp-1", date: "2026-08-27" } }),
    splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), coveredBy: { kind: "checkpoint", id: "cp-1", date: "2026-08-27" } })
  );
  assert.deepEqual(detectDuplicateSplits(covered, context), []);
});

// ---- 8. Settled-period errors ------------------------------------------------

const settled = { kind: "checkpoint", id: "cp-aug", date: "2026-08-27" };

test("settled period: the flight counted twice inside one settle-up is HIGH and says who was charged too much", () => {
  const [found] = detectSettledPeriodErrors(pair(
    splitRecord("exp-manual", { coveredBy: settled }),
    splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), description: "SINGAPORE AIRLINES SINGAPORE SG", coveredBy: settled })
  ), context);
  assert.equal(found.kind, "settled_period_error");
  assert.equal(found.tier, "high");
  assert.equal(found.amountMinor, 52_592);
  assert.match(found.summary, /is in Splits twice and the 27 Aug settle-up counted both\. Joyce was charged \$525\.92 too much\./);
  assert.deepEqual(found.evidence.filter((line) => line.role === "fact").map((line) => line.label), ["Joyce was charged $525.92 too much", "Tim was paid $525.92 too much"]);
  assert.equal(found.fix, null);
  assert.match(found.fixNote, /No fix yet/);
});

test("settled period: one copy outside the settle-up, or a failed gate, is only a check; real purchases stay silent", () => {
  const half = detectSettledPeriodErrors(pair(
    splitRecord("exp-manual", { coveredBy: settled }),
    splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), description: "SINGAPORE AIRLINES SINGAPORE SG" })
  ), context);
  assert.deepEqual(kinds(half), ["settled_period_error:check"]);
  assert.match(half[0].summary, /if the two really are one purchase/);
  const closedBatch = { kind: "batch", id: "batch-1", date: "2026-08-30" };
  assert.deepEqual(kinds(detectSettledPeriodErrors(pair(
    splitRecord("exp-manual", { coveredBy: closedBatch }),
    splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), coveredBy: closedBatch })
  ), context)), ["settled_period_error:high"]);
  // Two records each matched to their own bank row.
  assert.deepEqual(detectSettledPeriodErrors(pair(
    splitRecord("exp-1", { linkedTransactionId: "txn-1", coveredBy: settled }),
    splitRecord("exp-2", { linkedTransactionId: "txn-2", coveredBy: settled })
  ), context), []);
  // Open pair: the open-period detector's.
  assert.deepEqual(detectSettledPeriodErrors(pair(...oneLinked), context), []);
  // The payer is the only sharer: nobody else owes anything, so no balance moved.
  assert.deepEqual(detectSettledPeriodErrors(pair(
    splitRecord("exp-manual", { coveredBy: settled, shares: [{ personId: "person-tim", amountMinor: 105_184 }] }),
    splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), coveredBy: settled, shares: [{ personId: "person-tim", amountMinor: 105_184 }] })
  ), context), []);
});

test("settled period: a copy deleted after the settle-up counted it is HIGH with its kept twin, the cent rounding between the copies allowed", () => {
  const deleted = {
    record: splitRecord("exp-deleted", { coveredBy: settled, deletedAt: "2026-10-22 08:11:33", shares: [{ personId: "person-tim", amountMinor: 52_592 }, { personId: "person-joyce", amountMinor: 52_593 }], amountMinor: 105_185 }),
    twin: { record: splitRecord("exp-kept", { linkedTransactionId: "txn-flight", amountMinor: 105_185, coveredBy: null, shares: [{ personId: "person-tim", amountMinor: 52_593 }, { personId: "person-joyce", amountMinor: 52_592 }] }), inSameSettleUp: true },
    twinCount: 1
  };
  const [found, ...rest] = detectSettledPeriodErrors({ pairs: [], deletedInSettled: [deleted] }, context);
  assert.equal(rest.length, 0);
  assert.equal(found.id, "settled_period_error:deleted:exp-deleted");
  assert.equal(found.tier, "high");
  assert.equal(found.amountMinor, 52_593, "the deleted copy's share is what the settle-up over-counted");
  assert.match(found.summary, /was in Splits twice\. The extra copy was removed on 22 Oct, but the 27 Aug settle-up had already counted both\. Joyce was charged \$525\.93 too much\./);
  assert.deepEqual(found.evidence.filter((line) => line.role === "record").map((line) => line.shortId), ["deleted", "kept"]);
  assert.equal(found.fix, null);

  // No live twin, or two, or one the settle-up did not hold: the cost is gone but the cause is not proven.
  for (const variant of [{ ...deleted, twin: null, twinCount: 0 }, { ...deleted, twin: null, twinCount: 2 }, { ...deleted, twin: { ...deleted.twin, inSameSettleUp: false } }]) {
    assert.deepEqual(kinds(detectSettledPeriodErrors({ pairs: [], deletedInSettled: [variant] }, context)), ["settled_period_error:check"]);
  }
  // Different shares from the twin: check.
  assert.deepEqual(kinds(detectSettledPeriodErrors({ pairs: [], deletedInSettled: [{ ...deleted, twin: { ...deleted.twin, record: { ...deleted.twin.record, shares: [{ personId: "person-tim", amountMinor: 80_000 }, { personId: "person-joyce", amountMinor: 25_185 }] } } }] }, context)), ["settled_period_error:check"]);
  // A deleted cost nobody else shared moved no balance.
  assert.deepEqual(detectSettledPeriodErrors({ pairs: [], deletedInSettled: [{ ...deleted, record: { ...deleted.record, shares: [{ personId: "person-tim", amountMinor: 105_185 }] } }] }, context), []);
});

test("duplicate split: shares that differ by a rounding cent are the same shares", () => {
  const [found] = detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Flights to Okaeri", amountMinor: 105_185, shares: [{ personId: "person-tim", amountMinor: 52_592 }, { personId: "person-joyce", amountMinor: 52_593 }] }),
    splitRecord("exp-2", { description: "SQ 321", amountMinor: 105_185, linkedTransactionId: "txn-1", linkedEntry: flightEntry({ amountMinor: 105_185 }), shares: [{ personId: "person-tim", amountMinor: 52_593 }, { personId: "person-joyce", amountMinor: 52_592 }] })
  ), context);
  assert.equal(found.tier, "high");
  // Two cents apart is a different split.
  assert.deepEqual(detectDuplicateSplits(pair(
    splitRecord("exp-1", { description: "Taxi", shares: [{ personId: "person-tim", amountMinor: 52_590 }, { personId: "person-joyce", amountMinor: 52_594 }] }),
    splitRecord("exp-2", { description: "Dinner", linkedTransactionId: "txn-1", linkedEntry: flightEntry() })
  ), context), []);
});

// ---- 2b. Duplicate ledger entries ---------------------------------------------

const entry = (id, extra = {}) => ({
  id, accountId: "acct-tim-bank", date: "2026-10-01", description: "NTUC FAIRPRICE SINGAPORE SG", amountMinor: 2345, currency: "SGD", entryType: "expense",
  importId: "import-a", rowHash: "2026-10-01|NTUC|2345", importedAt: "2026-10-05T00:00:00Z", createdAt: "2026-10-05 00:00:00", ownerPersonId: "person-tim", ...extra
});

test("duplicate entries: the same bank row loaded by two imports is HIGH, anything softer is a check, one import's repeat is silent", () => {
  const sameRow = detectDuplicateEntries({ pairs: [{ a: entry("txn-aaaa0001"), b: entry("txn-bbbb0002", { importId: "import-b", importedAt: "2026-10-12T00:00:00Z" }) }] }, context);
  assert.deepEqual(kinds(sameRow), ["duplicate_entry:high"]);
  assert.match(sameRow[0].summary, /is on DBS Savings twice and both came from the same line of the bank's file/);
  assert.deepEqual(sameRow[0].evidence.map((line) => line.shortId), ["aaaa0001", "bbbb0002"]);
  assert.match(sameRow[0].fix.path, /editing_entry=txn-bbbb0002/, "the newer copy is the one to open");

  // A typed entry and an imported one: a check.
  const typed = detectDuplicateEntries({ pairs: [{ a: entry("txn-aaaa0001"), b: entry("txn-bbbb0002", { importId: null, rowHash: null, importedAt: null, createdAt: "2026-10-02 00:00:00" }) }] }, context);
  assert.deepEqual(kinds(typed), ["duplicate_entry:check"]);
  // Different hashes from two imports: a check, never high.
  assert.deepEqual(kinds(detectDuplicateEntries({ pairs: [{ a: entry("txn-aaaa0001"), b: entry("txn-bbbb0002", { importId: "import-b", rowHash: "other" }) }] }, context)), ["duplicate_entry:check"]);
  // Two coffees in one bank file are the bank's own repeat.
  assert.deepEqual(detectDuplicateEntries({ pairs: [{ a: entry("txn-aaaa0001"), b: entry("txn-bbbb0002") }] }, context), []);
});

// ---- 3. Unmatched transfers ------------------------------------------------------

const candidate = (id, accountId, date, amountMinor, direction, entryType = "transfer", extra = {}) => ({
  id, accountId, date, description: "FAST PAYMENT", amountMinor, currency: "SGD", direction, ownerPersonId: null, entryType, ...extra
});

test("unmatched transfer: exactly one opposite transfer within a week is HIGH and names both sides", () => {
  const [found] = detectUnmatchedTransfers({
    transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out")],
    candidates: [candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")]
  }, context);
  assert.equal(found.id, "unmatched_transfer:txn-in000001+txn-out00001");
  assert.equal(found.tier, "high");
  assert.match(found.summary, /\$450\.00 left DBS Savings on 1 Oct and \$450\.00 arrived in OCBC 365 on 2 Oct\. It is the same money moving, but the two are not linked/);
  assert.deepEqual(found.personIds, ["person-joyce", "person-tim"]);
  assert.match(found.fix.path, /editing_entry=txn-out00001/);
});

test("unmatched transfer: softer or ambiguous matches are a check; none is one note per series", () => {
  // The other side was filed as money in.
  assert.deepEqual(kinds(detectUnmatchedTransfers({
    transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out")],
    candidates: [candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, null, "income")]
  }, context)), ["unmatched_transfer:check"]);
  // Two same-amount partners: never guess between them.
  const several = detectUnmatchedTransfers({
    transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out")],
    candidates: [candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in"), candidate("txn-in000002", "acct-joint", "2026-10-04", 45_000, "in")]
  }, context);
  assert.deepEqual(kinds(several), ["unmatched_transfer:check"]);
  assert.equal(several[0].evidence.length, 3);
  // Not partners: the same direction, another currency, two months away, a purchase of the same round
  // amount next to a transfer out, money in a month away, a transfer in eight days later. Nothing plausible
  // is left, so it is a note.
  assert.deepEqual(kinds(detectUnmatchedTransfers({
    transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out")],
    candidates: [
      candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "out"),
      candidate("txn-in000002", "acct-joyce-bank", "2026-10-02", 45_000, "in", "transfer", { currency: "JPY" }),
      candidate("txn-in000003", "acct-joyce-bank", "2026-08-01", 45_000, "in"),
      candidate("txn-in000004", "acct-one", "2026-10-03", 45_000, null, "expense"),
      candidate("txn-in000005", "acct-joyce-bank", "2026-10-20", 45_000, null, "income"),
      candidate("txn-in000006", "acct-joyce-bank", "2026-10-09", 45_000, "in")
    ]
  }, context)), ["unmatched_transfer:note"]);
  // A transfer in is matched by a purchase of the same amount, the right way round.
  assert.deepEqual(kinds(detectUnmatchedTransfers({
    transfers: [transfer("txn-in000001", "acct-tim-bank", "2026-10-01", 45_000, "in")],
    candidates: [candidate("txn-exp00001", "acct-one", "2026-10-03", 45_000, null, "expense")]
  }, context)), ["unmatched_transfer:check"]);
  // A transfer with no direction has no way round to judge.
  assert.deepEqual(kinds(detectUnmatchedTransfers({
    transfers: [transfer("txn-und00001", "acct-tim-bank", "2026-10-01", 45_000, null)],
    candidates: [candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")]
  }, context)), ["unmatched_transfer:note"]);
  // Fourteen monthly transfers with nobody on the other side are one note.
  const monthly = Array.from({ length: 14 }, (_, index) => transfer(`txn-mon${String(index).padStart(5, "0")}`, "acct-tim-bank", `2025-${String((index % 12) + 1).padStart(2, "0")}-01`, 45_000, "out"));
  const [series, ...rest] = detectUnmatchedTransfers({ transfers: monthly, candidates: [] }, context);
  assert.equal(rest.length, 0);
  assert.equal(series.tier, "note");
  assert.match(series.summary, /^14 transfers of \$450\.00 out of DBS Savings/);
  assert.equal(series.amountMinor, 14 * 45_000);
  assert.equal(series.evidence.length, 6, "five records and an 'and 9 more' line");
});

test("unmatched transfer: a pair found from both sides is one finding; a monthly lookalike a month away is not a rival", () => {
  const found = detectUnmatchedTransfers({
    transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out"), transfer("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")],
    candidates: [candidate("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out"), candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")]
  }, context);
  assert.equal(found.length, 2, "each side finds the other");
  assert.equal(found[0].id, found[1].id, "with one id");
  assert.equal(found[0].evidenceFacts.join("|"), found[1].evidenceFacts.join("|"), "and one evidence key, so one dismissal covers it");
  assert.equal(found[0].id, "unmatched_transfer:txn-in000001+txn-out00001");
  assert.match(found[0].summary, /^\$450\.00 left DBS Savings on 1 Oct and \$450\.00 arrived in OCBC 365 on 2 Oct\. It is the same money moving, but the two are not linked/);
  assert.deepEqual(found[0].evidence.map((line) => line.note), ["money out", "money in"]);
  assert.equal(found[1].summary, found[0].summary, "the wording does not depend on the side it was found from");
  const report = runLedgerCheckup(emptyFacts({ transfers: { transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out"), transfer("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")], candidates: [candidate("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out"), candidate("txn-in000001", "acct-joyce-bank", "2026-10-02", 45_000, "in")] } }), new Map());
  assert.equal(report.findings.filter((item) => item.kind === "unmatched_transfer").length, 1);

  // Three months of the same $450: each month's pair is its own, the neighbours a month away are not rivals.
  const months = ["2026-08-01", "2026-09-01", "2026-10-01"];
  const outs = months.map((date, index) => transfer(`txn-out0000${index}`, "acct-tim-bank", date, 45_000, "out"));
  const ins = months.map((date, index) => candidate(`txn-in00000${index}`, "acct-joyce-bank", date, 45_000, "in"));
  const pairs = detectUnmatchedTransfers({ transfers: outs, candidates: [...outs.map((item) => ({ ...item, entryType: "transfer" })), ...ins] }, context);
  assert.deepEqual(pairs.map((item) => item.tier), ["high", "high", "high"]);
  assert.equal(new Set(pairs.map((item) => item.id)).size, 3);
});

test("unmatched transfer: young, investment and unknown-account transfers are skipped", () => {
  assert.deepEqual(detectUnmatchedTransfers({
    transfers: [
      transfer("txn-young001", "acct-tim-bank", "2026-10-22", 45_000, "out"),
      transfer("txn-invest01", "acct-invest", "2026-09-01", 45_000, "in"),
      transfer("txn-ghost001", "acct-missing", "2026-09-01", 45_000, "out")
    ],
    candidates: []
  }, context), []);
});

// ---- 4 and 6. Statements --------------------------------------------------------------

const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const bank = "acct-tim-bank";
// Net movement per statement and the balance each should print.
const nets = [100_000, -20_000, -10_000, -5_000, -3_000];
const balances = [100_000, 80_000, 70_000, 65_000, 62_000];
function chain(overrides = {}) {
  const printed = { ...Object.fromEntries(months.map((month, index) => [month, balances[index]])), ...overrides.printed };
  return {
    statements: months.map((month) => statement(bank, month, { balanceMinor: printed[month] })),
    segments: months.map((month, index) => ({ accountId: bank, month, netMinor: nets[index], entryCount: 3 })),
    activity: [],
    chainBreaks: [],
    laterEntries: [],
    ...overrides.facts
  };
}

test("statement chain: balances come from the opening balance plus each stretch, in the statement's own signs", () => {
  const points = buildStatementChain({ kind: "bank", openingBalanceMinor: 500 }, chain().statements, chain().segments);
  assert.deepEqual(points.map((point) => point.ledgerBalanceMinor), [100_500, 80_500, 70_500, 65_500, 62_500]);
  assert.deepEqual(points.map((point) => point.deltaMinor), [500, 500, 500, 500, 500]);
  // A credit card owes: the statement prints a positive balance owed and the app keeps it negative.
  const card = buildStatementChain({ kind: "credit_card", openingBalanceMinor: 0 }, [statement("acct-one", "2026-10", { balanceMinor: 12_345 })], [{ accountId: "acct-one", month: "2026-10", netMinor: -12_345, entryCount: 4 }]);
  assert.equal(card[0].ledgerBalanceMinor, -12_345);
  assert.equal(card[0].deltaMinor, 0, "owed 123.45 on the card and in the ledger agree");
  // Only the last eight proven statements are read, and an unproven one is not a point.
  const many = Array.from({ length: 10 }, (_, index) => statement(bank, `2026-${String(index + 1).padStart(2, "0")}`, { proven: index !== 4 }));
  assert.equal(buildStatementChain({ kind: "bank", openingBalanceMinor: 0 }, many, []).length, 8);
  assert.equal(buildStatementChain({ kind: "bank", openingBalanceMinor: 0 }, many, []).some((point) => point.statement.month === "2026-05"), false);
});

test("balance mismatch: a statement that matched when saved and no longer does is HIGH when the entries added since explain it exactly", () => {
  // The Oct statement printed 62,000 and now the entries come to 64,000: 2,000 more.
  const facts = chain({ printed: { "2026-10": 62_000 }, facts: { segments: months.map((month, index) => ({ accountId: bank, month, netMinor: nets[index] + (month === "2026-10" ? 2_000 : 0), entryCount: 3 })) } });
  assert.deepEqual(detectStatementJoins(facts, context), []);
  const explained = detectBalanceMismatches({ ...facts, laterEntries: [{ accountId: bank, entryCount: 1, netMinor: 2_000, sample: [{ id: "txn-late0001", description: "Dinner", date: "2026-10-10", amountMinor: 2_000, entryType: "income" }] }] }, context);
  assert.deepEqual(kinds(explained), ["balance_mismatch:high"]);
  assert.equal(explained[0].amountMinor, 2_000);
  assert.match(explained[0].summary, /^The October statement for DBS Savings matched when it was saved, but the entries up to 31 Oct now come to \$20\.00 more than the statement\. One entry added after that explains the difference exactly\.$/);
  assert.equal(explained[0].evidence[1].shortId, "late0001");
  // Entries added since that do not add up, or none: only a check.
  assert.deepEqual(kinds(detectBalanceMismatches({ ...facts, laterEntries: [{ accountId: bank, entryCount: 1, netMinor: 1_500, sample: [] }] }, context)), ["balance_mismatch:check"]);
  assert.deepEqual(kinds(detectBalanceMismatches(facts, context)), ["balance_mismatch:check"]);
});

test("balance mismatch: matching statements, a healed chain, unproven and archived accounts are silent", () => {
  assert.deepEqual(detectBalanceMismatches(chain(), context), []);
  // Sep was off but Oct matches again: healed.
  assert.deepEqual(detectBalanceMismatches(chain({ printed: { "2026-09": 64_000 } }), context), []);
  // An unproven statement is not evidence.
  const unproven = chain({ facts: {} });
  unproven.statements = unproven.statements.map((item) => ({ ...item, proven: false, balanceMinor: 1 }));
  assert.deepEqual(detectBalanceMismatches(unproven, context), []);
  // An archived account is not checked.
  const archived = checkupContext();
  archived.accounts.set(bank, { ...archived.accounts.get(bank), isActive: false });
  assert.deepEqual(detectBalanceMismatches(chain({ printed: { "2026-10": 1 } }), archived), []);
});

test("statement join: the first statement that stops joining, while the latest is still off, is one check naming where it broke", () => {
  // Aug printed 71,000 (1,000 more than the entries) and the later ones carry that difference.
  const facts = chain({ printed: { "2026-08": 69_000, "2026-09": 64_000, "2026-10": 61_000 } });
  const [found, ...rest] = detectStatementJoins(facts, context);
  assert.equal(rest.length, 0);
  assert.equal(found.id, "statement_join:acct-tim-bank:2026-08");
  assert.equal(found.tier, "check");
  assert.equal(found.amountMinor, 1_000);
  assert.match(found.summary, /DBS Savings matched its July statement, but not the August one/);
  assert.match(found.summary, /the October statement is still \$10\.00 off/);
  assert.deepEqual(detectBalanceMismatches(facts, context), [], "never reported twice");
});

test("statement join: a break right after a missing month is the gap's finding, not a second one", () => {
  const facts = chain({ printed: { "2026-09": 64_000, "2026-10": 61_000 } });
  // Remove the August statement: July then September are not consecutive months.
  facts.statements = facts.statements.filter((item) => item.month !== "2026-08");
  facts.segments = facts.segments.map((item) => (item.month === "2026-09" ? { ...item, netMinor: item.netMinor - 10_000 } : item));
  facts.segments = facts.segments.filter((item) => item.month !== "2026-08");
  assert.deepEqual(detectStatementJoins(facts, context), []);
});

test("statement gap: a month with entries between two statements and no statement of its own", () => {
  const withActivity = (extra) => ({
    statements: [statement(bank, "2026-06"), statement(bank, "2026-07"), statement(bank, "2026-08"), statement(bank, "2026-10")],
    segments: [], laterEntries: [], chainBreaks: [],
    activity: [{ accountId: bank, month: "2026-09", entryCount: 14 }],
    ...extra
  });
  const [found] = detectStatementGaps(withActivity(), context);
  assert.equal(found.id, "statement_gap:acct-tim-bank:2026-09");
  assert.equal(found.tier, "high", "one month, 14 entries, statements monthly elsewhere");
  assert.match(found.summary, /DBS Savings has a statement for August and one for October, but none for September, a month it has 14 entries in/);
  assert.deepEqual(found.evidence.map((line) => line.role), ["statement", "statement", "fact"]);
  assert.equal(found.fix.path, "/imports");
  // A removed statement on record makes even a thin month sure.
  assert.equal(detectStatementGaps(withActivity({ activity: [{ accountId: bank, month: "2026-09", entryCount: 1 }], chainBreaks: [{ accountId: bank, month: "2026-09" }] }), context)[0].tier, "high");
  // Few entries and no record: a check.
  assert.equal(detectStatementGaps(withActivity({ activity: [{ accountId: bank, month: "2026-09", entryCount: 2 }] }), context)[0].tier, "check");
  // Quarterly statements: not monthly elsewhere, so only a check.
  const quarterly = withActivity({ statements: [statement(bank, "2026-01"), statement(bank, "2026-04"), statement(bank, "2026-07")], activity: [{ accountId: bank, month: "2026-05", entryCount: 20 }, { accountId: bank, month: "2026-06", entryCount: 20 }] });
  assert.deepEqual(kinds(detectStatementGaps(quarterly, context)), ["statement_gap:check"]);
  assert.match(detectStatementGaps(quarterly, context)[0].title, /Statements are missing/);
});

test("statement gap: a dormant month, the month after the latest statement, one statement, and archived accounts are silent", () => {
  assert.deepEqual(detectStatementGaps({ statements: [statement(bank, "2026-08"), statement(bank, "2026-10")], activity: [], chainBreaks: [], segments: [], laterEntries: [] }, context), []);
  assert.deepEqual(detectStatementGaps({ statements: [statement(bank, "2026-08")], activity: [{ accountId: bank, month: "2026-09", entryCount: 20 }], chainBreaks: [], segments: [], laterEntries: [] }, context), []);
  const archived = checkupContext();
  archived.accounts.set(bank, { ...archived.accounts.get(bank), isActive: false });
  assert.deepEqual(detectStatementGaps({ statements: [statement(bank, "2026-08"), statement(bank, "2026-10")], activity: [{ accountId: bank, month: "2026-09", entryCount: 20 }], chainBreaks: [], segments: [], laterEntries: [] }, archived), []);
});

// ---- 5. Stale estimates -----------------------------------------------------------------

const estimate = (id, extra = {}) => ({
  id, accountId: "acct-one", date: "2026-09-20", description: "Grab* A-8XYZ", amountMinor: 1320, currency: "SGD", originalAmountMinor: 16_660_000, originalCurrency: "IDR", ownerPersonId: "person-tim", ...extra
});

test("stale estimate: older than the card's lag plus 14 days; HIGH when a file of that card covers the day, a check when none does", () => {
  const covered = detectStaleEstimates({
    estimates: [estimate("txn-est00001")],
    postingLagDays: { "acct-one": 3 },
    coverages: [{ accountId: "acct-one", first: "2026-08-14", last: "2026-10-13", referenceDate: "2026-10-14" }]
  }, context);
  assert.deepEqual(kinds(covered), ["stale_estimate:high"]);
  assert.match(covered[0].summary, /IDR 166,600\.00 at Grab\* A-8XYZ on 20 Sep is still only an estimate of \$13\.20\. UOB One Card's own bank record covers that day and nothing matches it/);
  assert.equal(covered[0].amountMinor, 1320);
  const open = detectStaleEstimates({ estimates: [estimate("txn-est00001")], postingLagDays: { "acct-one": 3 }, coverages: [] }, context);
  assert.deepEqual(kinds(open), ["stale_estimate:check"]);
  assert.match(open[0].fix.label, /Add UOB One Card's bank file in Imports/);
});

test("stale estimate: a young estimate, a slow card, another card's file, or a file loaded inside the lag are silent or soft", () => {
  const coverage = { accountId: "acct-one", first: "2026-08-14", last: "2026-10-13", referenceDate: "2026-10-14" };
  // 16 days old with a 3-day lag: not yet 17.
  assert.deepEqual(detectStaleEstimates({ estimates: [estimate("txn-est00001", { date: "2026-10-11" })], postingLagDays: { "acct-one": 3 }, coverages: [coverage] }, context), []);
  // A slow card (7 days) makes 20 days young.
  assert.deepEqual(detectStaleEstimates({ estimates: [estimate("txn-est00001", { date: "2026-10-07" })], postingLagDays: { "acct-one": 7 }, coverages: [coverage] }, context), []);
  // Another card's file does not count.
  assert.deepEqual(kinds(detectStaleEstimates({ estimates: [estimate("txn-est00001")], postingLagDays: { "acct-one": 3 }, coverages: [{ ...coverage, accountId: "acct-ladys" }] }, context)), ["stale_estimate:check"]);
  // A file loaded the day after: inside the lag, so not proof.
  assert.deepEqual(kinds(detectStaleEstimates({ estimates: [estimate("txn-est00001")], postingLagDays: { "acct-one": 3 }, coverages: [{ ...coverage, referenceDate: "2026-09-21" }] }, context)), ["stale_estimate:check"]);
});

// ---- 7. Plan problems ------------------------------------------------------------------------

const planRows = (extra = []) => [
  plannedRow("plan-income", { section: "income", label: "Salary", plannedMinor: 500_000, planDate: null, categoryId: "cat-income", categoryName: "Income" }),
  plannedRow("plan-rent", { label: "Rent", plannedMinor: 300_000, planDate: "2026-10-01", linkCount: 1 }),
  plannedRow("plan-food", { section: "budget_buckets", label: "Food", plannedMinor: 150_000, planDate: null, categoryName: "Food" }),
  ...extra
];

test("plan: planned spending beyond the income the plan expects is a check with the shortfall", () => {
  const [found] = detectPlanProblems({ rows: planRows([plannedRow("plan-save", { section: "budget_buckets", label: "Savings", plannedMinor: 120_000, planDate: null, categoryName: "Savings" })]), candidates: [] }, context);
  assert.equal(found.id, "plan_overspent:2026-10");
  assert.equal(found.tier, "check");
  assert.equal(found.amountMinor, 70_000);
  assert.match(found.summary, /October's plan spends \$5,700\.00 but only expects \$5,000\.00 of income, \$700\.00 more than comes in/);
  assert.equal(found.fix.path, "/month?view=household&month=2026-10#month-plan");
  assert.deepEqual(found.evidence.map((line) => line.label), ["Planned spending, savings included: $5,700.00", "Income you expect: $5,000.00", "Savings in the plan: $1,200.00"]);
});

test("plan: a plan that fits, a small shortfall, no income, or a past month is silent; next month is read too", () => {
  assert.deepEqual(detectPlanProblems({ rows: planRows(), candidates: [] }, context), []);
  // $20 beyond the income: under both the $50 and the 2% limit.
  assert.deepEqual(detectPlanProblems({ rows: planRows([plannedRow("plan-tiny", { section: "budget_buckets", label: "Tiny", plannedMinor: 2_000, planDate: null })]), candidates: [] }, context), []);
  assert.deepEqual(detectPlanProblems({ rows: planRows().filter((row) => row.section !== "income"), candidates: [] }, context), [], "no income expected, no comparison");
  const august = planRows().map((row) => ({ ...row, month: "2026-08", plannedMinor: row.section === "income" ? 1 : row.plannedMinor }));
  assert.deepEqual(detectPlanProblems({ rows: august, candidates: [] }, context), [], "a past month is history");
  const november = planRows().map((row) => ({ ...row, month: "2026-11", plannedMinor: row.section === "income" ? 100_000 : row.plannedMinor }));
  assert.deepEqual(kinds(detectPlanProblems({ rows: november, candidates: [] }, context)), ["plan_overspent:check"]);
});

const payment = (id, extra = {}) => ({ id, date: "2026-10-06", description: "FAST PAYMENT HOUSE LOAN", amountMinor: 45_000, categoryName: "Home", accountName: "DBS Savings", ...extra });

test("plan: a due bill with nothing linked and exactly one same-amount payment near its date is a check naming the payment", () => {
  const rows = planRows([plannedRow("plan-loan", { label: "House loan", plannedMinor: 45_000, planDate: "2026-10-05" })]);
  const found = detectPlanProblems({ rows, candidates: [payment("txn-pay00001")] }, context).filter((item) => item.kind === "plan_line_unpaid");
  assert.equal(found.length, 1);
  assert.equal(found[0].tier, "check");
  assert.equal(found[0].id, "plan_line_unpaid:plan-loan");
  assert.match(found[0].summary, /House loan \(\$450\.00, due 5 Oct\) has nothing matched to it, but FAST PAYMENT HOUSE LOAN for the same amount on 6 Oct looks like the payment/);
  assert.deepEqual(found[0].personIds, ["person-tim"]);
});

test("plan: contested, distant, other-category, linked or not-yet-due bills stay silent or soft", () => {
  const rows = planRows([plannedRow("plan-loan", { label: "House loan", plannedMinor: 45_000, planDate: "2026-10-05" })]);
  const unpaid = (candidates, planRowsOverride = rows) => detectPlanProblems({ rows: planRowsOverride, candidates }, context).filter((item) => item.kind === "plan_line_unpaid");
  // Two payments of the same amount could be it: a note.
  assert.deepEqual(kinds(unpaid([payment("txn-pay00001"), payment("txn-pay00002", { date: "2026-10-07" })])), ["plan_line_unpaid:note"]);
  // Two due bills of the same amount and one payment: contested.
  const twin = planRows([plannedRow("plan-loan", { plannedMinor: 45_000 }), plannedRow("plan-loan2", { label: "Car loan", plannedMinor: 45_000, planDate: "2026-10-06" })]);
  assert.deepEqual(kinds(unpaid([payment("txn-pay00001")], twin)), ["plan_line_unpaid:note", "plan_line_unpaid:note"]);
  // Eleven days away, another category, another amount: no candidate at all.
  assert.deepEqual(unpaid([payment("txn-pay00001", { date: "2026-10-16" })]), []);
  assert.deepEqual(unpaid([payment("txn-pay00001", { categoryName: "Food" })]), []);
  assert.deepEqual(unpaid([payment("txn-pay00001", { amountMinor: 44_900 })]), []);
  // Linked, with an actual, or dated tomorrow: nothing is due.
  assert.deepEqual(unpaid([payment("txn-pay00001")], planRows([plannedRow("plan-loan", { linkCount: 1 })])), []);
  assert.deepEqual(unpaid([payment("txn-pay00001")], planRows([plannedRow("plan-loan", { actualMinor: 45_000 })])), []);
  assert.deepEqual(unpaid([payment("txn-pay00001", { date: "2026-10-28" })], planRows([plannedRow("plan-loan", { planDate: "2026-10-28" })])), []);
  // Next month's dated bills cannot be past due.
  assert.deepEqual(unpaid([payment("txn-pay00001")], planRows([plannedRow("plan-loan", { month: "2026-11", planDate: "2026-11-05" })])), []);
});

test("plan: every payment the check-up names is one the Month link dialog's own scorer puts first for that line", () => {
  const row = plannedRow("plan-loan", { label: "House loan", plannedMinor: 45_000, planDate: "2026-10-05" });
  const near = payment("txn-pay00001");
  const decoys = [
    payment("txn-dec00001", { amountMinor: 12_300, description: "COLD STORAGE", categoryName: "Groceries", date: "2026-10-05" }),
    payment("txn-dec00002", { amountMinor: 45_000, description: "SOMETHING ELSE", categoryName: "Food", date: "2026-10-20" })
  ];
  const found = detectPlanProblems({ rows: planRows([row]), candidates: [near] }, context).filter((item) => item.kind === "plan_line_unpaid");
  assert.equal(found.length, 1);
  const asEntry = (item) => ({ id: item.id, entryType: "expense", description: item.description, amountMinor: item.amountMinor, categoryName: item.categoryName, accountName: item.accountName, date: item.date });
  const dialog = buildPlanLinkCandidates({
    row: { ...row, dayLabel: "5", linkedEntryIds: [], planMatchHints: [], accountName: undefined },
    monthEntries: [...decoys, near].map(asEntry),
    monthKey: "2026-10"
  });
  assert.equal(dialog[0].id, "txn-pay00001", "the dialog ranks the same payment first");
  assert.ok(dialog[0].matchReasons.includes("same amount") && dialog[0].matchReasons.includes("near planned date") && dialog[0].matchReasons.includes("same category"));
});

test("plan: a line with money and no category is a note; a zero line or a category is not", () => {
  const rows = planRows([plannedRow("plan-misc", { label: "Misc", categoryId: null, categoryName: null, planDate: null, plannedMinor: 5_000, linkCount: 1 }), plannedRow("plan-zero", { label: "Empty", categoryId: null, categoryName: null, plannedMinor: 0, planDate: null })]);
  const found = detectPlanProblems({ rows, candidates: [] }, context);
  assert.deepEqual(kinds(found), ["plan_line_no_category:note"]);
  assert.equal(found[0].id, "plan_line_no_category:plan-misc");
});

// ---- 9. Data hygiene -------------------------------------------------------------------------

const hygieneEntry = (id, extra = {}) => ({
  id, accountId: "acct-one", date: "2026-07-01", description: "KOPITIAM CORNER SINGAPORE SG", amountMinor: 650, currency: "SGD", entryType: "expense", ownerPersonId: "person-tim", ...extra
});
const rule = (pattern, categoryName) => ({ id: `rule-${pattern}`, pattern, categoryId: `cat-${categoryName}`, categoryName, priority: 100, isActive: true });
const habit = (key, categoryName, timesConfirmed) => ({ id: `category:${key}`, kind: "category", key, value: { categoryName }, timesConfirmed, timesOverridden: 0, lastUsed: "2026-10-01", source: "entries" });

test("hygiene: Other older than 60 days with a rule or a confirmed habit naming a better category is a note; guesses are not", () => {
  const base = { otherEntries: [hygieneEntry("txn-oth00001")], oddEntries: [], categoryNames: ["Other", "Food & Drinks", "Transfer"], rules: [], habits: [] };
  const byRule = detectHygiene({ ...base, rules: [rule("KOPITIAM", "Food & Drinks")] }, context);
  assert.deepEqual(kinds(byRule), ["other_category:note"]);
  assert.match(byRule[0].summary, /KOPITIAM CORNER SINGAPORE SG \(\$6\.50, 1 Jul\) is still in Other\. Your own category rules would put it under Food & Drinks/);
  assert.deepEqual(kinds(detectHygiene({ ...base, habits: [habit("kopitiam corner", "Food & Drinks", 3)] }, context)), ["other_category:note"]);
  // A habit confirmed twice is only a suggestion; a catch-all or unknown category is nothing.
  assert.deepEqual(detectHygiene({ ...base, habits: [habit("kopitiam corner", "Food & Drinks", 2)] }, context), []);
  assert.deepEqual(detectHygiene({ ...base, rules: [rule("KOPITIAM", "Transfer")] }, context), []);
  assert.deepEqual(detectHygiene({ ...base, rules: [rule("KOPITIAM", "Cat that is gone")] }, context), []);
  assert.deepEqual(detectHygiene({ ...base }, context), [], "no rule and no habit: never a guess from words or history");
  // Newer than 60 days, or money in, is not touched.
  assert.deepEqual(detectHygiene({ ...base, rules: [rule("KOPITIAM", "Food & Drinks")], otherEntries: [hygieneEntry("txn-oth00001", { date: "2026-09-01" })] }, context), []);
  assert.deepEqual(detectHygiene({ ...base, rules: [rule("KOPITIAM", "Food & Drinks")], otherEntries: [hygieneEntry("txn-oth00001", { entryType: "income" })] }, context), []);
});

test("hygiene: an entry of zero or dated more than 14 days ahead is a check; a near-future one is fine", () => {
  const base = { otherEntries: [], categoryNames: [], rules: [], habits: [] };
  const found = detectHygiene({ ...base, oddEntries: [hygieneEntry("txn-zero0001", { amountMinor: 0, date: "2026-10-20" }), hygieneEntry("txn-late0001", { date: "2026-11-12" }), hygieneEntry("txn-soon0001", { date: "2026-11-10" })] }, context);
  assert.deepEqual(found.map((item) => item.id).sort(), ["odd_entry:txn-late0001", "odd_entry:txn-zero0001"]);
  assert.equal(found.find((item) => item.id === "odd_entry:txn-late0001").title, "An entry is dated far ahead");
  assert.match(found.find((item) => item.id === "odd_entry:txn-zero0001").summary, /has an amount of \$0\.00, so it changes nothing/);
});

test("hygiene: a bank or card account quiet for 90 days is a note; cash, investment, archived and never-used accounts are not", () => {
  const ctx = checkupContext();
  const set = (id, patch) => ctx.accounts.set(id, { ...ctx.accounts.get(id), ...patch });
  set("acct-one", { lastEntryDate: "2026-07-01" });
  set("acct-ladys", { lastEntryDate: "2026-07-30" });
  set("acct-cash", { lastEntryDate: "2025-01-01" });
  set("acct-invest", { lastEntryDate: "2025-01-01" });
  set("acct-joint", { lastEntryDate: "2025-01-01", isActive: false });
  set("acct-joyce-bank", { lastEntryDate: null });
  const found = detectHygiene({ otherEntries: [], oddEntries: [], categoryNames: [], rules: [], habits: [] }, ctx);
  assert.deepEqual(found.map((item) => item.id), ["quiet_account:acct-one"], "acct-ladys is 89 days quiet, one short");
});

// ---- The runner ------------------------------------------------------------------------------

function onlyDetector(findings) {
  return [{ id: "test", kinds: ["duplicate_entry"], run: () => findings }];
}
const sample = (id, extra = {}) => ({
  id: `duplicate_entry:${id}`, kind: "duplicate_entry", tier: "check", title: "t", summary: "s", evidence: [], amountMinor: 100, currency: "SGD",
  occurredOn: "2026-10-01", personIds: [], fix: null, fixNote: "No fix yet.", evidenceFacts: ["check", id], ...extra
});

test("runner: tier, then money, then recency, then id; the cap is 50 a kind with the rest counted", () => {
  const findings = [
    sample("note-big", { tier: "note", amountMinor: 900_000 }),
    sample("check-small", { amountMinor: 100 }),
    sample("check-big-old", { amountMinor: 5_000, occurredOn: "2026-01-01" }),
    sample("check-big-new", { amountMinor: 5_000, occurredOn: "2026-10-01" }),
    sample("high-none", { tier: "high", amountMinor: null }),
    sample("high-some", { tier: "high", amountMinor: 1 })
  ];
  const report = runLedgerCheckup(emptyFacts(), new Map(), { detectors: onlyDetector(findings) });
  assert.deepEqual(report.findings.map((item) => item.id.split(":")[1]), ["high-some", "high-none", "check-big-new", "check-big-old", "check-small", "note-big"]);
  assert.deepEqual(report.tierCounts, { high: 2, check: 3, note: 1 });
  assert.deepEqual(report.kindCounts, { duplicate_entry: { high: 2, check: 3, note: 1 } });

  const many = Array.from({ length: 63 }, (_, index) => sample(`n${String(index).padStart(2, "0")}`, { amountMinor: 1000 - index }));
  const capped = runLedgerCheckup(emptyFacts(), new Map(), { detectors: onlyDetector(many) });
  assert.equal(capped.findings.length, 50);
  assert.deepEqual(capped.moreByKind, { duplicate_entry: 13 });
  assert.equal(capped.tierCounts.check, 63, "the headline counts every finding, shown or not");
  assert.equal(capped.findings[0].id, "duplicate_entry:n00");
});

test("runner: a dismissal holds for the same evidence and lifts when the evidence changes", () => {
  const found = runLedgerCheckup(emptyFacts(), new Map(), { detectors: onlyDetector([sample("one")]) }).findings[0];
  assert.match(found.evidenceKey, /^[0-9a-f]{14}$/);
  assert.equal(found.dismissed, false);

  const dismissed = new Map([[found.id, found.evidenceKey]]);
  const hidden = runLedgerCheckup(emptyFacts(), dismissed, { detectors: onlyDetector([sample("one")]) });
  assert.deepEqual(hidden.findings, []);
  assert.deepEqual(hidden.tierCounts, { high: 0, check: 0, note: 0 });
  assert.equal(hidden.dismissedCount, 1);
  const shown = runLedgerCheckup(emptyFacts(), dismissed, { detectors: onlyDetector([sample("one")]), includeDismissed: true });
  assert.equal(shown.findings[0].dismissed, true);

  // The evidence changed (an amount, a tier): it is back.
  const changed = runLedgerCheckup(emptyFacts(), dismissed, { detectors: onlyDetector([sample("one", { evidenceFacts: ["check", "one", 999] })]) });
  assert.equal(changed.findings.length, 1);
  assert.equal(changed.findings[0].dismissed, false);
  assert.equal(changed.dismissedCount, 0);
  // The same key for another finding does nothing.
  assert.equal(runLedgerCheckup(emptyFacts(), new Map([["duplicate_entry:two", found.evidenceKey]]), { detectors: onlyDetector([sample("one")]) }).findings.length, 1);
});

test("runner: a person's view keeps their findings and the household's; a broken detector is named, never fatal", () => {
  const findings = [sample("tim", { personIds: ["person-tim"] }), sample("joyce", { personIds: ["person-joyce"] }), sample("shared", { personIds: [] }), sample("both", { personIds: ["person-tim", "person-joyce"] })];
  const idsFor = (view) => runLedgerCheckup(emptyFacts(), new Map(), { view, detectors: onlyDetector(findings) }).findings.map((item) => item.id.split(":")[1]).sort();
  assert.deepEqual(idsFor("person-tim"), ["both", "shared", "tim"]);
  assert.deepEqual(idsFor("person-joyce"), ["both", "joyce", "shared"]);
  assert.deepEqual(idsFor("household"), ["both", "joyce", "shared", "tim"]);
  assert.deepEqual(idsFor(undefined), ["both", "joyce", "shared", "tim"]);
  assert.deepEqual(runLedgerCheckup(emptyFacts(), new Map(), { view: "person-tim", detectors: onlyDetector(findings) }).tierCounts, { high: 0, check: 3, note: 0 });

  const originalError = console.error;
  console.error = () => {};
  try {
    const report = runLedgerCheckup(emptyFacts(), new Map(), {
      detectors: [
        { id: "broken", kinds: ["odd_entry", "quiet_account"], run: () => { throw new Error("boom with a private description"); } },
        { id: "fine", kinds: ["duplicate_entry"], run: () => [sample("one")] }
      ]
    });
    assert.equal(report.findings.length, 1);
    assert.deepEqual(report.unavailableKinds.sort(), ["odd_entry", "quiet_account"]);
  } finally {
    console.error = originalError;
  }
  // Two detectors never show one id twice.
  assert.equal(runLedgerCheckup(emptyFacts(), new Map(), { detectors: [...onlyDetector([sample("one")]), ...onlyDetector([sample("one")])] }).findings.length, 1);
});

test("runner: the registry runs every kind once over empty facts without a finding", () => {
  const report = runLedgerCheckup(emptyFacts(), new Map());
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.unavailableKinds, []);
  const declared = CHECKUP_DETECTORS.flatMap((detector) => detector.kinds);
  assert.equal(new Set(declared).size, declared.length, "no kind has two owners");
  assert.equal(declared.length, 15);
  assert.equal(compareFindings(sample("a"), sample("a")), 0);
});

// ---- Plain words -----------------------------------------------------------------------------

test("every sentence a detector writes passes the plain-words lint", () => {
  const findings = [
    ...detectWrongCardDuplicates(wrongCard(), context),
    ...detectDuplicateSplits(pair(...oneLinked), context),
    ...detectSettledPeriodErrors(pair(splitRecord("exp-manual", { coveredBy: settled }), splitRecord("exp-bank", { linkedTransactionId: "txn-flight", linkedEntry: flightEntry(), coveredBy: settled })), context),
    ...detectDuplicateEntries({ pairs: [{ a: entry("txn-aaaa0001"), b: entry("txn-bbbb0002", { importId: "import-b" }) }] }, context),
    ...detectUnmatchedTransfers({ transfers: [transfer("txn-out00001", "acct-tim-bank", "2026-10-01", 45_000, "out")], candidates: [] }, context),
    ...detectStatementGaps({ statements: [statement(bank, "2026-08"), statement(bank, "2026-10")], activity: [{ accountId: bank, month: "2026-09", entryCount: 14 }], chainBreaks: [], segments: [], laterEntries: [] }, context),
    ...detectBalanceMismatches(chain({ printed: { "2026-10": 61_000 } }), context),
    ...detectStatementJoins(chain({ printed: { "2026-08": 69_000, "2026-09": 64_000, "2026-10": 61_000 } }), context),
    ...detectStaleEstimates({ estimates: [estimate("txn-est00001")], postingLagDays: {}, coverages: [] }, context),
    ...detectPlanProblems({ rows: planRows([plannedRow("plan-save", { section: "budget_buckets", label: "Savings", plannedMinor: 120_000, planDate: null }), plannedRow("plan-misc", { categoryId: null, categoryName: null, planDate: null })]), candidates: [] }, context),
    ...detectHygiene({ otherEntries: [hygieneEntry("txn-oth00001")], oddEntries: [hygieneEntry("txn-zero0001", { amountMinor: 0 })], categoryNames: ["Food & Drinks"], rules: [rule("KOPITIAM", "Food & Drinks")], habits: [] }, { ...context, accounts: new Map([...context.accounts, ["acct-one", { ...context.accounts.get("acct-one"), lastEntryDate: "2026-01-01" }]]) })
  ];
  assert.ok(findings.length >= 10);
  for (const item of findings) {
    for (const text of [item.title, item.summary, item.fixNote ?? "", item.fix?.label ?? "", ...item.evidence.map((line) => `${line.label} ${line.note ?? ""}`)]) {
      assert.deepEqual(findAppJargon(text), [], `"${text}" uses app words`);
      assert.doesNotMatch(text, /\b(provisional|certified|checkpoint|unlinked|DTO|bucket)\b/i, text);
    }
    assert.ok(item.title.split(" ").length <= 9, `title too long: ${item.title}`);
    assert.match(item.id, new RegExp(`^${item.kind}:`));
    assert.ok(["high", "check", "note"].includes(item.tier));
    assert.ok(item.fix || item.fixNote, "every finding says how to fix it or that it cannot yet");
    assert.ok(item.evidence.length >= 1);
  }
});
