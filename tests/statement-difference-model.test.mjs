import assert from "node:assert/strict";
import test from "node:test";

import { describeStatementDifference } from "../src/client/statement-difference-model.js";
import { statementDifferenceMessages } from "../src/client/copy/en-SG-statement-difference.js";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";

const fish = { entryId: "txn-fish", date: "2026-10-27", description: "Lixin Fishball", signedAmountMinor: -750 };

test("a matched statement reads Matched", () => {
  assert.deepEqual(describeStatementDifference({ deltaMinor: 0 }), { tone: "in", headline: "Matched", details: [], isTimingOnly: false });
});

test("a difference that is only next-statement billing reads as matched, with the amount", () => {
  const line = describeStatementDifference({
    deltaMinor: -170666,
    difference: { remainingMinor: 0, billedNext: { totalMinor: -170666, entryCount: 7, entries: [] } }
  });
  assert.equal(line.tone, "in");
  assert.equal(line.isTimingOnly, true);
  assert.equal(line.headline, "Matched. 7 entries worth $1,706.66 were billed on the next statement.");
});

test("one entry the bank never listed is named and can be removed", () => {
  const line = describeStatementDifference({
    deltaMinor: -750,
    difference: { remainingMinor: 0, notOnStatement: { totalMinor: -750, entryCount: 1, oneOf: false, entries: [fish] } }
  });
  assert.equal(line.tone, "short");
  assert.equal(line.headline, "Off by $7.50");
  assert.deepEqual(line.details, ["Lixin Fishball on 27 Oct 2026 ($7.50) is not on the statement."]);
  assert.equal(line.removableEntry.entryId, "txn-fish");
});

test("several same-amount entries are offered as one of these, and none is removable", () => {
  const twin = { ...fish, entryId: "txn-twin", date: "2026-10-28" };
  const line = describeStatementDifference({
    deltaMinor: -750,
    difference: { remainingMinor: 0, notOnStatement: { totalMinor: -750, entryCount: 2, oneOf: true, entries: [fish, twin] } }
  });
  assert.equal(line.removableEntry, undefined);
  assert.match(line.details[0], /^One of these is not on the statement: Lixin Fishball on 27 Oct 2026 \(\$7\.50\) and Lixin Fishball on 28 Oct 2026 \(\$7\.50\)\.$/);
});

test("part timing, part unexplained: both amounts are said and it stays off", () => {
  const line = describeStatementDifference({
    deltaMinor: -1300,
    difference: { remainingMinor: -300, billedNext: { totalMinor: -1000, entryCount: 1, entries: [] } }
  });
  assert.equal(line.tone, "short");
  assert.equal(line.isTimingOnly, false);
  assert.deepEqual(line.details, ["$10.00 of it was billed on the next statement.", "$3.00 is not explained yet."]);
});

test("no explanation: the plain difference and nothing blamed", () => {
  const line = describeStatementDifference({ deltaMinor: 500 });
  assert.equal(line.headline, "Off by $5.00");
  assert.deepEqual(line.details, ["$5.00 is not explained yet."]);
});

test("the wording is plain: no app jargon", () => {
  const samples = [
    statementDifferenceMessages.matched,
    statementDifferenceMessages.matchedBilledNext(1, "$1.00"),
    statementDifferenceMessages.matchedBilledNext(2, "$1.00"),
    statementDifferenceMessages.offBy("$1.00"),
    statementDifferenceMessages.notOnStatementOne("Shop on 1 Oct 2026 ($1.00)"),
    statementDifferenceMessages.notOnStatementOneOf(["A", "B"]),
    statementDifferenceMessages.notOnStatementGroup(["A", "B"], 2),
    statementDifferenceMessages.partlyBilledNext("$1.00"),
    statementDifferenceMessages.notExplained("$1.00"),
    statementDifferenceMessages.removeEntry,
    statementDifferenceMessages.removeEntryPrompt("Shop on 1 Oct 2026 ($1.00)")
  ];
  for (const sample of samples) {
    assert.deepEqual(findAppJargon(sample), [], sample);
  }
  assert.equal(statementDifferenceMessages.matchedBilledNext(1, "$1.00"), "Matched. 1 entry worth $1.00 was billed on the next statement.");
});
