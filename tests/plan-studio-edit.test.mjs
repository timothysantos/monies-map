// Plan Studio's edits (DOMAIN.md "Plan Studio"): changing a row takes the money
// from left over (or a chosen category), a locked row holds, the dividers move
// money between jobs, "What if I save more?" says where the money would come
// from, and one Undo stack covers it all until "Save plan" sends one request.
import assert from "node:assert/strict";
import test from "node:test";

import { buildStudioRows, planTotals } from "../src/client/plan-studio-model.js";
import {
  adjustJob,
  buildChanges,
  buildRowUpdates,
  buildSegments,
  changedKeys,
  createEditState,
  currentPlan,
  moveLine,
  previewSaveTarget,
  setAmount,
  splitAcrossSources,
  studioReducer
} from "../src/client/plan-studio-edit.js";

const d = (dollars) => Math.round(dollars * 100);

function planned(id, label, section, plannedDollars, actualDollars, extra = {}) {
  return {
    id, section, label, categoryName: extra.categoryName ?? label,
    plannedMinor: d(plannedDollars), actualMinor: d(actualDollars),
    ownershipType: extra.ownershipType ?? "shared", ownerName: extra.ownerName,
    sourceRowIds: extra.sourceRowIds ?? [id], sourcePlannedMinors: extra.sourcePlannedMinors,
    planDate: extra.planDate, splits: [], actualEntryIds: []
  };
}
const income = (id, label, plannedDollars) => ({ id, label, categoryName: "Salary", plannedMinor: d(plannedDollars), actualMinor: d(plannedDollars), sourceRowIds: [id] });

const rows = buildStudioRows({
  month: "2026-10",
  incomeRows: [income("tim-sal", "Tim, salary", 5400), income("joy-sal", "Joyce, salary", 3200), income("joy-free", "Joyce, freelance", 600)],
  planSections: [
    { key: "planned_items", rows: [
      planned("loan", "Home loan", "planned_items", 2200, 2200, { planDate: "2026-10-01" }),
      planned("bills", "Bills", "planned_items", 1450, 1210, { planDate: "2026-10-08" }),
      planned("invest", "Investments", "planned_items", 1200, 800, { categoryName: "Investments", planDate: "2026-10-05" }),
      planned("save", "Savings", "planned_items", 1500, 0, { categoryName: "Savings" })
    ] },
    { key: "budget_buckets", rows: [
      planned("food", "Food & Drinks", "budget_buckets", 1300, 910),
      planned("travel", "Travel", "budget_buckets", 600, 640),
      planned("fun", "Fun", "budget_buckets", 300, 100)
    ] }
  ]
});
const saved = Object.fromEntries(rows.map((row) => [row.key, row.savedMinor]));
const plan = (overrides = {}) => ({ ...saved, ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, d(value)])) });
const ctx = (extra = {}) => ({ rows, locks: {}, takeFrom: "left", ...extra });

test("changing a row by default takes the money from left over: only that row moves", () => {
  const result = setAmount(ctx(), plan(), "food", d(1400));
  assert.equal(result.plan.food, d(1400));
  assert.equal(result.plan.travel, d(600));
  const totals = planTotals(rows, result.plan);
  assert.equal(totals.income, d(9200));
  assert.equal(totals.out, d(2200 + 1450 + 1200 + 1500 + 1400 + 600 + 300));
  assert.equal(totals.left, d(650) - d(100), "the extra $100 came out of the $650 left over");
});

test("with a category to take from, the money moves between the two and the total holds", () => {
  const result = setAmount(ctx({ takeFrom: "fun" }), plan(), "food", d(1400));
  assert.equal(result.plan.food, d(1400));
  assert.equal(result.plan.fun, d(200));
  assert.equal(planTotals(rows, result.plan).out, planTotals(rows, plan()).out);
  // Lowering gives it back.
  const back = setAmount(ctx({ takeFrom: "fun" }), plan(), "food", d(1200));
  assert.equal(back.plan.fun, d(400));
});

