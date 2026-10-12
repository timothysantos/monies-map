import { moneyActionsCopy, moneyJobsCopy } from "./copy/money-jobs-copy";
import { buildEntriesFilterSearch } from "./entry-filter-params";
import { formatMonthLabel } from "./formatters";
import { wholeMoney } from "./money-jobs-model";

// The words of the opened money jobs and of the bar parts' menu (design.md
// "Money jobs"): the rows' labels and statuses, the menu's Entries link and
// its question for Ask. Plain functions with no React, loaded through
// money-jobs-loader.js on the first open, tap, hover or focus, so neither
// they nor their copy and the Entries filter code are in the first screen.
// The lead's components (ui/money-jobs.jsx, ui/money-actions.jsx) render
// what these return.

// One row per job (listMoneyJobs' numbers, money-jobs-model.js): the job and
// its plan, then "✓ done" or short / over by the gap, with "so far" while
// the period is still going. Hidden money: the label drops its amount, and
// the status is ✓ or the share of the plan reached. Nothing is forecast.
export function describeMoneyJobs(jobs, { inProgress = false, hidden = false, formatMoney = wholeMoney } = {}) {
  const copy = moneyJobsCopy;
  return jobs.map(({ key, planMinor, actualMinor, gapMinor, upward, done }) => {
    let status;
    if (hidden) {
      status = done ? copy.hiddenDone : copy.hiddenPercent(Math.max(0, Math.round((actualMinor * 100) / planMinor)));
    } else if (done) {
      status = copy.done(inProgress);
    } else {
      status = upward ? copy.short(formatMoney(gapMinor), inProgress) : copy.over(formatMoney(gapMinor), inProgress);
    }
    return { key, label: copy[key](hidden ? null : formatMoney(planMinor)), status, done, tone: done ? "in" : "short" };
  });
}

export const moneyJobsListLabel = moneyJobsCopy.listLabel;

// What a bar part or a job opens: the Entries filter that lists the money
// behind it (null when no entry holds it, such as income simply left in the
// bank), and the question it offers Ask. The question never carries an
// amount, and with hidden money never says which side of the plan the
// spending fell.
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

// The menu as ui/money-actions.jsx shows it: its group label, and the
// "View entries" button (null when there is no entry to show) with the
// Entries location it opens, for the period's last month (Entries shows one
// month) in the page's view and scope (`search`, the page's own query), and
// the "Ask about this" button with its question. Null for a part with no menu.
export function moneyActionView(actionKey, { name, figures, hidden = false, period, search = "" }) {
  const copy = moneyActionsCopy;
  const target = moneyActionTarget(actionKey, { figures, hidden });
  if (!target) {
    return null;
  }
  const { startMonth, endMonth } = period;
  const endLabel = formatMonthLabel(endMonth);
  const periodWords = startMonth === endMonth ? copy.inMonth(endLabel) : copy.inRange(formatMonthLabel(startMonth), endLabel);
  let entries = null;
  if (target.entries) {
    const current = new URLSearchParams(search);
    const params = buildEntriesFilterSearch({
      month: endMonth,
      viewId: current.get("view") || "household",
      scope: current.get("scope") || "direct_plus_shared",
      ...target.entries
    }, { fromAsk: false });
    entries = {
      label: startMonth === endMonth ? copy.viewEntries : copy.viewMonthEntries(endLabel),
      location: { pathname: "/entries", search: `?${params.toString()}` }
    };
  }
  return {
    label: copy.label(name),
    entries,
    ask: { label: copy.ask, question: copy.questions[target.question](periodWords) }
  };
}
