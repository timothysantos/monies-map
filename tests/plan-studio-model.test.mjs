// Plan Studio's pure model (DOMAIN.md "Plan Studio"): how a month's plan
// rows become money jobs, how the plan adds up, the pace by due date, and the
// plain-words verdicts. Demo figures are the mockup's (October, day 19): Tim
// and Joyce earn $9,200 and plan $8,870 out, so $330 is left over.
import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceVerdict,
  buildStudioRows,
  dayOfMonthFor,
  expectedByToday,
  paceVerdict,
  planTotals,
  rowStatus,
  sharedHalves,
  suggestFix
} from "../src/client/plan-studio-model.js";

const d = (dollars) => Math.round(dollars * 100);

function plannedRow(id, label, section, plannedDollars, actualDollars, extra = {}) {
  return {
    id,
    section,
    label,
    categoryName: extra.categoryName ?? label,
    plannedMinor: d(plannedDollars),
    actualMinor: d(actualDollars),
    ownershipType: extra.ownershipType ?? "shared",
    ownerName: extra.ownerName,
    sourceRowIds: extra.sourceRowIds ?? [id],
    sourcePlannedMinor: extra.sourcePlannedMinor,
    sourcePlannedMinors: extra.sourcePlannedMinors,
    isDerived: extra.isDerived,
    planDate: extra.planDate,
    splits: extra.splits ?? [],
    actualEntryIds: []
  };
}

function incomeRow(id, label, plannedDollars, actualDollars, ownerName) {
  return { id, label, categoryName: "Salary", plannedMinor: d(plannedDollars), actualMinor: d(actualDollars), ownerName, sourceRowIds: [id], isDerived: false };
}

const incomeRows = [
  incomeRow("tim-sal", "Tim, salary", 5400, 5400, "Tim"),
  incomeRow("joy-sal", "Joyce, salary", 3200, 3200, "Joyce"),
  incomeRow("joy-free", "Joyce, freelance", 600, 300, "Joyce")
];
const planSections = [
  {
    key: "planned_items",
    rows: [
      plannedRow("loan", "Home loan", "planned_items", 2200, 2200, { planDate: "2026-10-01" }),
      plannedRow("bills", "Bills", "planned_items", 1450, 1210, { planDate: "2026-10-08" }),
      plannedRow("church", "Church", "planned_items", 500, 400, { planDate: "2026-10-12", ownershipType: "direct", ownerName: "Joyce" }),
      plannedRow("subs", "Subscriptions", "planned_items", 120, 98, { planDate: "2026-10-07" }),
      plannedRow("invest", "Investments", "planned_items", 1200, 800, { categoryName: "Investments", planDate: "2026-10-05" }),
      plannedRow("save", "Savings", "planned_items", 1500, 0, { categoryName: "Savings" })
    ]
  },
  {
    key: "budget_buckets",
    rows: [
      plannedRow("food", "Food & Drinks", "budget_buckets", 1300, 910),
      plannedRow("travel", "Travel", "budget_buckets", 600, 640, { ownershipType: "direct", ownerName: "Tim" })
    ]
  }
];

const rows = buildStudioRows({ incomeRows, planSections, month: "2026-10" });
const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
const savedPlan = Object.fromEntries(rows.map((row) => [row.key, row.savedMinor]));

test("every row gets a money job: income, the Savings row saves, Investments invest, the rest spend", () => {
  assert.deepEqual(
    rows.map((row) => [row.key, row.job]),
    [
      ["tim-sal", "income"], ["joy-sal", "income"], ["joy-free", "income"],
      ["loan", "spend"], ["bills", "spend"], ["church", "spend"], ["subs", "spend"],
      ["invest", "invest"], ["save", "save"],
      ["food", "spend"], ["travel", "spend"]
    ]
  );
  assert.equal(byKey.loan.dueDay, 1);
  assert.equal(byKey.bills.dueDay, 8);
  assert.equal(byKey.food.dueDay, null);
  assert.equal(byKey.food.savedMinor, d(1300));
  assert.equal(byKey.food.actualMinor, d(910));
  assert.equal(byKey.food.editable, true);
});

test("planned money in less what is planned out is what is left over", () => {
  const totals = planTotals(rows, savedPlan);
  assert.deepEqual(totals, {
    income: d(9200), spend: d(6170), save: d(1500), invest: d(1200), out: d(8870), left: d(330)
  });
});

