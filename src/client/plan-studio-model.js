// Plan Studio's model (DOMAIN.md "Plan Studio"): the Month plan as money
// jobs. Pure functions over the rows the Month page already carries
// (monthPage.incomeRows and planSections), so the studio reads no new data
// and never disagrees with the lead above it. Every amount is in minor units
// (cents); the screen says whole dollars unless a figure has cents.
//
// A row's job follows the rules the lead and the savings bar use
// (src/domain/money-job-plan.ts): the "Savings" row is the savings target,
// rows in the Investments category are the investment goal, planned income
// is money in, every other planned row is spend. "Left over" is planned money
// in less everything planned out, the Month lead's "To allocate".
import { isInvestmentPlanRow, isSavingsTargetRow } from "../domain/money-job-plan";

export const JOB_ORDER = ["income", "spend", "save", "invest"];

function dueDayOf(row, month) {
  if (row.section !== "planned_items" || !row.planDate) return null;
  const [year, monthNumber, day] = String(row.planDate).split("-").map(Number);
  const [wantYear, wantMonth] = month.split("-").map(Number);
  if (!year || !monthNumber || !day) return null;
  if (year * 12 + monthNumber < wantYear * 12 + wantMonth) return 0;
  if (year * 12 + monthNumber > wantYear * 12 + wantMonth) return 99;
  return day;
}

export function planJob(row) {
  if (isSavingsTargetRow(row)) return "save";
  if (isInvestmentPlanRow(row)) return "invest";
  return "spend";
}

// A row's past (month-plan-history.ts) as named figures, or null when no
// earlier month had the row.
function readHistory(history) {
  if (!Array.isArray(history)) return null;
  const [lastPlannedMinor, lastActualMinor, averageActualMinor, months] = history;
  return { lastPlannedMinor, lastActualMinor, averageActualMinor, months };
}

// The date a dated line is due in the month shown (a date from another month
// is not a due date for this one).
function dueDateIn(row, dueDay) {
  return dueDay !== null && dueDay >= 1 && dueDay <= 31 ? row.planDate : null;
}

// What a plan line is saved through: its one stored row. A line made of
// several stored rows (the household view's combined line) is read only, as
// the household view's plan tables are.
function sourcesOf(row, fallbackMinor) {
  const ids = row.sourceRowIds?.length ? row.sourceRowIds : [row.id];
  return { ids, minors: [row.sourcePlannedMinor ?? fallbackMinor], editable: ids.length === 1 && !row.isDraft };
}

/**
 * The studio's rows: income first, then the plan rows in the page's order.
 * @param {{ incomeRows?: any[], planSections?: any[], month: string }} input
 */
export function buildStudioRows({ incomeRows = [], planSections = [], month }) {
  const rows = [];
  for (const row of incomeRows) {
    const source = sourcesOf(row, row.plannedMinor);
    rows.push({
      key: row.id,
      ids: source.ids,
      sourceMinors: source.minors,
      job: "income",
      section: "income",
      label: row.label,
      categoryName: row.categoryName,
      ownerName: row.ownerName ?? "",
      ownershipType: "direct",
      savedMinor: row.plannedMinor,
      actualMinor: row.actualMinor ?? 0,
      actualEntryIds: row.actualEntryIds ?? [],
      dueDay: null,
      dueDate: null,
      history: readHistory(row.history),
      splits: [],
      editable: source.editable && !row.isDerived
    });
  }
  for (const section of planSections) {
    for (const row of section.rows ?? []) {
      const source = sourcesOf(row, row.plannedMinor);
      const dueDay = dueDayOf({ ...row, section: section.key }, month);
      rows.push({
        key: row.id,
        ids: source.ids,
        sourceMinors: source.minors,
        job: planJob(row),
        section: section.key,
        label: row.label,
        categoryName: row.categoryName,
        ownerName: row.ownerName ?? "",
        ownershipType: row.ownershipType,
        savedMinor: row.plannedMinor,
        actualMinor: row.actualMinor ?? 0,
        actualEntryIds: row.actualEntryIds ?? [],
        dueDay,
        dueDate: dueDateIn(row, dueDay),
        history: readHistory(row.history),
        splits: row.splits ?? [],
        editable: source.editable
      });
    }
  }
  return rows;
}