test("a take-from category that has less than asked gives what it has and says so", () => {
  const result = setAmount(ctx({ takeFrom: "fun" }), plan(), "food", d(1800));
  assert.equal(result.plan.fun, 0);
  assert.equal(result.plan.food, d(1600));
  assert.deepEqual(result.notice, { kind: "partial", amountMinor: d(300), label: "Fun" });
});

test("a locked row holds: it says so and nothing changes", () => {
  const result = setAmount(ctx({ locks: { food: true } }), plan(), "food", d(1400));
  assert.deepEqual(result.plan, plan());
  assert.deepEqual(result.notice, { kind: "locked", label: "Food & Drinks" });
  // A locked take-from falls back to left over, so the change still happens.
  const fallback = setAmount(ctx({ takeFrom: "fun", locks: { fun: true } }), plan(), "food", d(1400));
  assert.equal(fallback.plan.food, d(1400));
  assert.equal(fallback.plan.fun, d(300));
});

test("income changes on its own, never taking from a category, and an amount never goes below zero", () => {
  const result = setAmount(ctx({ takeFrom: "fun" }), plan(), "joy-free", d(900));
  assert.equal(result.plan["joy-free"], d(900));
  assert.equal(result.plan.fun, d(300));
  assert.equal(setAmount(ctx(), plan(), "fun", -d(40)).plan.fun, 0);
  // A row the studio cannot save is left alone.
  const readOnly = rows.map((row) => (row.key === "fun" ? { ...row, editable: false } : row));
  assert.deepEqual(setAmount({ ...ctx(), rows: readOnly }, plan(), "fun", d(100)).plan, plan());
});

test("moving a whole job spreads over its flexible rows in proportion, and leaves the rent alone", () => {
  // Spend's flexible rows are the budgets with no due date: food 1300, travel 600, fun 300.
  const result = adjustJob(ctx(), plan(), "spend", d(-190));
  assert.equal(result.appliedMinor, d(-190));
  assert.equal(result.plan.loan, d(2200));
  assert.equal(result.plan.bills, d(1450));
  const moved = result.plan.food + result.plan.travel + result.plan.fun;
  assert.equal(moved, d(2200) - d(190), "the rows add up to what they were less the move");
  assert.ok(result.plan.food < d(1300) && result.plan.travel < d(600) && result.plan.fun < d(300));
  assert.ok(result.plan.food > result.plan.travel && result.plan.travel > result.plan.fun, "the bigger rows give more");
});

test("a job cannot give more than its flexible rows hold, and a locked row gives nothing", () => {
  const all = adjustJob(ctx(), plan(), "spend", -d(9999));
  assert.equal(all.appliedMinor, -d(2200));
  assert.equal(all.plan.food + all.plan.travel + all.plan.fun, 0);
  const locked = adjustJob(ctx({ locks: { food: true } }), plan(), "spend", -d(9999));
  assert.equal(locked.plan.food, d(1300));
  assert.equal(locked.appliedMinor, -d(900));
  // Growing a job with nothing in it puts the money in its first flexible row.
  const empty = { ...plan(), food: 0, travel: 0, fun: 0 };
  assert.equal(adjustJob(ctx(), empty, "spend", d(500)).plan.food, d(500));
});

test("the bar's lines: one slice per job and left over, or one per category inside a job", () => {
  const jobs = buildSegments(rows, plan(), null);
  assert.deepEqual(jobs.map((segment) => segment.id), ["spend", "save", "invest", "left"]);
  assert.deepEqual(jobs.map((segment) => segment.amountMinor), [d(5850), d(1500), d(1200), d(650)]);
  const inside = buildSegments(rows, plan(), "spend");
  assert.deepEqual(inside.map((segment) => segment.id), ["loan", "bills", "food", "travel", "fun", "left"]);
  // Over-allocated: left over is an empty slice, not a negative one.
  assert.equal(buildSegments(rows, plan({ food: 3000 }), null)[3].amountMinor, 0);
});

