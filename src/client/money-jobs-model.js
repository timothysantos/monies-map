// Whole dollars: the bar's lines and the job rows are read at a glance and
// have to fit one line on a phone; the cents are on the figures above.
const wholeMoneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
export const wholeMoney = (minor) => wholeMoneyFormatter.format(minor / 100);

const atLeastZero = (minor) => Math.max(0, minor ?? 0);

// The window event a bar part's or a job's menu sends (ui/money-actions.jsx):
// { entries: { pathname, search } } to open Entries, or { askText } to open
// Ask with that question. The shell (App.jsx, which names it as a literal so
// neither side imports the other) navigates.
export const MONEY_ACTION_EVENT = "monies:money-action";

// What the period's income went to, from figures the lead already has
// (design.md "Money jobs"; DOMAIN.md "Money job"). The lead's spend counts
// every expense entry, including money filed under the Investments and
// Savings categories; that money was moved, not spent, so it comes out of
// the spend here: invested is the Investments category's share, and the
// Savings category's share is kept with whatever income was left over.
// The plan splits the same way: the savings target and the Investments
// plan rows come out of the planned spend.
export function splitMoneyUse({
  incomeMinor,
  spentMinor,
  investedMinor = 0,
  savedMovedMinor = 0,
  plannedSpendMinor = 0,
  savingsTargetMinor = 0,
  plannedInvestMinor = 0
}) {
  const income = atLeastZero(incomeMinor);
  const invested = atLeastZero(investedMinor);
  const movedToSavings = atLeastZero(savedMovedMinor);
  const spending = atLeastZero((spentMinor ?? 0) - invested - movedToSavings);
  const savePlan = atLeastZero(savingsTargetMinor);
  const investPlan = atLeastZero(plannedInvestMinor);
  return {
    income,
    spending,
    invested,
    movedToSavings,
    // Can be below zero: more went out than came in.
    kept: income - spending - invested,
    spendPlan: atLeastZero((plannedSpendMinor ?? 0) - savePlan - investPlan),
    savePlan,
    investPlan
  };
}

// The jobs the plan gives the money, as plain numbers (labels and statuses
// are worded by money-jobs-words.js, which loads with the opened
// list): spend within the budget, save the savings target, invest the
// investment goal, and the planned income coming in. A job is there only
// when its plan line is (more than zero). `gapMinor` is how far it is from
// done: short of an upward job's plan, or over the spend plan. The rows say
// whole dollars, so a gap that would read "$0" is on plan. Nothing is
// forecast: these are recorded entries against the household's own plan.
export function listMoneyJobs({ figures, plannedIncomeMinor = 0 }) {
  return [
    { key: "spend", planMinor: figures.spendPlan, actualMinor: figures.spending, upward: false },
    { key: "save", planMinor: figures.savePlan, actualMinor: figures.kept, upward: true },
    { key: "invest", planMinor: figures.investPlan, actualMinor: figures.invested, upward: true },
    { key: "income", planMinor: atLeastZero(plannedIncomeMinor), actualMinor: figures.income, upward: true }
  ]
    .filter((job) => job.planMinor > 0)
    .map((job) => {
      const gapMinor = job.upward ? job.planMinor - job.actualMinor : job.actualMinor - job.planMinor;
      return { ...job, gapMinor, done: gapMinor < 50 };
    });
}