/** Where the plan puts the money. `left` is below zero when it does not add up. */
export function planTotals(rows, plan) {
  const totals = { income: 0, spend: 0, save: 0, invest: 0 };
  for (const row of rows) {
    totals[row.job] += plan[row.key] ?? row.savedMinor;
  }
  const out = totals.spend + totals.save + totals.invest;
  return { ...totals, out, left: totals.income - out };
}

/** The plan balance in plain kinds (copy words them). */
export function balanceVerdict(totals) {
  if (totals.income === 0) return { kind: "empty", tone: "caution", amountMinor: 0 };
  if (totals.left < 0) return { kind: "over", tone: "short", amountMinor: -totals.left };
  if (totals.left === 0) return { kind: "exact", tone: "in", amountMinor: 0 };
  return { kind: "covered", tone: "in", amountMinor: totals.left };
}

// The flexible rows of a job: unlocked and editable. In a job that has
// budgets with no due date, only those are flexible (rent and bills do not
// shrink because a line was dragged); a job whose rows all have dates, like a
// monthly investment, moves them.
export function flexibleRows(rows, job, locks) {
  const inJob = rows.filter((row) => row.job === job);
  const open = inJob.filter((row) => row.editable && !locks[row.key]);
  return inJob.some((row) => row.dueDay === null) ? open.filter((row) => row.dueDay === null) : open;
}

/**
 * The one-tap fix for the plan balance: when more goes out than comes in,
 * lower the flexible spend row with the most room (plan less what is spent),
 * by what is over rounded up to $10 and never past the row's plan; when money
 * is left over, add it to the savings row. Null when nothing can be done.
 */
export function suggestFix({ rows, plan, locks, totals }) {
  if (totals.left < 0) {
    const candidates = flexibleRows(rows, "spend", locks).filter((row) => (plan[row.key] ?? 0) > 0);
    if (!candidates.length) return null;
    const room = (row) => (plan[row.key] ?? 0) - row.actualMinor;
    const best = [...candidates].sort((a, b) => room(b) - room(a))[0];
    const roundedUp = Math.ceil(-totals.left / 1000) * 1000;
    return { kind: "lower", rowKey: best.key, label: best.label, byMinor: Math.min(roundedUp, plan[best.key]) };
  }
  if (totals.left > 0) {
    const save = primarySaveRow(rows, locks);
    return save ? { kind: "save", rowKey: save.key, label: save.label, byMinor: totals.left } : null;
  }
  return null;
}

/** The savings row extra saving goes to: the largest editable, unlocked one. */
export function primarySaveRow(rows, locks = {}, plan = null) {
  const saves = rows.filter((row) => row.job === "save" && row.editable && !locks[row.key]);
  if (!saves.length) return null;
  const size = (row) => plan?.[row.key] ?? row.savedMinor;
  return [...saves].sort((a, b) => size(b) - size(a))[0];
}

/** Today's place in the month shown (the pace needs no clock of its own). */
export function dayOfMonthFor(month, todayIso) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const todayMonth = String(todayIso).slice(0, 7);
  if (todayMonth === month) {
    return { day: Number(String(todayIso).slice(8, 10)), daysInMonth, isCurrent: true };
  }
  return { day: todayMonth > month ? daysInMonth : 0, daysInMonth, isCurrent: false };
}

/**
 * What the plan expects to be spent on a row by today: all of it once its due
 * date has passed (rent, bills), none before; with no due date, a straight
 * line across the month. Saving and income have no pace (null).
 */