test("dragging the line between two jobs moves money from one to the other", () => {
  const segments = buildSegments(rows, plan(), null);
  // The line between Spend and Save sits at the end of Spend: $5,850. Drag it $150 left.
  const result = moveLine(ctx(), plan(), segments, 0, d(5850) - d(150));
  assert.equal(planTotals(rows, result.plan).spend, d(5850) - d(150));
  assert.equal(planTotals(rows, result.plan).save, d(1500) + d(150));
  assert.equal(planTotals(rows, result.plan).out, planTotals(rows, plan()).out, "money moved, none added");
});

test("the last line takes from, or gives to, left over, and can push past planned money in", () => {
  const segments = buildSegments(rows, plan(), null);
  const left = planTotals(rows, plan()).left;
  const grow = moveLine(ctx(), plan(), segments, 2, d(5850 + 1500 + 1200) + left + d(100));
  assert.equal(planTotals(rows, grow.plan).invest, d(1200) + left + d(100));
  assert.equal(planTotals(rows, grow.plan).left, -d(100), "over-allocated: the plan no longer adds up");
});

test("a line does not move when the job next to it has nothing flexible to give", () => {
  const segments = buildSegments(rows, plan(), null);
  const locked = ctx({ locks: { food: true, travel: true, fun: true } });
  const result = moveLine(locked, plan(), segments, 0, d(5850) - d(150));
  assert.deepEqual(result.plan, plan());
  assert.equal(result.notice.kind, "line_locked");
});

test("inside a job, a line moves money between two categories", () => {
  const segments = buildSegments(rows, plan(), "spend");
  // The line between Food and Travel: drag it $100 left.
  const foodEnd = d(2200 + 1450 + 1300);
  const result = moveLine(ctx(), plan(), segments, 2, foodEnd - d(100));
  assert.equal(result.plan.food, d(1200));
  assert.equal(result.plan.travel, d(700));
});

test("What if I save more: left over pays first, then the flexible categories in proportion", () => {
  const left = planTotals(rows, plan()).left; // $9,200 - $8,550 = $650
  assert.equal(left, d(650));
  const small = previewSaveTarget({ ...ctx(), plan: plan(), targetMinor: d(1500) + d(200), takeFromKey: "auto" });
  assert.equal(small.plan.save, d(1700));
  assert.equal(small.fromLeftMinor, d(200));
  assert.deepEqual(small.takenFrom, []);
  assert.equal(small.shortfallMinor, 0);
  assert.equal(small.totals.left, d(450));

  const big = previewSaveTarget({ ...ctx(), plan: plan(), targetMinor: d(1500) + d(850), takeFromKey: "auto" });
  assert.equal(big.fromLeftMinor, d(650));
  assert.equal(big.takenFrom.reduce((sum, part) => sum + part.minor, 0), d(200));
  assert.deepEqual(big.takenFrom.map((part) => part.key), ["food", "travel", "fun"]);
  assert.equal(big.plan.food + big.plan.travel + big.plan.fun, d(2200) - d(200));
  assert.equal(big.totals.left, 0, "every dollar still has a job");
  assert.equal(big.shortfallMinor, 0);
});

test("What if names one category to take from, caps it at what it has, and says what is short", () => {
  const picked = previewSaveTarget({ ...ctx(), plan: plan(), targetMinor: d(1500) + d(700), takeFromKey: "travel" });
  assert.equal(picked.fromLeftMinor, d(650));
  assert.deepEqual(picked.takenFrom, [{ key: "travel", label: "Travel", minor: d(50) }]);
  const short = previewSaveTarget({ ...ctx(), plan: plan(), targetMinor: d(1500) + d(650) + d(400), takeFromKey: "fun" });
  assert.equal(short.takenFrom[0].minor, d(300));
  assert.equal(short.shortfallMinor, d(100));
  assert.equal(short.totals.left, -d(100), "the plan would not add up, and the preview says so");
});

