// Plan Studio's "Add to Savings" on extra income (DOMAIN.md "Plan Studio"):
// the Savings plan row rises and the planned money in rises by the same
// amount in ONE applyMonthPlanChanges batch: an update of the Savings row plus
// a create of the person's Extra income row (or an update of the one they
// already have). A failure on either row writes nothing, a plan that changed
// underneath is refused whole (409), and the month is marked and refreshed.
// Real local D1 (Miniflare) seeded with the demo household.
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
const EXTRA = 50_000;
const EXTRA_ROW = "month-income-extra-test";
const NEW_EXTRA_INCOME = {
  action: "create", rowId: EXTRA_ROW, sectionKey: "income", categoryName: "Income", label: "Extra income",
  plannedMinor: EXTRA, planDate: null, accountName: null, note: "Additional planned income source.", ownershipType: "direct", ownerName: "Tim"
};

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function savingsRow(db) {
  const [saving] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND label = 'Savings' ORDER BY id LIMIT 1");
  assert.ok(saving, "the seed has a Savings line in May");
  return saving;
}
const incomeRows = (db) => rows(db, "SELECT id, label, section_key, ownership_type, person_id, planned_amount_minor, notes, category_id FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND label = 'Extra income' ORDER BY id");
const raiseSavings = (saving) => ({ action: "update", rowId: saving.id, expectedMinor: saving.planned_amount_minor, plannedMinor: saving.planned_amount_minor + EXTRA });

test("Savings is raised and an Extra income line is added together, with the owner and the income defaults", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await recalculateMonthlySnapshots(db, MONTH);
  const saving = await savingsRow(db);
  const [before] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");

  const result = await applyMonthPlanChanges(db, { month: MONTH, changes: [raiseSavings(saving), NEW_EXTRA_INCOME] });

  assert.equal(result.applied, 2);
  const [after] = await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = ?", saving.id);
  assert.equal(after.planned_amount_minor, saving.planned_amount_minor + EXTRA);
  const [created] = await incomeRows(db);
  assert.equal(created.id, EXTRA_ROW);
  assert.equal(created.planned_amount_minor, EXTRA);
  assert.equal(created.section_key, "income");
  assert.equal(created.ownership_type, "direct");
  assert.equal(created.person_id, "person-tim");
  assert.equal(created.notes, "Additional planned income source.");
  const [{ name }] = await rows(db, "SELECT name FROM categories WHERE id = ?", created.category_id);
  assert.equal(name, "Income");
  assert.deepEqual(await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?", EXTRA_ROW), [
    { person_id: "person-tim", ratio_basis_points: 10_000, amount_minor: EXTRA }
  ]);
  // The month's totals were refreshed after the batch: the new planned money in is in the snapshot.
  const [householdAfter] = (await snapshotTotals(db, MONTH)).filter((row) => row.person_scope === "household");
  assert.equal(householdAfter.total_income_minor, before.total_income_minor + EXTRA);

  // Undo puts the month back: the Extra income line is removed and Savings lowered.
  const undone = await applyMonthPlanChanges(db, { month: MONTH, changes: result.undo });
  assert.equal(undone.applied, 2);
  assert.deepEqual(await incomeRows(db), []);
  assert.equal((await rows(db, "SELECT planned_amount_minor FROM monthly_plan_rows WHERE id = ?", saving.id))[0].planned_amount_minor, saving.planned_amount_minor);
});

test("an Extra income line the person already has is raised, not duplicated", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const saving = await savingsRow(db);
  await applyMonthPlanChanges(db, { month: MONTH, changes: [{ ...NEW_EXTRA_INCOME, plannedMinor: 20_000 }] });

  await applyMonthPlanChanges(db, {
    month: MONTH,
    changes: [
      raiseSavings(saving),
      { action: "update", rowId: EXTRA_ROW, expectedMinor: 20_000, plannedMinor: 20_000 + EXTRA }
    ]
  });

  const extraLines = await incomeRows(db);
  assert.equal(extraLines.length, 1);
  assert.equal(extraLines[0].planned_amount_minor, 20_000 + EXTRA);
});

test("a failure on the Extra income line's split leaves Savings and the month exactly as they were", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const saving = await savingsRow(db);
  const before = await dumpDatabase(db);
  // The Savings row's own split statements run first; the create's insert is the second.
  const faulty = failingStatement(db, /INSERT INTO monthly_plan_row_splits/, { skip: 1 });

  await assert.rejects(applyMonthPlanChanges(faulty.db, { month: MONTH, changes: [raiseSavings(saving), NEW_EXTRA_INCOME] }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a failure writing the Extra income row itself leaves Savings unchanged", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const saving = await savingsRow(db);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO monthly_plan_rows/);

  await assert.rejects(applyMonthPlanChanges(faulty.db, { month: MONTH, changes: [raiseSavings(saving), NEW_EXTRA_INCOME] }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a plan that changed underneath refuses the whole save: Savings moved elsewhere means no Extra income line either", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const saving = await savingsRow(db);
  await applyMonthPlanChanges(db, { month: MONTH, changes: [{ action: "update", rowId: saving.id, expectedMinor: saving.planned_amount_minor, plannedMinor: saving.planned_amount_minor + 100 }] });
  const before = await dumpDatabase(db);

  await assert.rejects(
    applyMonthPlanChanges(db, { month: MONTH, changes: [raiseSavings(saving), NEW_EXTRA_INCOME] }),
    (error) => error instanceof MonthPlanChangeError && error.status === 409
  );
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(await incomeRows(db), []);
});

test("a month whose plan is already over-allocated saves the same two writes", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const saving = await savingsRow(db);
  const [shared] = await rows(db, "SELECT id, planned_amount_minor FROM monthly_plan_rows WHERE year = 2026 AND month = 5 AND section_key = 'budget_buckets' AND ownership_type = 'direct' ORDER BY id LIMIT 1");
  assert.ok(shared);
  const result = await applyMonthPlanChanges(db, {
    month: MONTH,
    changes: [
      { action: "update", rowId: shared.id, expectedMinor: shared.planned_amount_minor, plannedMinor: shared.planned_amount_minor + 90_000_000 },
      raiseSavings(saving),
      NEW_EXTRA_INCOME
    ]
  });
  assert.equal(result.applied, 3);
  assert.equal((await incomeRows(db)).length, 1);
});
