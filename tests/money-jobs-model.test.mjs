import assert from "node:assert/strict";
import test from "node:test";

import { messages } from "../src/client/copy/en-SG.js";
import { describeMoneyJobs, MONEY_JOB_FIGURES } from "../src/client/money-jobs-detail.js";
import { figureMenu } from "../src/client/figure-menu-model.js";
import { listMoneyJobs, splitMoneyUse } from "../src/client/money-jobs-model.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

// Money jobs (DOMAIN.md "Money job"; design.md "Money jobs"): each plan
// line's job and whether it was done, from the figures the lead already has.
// Amounts are minor units (cents).

const PERIOD = {
  incomeMinor: 24_700_000,
  // The lead's spend: $227,000 spending plus $8,000 filed under Investments.
  spentMinor: 23_500_000,
  investedMinor: 800_000,
  plannedSpendMinor: 24_000_000,
  savingsTargetMinor: 1_000_000,
  plannedInvestMinor: 1_000_000
};
const noFormatting = () => { throw new Error("hidden money must not be formatted"); };

// What the lead shows: the folded line from the first-screen numbers
// (listMoneyJobs) and the rows worded by the module that loads on open.
function buildMoneyJobs({ figures, plannedIncomeMinor = 0, inProgress = false, hidden = false, formatMoney = undefined }) {
  const jobs = listMoneyJobs({ figures, plannedIncomeMinor });
  if (!jobs.length) {
    return null;
  }
  const doneCount = jobs.filter((job) => job.done).length;
  return {
    jobs: describeMoneyJobs(jobs, { inProgress, hidden, ...(formatMoney ? { formatMoney } : {}) }),
    doneCount,
    summary: messages.summary.lead.moneyJobs.summary(doneCount, jobs.length, inProgress)
  };
}
const rows = (model) => model.jobs.map(({ key, label, status, tone }) => ({ key, label, status, tone }));

test("splitMoneyUse takes invested and moved-to-savings money out of the spend, and their plans out of the planned spend", () => {
  assert.deepEqual(splitMoneyUse({ ...PERIOD, savedMovedMinor: 150_000 }), {
    income: 24_700_000,
    spending: 22_550_000,
    invested: 800_000,
    takenFromInvestments: 0,
    movedToSavings: 150_000,
    kept: 1_350_000,
    spendPlan: 22_000_000,
    savePlan: 1_000_000,
    investPlan: 1_000_000
  });
  // Nothing goes below zero except what was kept.
  assert.deepEqual(splitMoneyUse({ incomeMinor: 0, spentMinor: 10_000, investedMinor: 20_000, plannedSpendMinor: 5_000, savingsTargetMinor: 9_000 }), {
    income: 0, spending: 0, invested: 20_000, takenFromInvestments: 0, movedToSavings: 0, kept: -20_000, spendPlan: 0, savePlan: 9_000, investPlan: 0
  });
});

test("a finished month: each job is done, or short or over by its amount", () => {
  const model = buildMoneyJobs({ figures: splitMoneyUse(PERIOD), plannedIncomeMinor: 25_000_000 });
  assert.deepEqual(rows(model), [
    { key: "spend", label: "Spend within $220,000", status: "over by $7,000", tone: "short" },
    { key: "save", label: "Save $10,000", status: "✓ done", tone: "in" },
    { key: "invest", label: "Invest $10,000", status: "short by $2,000", tone: "short" },
    { key: "income", label: "Income $250,000", status: "short by $3,000", tone: "short" }
  ]);
  assert.equal(model.doneCount, 1);
  assert.equal(model.summary, "1 of 4 money jobs done");
});

test("the month still going says so far, and forecasts nothing", () => {
  const model = buildMoneyJobs({ figures: splitMoneyUse(PERIOD), plannedIncomeMinor: 24_000_000, inProgress: true });
  assert.deepEqual(model.jobs.map((job) => job.status), ["over by $7,000 so far", "✓ so far", "short by $2,000 so far", "✓ so far"]);
  assert.equal(model.summary, "2 of 4 money jobs done so far");
});