test("What if with a lower target gives the money back to left over", () => {
  const lower = previewSaveTarget({ ...ctx(), plan: plan(), targetMinor: d(1000), takeFromKey: "auto" });
  assert.equal(lower.plan.save, d(1000));
  assert.equal(lower.givenBackMinor, d(500));
  assert.equal(lower.totals.left, d(1150));
});

test("What if has nothing to change without an editable savings line", () => {
  const noSave = rows.filter((row) => row.job !== "save");
  assert.equal(previewSaveTarget({ rows: noSave, locks: {}, plan: plan(), targetMinor: d(2000), takeFromKey: "auto" }), null);
});

test("Save plan sends only the rows that changed, each with what it must still hold on the server", () => {
  const next = plan({ food: 1400, "joy-free": 900 });
  assert.deepEqual(changedKeys(rows, next), ["joy-free", "food"]);
  assert.deepEqual(buildChanges(rows, next), [
    { action: "update", rowId: "joy-free", expectedMinor: d(600), plannedMinor: d(900) },
    { action: "update", rowId: "food", expectedMinor: d(1300), plannedMinor: d(1400) }
  ]);
  assert.deepEqual(buildChanges(rows, plan()), []);
});

test("a combined household row is saved as each person's row, in proportion, adding up exactly", () => {
  assert.deepEqual(splitAcrossSources([d(700), d(500)], d(1200)), [d(700), d(500)]);
  assert.deepEqual(splitAcrossSources([d(700), d(500)], d(1500)), [d(875), d(625)]);
  assert.deepEqual(splitAcrossSources([d(700), d(500)], 100), [58, 42]);
  assert.deepEqual(splitAcrossSources([1, 1, 1], 100), [34, 33, 33]);
  assert.deepEqual(splitAcrossSources([0, 0], d(40)), [d(40), 0]);
  const combined = buildStudioRows({
    month: "2026-10", incomeRows: [],
    planSections: [{ key: "planned_items", rows: [planned("combined:s", "Savings", "planned_items", 1200, 0, { categoryName: "Savings", sourceRowIds: ["tim-save", "joy-save"], sourcePlannedMinors: [d(700), d(500)] })] }]
  });
  assert.deepEqual(buildChanges(combined, { "combined:s": d(1500) }), [
    { action: "update", rowId: "tim-save", expectedMinor: d(700), plannedMinor: d(875) },
    { action: "update", rowId: "joy-save", expectedMinor: d(500), plannedMinor: d(625) }
  ]);
});

test("the screen learns what each saved row now holds from the same split the request uses", () => {
  const updates = buildRowUpdates(rows, plan({ food: 1400 }));
  assert.deepEqual(updates.map((update) => [update.key, update.section, update.plannedMinor, update.sourceMinors]), [["food", "budget_buckets", d(1400), [d(1400)]]]);
});

test("a one-tap fix takes from left over even when Take from names a category", () => {
  const state = studioReducer({ ...createEditState(), takeFrom: "fun" }, { rows, type: "set", key: "food", minor: d(1250), takeFrom: "left" });
  assert.equal(currentPlan(rows, state.overrides).food, d(1250));
  assert.equal(currentPlan(rows, state.overrides).fun, d(300), "the take-from category is untouched");
});

test("rows are never sent when they cannot be edited", () => {
  const readOnly = rows.map((row) => (row.key === "food" ? { ...row, editable: false } : row));
  assert.deepEqual(buildChanges(readOnly, plan({ food: 1400 })), []);
});

// ---- the reducer: one Undo stack, gestures, lock, take from, what if ----

function run(...actions) {
  return actions.reduce((state, action) => studioReducer(state, { rows, ...action }), createEditState());
}

