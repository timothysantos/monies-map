import { messages } from "./copy/en-SG";

const copy = messages.summary.lead.moneyJobs;

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

// One row per job the plan gives the money: spend within the budget, save
// the savings target, invest the investment goal, and the planned income
// coming in. A job is there only when its plan line is (more than zero).
// Each is done, or short or over by an amount; while the period is still
// going ("so far") the same facts carry "so far". Nothing is forecast.
// Hidden money: ✓ for a done job, else the share of the plan reached.
// Returns null when the plan sets no job.
export function buildMoneyJobs({ figures, plannedIncomeMinor = 0, inProgress = false, hidden = false, formatMoney = wholeMoney }) {
  const plannedIncome = atLeastZero(plannedIncomeMinor);
  const amount = (minor) => (hidden ? null : formatMoney(minor));
  const candidates = [
    // Spending is done while it stays within its plan.
    { key: "spend", plan: figures.spendPlan, actual: figures.spending, upward: false, label: copy.spend },
    { key: "save", plan: figures.savePlan, actual: figures.kept, upward: true, label: copy.save },
    { key: "invest", plan: figures.investPlan, actual: figures.invested, upward: true, label: copy.invest },
    { key: "income", plan: plannedIncome, actual: figures.income, upward: true, label: copy.income }
  ];
  const jobs = candidates
    .filter((job) => job.plan > 0)
    .map(({ key, plan, actual, upward, label }) => {
      const gap = upward ? plan - actual : actual - plan;
      // The rows say whole dollars: a gap that would read "$0" is on plan.
      const done = gap < 50;
      let status;
      if (hidden) {
        status = done ? copy.hiddenDone : copy.hiddenPercent(Math.max(0, Math.round((actual * 100) / plan)));
      } else if (done) {
        status = copy.done(inProgress);
      } else {
        status = upward ? copy.short(formatMoney(gap), inProgress) : copy.over(formatMoney(gap), inProgress);
      }
      return { key, label: label(amount(plan)), status, done, tone: done ? "in" : "short" };
    });
  if (!jobs.length) {
    return null;
  }
  const doneCount = jobs.filter((job) => job.done).length;
  return { jobs, doneCount, summary: copy.summary(doneCount, jobs.length, inProgress) };
}

// What a bar part or a job opens (ui/money-actions.jsx): the Entries filter
// that lists the money behind it (null when no entry holds it, such as
// income simply left in the bank), and the question it offers Ask. The
// question never carries an amount, and with hidden money never says which
// side of the plan the spending fell.
export function moneyActionTarget(key, { figures, hidden = false }) {
  switch (key) {
    case "spent":
    case "spend":
      return {
        entries: { type: "expense" },
        question: hidden ? "spentVsPlan" : figures.spendPlan > 0 && figures.spending > figures.spendPlan ? "spentOverPlan" : "spentMost"
      };
    case "savings":
      return { entries: { type: "expense" }, question: hidden ? "spentVsIncome" : "spentMore" };
    case "invested":
    case "invest":
      return { entries: figures.invested > 0 ? { categories: ["Investments"] } : null, question: "invested" };
    case "kept":
    case "save":
      return { entries: figures.movedToSavings ? { categories: ["Savings"] } : null, question: "saved" };
    case "income":
      return { entries: figures.income > 0 ? { type: "income" } : null, question: "income" };
    default:
      return null;
  }
}