test("spending its plan, or within the cents the row cannot show, is done; a dollar more is over", () => {
  const onPlan = buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 60_000 }) });
  assert.deepEqual(rows(onPlan), [{ key: "spend", label: "Spend within $600", status: "✓ done", tone: "in" }]);
  assert.equal(onPlan.summary, "1 of 1 money job done");

  // 49 cents over would read "over by $0".
  const cents = buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 60_049, plannedSpendMinor: 60_000 }) });
  assert.equal(cents.jobs[0].status, "✓ done");

  const over = buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 60_050, plannedSpendMinor: 60_000 }) });
  assert.equal(over.jobs[0].status, "over by $1");
  assert.equal(over.jobs[0].done, false);
});

test("saving when more went out than came in is short by the whole gap", () => {
  const model = buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 150_000, plannedSpendMinor: 150_000, savingsTargetMinor: 20_000 }) });
  // Spend plan $1,300 vs $1,500 spent; kept is -$500 against a $200 target.
  assert.deepEqual(rows(model), [
    { key: "spend", label: "Spend within $1,300", status: "over by $200", tone: "short" },
    { key: "save", label: "Save $200", status: "short by $700", tone: "short" }
  ]);
  assert.equal(model.summary, "0 of 2 money jobs done");
});

test("a job is there only when its plan line is: no plan and no planned income sets no job", () => {
  assert.equal(buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 60_000 }) }), null);
  const investOnly = buildMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 30_000, plannedSpendMinor: 30_000, plannedInvestMinor: 30_000 }) });
  assert.deepEqual(rows(investOnly), [{ key: "invest", label: "Invest $300", status: "short by $300", tone: "short" }]);
});

test("hidden money: ✓ for a done job, else the share of the plan reached, and no amount", () => {
  const model = buildMoneyJobs({ figures: splitMoneyUse(PERIOD), plannedIncomeMinor: 25_000_000, inProgress: true, hidden: true, formatMoney: noFormatting });
  assert.deepEqual(model.jobs.map(({ label, status }) => [label, status]), [
    ["Spend within plan", "103%"],
    ["Save", "✓"],
    ["Invest", "80%"],
    ["Income", "99%"]
  ]);
  assert.equal(model.summary, "1 of 4 money jobs done so far");
  const words = [model.summary, ...model.jobs.flatMap((job) => [job.label, job.status])].join(" ");
  assert.doesNotMatch(words, /\$|short|over|under|left|\d+ more/);
});

test("each job's row opens its money figure, its part of the plan and its question, with no amount in it", () => {
  const figures = splitMoneyUse({ ...PERIOD, savedMovedMinor: 0 });
  const jobs = describeMoneyJobs(listMoneyJobs({ figures, plannedIncomeMinor: 25_000_000 }));
  const opens = Object.fromEntries(jobs.map((job) => {
    const { fig, plan, ask } = MONEY_JOB_FIGURES[job.key];
    return [job.key, { fig, plan, ask: ask(job) }];
  }));
  assert.deepEqual(opens, {
    // Over its plan the spend job asks why.
    spend: { fig: "spending", plan: "", ask: "spentOverPlan" },
    save: { fig: "kept", plan: "", ask: "saved" },
    invest: { fig: "invested", plan: "", ask: "invested" },
    income: { fig: "earned", plan: "income", ask: "income" }
  });
  // Within its plan it asks what the money went on.
  const within = describeMoneyJobs(listMoneyJobs({ figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 10_000, plannedSpendMinor: 50_000 }) }));
  assert.equal(MONEY_JOB_FIGURES.spend.ask(within[0]), "spentMost");
});

const SUMMARY_CARDS = [
  { label: "Planned income", amountMinor: 25_000_000, tone: "plan" },
  { label: "Actual income", amountMinor: 24_700_000, tone: "in" },
  { label: "Planned spend", amountMinor: 24_000_000, tone: "plan" },
  { label: "Actual spend", amountMinor: 23_500_000, tone: "neutral" },
  { label: "Savings target", amountMinor: 1_000_000, tone: "plan" },
  { label: "Realized savings", amountMinor: 1_200_000, tone: "in" }
];