export function expectedByToday(row, plannedMinor, { day, daysInMonth }) {
  if (row.job === "save" || row.job === "income") return null;
  if (row.dueDay !== null) return day >= row.dueDay ? plannedMinor : 0;
  return Math.round((plannedMinor * day) / daysInMonth);
}

/** The usual spend by today across the spend rows, for the pace marker. */
export function expectedSpendByToday(rows, plan, when) {
  return rows
    .filter((row) => row.job === "spend")
    .reduce((sum, row) => sum + (expectedByToday(row, plan[row.key] ?? row.savedMinor, when) ?? 0), 0);
}

/** On track, a bit ahead of pace, or over plan (the larger of $100 and 5% is the margin). */
export function paceVerdict({ spentMinor, plannedSpendMinor, expectedMinor }) {
  if (spentMinor > plannedSpendMinor) {
    return { kind: "over", tone: "short", overByMinor: spentMinor - plannedSpendMinor, expectedMinor };
  }
  const margin = Math.max(10_000, Math.round(plannedSpendMinor * 0.05));
  if (spentMinor > expectedMinor + margin) {
    return { kind: "ahead", tone: "caution", aheadByMinor: spentMinor - expectedMinor, expectedMinor };
  }
  return { kind: "on_track", tone: "in", expectedMinor };
}

/**
 * Where one row stands against its plan, as a kind, a tone and an amount the
 * copy words. Savings are measured by money kept so far (the Month lead's
 * Saved), as the money jobs do.
 */
export function rowStatus(row, plannedMinor, { day, daysInMonth, keptMinor = 0 }) {
  const actual = row.actualMinor;
  if (row.job === "income") {
    if (actual >= plannedMinor) {
      return actual > plannedMinor
        ? { kind: "income_more", tone: "in", amountMinor: actual - plannedMinor }
        : { kind: "income_full", tone: "in", amountMinor: 0 };
    }
    return { kind: "income_to_come", tone: "plan", amountMinor: plannedMinor - actual };
  }
  if (row.job === "save") {
    return keptMinor >= plannedMinor
      ? { kind: "save_ahead", tone: "in", amountMinor: keptMinor - plannedMinor }
      : { kind: "save_to_go", tone: "plan", amountMinor: plannedMinor - keptMinor };
  }
  if (row.job === "invest") {
    return actual >= plannedMinor
      ? { kind: "invest_full", tone: "in", amountMinor: 0 }
      : { kind: "invest_to_move", tone: "plan", amountMinor: plannedMinor - actual };
  }
  if (actual > plannedMinor) return { kind: "spend_over", tone: "short", amountMinor: actual - plannedMinor };
  if (actual === 0) return { kind: "spend_nothing", tone: "plan", amountMinor: 0 };
  if (row.dueDay !== null) {
    return day >= row.dueDay && actual < plannedMinor
      ? { kind: "spend_to_pay", tone: "plan", amountMinor: plannedMinor - actual }
      : { kind: "spend_on_track", tone: "in", amountMinor: plannedMinor - actual };
  }
  const expected = expectedByToday(row, plannedMinor, { day, daysInMonth }) ?? 0;
  if (actual > expected + Math.max(4000, Math.round(plannedMinor * 0.08))) {
    return { kind: "spend_ahead", tone: "caution", amountMinor: actual - expected };
  }
  return { kind: "spend_left", tone: "in", amountMinor: plannedMinor - actual };
}

/**
 * A shared row's amount as each person's part, from the row's own split
 * ratios (the last person takes the odd cent). Empty for one person's row.
 */
export function sharedHalves(row, plannedMinor) {
  if (row.ownershipType !== "shared" || !row.splits?.length) return [];
  let assigned = 0;
  return row.splits.map((split, index) => {
    const isLast = index === row.splits.length - 1;
    const amountMinor = isLast ? plannedMinor - assigned : Math.ceil((plannedMinor * split.ratioBasisPoints) / 10_000);
    assigned += amountMinor;
    return { personName: split.personName, amountMinor };
  });
}
