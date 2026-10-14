import assert from "node:assert/strict";
import test from "node:test";

import { LEAD_VIEW_STORAGE_KEY, chooseLeadView, createLeadViewStore, readLeadView, saveLeadView } from "../src/client/lead-view.js";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";
import { buildEarnedSpentMonths } from "../src/client/summary-earned-spent-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

// The lead's Plan | Simple views (lead-view.js, design.md "Plan or Simple"):
// Simple shows earned and spent with no plan, from the same split as Plan,
// so the two never disagree. Without a remembered choice a page opens in
// Simple; the choice wins once made.

function summaryCards({ plannedIncome = 0, actualIncome = 650_000, plannedSpend = 0, actualSpend = 420_000, savingsTarget = 0, realizedSavings = 230_000 } = {}) {
  return [
    { label: "Planned income", amountMinor: plannedIncome, tone: "plan" },
    { label: "Actual income", amountMinor: actualIncome, tone: "in" },
    { label: "Planned spend", amountMinor: plannedSpend, tone: "plan" },
    { label: "Actual spend", amountMinor: actualSpend, tone: "neutral" },
    { label: "Savings target", amountMinor: savingsTarget, tone: "plan" },
    { label: "Realized savings", amountMinor: realizedSavings, tone: "in" }
  ];
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

const blockedStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
  removeItem() { throw new Error("SecurityError"); }
};

// The page's store: the login's choice comes on the app shell and replaces
// this device's cache; a switch shows at once and is saved for the login.
const signedIn = (leadView) => ({ viewerIdentity: { email: "tim@example.com" }, ...(leadView ? { leadView } : {}) });

test("signed in, the shell's choice replaces the device's cache, and none on the shell means the default", () => {
  const storage = memoryStorage({ [LEAD_VIEW_STORAGE_KEY]: "plan" });
  const store = createLeadViewStore({ storage, send: async () => {} });
  // First paint: the cache.
  assert.equal(store.get(), "plan");
  let changes = 0;
  store.subscribe(() => { changes += 1; });
  store.applyShell(signedIn("simple"));
  assert.equal(store.get(), "simple");
  assert.equal(storage.values.get(LEAD_VIEW_STORAGE_KEY), "simple");
  // A login that never chose: the cache from another login or an old visit goes.
  store.applyShell(signedIn(null));
  assert.equal(store.get(), null);
  assert.equal(storage.values.has(LEAD_VIEW_STORAGE_KEY), false);
  assert.equal(changes, 2);
  assert.equal(chooseLeadView(store.get()), "simple");
});

test("signed in, a switch is shown at once and saved for the login; a shell that lands meanwhile does not undo it", async () => {
  const storage = memoryStorage();
  const sent = [];
  let release;
  const store = createLeadViewStore({ storage, send: (view) => { sent.push(view); return new Promise((resolve) => { release = resolve; }); } });
  store.applyShell(signedIn("plan"));
  const saving = store.choose("simple");
  assert.equal(store.get(), "simple");
  assert.deepEqual(sent, ["simple"]);
  store.applyShell(signedIn("plan"));
  assert.equal(store.get(), "simple", "the old shell does not win over a save on its way");
  release();
  await saving;
  store.applyShell(signedIn("simple"));
  assert.equal(store.get(), "simple");
});

test("signed in, a switch also updates the app shell this device keeps, so a reload does not bring the old choice back", async () => {
  const storage = memoryStorage({ "monies-map-app-shell-cache-v4": JSON.stringify({ cacheKey: "", data: signedIn("simple") }) });
  const store = createLeadViewStore({ storage, send: async () => {} });
  store.applyShell(signedIn("simple"));
  await store.choose("plan");
  assert.equal(JSON.parse(storage.values.get("monies-map-app-shell-cache-v4")).data.leadView, "plan");
  // Without a login the kept shell is left alone.
  const anonymous = memoryStorage({ "monies-map-app-shell-cache-v4": JSON.stringify({ cacheKey: "", data: { household: {} } }) });
  const deviceStore = createLeadViewStore({ storage: anonymous, send: async () => {} });
  deviceStore.applyShell({ household: {} });
  await deviceStore.choose("simple");
  assert.equal(JSON.parse(anonymous.values.get("monies-map-app-shell-cache-v4")).data.leadView, undefined);
});

