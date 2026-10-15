import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitsPage } from "../src/domain/splits-projection.ts";
import { buildSplitsLead, summariseGroupSpend } from "../src/client/splits-lead-model.js";

// The group spend chip describes the open period only: the expenses no
// settle-up has covered, the same set the entry count and the balance use.
// The shape mirrors a real group: one checkpoint covers the older expenses
// (and some of another group's), a few newer expenses are still open.

const people = { "person-tim": "Tim", "person-joyce": "Joyce" };
const peopleList = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const groupId = "split-group-okaeri";

function expense(id, date, totalAmountMinor, overrides = {}) {
  const half = totalAmountMinor / 2;
  return {
    id,
    groupId,
    groupName: "Okaeri",
    date,
    description: `Expense ${id}`,
    categoryName: "Food & Drinks",
    payerPersonId: "person-joyce",
    payerPersonName: "Joyce",
    totalAmountMinor,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    shares: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: half },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: half }
    ],
    ...overrides
  };
}

function checkpoint(id, status, includedRecordIds, settlementDate = "2026-08-27") {
  return {
    id,
    amountMinor: 1,
    currency: "SGD",
    settlementDate,
    status,
    matchedAmountMinor: 0,
    matchedTransfers: [],
    includedRecordCount: includedRecordIds.length,
    includedRecordIds
  };
}

const older = [
  expense("e-old-1", "2026-04-02", 100_000),
  expense("e-old-2", "2026-06-24", 105_185),
  expense("e-old-3", "2026-08-20", 20_000)
];
const newer = [
  expense("e-new-1", "2026-08-23", 10_000),
  expense("e-new-2", "2026-10-13", 20_000)
];
const OLDER_IDS = older.map((item) => item.id);

function build(expenses, checkpoints, viewId = "person-tim") {
  const page = buildSplitsPage(
    viewId,
    [{ id: groupId, name: "Okaeri", sortOrder: 1, currency: "SGD", expenseSource: "mixed" }],
    expenses,
    [],
    [],
    [],
    "2026-10",
    people,
    checkpoints
  );
  // What buildSplitsPanelModel (splits-selectors.js) hands the lead card: the
  // open group's activity, its spend summary, balance and donut.
  const activeGroup = page.groups.find((group) => group.id === groupId);
  const { spendMinor, hasSettledBefore } = summariseGroupSpend(page.activity.filter((item) => item.groupId === groupId));
  const model = {
    activeGroup,
    groupBalanceMinor: activeGroup.balanceMinor,
    totalExpenseMinor: spendMinor,
    hasSettledBefore,
    donutChart: page.donutChart
  };
  const lead = buildSplitsLead({
    group: model.activeGroup,
    viewId,
    people: peopleList,
    areTotalsVisible: true,
    spendMinor: model.totalExpenseMinor,
    hasSettledBefore: model.hasSettledBefore
  });
  return { page, model, lead };
}

test("a group that was never settled keeps Group spend and counts every expense", () => {
  const { model, lead } = build([...older, ...newer], []);
  assert.equal(model.totalExpenseMinor, 255_185);
  assert.equal(lead.spendMinor, 255_185);
  assert.equal(lead.spendLabel, "Group spend");
  assert.equal(lead.donutLabel, "Group spend");
  assert.equal(model.activeGroup.entryCount, 5);
});

test("one matched checkpoint: the spend is only what came after, and it agrees with the entry count", () => {
  const { model, lead } = build([...older, ...newer], [checkpoint("cp-1", "matched", OLDER_IDS)]);
  assert.equal(lead.spendMinor, 30_000);
  assert.equal(lead.spendLabel, "Spent since last settle-up");
  assert.equal(lead.donutLabel, "Since last settle-up");
  assert.equal(model.activeGroup.entryCount, 2);
  // The balance describes the same two expenses: Joyce paid, Tim owes half.
  assert.equal(model.groupBalanceMinor, -15_000);
  assert.equal(lead.amountMinor, 15_000);
});

test("partially matched and internally offset checkpoints also settle their expenses", () => {
  for (const status of ["partially_matched", "internally_offset"]) {
    const { lead, model } = build([...older, ...newer], [checkpoint("cp-1", status, OLDER_IDS)]);
    assert.equal(lead.spendMinor, 30_000, status);
    assert.equal(model.activeGroup.entryCount, 2, status);
  }
});

test("a reopened or voided checkpoint does not settle its expenses: they count again", () => {
  for (const status of ["reopened", "voided"]) {
    const { lead, model } = build([...older, ...newer], [checkpoint("cp-1", status, OLDER_IDS)]);
    assert.equal(lead.spendMinor, 255_185, status);
    assert.equal(lead.spendLabel, "Group spend", status);
    assert.equal(model.activeGroup.entryCount, 5, status);
  }
});

test("several checkpoints: every settled expense is left out, whichever checkpoint holds it", () => {
  const { lead, model } = build([...older, ...newer], [
    checkpoint("cp-1", "matched", ["e-old-1", "e-old-2"], "2026-07-01"),
    checkpoint("cp-2", "matched", ["e-old-3", "e-new-1"], "2026-08-27")
  ]);
  assert.equal(lead.spendMinor, 20_000);
  assert.equal(model.activeGroup.entryCount, 1);
});

test("a checkpoint whose records are all in the group leaves a zero spend that still says since last settle-up", () => {
  const { lead } = build(older, [checkpoint("cp-1", "matched", OLDER_IDS)]);
  assert.equal(lead.spendMinor, 0);
  assert.equal(lead.spendLabel, "Spent since last settle-up");
});

test("the donut charts the same open expenses the chip adds up (household view: the full amounts)", () => {
  const { page, model, lead } = build([...older, ...newer], [checkpoint("cp-1", "matched", OLDER_IDS)], "household");
  const donutTotal = model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0);
  const donutEntries = model.donutChart.reduce((sum, item) => sum + item.entryCount, 0);
  assert.equal(donutTotal, lead.spendMinor);
  assert.equal(donutEntries, model.activeGroup.entryCount);
  assert.equal(page.donutChart.length, 1);
  // Negative: never settled, the donut and the chip both take in all five.
  const never = build([...older, ...newer], [], "household");
  assert.equal(never.model.donutChart.reduce((sum, item) => sum + item.valueMinor, 0), never.lead.spendMinor);
  assert.equal(never.lead.spendMinor, 255_185);
});

test("a foreign-currency group adds the expense totals in its own currency, never converted", () => {
  const yen = (id, total, extra = {}) => expense(id, "2026-09-01", total, { currency: "JPY", homeAmountMinor: Math.round(total / 100), ...extra });
  const { lead } = build(
    [yen("y-1", 1_200_000), yen("y-2", 600_000)],
    [checkpoint("cp-y", "matched", ["y-1"])]
  );
  assert.equal(lead.spendMinor, 600_000);
});

test("summariseGroupSpend ignores settled items, settlements and counts only expenses", () => {
  const items = [
    { kind: "expense", totalAmountMinor: 500, settlementStatus: "open" },
    { kind: "expense", totalAmountMinor: 700, settlementStatus: "open_after_settlement" },
    { kind: "expense", totalAmountMinor: 9_000, settlementStatus: "settled" },
    { kind: "settlement", totalAmountMinor: 4_000, settlementStatus: "open" }
  ];
  assert.deepEqual(summariseGroupSpend(items), { spendMinor: 1_200, hasSettledBefore: true });
  assert.deepEqual(summariseGroupSpend([]), { spendMinor: 0, hasSettledBefore: false });
});
