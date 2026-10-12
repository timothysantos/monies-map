// A plan draft (docs/flows/ask-flow.md "Planning by chat"): a plan request
// resolved against a month's month plan rows into the exact draft the Ask
// card shows and Save posts, a question (which month, which line, whose new
// line) or a note. Pure; demo-style names only.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanDraft, planDraftMonths, planTotals } from "../src/domain/plan-draft.ts";
import { readPlanRequest } from "../src/domain/plan-draft-reader.ts";

const TODAY = "2026-10-13";
const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const categoryNames = ["Groceries", "Shopping", "Food & Drinks", "Housing", "Savings", "Travel", "Salary", "Other"];

function row(id, fields) {
  const ownershipType = fields.shared ? "shared" : "direct";
  const personId = fields.shared ? null : fields.personId ?? "person-tim";
  return {
    id,
    section: fields.section ?? "budget_buckets",
    categoryName: fields.categoryName ?? fields.label,
    label: fields.label,
    plannedMinor: fields.plannedMinor,
    ownershipType,
    personId,
    ownerName: personId ? people.find((person) => person.id === personId).name : null,
    splits: fields.shared
      ? [{ personId: "person-tim", ratioBasisPoints: 5_000 }, { personId: "person-joyce", ratioBasisPoints: 5_000 }]
      : [{ personId, ratioBasisPoints: 10_000 }],
    planDate: fields.planDate ?? null,
    accountName: fields.accountName ?? null,
    note: null
  };
}

const OCTOBER = [
  row("inc-tim", { section: "income", label: "Salary", plannedMinor: 800_000 }),
  row("inc-joyce", { section: "income", label: "Salary", plannedMinor: 600_000, personId: "person-joyce" }),
  row("groc-tim", { label: "Groceries", plannedMinor: 65_000 }),
  row("groc-joyce", { label: "Groceries", plannedMinor: 40_000, personId: "person-joyce" }),
  row("shop", { label: "Shopping", plannedMinor: 48_000, shared: true }),
  row("food-tim", { label: "Food & Drinks", plannedMinor: 32_000 }),
  row("rent", { section: "planned_items", label: "Rent", categoryName: "Housing", plannedMinor: 300_000, shared: true, planDate: "2026-10-01", accountName: "UOB One Account" }),
  row("save-tim", { section: "planned_items", label: "Savings", plannedMinor: 150_000 })
];
const SEPTEMBER = [
  row("inc-tim-09", { section: "income", label: "Salary", plannedMinor: 800_000 }),
  row("groc-tim-09", { label: "Groceries", plannedMinor: 60_000 }),
  row("shop-09", { label: "Shopping", plannedMinor: 50_000, shared: true }),
  row("rent-09", { section: "planned_items", label: "Rent", categoryName: "Housing", plannedMinor: 300_000, shared: true, planDate: "2026-09-30", accountName: "UOB One Account" }),
  row("travel-09", { label: "Travel", plannedMinor: 20_000 }),
  row("groc-joyce-09", { label: "Groceries", plannedMinor: 45_000, personId: "person-joyce" })
];
const NOVEMBER = [row("inc-tim-11", { section: "income", label: "Salary", plannedMinor: 800_000 })];
const rowsByMonth = { "2026-09": SEPTEMBER, "2026-10": OCTOBER, "2026-11": NOVEMBER };

function draft(text, { viewId = "person-tim", answers, rows = rowsByMonth } = {}) {
  const reading = readPlanRequest(text, { today: TODAY });
  assert.equal(reading.kind, "request", text);
  return buildPlanDraft(reading.request, { today: TODAY, viewId, monthInView: "2026-10", people, categoryNames, rowsByMonth: rows, answers });
}

test("setting a line drafts its before and after, the view's totals and the one update Save posts", () => {
  assert.deepEqual(draft("set groceries plan to $700 for October"), {
    kind: "draft",
    draft: {
      month: "2026-10",
      viewId: "person-tim",
      kind: "set",
      copyFrom: null,
      lead: { label: "Groceries", categoryName: "Groceries", amountMinor: 70_000, beforeMinor: 65_000 },
      changes: [{ rowId: "groc-tim", action: "update", section: "budget_buckets", label: "Groceries", categoryName: "Groceries", ownerLabel: "Tim", beforeMinor: 65_000, afterMinor: 70_000 }],
      totals: {
        before: { plannedIncomeMinor: 800_000, plannedSpendMinor: 595_000, remainingMinor: 205_000 },
        after: { plannedIncomeMinor: 800_000, plannedSpendMinor: 600_000, remainingMinor: 200_000 }
      },
      warning: null,
      apply: [{ action: "update", rowId: "groc-tim", expectedMinor: 65_000, plannedMinor: 70_000 }]
    }
  });
});

