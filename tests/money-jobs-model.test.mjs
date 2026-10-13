import assert from "node:assert/strict";
import test from "node:test";

import { messages } from "../src/client/copy/en-SG.js";
import { describeMoneyJobs, moneyActionTarget, moneyActionView } from "../src/client/money-jobs-detail.js";
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

test("each part opens the entries behind it and a question with no amount in it", () => {
  const figures = splitMoneyUse({ ...PERIOD, savedMovedMinor: 0 });
  assert.deepEqual(moneyActionTarget("spent", { figures }), { entries: { type: "expense" }, question: "spentOverPlan" });
  assert.deepEqual(moneyActionTarget("spend", { figures, hidden: true }), { entries: { type: "expense" }, question: "spentVsPlan" });
  assert.deepEqual(moneyActionTarget("invested", { figures }), { entries: { categories: ["Investments"] }, question: "invested" });
  assert.deepEqual(moneyActionTarget("savings", { figures }), { entries: { type: "expense" }, question: "spentMore" });
  assert.deepEqual(moneyActionTarget("income", { figures }), { entries: { type: "income" }, question: "income" });
  // Money left in the bank has no entry: Kept offers only the question.
  assert.deepEqual(moneyActionTarget("kept", { figures }), { entries: null, question: "saved" });
  assert.deepEqual(moneyActionTarget("save", { figures: splitMoneyUse({ ...PERIOD, savedMovedMinor: 5_000 }) }), { entries: { categories: ["Savings"] }, question: "saved" });
  // Spending within its plan asks what it went on.
  assert.equal(moneyActionTarget("spent", { figures: splitMoneyUse({ incomeMinor: 100_000, spentMinor: 10_000, plannedSpendMinor: 50_000 }) }).question, "spentMost");
  assert.equal(moneyActionTarget("tick", { figures }), null);
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

test("the shell listens for the lead menu under the same event name", async () => {
  const { MONEY_ACTION_EVENT } = await import("../src/client/money-jobs-detail.js");
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
  assert.ok(app.includes(`window.addEventListener("${MONEY_ACTION_EVENT}"`), "App.jsx navigates for it");
});

test("a part's menu: the Entries location for the period's last month in the page's view and scope, and its question", () => {
  const figures = splitMoneyUse({ ...PERIOD });
  const month = { startMonth: "2026-05", endMonth: "2026-05" };
  assert.deepEqual(moneyActionView("invested", { name: "Invested", figures, period: month, search: "?view=person-tim&month=2026-05&scope=direct&summary_start=2026-05" }), {
    label: "Invested: what next",
    entries: {
      label: "View entries",
      location: { pathname: "/entries", search: "?view=person-tim&month=2026-05&scope=direct&entries_scope=direct&entry_category=Investments" }
    },
    ask: { label: "Ask about this", question: "How much did I invest in May 2026?" }
  });
  // A range opens its last month, and says so; household has no person scope.
  const range = moneyActionView("spent", { name: "Spent", figures, period: { startMonth: "2025-10", endMonth: "2026-09" }, search: "" });
  assert.equal(range.entries.label, "View Sep 2026 entries");
  assert.equal(range.entries.location.search, "?view=household&month=2026-09&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_type=expense");
  assert.equal(range.ask.question, "Why did I spend more than planned from Oct 2025 to Sep 2026?");
  // Money left in the bank has no entry to show: only the question.
  assert.equal(moneyActionView("kept", { name: "Kept", figures, period: month }).entries, null);
  // Hidden money never says which side of the plan the spending fell.
  assert.equal(moneyActionView("spent", { name: "Spent", figures, hidden: true, period: month }).ask.question, "How did my spending compare with the plan in May 2026?");
  assert.equal(moneyActionView("tick", { name: "", figures, period: month }), null);
});