test("a failed save keeps the choice for the visit and on the device", async () => {
  const storage = memoryStorage();
  const store = createLeadViewStore({ storage, send: async () => { throw new Error("offline"); } });
  store.applyShell(signedIn(null));
  await store.choose("simple");
  assert.equal(store.get(), "simple");
  assert.equal(storage.values.get(LEAD_VIEW_STORAGE_KEY), "simple");
});

test("without a login the device keeps the choice and nothing is sent", async () => {
  const storage = memoryStorage({ [LEAD_VIEW_STORAGE_KEY]: "simple" });
  const sent = [];
  const store = createLeadViewStore({ storage, send: async (view) => { sent.push(view); } });
  store.applyShell({ household: {} });
  assert.equal(store.get(), "simple");
  await store.choose("plan");
  assert.deepEqual(sent, []);
  assert.equal(storage.values.get(LEAD_VIEW_STORAGE_KEY), "plan");
  // Blocked storage: the default first, and the switch still works.
  const blocked = createLeadViewStore({ storage: blockedStorage, send: async () => {} });
  assert.equal(blocked.get(), null);
  await blocked.choose("simple");
  assert.equal(blocked.get(), "simple");
});

test("Simple's earned and spent are Plan's income and spend, and kept is Plan's Saved", () => {
  const model = buildSummaryLeadModel([
    ...summaryCards({ plannedIncome: 600_000, plannedSpend: 500_000, savingsTarget: 180_000, actualSpend: 470_000, realizedSavings: 180_000 }),
    { label: "Planned investments", amountMinor: 20_000, tone: "plan" }
  ], {
    categoryShare: [
      { key: "Food", label: "Food", valueMinor: 400_000 },
      { key: "Investments", label: "Investments", valueMinor: 30_000 },
      { key: "Savings", label: "Savings", valueMinor: 40_000 }
    ],
    investmentMoves: { intoMinor: 10_000, outOfMinor: 0 }
  });
  // $4,700 spent, $300 filed under Investments and $400 under Savings: $4,000
  // of spending, $400 invested (with the $100 transfer), $2,100 kept.
  assert.deepEqual(model.simple, {
    earned: { amountMinor: 650_000, tone: "in" },
    spent: { amountMinor: 400_000, tone: "neutral" }
  });
  assert.equal(model.simple.earned.amountMinor, model.income.amountMinor);
  assert.equal(model.simple.spent.amountMinor, model.spent.amountMinor);
  assert.equal(model.figures.invested, 40_000);
  assert.equal(model.figures.kept, 210_000);
  assert.equal(model.saved.amountMinor, model.figures.kept);
  assert.equal(model.hasPlan, true);
});

test("Simple's spent is rose only when more went out than came in, with no plan to be over", () => {
  const over = buildSummaryLeadModel(summaryCards({ actualIncome: 300_000, actualSpend: 420_000, realizedSavings: -120_000 }));
  assert.deepEqual(over.simple.spent, { amountMinor: 420_000, tone: "short" });
  // Plan's own tone is unchanged: with no plan, any spend is over it.
  assert.equal(over.spent.tone, "short");
  const nothingEarned = buildSummaryLeadModel(summaryCards({ actualIncome: 0, actualSpend: 0, realizedSavings: 0 }));
  assert.deepEqual(nothingEarned.simple, { earned: { amountMinor: 0, tone: "neutral" }, spent: { amountMinor: 0, tone: "neutral" } });
});