test("the view's totals add up as the Month cards do: a person's own and shared lines, the household's every line", () => {
  assert.deepEqual(planTotals(OCTOBER, "person-tim"), { plannedIncomeMinor: 800_000, plannedSpendMinor: 595_000, remainingMinor: 205_000 });
  assert.deepEqual(planTotals(OCTOBER, "person-joyce"), { plannedIncomeMinor: 600_000, plannedSpendMinor: 388_000, remainingMinor: 212_000 });
  assert.deepEqual(planTotals(OCTOBER, "household"), { plannedIncomeMinor: 1_400_000, plannedSpendMinor: 635_000, remainingMinor: 765_000 });
});

test("moving between two lines keeps planned spend and names both lines in the lead", () => {
  const result = draft("move $50 from Shopping to Groceries in October");
  assert.equal(result.kind, "draft");
  assert.deepEqual(result.draft.lead, { label: "", categoryName: null, amountMinor: 5_000, beforeMinor: null, fromLabel: "Shopping", toLabel: "Groceries" });
  assert.deepEqual(result.draft.changes.map(({ rowId, beforeMinor, afterMinor }) => ({ rowId, beforeMinor, afterMinor })), [
    { rowId: "groc-tim", beforeMinor: 65_000, afterMinor: 70_000 },
    { rowId: "shop", beforeMinor: 48_000, afterMinor: 43_000 }
  ]);
  assert.deepEqual(result.draft.totals.before, result.draft.totals.after);
  assert.deepEqual(result.draft.apply, [
    { action: "update", rowId: "groc-tim", expectedMinor: 65_000, plannedMinor: 70_000 },
    { action: "update", rowId: "shop", expectedMinor: 48_000, plannedMinor: 43_000 }
  ]);
});

test("copying a month copies the view's lines into it, then applies the changes after 'but'", () => {
  const result = draft("plan November like September but Groceries $700");
  assert.equal(result.kind, "draft");
  const { draft: plan } = result;
  assert.equal(plan.kind, "copy");
  assert.equal(plan.copyFrom, "2026-09");
  // Joyce's own September line is not Tim's to copy; his salary is already there.
  assert.deepEqual(plan.changes.map(({ rowId, action, label, ownerLabel, beforeMinor, afterMinor }) => ({ rowId, action, label, ownerLabel, beforeMinor, afterMinor })), [
    { rowId: "groc-tim-09-copy-2026-11", action: "create", label: "Groceries", ownerLabel: "Tim", beforeMinor: 0, afterMinor: 70_000 },
    { rowId: "shop-09-copy-2026-11", action: "create", label: "Shopping", ownerLabel: "Shared", beforeMinor: 0, afterMinor: 50_000 },
    { rowId: "rent-09-copy-2026-11", action: "create", label: "Rent", ownerLabel: "Shared", beforeMinor: 0, afterMinor: 300_000 },
    { rowId: "travel-09-copy-2026-11", action: "create", label: "Travel", ownerLabel: "Tim", beforeMinor: 0, afterMinor: 20_000 }
  ]);
  assert.deepEqual(plan.lead, { label: "", categoryName: null, amountMinor: 440_000, beforeMinor: 0 });
  assert.deepEqual(plan.totals, {
    before: { plannedIncomeMinor: 800_000, plannedSpendMinor: 0, remainingMinor: 800_000 },
    after: { plannedIncomeMinor: 800_000, plannedSpendMinor: 440_000, remainingMinor: 360_000 }
  });
  // A planned item keeps its day (30 Nov), its wallet and its shared split.
  assert.deepEqual(plan.apply.find((change) => change.rowId === "rent-09-copy-2026-11"), {
    action: "create",
    rowId: "rent-09-copy-2026-11",
    sectionKey: "planned_items",
    categoryName: "Housing",
    label: "Rent",
    plannedMinor: 300_000,
    ownershipType: "shared",
    splitBasisPoints: 5_000,
    planDate: "2026-11-30",
    accountName: "UOB One Account",
    note: null
  });
  assert.deepEqual(plan.apply.find((change) => change.rowId === "groc-tim-09-copy-2026-11"), {
    action: "create",
    rowId: "groc-tim-09-copy-2026-11",
    sectionKey: "budget_buckets",
    categoryName: "Groceries",
    label: "Groceries",
    plannedMinor: 70_000,
    ownershipType: "direct",
    ownerName: "Tim",
    planDate: null,
    accountName: null,
    note: null
  });
});

test("copying into a month that already has the lines changes their amounts instead of adding them twice", () => {
  const result = draft("copy september to october");
  assert.equal(result.kind, "draft");
  assert.deepEqual(result.draft.changes.map(({ rowId, action, beforeMinor, afterMinor }) => ({ rowId, action, beforeMinor, afterMinor })), [
    { rowId: "groc-tim", action: "update", beforeMinor: 65_000, afterMinor: 60_000 },
    { rowId: "shop", action: "update", beforeMinor: 48_000, afterMinor: 50_000 },
    { rowId: "travel-09-copy-2026-10", action: "create", beforeMinor: 0, afterMinor: 20_000 }
  ]);
});

