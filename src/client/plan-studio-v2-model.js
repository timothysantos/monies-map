// Plan Studio v2's model (DOMAIN.md "Plan Studio", "Plan history"): the plan
// as one list grouped by what the money does, the facts a row's slider
// popover shows, income by row with the money that arrived outside the plan,
// and where a new line is stored. Pure functions over the studio's rows
// (plan-studio-model.js) and the held plan; amounts are minor units.
//
// A row's job is the one rule the lead and the savings bar use
// (planJob, src/domain/money-job-plan.ts): this file never classifies a line
// a second way. The stored section (planned items or budget buckets) is only
// where a line lives: a dated spending line and an undated budget are both
// Spend.
import { sectionForNewLine } from "./plan-line-section.js";
import { expectedByToday, JOB_ORDER, planJob } from "./plan-studio-model.js";

// The pace margin of a row: the larger of $40 and 8% of its plan, the same
// margin the row's status line uses.
const paceMargin = (plannedMinor) => Math.max(4000, Math.round(plannedMinor * 0.08));

/**
 * The studio's list: one group per money job that has rows, in the order
 * Money in, Spend, Save, Invest. Spend and Invest list dated lines first, by
 * due date, then the undated ones in the page's order.
 */
export function studioGroups(rows) {
  return JOB_ORDER.map((job) => {
    const inJob = rows.filter((row) => row.job === job);
    if (job !== "spend" && job !== "invest") return { job, rows: inJob };
    const dated = inJob.filter((row) => row.dueDate).sort((a, b) => a.dueDay - b.dueDay);
    return { job, rows: [...dated, ...inJob.filter((row) => !row.dueDate)] };
  }).filter((group) => group.rows.length);
}

/** The day and month (0 to 11) of a dated line's due date, or null. */
export function dueTagParts(row) {
  if (!row.dueDate) return null;
  const [, month, day] = String(row.dueDate).split("-").map(Number);
  return day && month ? { day, monthIndex: month - 1 } : null;
}

// Where a row stands against its own pace today: ahead, on pace or behind.
// A dated line follows its due date; any other follows a straight line over
// the month. Income and savings have none, and neither does a month that is
// not the current one.
function paceOf(row, plannedMinor, when) {
  if (!when.isCurrent) return null;
  const expected = expectedByToday(row, plannedMinor, when);
  if (expected === null) return null;
  const dated = row.dueDay !== null;
  const gap = row.actualMinor - expected;
  const margin = paceMargin(plannedMinor);
  if (gap > margin) return { kind: "ahead", amountMinor: gap, dated };
  if (-gap > margin) return { kind: "behind", amountMinor: -gap, dated };
  return { kind: "on_pace", amountMinor: 0, dated };
}

/**
 * The facts the slider popover shows for one row: last month's plan and
 * actual, the three-month average actual, spent (or received, or kept) so far
 * and what is left or over, the pace verdict, and the live effect of a
 * pending change on Left over. `totals` are the held plan's totals, so the
 * effect follows the slider while it moves.
 */
export function rowInfo({ row, plannedMinor, totals, when }) {
  const history = row.history;
  const changeMinor = plannedMinor - row.savedMinor;
  // Raising money in raises Left over; raising anything planned out lowers it.
  const sign = row.job === "income" ? 1 : -1;
  return {
    lastPlannedMinor: history?.lastPlannedMinor ?? null,
    lastActualMinor: history?.lastActualMinor ?? null,
    averageActualMinor: history?.averageActualMinor ?? null,
    averageMonths: history?.months ?? 0,
    spentMinor: row.actualMinor,
    leftMinor: Math.max(0, plannedMinor - row.actualMinor),
    overMinor: Math.max(0, row.actualMinor - plannedMinor),
    pace: paceOf(row, plannedMinor, when),
    effect: changeMinor === 0 ? null : { changeMinor, leftOverMinor: totals.left, leftOverWasMinor: totals.left - sign * changeMinor }
  };
}

/** Planned money in by income row (rows planned at nothing are left out). */
export function incomeSegments(rows, plan) {
  return rows
    .filter((row) => row.job === "income" && (plan[row.key] ?? row.savedMinor) > 0)
    .map((row) => ({ key: row.key, label: row.label, ownerName: row.ownerName, amountMinor: plan[row.key] ?? row.savedMinor }));
}

/** Money that arrived beyond the plan: received less planned money in, never below nothing. */
export function unplannedIncome({ receivedMinor, plannedInMinor }) {
  return Math.max(0, receivedMinor - plannedInMinor);
}

/**
 * Where a new line is stored and which group it lands in. A line with a
 * due date is a planned item, any other spending line a budget bucket;
 * income is its own section; savings and investing lines are stored the same
 * way and land in Save and Invest because planJob says so.
 */
export function classifyNewLine({ label = "", categoryName = "", planDate = null, kind = "plan" }) {
  if (kind === "income") return { job: "income", sectionKey: "income" };
  return { job: planJob({ label, categoryName }), sectionKey: sectionForNewLine(planDate) };
}