test("the Summary lead reads invested and moved-to-savings money from the range's category share and the investment goal from its card", () => {
  const model = buildSummaryLeadModel([...SUMMARY_CARDS, { label: "Planned investments", amountMinor: 1_000_000, tone: "plan" }], {
    categoryShare: [
      { key: "Food", label: "Food", valueMinor: 22_550_000 },
      { key: "Investments", label: "Investments", valueMinor: 800_000 },
      { key: "Savings", label: "Savings", valueMinor: 150_000 }
    ]
  });
  assert.deepEqual({ invested: model.figures.invested, moved: model.figures.movedToSavings, plan: model.figures.investPlan }, { invested: 800_000, moved: 150_000, plan: 1_000_000 });
  // The lead, the bar and the jobs read this one split: the spend job's
  // figures are the headline's, the save job's kept is the Saved pill.
  const jobs = listMoneyJobs({ figures: model.figures, plannedIncomeMinor: model.income.planMinor });
  const spendJob = jobs.find((job) => job.key === "spend");
  assert.deepEqual([spendJob.actualMinor, spendJob.planMinor], [model.spent.amountMinor, model.plannedSpendMinor]);
  assert.equal(spendJob.done, !model.headroom.isOver);
  assert.equal(jobs.find((job) => job.key === "save").actualMinor, model.saved.amountMinor);
  // Without them (an older page, or none filed) nothing is invested.
  const plain = buildSummaryLeadModel(SUMMARY_CARDS);
  assert.deepEqual({ invested: plain.figures.invested, moved: plain.figures.movedToSavings, plan: plain.figures.investPlan }, { invested: 0, moved: 0, plan: 0 });
});

test("the Month lead takes the investment goal from its Investments plan rows, not a Savings row", () => {
  const cards = [
    { label: "Planned income", amountMinor: 900_000, tone: "plan" },
    { label: "Planned spend", amountMinor: 600_000, tone: "plan" },
    { label: "Remaining budget", amountMinor: 300_000, tone: "in" },
    { label: "Actual spend", amountMinor: 500_000, tone: "neutral" },
    { label: "Savings target", amountMinor: 180_000, tone: "plan" }
  ];
  const planRows = [
    { label: "Savings", categoryName: "Savings", plannedMinor: 180_000 },
    { label: "iFAST", categoryName: "Investments", plannedMinor: 150_000 },
    { label: "Stashaway", categoryName: "investments", plannedMinor: 45_000 },
    { label: "Food", categoryName: "Food & Drinks", plannedMinor: 225_000 }
  ];
  const model = buildMonthLeadModel(cards, { actualIncomeMinor: 900_000, realizedSavingsMinor: 400_000 }, {
    planRows,
    categoryShare: [{ key: "Investments", label: "Investments", valueMinor: 150_000 }]
  });
  assert.deepEqual(model.figures, { income: 900_000, spending: 350_000, invested: 150_000, takenFromInvestments: 0, movedToSavings: 0, kept: 400_000, spendPlan: 225_000, savePlan: 180_000, investPlan: 195_000 });
  // The headline is the spending against the spend plan.
  assert.deepEqual([model.spent.amountMinor, model.plannedSpendMinor], [350_000, 225_000]);
  assert.deepEqual(model.headroom, { amountMinor: 125_000, isOver: true, tone: "short" });
});

test("the shell opens a figure's menu on a tap, click, Enter or Space and navigates for its choices under one event name", async () => {
  const MONEY_ACTION_EVENT = "monies:money-action";
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
  const menu = await readFile(new URL("../src/client/figure-menu.js", import.meta.url), "utf8");
  assert.equal(MONEY_ACTION_EVENT, "monies:money-action");
  assert.ok(menu.includes('export const MONEY_ACTION_EVENT = "monies:money-action"'));
  assert.ok(app.includes(`window.addEventListener("${MONEY_ACTION_EVENT}"`), "App.jsx navigates for it");
  // One captured listener for every figure; the menu is a dynamic import.
  assert.ok(app.includes('document.addEventListener("click", onFigure, true)'));
  assert.ok(app.includes('document.addEventListener("keydown", onFigure, true)'));
  assert.ok(app.includes('import("./figure-menu.js")'));
});