test("a name that fits more than one line asks which, and the answer drafts that line", () => {
  const household = draft("set groceries to 500 for october", { viewId: "household" });
  assert.deepEqual(household, {
    kind: "question",
    question: {
      field: "line",
      name: "groceries",
      options: [
        { rowId: "groc-tim", label: "Groceries", ownerLabel: "Tim", plannedMinor: 65_000 },
        { rowId: "groc-joyce", label: "Groceries", ownerLabel: "Joyce", plannedMinor: 40_000 }
      ]
    }
  });
  const answered = draft("set groceries to 500 for october", { viewId: "household", answers: { lines: { groceries: "groc-joyce" } } });
  assert.deepEqual(answered.draft.apply, [{ action: "update", rowId: "groc-joyce", expectedMinor: 40_000, plannedMinor: 50_000 }]);

  const rows = { ...rowsByMonth, "2026-10": [...OCTOBER, row("food-del", { label: "Food delivery", categoryName: "Food & Drinks", plannedMinor: 8_000 })] };
  const food = draft("set food to 300 for october", { rows });
  assert.equal(food.kind, "question");
  assert.deepEqual(food.question.options.map((option) => option.rowId), ["food-tim", "food-del"]);
});

test("no month, or a month out of reach, asks which month instead of guessing", () => {
  const expected = { kind: "question", question: { field: "month", options: ["2026-10", "2026-11"] } };
  assert.deepEqual(draft("groceries budget 700"), expected);
  assert.deepEqual(draft("set groceries to 700 for 2028-05"), expected);
  const answered = draft("groceries budget 700", { answers: { month: "2026-10" } });
  assert.equal(answered.kind, "draft");
  assert.equal(answered.draft.month, "2026-10");
  assert.equal(planDraftMonths(readPlanRequest("groceries budget 700", { today: TODAY }).request, { today: TODAY }), null);
  assert.deepEqual(planDraftMonths(readPlanRequest("plan november like september", { today: TODAY }).request, { today: TODAY }), ["2026-11", "2026-09"]);
});

test("a new line takes a category's name and the view's person; on the household view it asks whose", () => {
  const tim = draft("set travel to 300 for october");
  assert.deepEqual(tim.draft.apply, [{
    action: "create",
    rowId: "plan-ask-2026-10-travel",
    sectionKey: "budget_buckets",
    categoryName: "Travel",
    label: "Travel",
    plannedMinor: 30_000,
    ownershipType: "direct",
    ownerName: "Tim",
    planDate: null,
    accountName: null,
    note: null
  }]);
  assert.deepEqual(tim.draft.lead, { label: "Travel", categoryName: "Travel", amountMinor: 30_000, beforeMinor: null });

  assert.deepEqual(draft("add a travel line of $300 to october", { viewId: "household" }), {
    kind: "question",
    question: { field: "owner", line: "Travel", options: [{ key: "person-tim", label: "Tim" }, { key: "person-joyce", label: "Joyce" }, { key: "shared", label: "Shared" }] }
  });
  const shared = draft("add a travel line of $300 to october", { viewId: "household", answers: { owner: "shared" } });
  assert.deepEqual(shared.draft.apply[0], {
    action: "create", rowId: "plan-ask-2026-10-travel", sectionKey: "budget_buckets", categoryName: "Travel", label: "Travel",
    plannedMinor: 30_000, ownershipType: "shared", splitBasisPoints: 5_000, planDate: null, accountName: null, note: null
  });
});

test("names nothing can mean, cuts below zero and changes that change nothing are notes, not drafts", () => {
  assert.deepEqual(draft("set yacht to 500 for october"), { kind: "note", note: { reason: "unknown_line", name: "yacht", month: "2026-10" } });
  assert.deepEqual(draft("move $600 from shopping to groceries in october"), { kind: "note", note: { reason: "not_enough", label: "Shopping", plannedMinor: 48_000 } });
  assert.deepEqual(draft("cut groceries by 700 for october"), { kind: "note", note: { reason: "not_enough", label: "Groceries", plannedMinor: 65_000 } });
  assert.deepEqual(draft("set groceries to 650 for october"), { kind: "note", note: { reason: "nothing_changes", month: "2026-10" } });
  assert.deepEqual(draft("move 100 from salary to groceries in october"), { kind: "note", note: { reason: "move_mixed" } });
  assert.deepEqual(draft("plan october like october"), { kind: "note", note: { reason: "same_month", month: "2026-10" } });
  assert.deepEqual(draft("plan november like august"), { kind: "note", note: { reason: "no_plan_to_copy", month: "2026-08" } });
});

test("a plan that would spend more than it expects to earn carries the Money insights plan-balance warning", () => {
  const result = draft("set rent to 6000 for october");
  assert.equal(result.kind, "draft");
  assert.deepEqual(result.draft.warning, {
    text: "Your October plan spends $950.00 more than it expects to earn, so only $550.00 of the $1,500.00 savings goal fits.",
    shortMinor: 95_000
  });
  assert.equal(result.draft.totals.after.remainingMinor, -95_000);
});
