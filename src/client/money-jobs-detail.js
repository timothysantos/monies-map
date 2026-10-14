import { moneyJobsCopy } from "./copy/money-jobs-copy";
import { wholeMoney } from "./money-jobs-model";

// The opened money jobs (design.md "Money jobs"): the rows' labels and
// statuses and the list that shows them. Loaded through money-jobs-loader.js
// on the first open (at once where the jobs start open), so none of it (nor
// its copy) is in the first screen.
//
// The UI is drawn with the caller's `h` (React's createElement): this chunk
// imports nothing from the first screen's shared React chunk, which the
// bundler would otherwise split into one more first-screen file
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
    return { key, label: copy[key](hidden ? null : formatMoney(planMinor)), status, done, upward, tone: done ? "in" : "short" };
  });
}

// What each job's row opens (design.md "Openable figures", figure-menu.js):
// the money figure behind it (src/domain/money-figures.ts), the part of the
// Month plan it is a line of, and the question for Ask. The spend job over
// its plan asks why; with money hidden the menu turns that into the
// neutral question itself.
export const MONEY_JOB_FIGURES = {
  spend: { fig: "spending", plan: "", ask: (job) => (job.done ? "spentMost" : "spentOverPlan") },
  save: { fig: "kept", plan: "", ask: () => "saved" },
  invest: { fig: "invested", plan: "", ask: () => "invested" },
  income: { fig: "earned", plan: "income", ask: () => "income" }
};

// One quiet row per job: the job and its plan on the left, the status on the
// right in its money tone (text only). A row is an openable figure: a tap,
// click or Enter opens its menu (View entries, Open plan, Ask about this).
export function renderMoneyJobRows(h, { jobs, hidden, period }) {
  const rows = describeMoneyJobs(jobs, { inProgress: period.inProgress, hidden });
  return h(
    "ul",
    { className: "money-jobs-list", "aria-label": moneyJobsCopy.listLabel },
    rows.map((job) => {
      const opens = MONEY_JOB_FIGURES[job.key];
      return h(
        "li",
        { key: job.key, className: "money-job", "data-job": job.key },
        h(
          "button",
          {
            type: "button",
            className: "money-job-row",
            "data-fig": opens.fig,
            "data-fig-plan": opens.plan,
            "data-fig-ask": opens.ask(job)
          },
          h("span", { className: "money-job-label" }, job.label),
          h("span", { className: `money-job-status money-${job.tone}`, "data-job-status": true }, job.status)
        )
      );
    })
  );
}
