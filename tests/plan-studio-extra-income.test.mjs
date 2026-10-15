// "Add to Savings" on money that arrived beyond the plan (DOMAIN.md "Plan
// Studio", extra income): Savings and Planned in both rise by the amount, so
// the plan still adds up. Pure model: which rows are raised or created, the
// amounts (minor units), that Left over does not move, and that the unplanned
// amount is worked out from totals, not labels.
import assert from "node:assert/strict";
import test from "node:test";

import { buildStudioRows, planTotals } from "../src/client/plan-studio-model.js";
import { createChangeForRow } from "../src/client/plan-studio-edit.js";
import { EXTRA_INCOME_LABEL, planExtraIncomeToSavings, unplannedIncome } from "../src/client/plan-studio-v2-model.js";
import { currentPlan } from "../src/client/plan-studio-edit.js";

const d = (dollars) => Math.round(dollars * 100);

const incomeRow = (id, label, plannedDollars, ownerName, extra = {}) => ({
  id, label, categoryName: "Salary", plannedMinor: d(plannedDollars), actualMinor: 0, ownerName, sourceRowIds: [id], isDerived: false, ...extra
});
const planRow = (id, label, plannedDollars, categoryName = label) => ({
  id, section: "budget_buckets", label, categoryName, plannedMinor: d(plannedDollars), actualMinor: 0,
  ownershipType: "direct", ownerName: "Tim", sourceRowIds: [id], splits: [], actualEntryIds: []
});

const salary = incomeRow("tim-sal", "Salary", 5400, "Tim");
function studio({ income = [salary], plan = [planRow("food", "Food", 1300), planRow("save", "Savings", 1500, "Savings")] } = {}) {
  return buildStudioRows({ incomeRows: income, planSections: [{ key: "budget_buckets", rows: plan }], month: "2026-10" });
}

test("Add to Savings raises Savings and Planned in by the same amount: Left over is unchanged and the unplanned amount reaches zero", () => {
  const rows = studio();
  const plan = currentPlan(rows, {});
  const before = planTotals(rows, plan);
  const extraMinor = unplannedIncome({ receivedMinor: d(5900), plannedInMinor: before.income });
  assert.equal(extraMinor, d(500));

  const action = planExtraIncomeToSavings({ rows, plan, extraMinor, ownerName: "Tim" });
  assert.equal(action.amountMinor, d(500));
  assert.equal(action.saveKey, "save");
  assert.equal(action.createSavings, false);
  assert.equal(action.incomeKey, null);
  assert.equal(action.createIncome, true);
  assert.equal(action.plan.save, d(2000));
  assert.equal(action.plan.food, d(1300), "no other line moves");

  // Once the new Extra income row exists at the amount, the totals show it.
  const afterRows = studio({ income: [salary, incomeRow("new-extra", EXTRA_INCOME_LABEL, 500, "Tim")] });
  const after = planTotals(afterRows, { ...action.plan, "new-extra": d(500) });
  assert.equal(after.income, before.income + d(500));
  assert.equal(after.save, before.save + d(500));
  assert.equal(after.left, before.left, "Left over is unchanged");
  assert.equal(unplannedIncome({ receivedMinor: d(5900), plannedInMinor: after.income }), 0);
});

test("the unplanned amount comes from totals, not labels: money that arrived under Salary is covered by a planned Extra income row", () => {
  // The $500 arrived in the Salary category; the planned row is labelled Extra income.
  assert.equal(unplannedIncome({ receivedMinor: d(5900), plannedInMinor: d(5400) + d(500) }), 0);
  assert.equal(unplannedIncome({ receivedMinor: d(5900), plannedInMinor: d(5400) + d(400) }), d(100), "less than the whole amount planned leaves the rest");
});

