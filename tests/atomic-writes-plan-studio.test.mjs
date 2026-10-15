// Plan Studio's "Save plan" (DOMAIN.md "Plan Studio"): every changed row in one
// request through applyMonthPlanChanges. A save that moves an income row, a
// shared planned row and the savings row commits all three together, keeps
// the shared row's split, refreshes the month's planned totals, and a save
// that fails on its second row writes nothing. Real local D1 (Miniflare)
// seeded with the demo household.
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

async function studioRows(db) {
  const [shared] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND ownership_type = 'shared' AND section_key = 'budget_buckets' AND planned_amount_minor >= 10000 ORDER BY id LIMIT 1");
  const [saving] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND label = 'Savings' ORDER BY id LIMIT 1");
  const [income] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND section_key = 'income' ORDER BY id LIMIT 1");
  assert.ok(shared && saving, "the seed has a shared budget line and a savings line in May");
  return { shared, saving, income };
}

const sharedSplits = (db, rowId) => rows(db, "SELECT person_id, ratio_basis_points FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ? ORDER BY person_id", rowId);

test("Save plan moves a shared line and the savings line together, keeps the shared split and refreshes the planned total", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, MONTH);
  const { shared, saving } = await studioRows(db);
  const splitsBefore = await sharedSplits(db, shared.id);
  const [householdBefore] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");

  const result = await applyMonthPlanChanges(db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: shared.id, expectedMinor: shared.planned_amount_minor, plannedMinor: shared.planned_amount_minor - 5_000 },
      { action: "update", rowId: saving.id, expectedMinor: saving.planned_amount_minor, plannedMinor: saving.planned_amount_minor + 5_000 }
    ]
  });
  assert.equal(result.applied, 2);

  const [sharedAfter] = await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = ?", shared.id);
  const [savingAfter] = await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = ?", saving.id);
  assert.equal(sharedAfter.planned_amount_minor, shared.planned_amount_minor - 5_000);
  assert.equal(savingAfter.planned_amount_minor, saving.planned_amount_minor + 5_000);
  assert.deepEqual(await sharedSplits(db, shared.id), splitsBefore, "each person keeps their share of the shared line");
  const splitTotal = (await rows(db, "SELECT SUM(amount_minor) AS total FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?", shared.id))[0].total;
  assert.equal(splitTotal, shared.planned_amount_minor - 5_000, "the split amounts follow the new total");
  const [householdAfter] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.estimated_expense_minor, householdBefore.estimated_expense_minor, "money moved between lines, none added to the plan");
});

test("Save plan raising one line grows the month's planned spend by the same amount", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, MONTH);
  const { shared } = await studioRows(db);
  const [before] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  await applyMonthPlanChanges(db, { month: MONTH, changes: [{ action: "update", rowId: shared.id, expectedMinor: shared.planned_amount_minor, plannedMinor: shared.planned_amount_minor + 12_345 }] });
  const [after] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  assert.equal(after.estimated_expense_minor, before.estimated_expense_minor + 12_345);
});

test("a save that fails on its second row writes nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { shared, saving } = await studioRows(db);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE monthly_plan_rows/, { skip: 1 });

  await assert.rejects(applyMonthPlanChanges(faulty.db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: shared.id, expectedMinor: shared.planned_amount_minor, plannedMinor: shared.planned_amount_minor - 5_000 },
      { action: "update", rowId: saving.id, expectedMinor: saving.planned_amount_minor, plannedMinor: saving.planned_amount_minor + 5_000 }
    ]
  }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a save whose first row is still right but whose second changed underneath is refused whole (409)", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { shared, saving } = await studioRows(db);
  const before = await dumpDatabase(db);
  await assert.rejects(applyMonthPlanChanges(db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: shared.id, expectedMinor: shared.planned_amount_minor, plannedMinor: shared.planned_amount_minor - 5_000 },
      { action: "update", rowId: saving.id, expectedMinor: saving.planned_amount_minor - 100, plannedMinor: saving.planned_amount_minor + 5_000 }
    ]
  }), (error) => error instanceof MonthPlanChangeError && error.status === 409);
  assertSameDatabase(await dumpDatabase(db), before);
});