test("a combined household line (several stored rows) is read only, as the household view's plan is", () => {
  const combined = buildStudioRows({
    incomeRows: [],
    planSections: [{
      key: "planned_items",
      rows: [
        plannedRow("combined:x", "Savings", "planned_items", 1200, 0, {
          categoryName: "Savings", isDerived: true, ownershipType: "direct", sourceRowIds: ["tim-save", "joy-save"]
        }),
        plannedRow("tim-gym", "Gym", "planned_items", 100, 0, {})
      ]
    }],
    month: "2026-10"
  });
  assert.equal(combined[0].editable, false, "it is made of two stored rows");
  assert.equal(combined[1].editable, true);
  assert.deepEqual(combined[1].ids, ["tim-gym"]);
});

test("a plan that spends more than comes in does not add up, and says by how much", () => {
  assert.deepEqual(balanceVerdict(planTotals(rows, savedPlan)), { kind: "covered", tone: "in", amountMinor: d(330) });
  assert.deepEqual(balanceVerdict({ income: d(100), out: d(100), left: 0 }), { kind: "exact", tone: "in", amountMinor: 0 });
  assert.deepEqual(balanceVerdict({ income: d(9200), out: d(9270), left: -d(70) }), { kind: "over", tone: "short", amountMinor: d(70) });
  assert.deepEqual(balanceVerdict({ income: 0, out: d(50), left: -d(50) }), { kind: "empty", tone: "caution", amountMinor: 0 });
});

test("the one-tap fix lowers the flexible category with the most room, by what is over rounded up to $10", () => {
  const over = { ...savedPlan, food: d(1700) };
  const totals = planTotals(rows, over);
  assert.equal(totals.left, -d(70));
  assert.deepEqual(suggestFix({ rows, plan: over, locks: {}, totals }), {
    kind: "lower", rowKey: "food", label: "Food & Drinks", byMinor: d(70)
  });
  // The row's plan caps the fix, and a locked row is never chosen.
  const huge = { ...savedPlan, food: d(1300), travel: d(10) };
  const hugeTotals = { ...planTotals(rows, huge), left: -d(300) };
  assert.equal(suggestFix({ rows, plan: huge, locks: { food: true }, totals: hugeTotals }).rowKey, "travel");
  assert.equal(suggestFix({ rows, plan: huge, locks: { food: true }, totals: hugeTotals }).byMinor, d(10));
  // Nothing editable to lower: no fix.
  const none = suggestFix({ rows, plan: over, locks: Object.fromEntries(rows.map((row) => [row.key, true])), totals });
  assert.equal(none, null);
});

test("with money left over, the one-tap action adds it to savings", () => {
  const totals = planTotals(rows, savedPlan);
  assert.deepEqual(suggestFix({ rows, plan: savedPlan, locks: {}, totals }), {
    kind: "save", rowKey: "save", label: "Savings", byMinor: d(330)
  });
  assert.equal(suggestFix({ rows: rows.filter((row) => row.job !== "save"), plan: savedPlan, locks: {}, totals }), null);
});

test("the usual by today follows due dates for bills and rent, and a straight line for flexible budgets", () => {
  const day19 = { day: 19, daysInMonth: 31 };
  assert.equal(expectedByToday(byKey.loan, d(2200), day19), d(2200), "due on the 1st: all expected by the 19th");
  assert.equal(expectedByToday(byKey.church, d(500), day19), d(500), "due on the 12th");
  assert.equal(expectedByToday(byKey.food, d(1300), day19), Math.round((d(1300) * 19) / 31), "no due date: 19 of 31 days");
  assert.equal(expectedByToday(byKey.loan, d(2200), { day: 0, daysInMonth: 31 }), 0, "a future month expects nothing yet");
  assert.equal(expectedByToday(byKey.bills, d(1450), { day: 7, daysInMonth: 31 }), 0, "due on the 8th, not yet");
  assert.equal(expectedByToday(byKey.save, d(1500), day19), null, "saving has no pace");
  assert.equal(expectedByToday(byKey["tim-sal"], d(5400), day19), null, "income arrives when it arrives");
});

test("the day of the month for the pace is today in the month shown, all of it for a past month, none for a future one", () => {
  assert.deepEqual(dayOfMonthFor("2026-10", "2026-10-19"), { day: 19, daysInMonth: 31, isCurrent: true });
  assert.deepEqual(dayOfMonthFor("2026-09", "2026-10-19"), { day: 30, daysInMonth: 30, isCurrent: false });
  assert.deepEqual(dayOfMonthFor("2026-11", "2026-10-19"), { day: 0, daysInMonth: 30, isCurrent: false });
  assert.deepEqual(dayOfMonthFor("2028-02", "2026-10-19").daysInMonth, 29);
});

