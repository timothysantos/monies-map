import { useState } from "react";

import { messages } from "../copy/en-SG";
import { useMoneyJobsWords } from "../money-jobs-loader";
import { listMoneyJobs } from "../money-jobs-model";
import { moneyToneClass } from "../money-tone-class";
import { useIsMobileLayout } from "../use-viewport";
import { MoneyActions } from "./money-actions";

const copy = messages.summary.lead.moneyJobs;

// The money jobs Detail under the savings bar (design.md "Money jobs";
// numbers in money-jobs-model.js): one line, "3 of 4 money jobs done", that
// opens one quiet row per job: the job and its plan on the left, ✓ done or
// short / over by an amount on the right in its money tone (text only). A
// row opens its menu (View entries, Ask about this) under it. Folded on a
// phone, open on a wider screen. The rows' words load on the first open
// (money-jobs-words.js), out of the first screen. Hidden money: ✓ or a
// percentage.
export function MoneyJobs({ figures, plannedIncomeMinor, hidden, period }) {
  const phone = useIsMobileLayout();
  const [open, setOpen] = useState(!phone);
  const [openJob, setOpenJob] = useState(null);
  const words = useMoneyJobsWords(open);
  const jobs = listMoneyJobs({ figures, plannedIncomeMinor });
  if (!jobs.length) {
    return null;
  }
  const done = jobs.filter((job) => job.done).length;
  const rows = open && words ? words.describeMoneyJobs(jobs, { inProgress: period.inProgress, hidden }) : null;
  return (
    <details className="money-jobs" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-money-jobs>
      <summary className="money-jobs-summary" data-money-jobs-summary>{copy.summary(done, jobs.length, period.inProgress)}</summary>
      {rows ? (
        <ul className="money-jobs-list" aria-label={words.moneyJobsListLabel}>
          {rows.map((job) => (
            <li key={job.key} className="money-job" data-job={job.key}>
              <button
                type="button"
                className="money-job-row"
                aria-expanded={openJob === job.key}
                onClick={() => setOpenJob((current) => (current === job.key ? null : job.key))}
              >
                <span className="money-job-label">{job.label}</span>
                <span className={`money-job-status ${moneyToneClass(job.tone)}`} data-job-status>{job.status}</span>
              </button>
              {openJob === job.key ? (
                <MoneyActions
                  actionKey={job.key}
                  view={words.moneyActionView(job.key, { name: job.label, figures, hidden, period, search: window.location.search })}
                  onDone={() => setOpenJob(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
