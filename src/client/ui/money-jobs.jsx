import { useState } from "react";

import { messages } from "../copy/en-SG";
import { buildMoneyJobs } from "../money-jobs-model";
import { moneyToneClass } from "../money-tone-class";
import { useIsMobileLayout } from "../use-viewport";
import { MoneyActions } from "./money-actions";

const copy = messages.summary.lead.moneyJobs;

// The money jobs Detail under the savings bar (design.md "Money jobs";
// model in money-jobs-model.js): one line, "3 of 4 money jobs done", that
// opens one quiet row per job: the job and its plan on the left, ✓ done or
// short / over by an amount on the right in its money tone (text only).
// Folded on a phone, open on a wider screen; a row opens its menu (View
// entries, Ask about this) under it. Hidden money: ✓ or a percentage.
export function MoneyJobs({ figures, plannedIncomeMinor, hidden, period }) {
  const phone = useIsMobileLayout();
  const [openJob, setOpenJob] = useState(null);
  const model = buildMoneyJobs({ figures, plannedIncomeMinor, inProgress: period.inProgress, hidden });
  if (!model) {
    return null;
  }
  return (
    <details className="money-jobs" open={!phone} data-money-jobs>
      <summary className="money-jobs-summary" data-money-jobs-summary>{model.summary}</summary>
      <ul className="money-jobs-list" aria-label={copy.listLabel}>
        {model.jobs.map((job) => (
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
              <MoneyActions actionKey={job.key} name={job.label} figures={figures} hidden={hidden} period={period} />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
