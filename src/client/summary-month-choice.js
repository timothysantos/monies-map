// The Summary tab's month choice: "All months" (the Summary page for the
// header's range) or one month of that range (the Month page). The URL is the
// source of truth: All months is /summary, a picked month is /month?month=…,
// and both carry the range as summary_start and summary_end. Pinning the
// range when a month is picked keeps it fixed while months change, because a
// Summary request without explicit bounds anchors its range on `month`.
//
// Pure helpers only, shared by the phone island, the month sheet and the
// desktop month selector (summary-month-picker.jsx, summary-month-sheet.jsx).
import { spendTone } from "../domain/money-tone";

const RANGE_PARAMS = ["summary_start", "summary_end"];

// Where a month choice goes. `month` is "YYYY-MM", or "" for All months.
// `range` is the range on screen ({ startMonth, endMonth }); without it the
// URL keeps whatever range it already had. summary_focus belonged to the
// Spending Mix month chips, which the month choice replaced, so it is dropped.
export function buildSummaryMonthChoiceLocation(search, month, range = null) {
  const next = new URLSearchParams(search);
  if (range?.startMonth && range?.endMonth) {
    next.set("summary_start", range.startMonth);
    next.set("summary_end", range.endMonth);
  }
  next.delete("summary_focus");
  if (month) {
    next.set("month", month);
  }
  return {
    pathname: month ? "/month" : "/summary",
    search: `?${next.toString()}`
  };
}

// The range bounds a URL pins, or null when the range is implicit.
export function readPinnedSummaryRange(searchParams) {
  const [startMonth, endMonth] = RANGE_PARAMS.map((key) => searchParams.get(key) ?? "");
  return startMonth && endMonth ? { startMonth, endMonth } : null;
}

// The month one step before or after `month` within the range, or "" at
// either end (and when `month` is not in the range).
export function stepMonthInRange(rangeMonths, month, direction) {
  const index = rangeMonths.indexOf(month);
  if (index === -1) {
    return "";
  }
  return rangeMonths[index + direction] ?? "";
}

// Keep a picked month inside a new range: a month that fell out moves to the
// nearest month the range still has.
export function clampMonthToRange(month, rangeMonths) {
  if (!rangeMonths.length || rangeMonths.includes(month)) {
    return month;
  }
  if (month < rangeMonths[0]) {
    return rangeMonths[0];
  }
  if (month > rangeMonths[rangeMonths.length - 1]) {
    return rangeMonths[rangeMonths.length - 1];
  }
  // A month inside the range's span but without data: the latest month before it.
  return rangeMonths.filter((candidate) => candidate < month).at(-1) ?? rangeMonths[0];
}

// Spend against plan for one month or the whole range: actual spend, planned
// spend, how full the bar is (capped at 100) and the money tone (rose only
// over plan, src/domain/money-tone.ts).
function spendAgainstPlan(actualMinor, plannedMinor) {
  const barPercent = plannedMinor > 0
    ? Math.min(100, Math.round((actualMinor / plannedMinor) * 100))
    : actualMinor > 0 ? 100 : 0;
  const tone = spendTone(actualMinor, plannedMinor);
  return { actualMinor, plannedMinor, barPercent, tone, isOver: tone === "short" };
}

// The "Pick a month" sheet's figures from the Summary page DTO months (one per
// range month): the All months card, then the months grouped by year, newest
// year and month first.
export function buildMonthSheetModel(months = []) {
  const total = spendAgainstPlan(
    months.reduce((sum, month) => sum + (month.realExpensesMinor ?? 0), 0),
    months.reduce((sum, month) => sum + (month.estimatedExpensesMinor ?? 0), 0)
  );
  const byYear = new Map();
  for (const month of [...months].sort((left, right) => right.month.localeCompare(left.month))) {
    const year = month.month.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, []);
    }
    byYear.get(year).push({
      month: month.month,
      ...spendAgainstPlan(month.realExpensesMinor ?? 0, month.estimatedExpensesMinor ?? 0)
    });
  }
  return {
    total,
    years: [...byYear.entries()].map(([year, yearMonths]) => ({ year, months: yearMonths }))
  };
}