test("an existing Extra income row for that person is raised by the amount, not duplicated; another person's row is not theirs", () => {
  const rows = studio({ income: [salary, incomeRow("tim-extra", "Extra income", 200, "Tim")] });
  const action = planExtraIncomeToSavings({ rows, plan: currentPlan(rows, {}), extraMinor: d(300), ownerName: "Tim" });
  assert.equal(action.incomeKey, "tim-extra");
  assert.equal(action.createIncome, false);
  assert.equal(action.plan["tim-extra"], d(500));
  assert.equal(action.plan.save, d(1800));

  const joyces = studio({ income: [salary, incomeRow("joy-extra", " extra INCOME ", 200, "Joyce")] });
  const other = planExtraIncomeToSavings({ rows: joyces, plan: currentPlan(joyces, {}), extraMinor: d(300), ownerName: "Tim" });
  assert.equal(other.createIncome, true);
  assert.equal(other.incomeKey, null);
  assert.equal(other.plan["joy-extra"], d(200), "Joyce's row is left alone");

  const matchedByCase = planExtraIncomeToSavings({ rows: joyces, plan: currentPlan(joyces, {}), extraMinor: d(300), ownerName: "Joyce" });
  assert.equal(matchedByCase.incomeKey, "joy-extra", "the label match ignores case and spaces");
});

test("a person with no Savings line gets one created; a held change on another line stays in the plan returned", () => {
  const rows = studio({ plan: [planRow("food", "Food", 1300)] });
  const action = planExtraIncomeToSavings({ rows, plan: { ...currentPlan(rows, {}), food: d(1400) }, extraMinor: d(500), ownerName: "Tim" });
  assert.equal(action.createSavings, true);
  assert.equal(action.saveKey, null);
  assert.equal(action.plan.food, d(1400));
});

test("it cannot run with nothing extra, with every Savings line locked or read only, or with an Extra income row that cannot be edited", () => {
  const rows = studio();
  const plan = currentPlan(rows, {});
  assert.equal(planExtraIncomeToSavings({ rows, plan, extraMinor: 0, ownerName: "Tim" }), null);
  assert.equal(planExtraIncomeToSavings({ rows, plan, locks: { save: true }, extraMinor: d(500), ownerName: "Tim" }), null, "a locked Savings line is not raised, and none is created beside it");
  const stuck = studio({ income: [salary, incomeRow("tim-extra", "Extra income", 200, "Tim", { isDerived: true })] });
  assert.equal(planExtraIncomeToSavings({ rows: stuck, plan: currentPlan(stuck, {}), extraMinor: d(500), ownerName: "Tim" }), null);
});

test("a plan that is already over-allocated stays exactly as over-allocated: Left over does not move", () => {
  const rows = studio();
  const over = { ...currentPlan(rows, {}), food: d(6000) };
  const before = planTotals(rows, over);
  assert.ok(before.left < 0);
  const action = planExtraIncomeToSavings({ rows, plan: over, extraMinor: d(500), ownerName: "Tim" });
  assert.equal(action.plan.save - over.save, d(500));
  const afterRows = studio({ income: [salary, incomeRow("new-extra", "Extra income", 500, "Tim")] });
  assert.equal(planTotals(afterRows, { ...action.plan, "new-extra": d(500) }).left, before.left);
});

test("the create change for a new line is the request the server's create takes: section, category, owner, amount", () => {
  assert.deepEqual(createChangeForRow({
    id: "month-income-1", categoryName: "Income", label: "Extra income", plannedMinor: d(500), note: "Additional planned income source.",
    ownershipType: "direct", ownerName: "Tim", splits: []
  }, "income"), {
    action: "create", rowId: "month-income-1", sectionKey: "income", categoryName: "Income", label: "Extra income", plannedMinor: d(500),
    planDate: null, accountName: null, note: "Additional planned income source.", ownershipType: "direct", ownerName: "Tim"
  });
  assert.deepEqual(createChangeForRow({
    id: "month-plan-1", categoryName: "Savings", label: "Savings", plannedMinor: d(500), note: "",
    ownershipType: "shared", splits: [{ ratioBasisPoints: 6000 }]
  }, "budget_buckets"), {
    action: "create", rowId: "month-plan-1", sectionKey: "budget_buckets", categoryName: "Savings", label: "Savings", plannedMinor: d(500),
    planDate: null, accountName: null, note: "", ownershipType: "shared", splitBasisPoints: 6000
  });
});