test("a period has a plan when any planned figure is above zero, and none when every one is zero", () => {
  assert.equal(buildSummaryLeadModel(summaryCards()).hasPlan, false);
  assert.equal(buildSummaryLeadModel(summaryCards({ plannedIncome: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel(summaryCards({ plannedSpend: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel(summaryCards({ savingsTarget: 1 })).hasPlan, true);
  assert.equal(buildSummaryLeadModel([...summaryCards(), { label: "Planned investments", amountMinor: 1, tone: "plan" }]).hasPlan, true);
});

test("a month with plan lines has a plan even at zero; a month with none has no plan", () => {
  const withRows = { incomeRows: [], planSections: [{ rows: [{ label: "Food", plannedMinor: 0, actualMinor: 0 }] }], currentMonthSummary: { realExpensesMinor: 50_000 } };
  const withoutRows = { incomeRows: [], planSections: [{ rows: [] }], currentMonthSummary: { realExpensesMinor: 50_000 } };
  const rollup = { actualIncomeMinor: 80_000, realizedSavingsMinor: 30_000 };
  const planned = buildMonthLeadModel(buildMonthMetricCards(withRows), rollup, { planRows: withRows.planSections[0].rows });
  const unplanned = buildMonthLeadModel(buildMonthMetricCards(withoutRows), rollup, { planRows: [] });
  assert.equal(planned.hasPlan, true);
  assert.equal(unplanned.hasPlan, false);
  assert.deepEqual(unplanned.simple, { earned: { amountMinor: 80_000, tone: "in" }, spent: { amountMinor: 50_000, tone: "neutral" } });
});

test("the default is Simple whether or not the period has a plan; a saved choice wins either way", () => {
  // A fresh account (nothing saved) opens Simple, with plans or without, and
  // while the figures load (so the page does not swap when they arrive).
  assert.equal(chooseLeadView(null), "simple");
  assert.equal(chooseLeadView(undefined), "simple");
  assert.equal(chooseLeadView("plan"), "plan");
  assert.equal(chooseLeadView("simple"), "simple");
  // Junk is not a choice.
  assert.equal(chooseLeadView("fancy"), "simple");
});

test("two accounts on one device each get their own choice: a shell without one clears the other's", () => {
  const storage = memoryStorage();
  const store = createLeadViewStore({ storage, send: async () => {} });
  store.applyShell(signedIn("plan"));
  assert.equal(chooseLeadView(store.get()), "plan");
  // Another login on the same device that never chose: Simple, not the first login's Plan.
  store.applyShell({ viewerIdentity: { email: "joyce@example.com" } });
  assert.equal(chooseLeadView(store.get()), "simple");
  assert.equal(storage.values.has(LEAD_VIEW_STORAGE_KEY), false);
  store.applyShell(signedIn("plan"));
  assert.equal(chooseLeadView(store.get()), "plan");
});

test("the choice is remembered on the device, and junk or blocked storage falls back to the default", () => {
  const storage = memoryStorage();
  assert.equal(readLeadView(storage), null);
  saveLeadView("simple", storage);
  assert.equal(storage.values.get(LEAD_VIEW_STORAGE_KEY), "simple");
  assert.equal(readLeadView(storage), "simple");
  assert.equal(readLeadView(memoryStorage({ [LEAD_VIEW_STORAGE_KEY]: "fancy" })), null);
  assert.equal(readLeadView(blockedStorage), null);
  assert.doesNotThrow(() => saveLeadView("plan", blockedStorage));
  assert.equal(readLeadView(undefined), null);
});

test("Simple's savings bar is Plan's bar without the plan bar or the plan in the legend", () => {
  const figures = { income: 650_000, spending: 400_000, invested: 40_000, takenFromInvestments: 0, movedToSavings: 40_000, kept: 210_000, spendPlan: 300_000, savePlan: 180_000, investPlan: 20_000 };
  const plan = buildSavingsBarModel({ figures });
  const simple = buildSavingsBarModel({ figures, withPlan: false });
  assert.notEqual(plan.plan, null);
  assert.match(plan.planLegend, /^Plan: spend/);
  assert.equal(simple.plan, null);
  assert.equal(simple.planLegend, null);
  // Everything else, the parts, their shares and the sentence, is the same.
  assert.deepEqual(simple.segments, plan.segments);
  assert.equal(simple.sentence, "You kept $2,100 and invested $400 of the $6,500 you earned");
  assert.equal(simple.sentence, plan.sentence);
  // Hidden money: no amounts either way.
  const hidden = buildSavingsBarModel({ figures, hidden: true, withPlan: false });
  assert.ok(hidden.segments.every((segment) => segment.legend.amount === null));
});

const summaryMonths = [
  { month: "2026-04", plannedIncomeMinor: 0, actualIncomeMinor: 500_000, estimatedExpensesMinor: 0, realExpensesMinor: 620_000, savingsGoalMinor: 0, realizedSavingsMinor: -120_000, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" },
  { month: "2026-05", plannedIncomeMinor: 0, actualIncomeMinor: 650_000, estimatedExpensesMinor: 0, realExpensesMinor: 470_000, savingsGoalMinor: 0, realizedSavingsMinor: 180_000, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" },
  { month: "2026-03", plannedIncomeMinor: 0, actualIncomeMinor: 0, estimatedExpensesMinor: 0, realExpensesMinor: 0, savingsGoalMinor: 0, realizedSavingsMinor: 0, estimatedDiffMinor: 0, realDiffMinor: 0, note: "" }
];
const shareByMonth = [
  { month: "2026-05", data: [{ key: "Food", label: "Food", valueMinor: 400_000 }, { key: "Investments", label: "Investments", valueMinor: 30_000 }, { key: "Savings", label: "Savings", valueMinor: 40_000 }] },
  { month: "2026-04", data: [{ key: "Food", label: "Food", valueMinor: 620_000 }] }
];

test("Earned vs spent by month: newest first, each month through the same split as the lead", () => {
  const rows = buildEarnedSpentMonths(summaryMonths, shareByMonth);
  assert.deepEqual(rows.map((row) => row.month), ["2026-05", "2026-04", "2026-03"]);
  assert.deepEqual(rows[0], {
    month: "2026-05",
    earnedMinor: 650_000,
    spentMinor: 400_000,
    investedMinor: 30_000,
    keptMinor: 220_000,
    isOver: false,
    spentPercent: 62,
    bar: [
      { key: "spent", tone: "short", widthPercent: 61.5 },
      { key: "invested", tone: "in", widthPercent: 4.6 },
      { key: "kept", tone: "in", widthPercent: 33.8 }
    ]
  });
  // The month's spend is the Month lead's spend for the same month.
  const monthLead = buildSummaryLeadModel(summaryCards({ actualIncome: 650_000, actualSpend: 470_000 }), { categoryShare: shareByMonth[0].data });
  assert.equal(rows[0].spentMinor, monthLead.simple.spent.amountMinor);
  assert.equal(rows[0].earnedMinor, monthLead.simple.earned.amountMinor);
});

test("an overspent month: rose spent to the income, then the part from savings, no kept part", () => {
  const april = buildEarnedSpentMonths(summaryMonths, shareByMonth)[1];
  assert.equal(april.isOver, true);
  assert.equal(april.keptMinor, -120_000);
  assert.equal(april.spentPercent, 124);
  assert.deepEqual(april.bar, [
    { key: "spent", tone: "short", widthPercent: 80.6 },
    { key: "savings", tone: "short", widthPercent: 19.4, hatched: true }
  ]);
});

test("a month with nothing earned or spent has no bar and no share; a month without a category share counts it all as spent", () => {
  const march = buildEarnedSpentMonths(summaryMonths, shareByMonth)[2];
  assert.deepEqual(march.bar, []);
  assert.equal(march.spentPercent, null);
  assert.equal(march.isOver, false);
  const [noShare] = buildEarnedSpentMonths([summaryMonths[1]], []);
  assert.equal(noShare.spentMinor, 470_000);
  assert.equal(noShare.investedMinor, 0);
  assert.deepEqual(buildEarnedSpentMonths([], []), []);
});
