// Ask's plan draft, saved (DOMAIN.md "Plan Draft"): applyMonthPlanChanges
// writes several plan-row changes for one month all or nothing. Real local
// D1 (Miniflare) seeded with the demo household. A success case pins the
// rows, splits and planned totals it writes and that its Undo list puts
// them back; failure cases make one statement fail partway, or the plan
// change under the draft, and prove nothing was written.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { recalculateMonthlySnapshots } from "../src/domain/app-repository-snapshots.ts";
import { applyMonthPlanChanges, MonthPlanChangeError } from "../src/domain/app-repository-month-commands.ts";

const MONTH = "2026-05";
let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// Two of the month's budget lines with room to move $50 between them.
async function twoBudgetLines(db) {
  const found = await rows(db, "SELECT id, planned_amount_minor, ownership_type FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND section_key = 'budget_buckets' AND planned_amount_minor >= 5000 ORDER BY id LIMIT 2");
  assert.equal(found.length, 2, "the seed has two budget lines in May");
  return found;
}

const planRows = (db) => rows(db, "SELECT id, label, planned_amount_minor, ownership_type, person_id FROM monthly_plan_rows WHERE year = 2026 AND month = 5 ORDER BY id");
// Who shares each line, and how. (A save rewrites a line's split rows with
// amounts that follow its plan, as the Month editor's save does, so the
// seed's own split amounts are not compared.)
const planSplits = (db) => rows(db, "SELECT s.monthly_plan_row_id, s.person_id, s.ratio_basis_points FROM monthly_plan_row_splits s JOIN monthly_plan_rows r ON r.id = s.monthly_plan_row_id WHERE r.year = 2026 AND r.month = 5 ORDER BY s.monthly_plan_row_id, s.person_id");

const NEW_LINE = { action: "create", rowId: "plan-ask-2026-05-travel", sectionKey: "budget_buckets", categoryName: "Groceries", label: "Travel", plannedMinor: 30_000, ownershipType: "direct", ownerName: "Tim", planDate: null, accountName: null, note: null };

test("a move and a new line commit together, refresh the planned total, and their Undo puts the month back", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, MONTH);
  const [from, to] = await twoBudgetLines(db);
  const rowsBefore = await planRows(db);
  const splitsBefore = await planSplits(db);
  const [householdBefore] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");

  const result = await applyMonthPlanChanges(db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: from.id, expectedMinor: from.planned_amount_minor, plannedMinor: from.planned_amount_minor - 5_000 },
      { action: "update", rowId: to.id, expectedMinor: to.planned_amount_minor, plannedMinor: to.planned_amount_minor + 5_000 },
      NEW_LINE
    ]
  });

  assert.deepEqual(result, {
    month: MONTH,
    applied: 3,
    undo: [
      { action: "delete", rowId: "plan-ask-2026-05-travel", expectedMinor: 30_000 },
      { action: "update", rowId: to.id, expectedMinor: to.planned_amount_minor + 5_000, plannedMinor: to.planned_amount_minor },
      { action: "update", rowId: from.id, expectedMinor: from.planned_amount_minor - 5_000, plannedMinor: from.planned_amount_minor }
    ]
  });
  const amounts = Object.fromEntries((await planRows(db)).map((row) => [row.id, row.planned_amount_minor]));
  assert.equal(amounts[from.id], from.planned_amount_minor - 5_000);
  assert.equal(amounts[to.id], to.planned_amount_minor + 5_000);
  assert.equal(amounts["plan-ask-2026-05-travel"], 30_000);
  assert.deepEqual(await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?", "plan-ask-2026-05-travel"), [
    { person_id: "person-tim", ratio_basis_points: 10_000, amount_minor: 30_000 }
  ]);
  // Each moved line's splits follow its new amount.
  const fromSplitTotal = (await rows(db, "SELECT SUM(amount_minor) AS total FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?", from.id))[0].total;
  assert.equal(fromSplitTotal, from.planned_amount_minor - 5_000);
  const [householdAfter] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.estimated_expense_minor, householdBefore.estimated_expense_minor + 30_000);

  const undone = await applyMonthPlanChanges(db, { month: MONTH, changes: result.undo });
  assert.equal(undone.applied, 3);
  assert.deepEqual(await planRows(db), rowsBefore);
  assert.deepEqual(await planSplits(db), splitsBefore);
  const [householdUndone] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  assert.equal(householdUndone.estimated_expense_minor, householdBefore.estimated_expense_minor);
});

test("a change list that fails on its second line's splits writes nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const [from, to] = await twoBudgetLines(db);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_plan_row_splits/, { skip: 1 });

  await assert.rejects(applyMonthPlanChanges(faulty.db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: from.id, expectedMinor: from.planned_amount_minor, plannedMinor: from.planned_amount_minor - 5_000 },
      { action: "update", rowId: to.id, expectedMinor: to.planned_amount_minor, plannedMinor: to.planned_amount_minor + 5_000 }
    ]
  }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a line changed since the draft, a new line whose id is taken, or a malformed list refuses the whole save", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const [from, to] = await twoBudgetLines(db);
  const before = await dumpDatabase(db);
  const stale = [
    { action: "update", rowId: from.id, expectedMinor: from.planned_amount_minor, plannedMinor: 1_000 },
    { action: "update", rowId: to.id, expectedMinor: to.planned_amount_minor + 1, plannedMinor: 1_000 }
  ];
  await assert.rejects(applyMonthPlanChanges(db, { month: MONTH, changes: stale }), (error) => error instanceof MonthPlanChangeError && error.status === 409 && /plan changed/.test(error.message));
  await assert.rejects(applyMonthPlanChanges(db, { month: MONTH, changes: [{ ...NEW_LINE, rowId: from.id }] }), (error) => error instanceof MonthPlanChangeError && error.status === 409);
  // A line from another month is not this month's to change.
  const [otherMonth] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE NOT (year = 2026 AND month = 5) LIMIT 1");
  await assert.rejects(applyMonthPlanChanges(db, { month: MONTH, changes: [{ action: "update", rowId: otherMonth.id, expectedMinor: otherMonth.planned_amount_minor, plannedMinor: 1 }] }), (error) => error.status === 409);
  for (const changes of [[], [{ action: "update", rowId: from.id, expectedMinor: -1, plannedMinor: 1 }], [{ action: "rename", rowId: from.id }], [{ ...NEW_LINE, ownerName: "" }], [stale[0], stale[0]]]) {
    await assert.rejects(applyMonthPlanChanges(db, { month: MONTH, changes }), (error) => error instanceof MonthPlanChangeError && error.status === 400);
  }
  await assert.rejects(applyMonthPlanChanges(db, { month: "2026-13", changes: stale }), (error) => error.status === 400);

  assertSameDatabase(await dumpDatabase(db), before);
});
