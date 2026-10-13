import { createElement, useState } from "react";

import { messages } from "../copy/en-SG";
import { useMoneyJobsDetail } from "../money-jobs-loader";
import { listMoneyJobs } from "../money-jobs-model";
import { useIsMobileLayout } from "../use-viewport";

const copy = messages.summary.lead.moneyJobs;

// The money jobs Detail under the savings bar (design.md "Money jobs";
// numbers in money-jobs-model.js): one line, "3 of 4 money jobs done", that
// opens one quiet row per job, each opening its menu (View entries, Ask
// about this). Folded on a phone, open on a wider screen. The rows and the
// menu (money-jobs-detail.js) load on the first open, out of the first
// screen; their state stays here.
export function MoneyJobs({ figures, plannedIncomeMinor, hidden, period }) {
  const phone = useIsMobileLayout();
  const [open, setOpen] = useState(!phone);
  const [openJob, setOpenJob] = useState(null);
  const detail = useMoneyJobsDetail(open);
  const jobs = listMoneyJobs({ figures, plannedIncomeMinor });
  if (!jobs.length) {
    return null;
  }
  const done = jobs.filter((job) => job.done).length;
  return (
    <details className="money-jobs" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-money-jobs>
      <summary className="money-jobs-summary" data-money-jobs-summary>{copy.summary(done, jobs.length, period.inProgress)}</summary>
      {open && detail ? detail.renderMoneyJobRows(createElement, { jobs, figures, hidden, period, openJob, setOpenJob }) : null}
    </details>
  );
}
