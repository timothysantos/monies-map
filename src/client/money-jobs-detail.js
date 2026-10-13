import { moneyActionsCopy, moneyJobsCopy } from "./copy/money-jobs-copy";
import { buildEntriesFilterSearch } from "./entry-filter-params";
import { formatMonthLabel } from "./formatters";
import { wholeMoney } from "./money-jobs-model";

// The window event a bar part's or a job's menu sends: { entries: { pathname,
// search } } to open Entries, or { askText } to open Ask and ask that question.
// The shell (App.jsx, which names it as a literal so neither side imports
// the other) navigates.
export const MONEY_ACTION_EVENT = "monies:money-action";

// The opened money jobs and the bar parts' menu (design.md "Money jobs"):
// the rows' labels and statuses, the menu's Entries link and its question
// for Ask, and the two small pieces of UI that show them. Loaded through
// money-jobs-loader.js on the first open, tap, hover or focus, so none of
// it (nor its copy, nor the Entries filter code) is in the first screen.
//
// The UI is drawn with the caller's `h` (React's createElement), and its
// state stays with the caller (ui/money-jobs.jsx, ui/savings-bar.jsx): this
// chunk imports nothing from the first screen's shared React chunk, which
// the bundler would otherwise split into one more first-screen file
// (scripts/check-initial-bundle.mjs counts them).

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

// The menu: "View entries" and "Ask about this", two quiet pill buttons. The
// shell does the navigating (App.jsx listens for MONEY_ACTION_EVENT): Entries,
// or Ask (the page on a phone, the panel beside the page on a wider screen).
// The menu closes as it goes, so Back finds the lead as it was.
export function renderMoneyActions(h, { actionKey, view, onDone }) {
  if (!view) {
    return null;
  }
  const send = (detail) => {
    onDone?.();
    window.dispatchEvent(new CustomEvent(MONEY_ACTION_EVENT, { detail }));
  };
  const button = (action, label, detail, extra = {}) => h(
    "button",
    { type: "button", className: "money-action", "data-action": action, onClick: () => send(detail), ...extra },
    label
  );
  return h(
    "span",
    { className: "money-actions", role: "group", "aria-label": view.label, "data-money-actions": actionKey },
    view.entries ? button("entries", view.entries.label, { entries: view.entries.location }) : null,
    button("ask", view.ask.label, { askText: view.ask.question }, { "data-question": view.ask.question })
  );
}

// One quiet row per job: the job and its plan on the left, the status on the
// right in its money tone (text only). A row is a button that opens its menu
// under it (`openJob`, `setOpenJob` are the caller's state).
export function renderMoneyJobRows(h, { jobs, figures, hidden, period, openJob, setOpenJob }) {
  const rows = describeMoneyJobs(jobs, { inProgress: period.inProgress, hidden });
  return h(
    "ul",
    { className: "money-jobs-list", "aria-label": moneyJobsCopy.listLabel },
    rows.map((job) => h(
      "li",
      { key: job.key, className: "money-job", "data-job": job.key },
      h(
        "button",
        {
          type: "button",
          className: "money-job-row",
          "aria-expanded": openJob === job.key,
          onClick: () => setOpenJob((current) => (current === job.key ? null : job.key))
        },
        h("span", { className: "money-job-label" }, job.label),
        h("span", { className: `money-job-status money-${job.tone}`, "data-job-status": true }, job.status)
      ),
      openJob === job.key
        ? renderMoneyActions(h, {
          actionKey: job.key,
          view: moneyActionView(job.key, { name: job.label, figures, hidden, period, search: window.location.search }),
          onDone: () => setOpenJob(null)
        })
        : null
    ))
  );
}