test("a figure's menu: View entries over the figure's whole period in the page's view and scope, Open plan, and its question", () => {
  const month = { startMonth: "2026-05", endMonth: "2026-05" };
  assert.deepEqual(figureMenu({ fig: "invested", plan: "", period: month, search: "?view=person-tim&month=2026-05&scope=direct&summary_start=2026-05" }), {
    label: "Invested: what next",
    items: [
      { action: "entries", label: "View entries", location: { pathname: "/entries", search: "?view=person-tim&month=2026-05&scope=direct&entries_scope=direct&entry_figure=invested" } },
      { action: "plan", label: "Open plan", location: { pathname: "/month", search: "?view=person-tim&month=2026-05&scope=direct", hash: "#month-plan" } },
      { action: "ask", label: "Ask about this", question: "How much did I invest in May 2026?" }
    ]
  });
  // A range opens every month of it (entry_from to entry_to); the plan is
  // its last month's, and says so; household has no person scope.
  const range = figureMenu({ fig: "spending", plan: "", ask: "spentOverPlan", period: { startMonth: "2025-10", endMonth: "2026-09" }, search: "" });
  assert.deepEqual(range.items.map((item) => item.label), ["View entries", "Open Sep 2026 plan", "Ask about this"]);
  assert.equal(range.items[0].location.search, "?view=household&month=2026-09&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_figure=spending&entry_from=2025-10&entry_to=2026-09");
  assert.equal(range.items[2].question, "Why did I spend more than planned from Oct 2025 to Sep 2026?");
  // Kept has entries behind it too: the income, spending and moves that made it.
  assert.equal(figureMenu({ fig: "kept", period: month }).items[0].location.search, "?view=household&month=2026-05&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_figure=kept");
  // Income opens the plan's income part.
  assert.equal(figureMenu({ fig: "earned", plan: "income", period: month }).items[1].location.hash, "#month-plan-income");
  // A plan figure has no entries: Open plan and Ask only.
  assert.deepEqual(figureMenu({ fig: "plan", plan: "", period: month }).items.map((item) => item.action), ["plan", "ask"]);
  // A category: its spending in the period.
  assert.equal(figureMenu({ fig: "category", arg: "Groceries", period: { startMonth: "2025-10", endMonth: "2026-09" } }).items[0].location.search,
    "?view=household&month=2026-09&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_category=Groceries&entry_figure=spent&entry_from=2025-10&entry_to=2026-09");
  // A plan row's actual: exactly its entries.
  assert.equal(figureMenu({ fig: "spent", ids: ["e1", "e2"], period: null, search: "?view=household&month=2026-05&scope=direct_plus_shared" }).items[0].location.search,
    "?view=household&month=2026-05&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_figure=spent&entry_id=e1&entry_id=e2");
  // On Entries, a pill narrows the list it is on, keeping its filters.
  assert.equal(figureMenu({ fig: "transfers", period: null, pathname: "/entries", search: "?view=household&month=2026-05&entry_wallet=acc-1" }).items[0].location.search,
    "?view=household&month=2026-05&entry_wallet=acc-1&entry_figure=transfers");
  // A split balance: its group on Splits, and who owes whom.
  assert.deepEqual(figureMenu({ fig: "splits", arg: "split-group-japan", period: null, search: "?view=person-tim&month=2026-05" }).items, [
    { action: "splits", label: "Open Splits", location: { pathname: "/splits", search: "?view=person-tim&month=2026-05&split_group=split-group-japan", hash: "#splits-activity" } },
    { action: "ask", label: "Ask about this", question: "Who owes whom?" }
  ]);
  // Hidden money: the same menu, and a question that never says which side
  // of the plan or of income the money fell. No label holds an amount.
  const hidden = figureMenu({ fig: "spending", plan: "", ask: "spentOverPlan", hidden: true, period: month });
  assert.equal(hidden.items[2].question, "How did my spending compare with the plan in May 2026?");
  assert.equal(figureMenu({ fig: "from_savings", hidden: true, period: month }).items.at(-1).question, "How did my spending compare with my income in May 2026?");
  assert.doesNotMatch(JSON.stringify(hidden), /\$\d/);
});
