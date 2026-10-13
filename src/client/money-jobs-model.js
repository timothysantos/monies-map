import { splitMoneyUse as splitMoneyUseInDomain } from "../domain/money-jobs";

// Whole dollars: the bar's lines and the job rows are read at a glance and
// have to fit one line on a phone; the cents are on the figures above.
const wholeMoneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
export const wholeMoney = (minor) => wholeMoneyFormatter.format(minor / 100);

const atLeastZero = (minor) => Math.max(0, minor ?? 0);

// What the period's income went to: one calculation for every screen and
// Ask's plan answer (src/domain/money-jobs.ts). Wrapped here rather than
// re-exported, so the Ask chunk takes it from this module and the domain
// module stays inside the first screen's chunk (no extra first-screen file).
/** @param {Parameters<typeof splitMoneyUseInDomain>[0]} input */
export function splitMoneyUse(input) {
  return splitMoneyUseInDomain(input);
}

// The jobs the plan gives the money, as plain numbers (labels and statuses
// are worded by money-jobs-detail.js, which loads with the opened
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