test("the pace verdict is On track, A bit ahead of pace or Over plan", () => {
  assert.equal(paceVerdict({ spentMinor: d(5458), plannedSpendMinor: d(6170), expectedMinor: d(5435) }).kind, "on_track");
  const ahead = paceVerdict({ spentMinor: d(5800), plannedSpendMinor: d(6170), expectedMinor: d(5435) });
  assert.deepEqual([ahead.kind, ahead.tone, ahead.aheadByMinor], ["ahead", "caution", d(365)]);
  const over = paceVerdict({ spentMinor: d(6300), plannedSpendMinor: d(6170), expectedMinor: d(5435) });
  assert.deepEqual([over.kind, over.tone, over.overByMinor], ["over", "short", d(130)]);
  // Within the margin (the larger of $100 and 5% of the plan: $308 here) is still on track.
  assert.equal(paceVerdict({ spentMinor: d(5700), plannedSpendMinor: d(6170), expectedMinor: d(5435) }).kind, "on_track");
  assert.equal(paceVerdict({ spentMinor: d(5530), plannedSpendMinor: d(6170), expectedMinor: d(5435) }).kind, "on_track");
});

test("a row says where it stands in plain kinds with the amount, never the app's own state", () => {
  const ctx = { day: 19, daysInMonth: 31, keptMinor: d(2642) };
  assert.deepEqual(rowStatus(byKey["joy-free"], d(600), ctx), { kind: "income_to_come", tone: "plan", amountMinor: d(300) });
  assert.deepEqual(rowStatus(byKey["tim-sal"], d(5400), ctx), { kind: "income_full", tone: "in", amountMinor: 0 });
  assert.deepEqual(rowStatus(byKey["tim-sal"], d(5000), ctx), { kind: "income_more", tone: "in", amountMinor: d(400) });
  assert.deepEqual(rowStatus(byKey.travel, d(600), ctx), { kind: "spend_over", tone: "short", amountMinor: d(40) });
  assert.deepEqual(rowStatus(byKey.food, d(1600), ctx), { kind: "spend_left", tone: "in", amountMinor: d(690) });
  assert.deepEqual(rowStatus(byKey.food, d(1300), ctx), { kind: "spend_ahead", tone: "caution", amountMinor: 11323 }, "$910 spent by the 19th is past the straight line");
  assert.deepEqual(rowStatus(byKey.bills, d(1450), ctx), { kind: "spend_to_pay", tone: "plan", amountMinor: d(240) });
  assert.deepEqual(rowStatus(byKey.save, d(1500), ctx), { kind: "save_ahead", tone: "in", amountMinor: d(1142) });
  assert.deepEqual(rowStatus(byKey.save, d(3000), ctx), { kind: "save_to_go", tone: "plan", amountMinor: d(358) });
  assert.deepEqual(rowStatus(byKey.invest, d(1200), ctx), { kind: "invest_to_move", tone: "plan", amountMinor: d(400) });
});

test("a shared row shows each person's half from its own split, the last person taking the odd cent", () => {
  const shared = {
    ...byKey.food,
    splits: [
      { personId: "p1", personName: "Tim", ratioBasisPoints: 5000, amountMinor: d(650) },
      { personId: "p2", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: d(650) }
    ]
  };
  assert.deepEqual(sharedHalves(shared, d(1300)), [
    { personName: "Tim", amountMinor: d(650) },
    { personName: "Joyce", amountMinor: d(650) }
  ]);
  assert.deepEqual(sharedHalves(shared, 1301), [
    { personName: "Tim", amountMinor: 651 },
    { personName: "Joyce", amountMinor: 650 }
  ]);
  assert.deepEqual(sharedHalves({ ...shared, splits: [{ personId: "p1", personName: "Tim", ratioBasisPoints: 7000, amountMinor: 0 }, { personId: "p2", personName: "Joyce", ratioBasisPoints: 3000, amountMinor: 0 }] }, d(1000)), [
    { personName: "Tim", amountMinor: d(700) },
    { personName: "Joyce", amountMinor: d(300) }
  ]);
  assert.deepEqual(sharedHalves({ ...byKey.travel, ownershipType: "direct", splits: [] }, d(600)), [], "a row that is one person's has no halves");
});
