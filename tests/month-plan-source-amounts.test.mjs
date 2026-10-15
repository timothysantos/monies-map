import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanRowsForView } from "../src/domain/month-projection.ts";

// Plan Studio edits the household view's combined line through the stored
// rows it was made of, so each combined line carries what each one held, in
// the order of its source row ids. A line that is one stored row carries none
// (its own planned amount is the source), so the page does not grow for it.

const split = (personId, personName, amountMinor) => ({ personId, personName, amountMinor, ratioBasisPoints: 10_000 });
const row = (id, personId, personName, plannedMinor) => ({
  id, section: "planned_items", categoryName: "Savings", label: "Savings", plannedMinor, actualMinor: 0,
  ownershipType: "direct", personId, ownerName: personName, splits: [split(personId, personName, plannedMinor)]
});

test("a combined household line says what each of its stored rows holds, in source order", () => {
  const rows = buildPlanRowsForView([row("tim-save", "p-tim", "Tim", 70_000), row("joy-save", "p-joyce", "Joyce", 50_000)], "household");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plannedMinor, 120_000);
  assert.deepEqual(rows[0].sourceRowIds, ["tim-save", "joy-save"]);
  assert.deepEqual(rows[0].sourcePlannedMinors, [70_000, 50_000]);
});

test("three rows that combine keep every amount in order", () => {
  const rows = buildPlanRowsForView([row("a", "p-tim", "Tim", 100), row("b", "p-joyce", "Joyce", 200), row("c", "p-tim", "Tim", 300)], "household");
  assert.deepEqual(rows[0].sourceRowIds, ["a", "b", "c"]);
  assert.deepEqual(rows[0].sourcePlannedMinors, [100, 200, 300]);
});

test("a line that is one stored row, and any person's view, carry no source list", () => {
  const single = buildPlanRowsForView([row("only", "p-tim", "Tim", 70_000)], "household");
  assert.equal(single[0].sourcePlannedMinors, undefined);
  assert.deepEqual(single[0].sourceRowIds, ["only"]);
  const person = buildPlanRowsForView([row("tim-save", "p-tim", "Tim", 70_000), row("joy-save", "p-joyce", "Joyce", 50_000)], "p-tim");
  assert.equal(person.length, 1);
  assert.equal(person[0].sourcePlannedMinors, undefined);
});