test("a drag is one Undo step, however many values it passes through", () => {
  let state = run({ type: "gestureStart" }, { type: "set", key: "food", minor: d(1310) }, { type: "set", key: "food", minor: d(1330) }, { type: "set", key: "food", minor: d(1350) }, { type: "gestureEnd" });
  assert.equal(currentPlan(rows, state.overrides).food, d(1350));
  assert.equal(state.history.length, 1);
  state = studioReducer(state, { rows, type: "undo" });
  assert.equal(currentPlan(rows, state.overrides).food, d(1300));
  assert.deepEqual(state.overrides, {}, "back at the saved plan: nothing is held");
});

test("a drag that ends where it began leaves nothing on the Undo stack", () => {
  const state = run({ type: "gestureStart" }, { type: "set", key: "food", minor: d(1350) }, { type: "set", key: "food", minor: d(1300) }, { type: "gestureEnd" });
  assert.equal(state.history.length, 0);
});

test("a typed amount, a nudge or a chip is its own Undo step", () => {
  const state = run({ type: "set", key: "food", minor: d(1337) }, { type: "set", key: "travel", minor: d(650) });
  assert.equal(state.history.length, 2);
  assert.equal(currentPlan(rows, state.overrides).food, d(1337));
});

test("undo on an empty stack says so; reset goes back to saved and can itself be undone", () => {
  assert.equal(run({ type: "undo" }).notice.kind, "nothing_to_undo");
  let state = run({ type: "set", key: "food", minor: d(1400) }, { type: "set", key: "travel", minor: d(700) }, { type: "reset" });
  assert.deepEqual(state.overrides, {});
  assert.equal(state.notice.kind, "reset");
  state = studioReducer(state, { rows, type: "undo" });
  assert.equal(currentPlan(rows, state.overrides).food, d(1400));
  assert.equal(currentPlan(rows, state.overrides).travel, d(700));
});

test("a change back to the saved amount is not held as a change", () => {
  const state = run({ type: "set", key: "food", minor: d(1400) }, { type: "set", key: "food", minor: d(1300) });
  assert.deepEqual(state.overrides, {});
});

test("lock and take-from are choices that stay while editing; a locked row refuses a change", () => {
  let state = run({ type: "toggleLock", key: "food" }, { type: "takeFrom", value: "fun" });
  assert.deepEqual([state.locks.food, state.takeFrom], [true, "fun"]);
  state = studioReducer(state, { rows, type: "set", key: "food", minor: d(1500) });
  assert.equal(state.notice.kind, "locked");
  assert.deepEqual(state.overrides, {});
  assert.equal(state.history.length, 0, "a refused change is not an Undo step");
  state = studioReducer(state, { rows, type: "toggleLock", key: "food" });
  assert.equal(state.locks.food, false);
});

test("What if previews first and changes the plan only when applied, as one Undo step", () => {
  let state = run({ type: "whatIfTry", targetMinor: d(2000) });
  assert.deepEqual(state.overrides, {}, "the preview does not touch the plan");
  assert.equal(state.whatIf.targetMinor, d(2000));
  state = studioReducer(state, { rows, type: "whatIfApply" });
  assert.equal(currentPlan(rows, state.overrides).save, d(2000));
  assert.equal(state.whatIf, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.notice.kind, "what_if_applied");
  const cancelled = run({ type: "whatIfTry", targetMinor: d(2000) }, { type: "whatIfCancel" });
  assert.equal(cancelled.whatIf, null);
  assert.deepEqual(cancelled.overrides, {});
  // Trying the saved amount again is no preview at all.
  assert.equal(run({ type: "whatIfTry", targetMinor: d(2000) }, { type: "whatIfTry", targetMinor: d(1500) }).whatIf, null);
});

test("after a save the held changes and the Undo stack are cleared", () => {
  const state = run({ type: "set", key: "food", minor: d(1400) }, { type: "saved" });
  assert.deepEqual(state.overrides, {});
  assert.equal(state.history.length, 0);
});

test("the Undo stack is capped so a long session cannot grow it without end", () => {
  let state = createEditState();
  for (let value = 1; value <= 90; value += 1) {
    state = studioReducer(state, { rows, type: "set", key: "food", minor: d(1300 + value) });
  }
  assert.equal(state.history.length, 60);
});
