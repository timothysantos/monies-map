import assert from "node:assert/strict";
import test from "node:test";

import { explainStatementDifference } from "../src/domain/statement-difference.ts";

const entry = (id, date, amountMinor, extra = {}) => ({
  entryId: id,
  date,
  description: `Shop ${id}`,
  signedAmountMinor: amountMinor,
  certifiedByMonth: undefined,
  ...extra
});

const statement = { month: "2026-10", startDate: "2026-09-10", endDate: "2026-10-11" };

test("purchases the bank billed on the next statement explain the whole difference", () => {
  const result = explainStatementDifference({
    statement,
    deltaMinor: -170666,
    entries: [
      entry("a", "2026-10-09", -148000, { certifiedByMonth: "2026-11" }),
      entry("b", "2026-10-10", -13295, { certifiedByMonth: "2026-11" }),
      entry("c", "2026-10-11", -9371, { certifiedByMonth: "2026-11" }),
      // On this statement itself: never part of the difference.
      entry("d", "2026-10-02", -5000, { certifiedByMonth: "2026-10" })
    ]
  });

  assert.equal(result.remainingMinor, 0);
  assert.deepEqual(result.billedNext, {
    totalMinor: -170666,
    entryCount: 3,
    entries: [
      { entryId: "a", date: "2026-10-09", description: "Shop a", signedAmountMinor: -148000 },
      { entryId: "b", date: "2026-10-10", description: "Shop b", signedAmountMinor: -13295 },
      { entryId: "c", date: "2026-10-11", description: "Shop c", signedAmountMinor: -9371 }
    ]
  });
  assert.equal(result.notOnStatement, undefined);
});

test("one unconfirmed entry in the period that equals the difference is named", () => {
  const result = explainStatementDifference({
    statement: { month: "2026-11", startDate: "2026-10-13", endDate: "2026-11-12" },
    deltaMinor: -750,
    entries: [
      entry("fish", "2026-10-27", -750),
      entry("toast", "2026-11-12", -370),
      // Before the period: an old unconfirmed entry is not a candidate.
      entry("old", "2026-09-01", -750)
    ]
  });

  assert.equal(result.remainingMinor, 0);
  assert.equal(result.billedNext, undefined);
  assert.deepEqual(result.notOnStatement, {
    totalMinor: -750,
    entryCount: 1,
    oneOf: false,
    entries: [{ entryId: "fish", date: "2026-10-27", description: "Shop fish", signedAmountMinor: -750 }]
  });
});

test("two unconfirmed entries of the same amount are offered as one of these", () => {
  const result = explainStatementDifference({
    statement,
    deltaMinor: -500,
    entries: [entry("x", "2026-09-20", -500), entry("y", "2026-10-01", -500)]
  });

  assert.equal(result.notOnStatement.oneOf, true);
  assert.equal(result.notOnStatement.totalMinor, -500);
  assert.deepEqual(result.notOnStatement.entries.map((item) => item.entryId), ["x", "y"]);
  assert.equal(result.remainingMinor, 0);
});

test("a pair of unconfirmed entries explains what is left after next-statement purchases", () => {
  const result = explainStatementDifference({
    statement,
    deltaMinor: -1300,
    entries: [
      entry("late", "2026-10-11", -1000, { certifiedByMonth: "2026-11" }),
      entry("p", "2026-09-15", -100),
      entry("q", "2026-09-16", -200),
      entry("r", "2026-09-17", -900)
    ]
  });

  assert.equal(result.billedNext.totalMinor, -1000);
  assert.deepEqual(result.notOnStatement.entries.map((item) => item.entryId), ["p", "q"]);
  assert.equal(result.remainingMinor, 0);
});

test("nothing adds up: no entry is blamed and the whole difference remains", () => {
  const result = explainStatementDifference({
    statement,
    deltaMinor: -100000,
    entries: [entry("p", "2026-09-15", -100), entry("q", "2026-09-16", -200)]
  });

  assert.equal(result.billedNext, undefined);
  assert.equal(result.notOnStatement, undefined);
  assert.equal(result.remainingMinor, -100000);
});

test("two different pairs fit: ambiguous, so no entry is blamed", () => {
  const result = explainStatementDifference({
    statement,
    deltaMinor: -500,
    entries: [
      entry("a", "2026-09-15", -100),
      entry("b", "2026-09-16", -400),
      entry("c", "2026-09-17", -200),
      entry("d", "2026-09-18", -300)
    ]
  });

  assert.equal(result.notOnStatement, undefined);
  assert.equal(result.remainingMinor, -500);
});

test("next-statement purchases that overshoot are not used", () => {
  // The later statement's rows come to more than the difference: the
  // difference is something else, so they must not be shown as its cause.
  const result = explainStatementDifference({
    statement,
    deltaMinor: -100,
    entries: [entry("late", "2026-10-11", -1000, { certifiedByMonth: "2026-11" })]
  });

  assert.equal(result.billedNext, undefined);
  assert.equal(result.remainingMinor, -100);
});

test("a matched statement has nothing to explain", () => {
  assert.equal(explainStatementDifference({ statement, deltaMinor: 0, entries: [entry("p", "2026-09-15", -100)] }), undefined);
});

test("long lists are cut to five rows but keep their count and total", () => {
  const entries = Array.from({ length: 8 }, (_, index) =>
    entry(`n${index}`, "2026-10-10", -100, { certifiedByMonth: "2026-11" }));
  const result = explainStatementDifference({ statement, deltaMinor: -800, entries });

  assert.equal(result.billedNext.entryCount, 8);
  assert.equal(result.billedNext.entries.length, 5);
  assert.equal(result.billedNext.totalMinor, -800);
});
