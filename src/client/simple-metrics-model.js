import { isInvestmentsCategoryName, isSavingsCategoryName } from "../domain/money-jobs";

// The Simple view's few facts under the savings bar (design.md "Plan or
// Simple"): things worth knowing that need no plan, all about what already
// happened, never a forecast or a figure to spend. What was kept and its
// share of income (or how much more went out than came in) is the savings
// bar's own line just above, so it is not repeated here.
// - dailySpend: the period's spending over its days so far (the whole
//   period once it has ended; up to today while it is going);
// - topCategories: the three biggest spending categories and their share
//   of spending (money filed under Investments or Savings is not spending).
// Every figure is the lead's own split (`figures`, splitMoneyUse) and the
// period's category share, already on the page. `today` is YYYY-MM-DD.
// Returns null when nothing was earned or spent.
export function buildSimpleMetrics({ figures, categoryShare = [], startMonth, endMonth, today }) {
  const { income, spending } = figures;
  if (income === 0 && spending === 0) {
    return null;
  }
  const days = elapsedDays(startMonth, endMonth, today);
  const slices = categoryShare
    .filter((slice) => slice.valueMinor > 0 && !isInvestmentsCategoryName(slice.label) && !isSavingsCategoryName(slice.label))
    .sort((left, right) => right.valueMinor - left.valueMinor);
  const sliceTotal = slices.reduce((sum, slice) => sum + slice.valueMinor, 0);
  return {
    dailySpend: days.count > 0 && spending > 0 ? { amountMinor: Math.round(spending / days.count), days: days.count, soFar: days.soFar } : null,
    topCategories: slices.slice(0, 3).map((slice) => ({
      name: slice.label,
      percent: Math.round((slice.valueMinor * 100) / sliceTotal)
    }))
  };
}

const DAY_MS = 86_400_000;
const dayNumber = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;

// The days from the first of `startMonth` to the last of `endMonth`, or to
// today while the period is still going; none when it has not started.
export function elapsedDays(startMonth, endMonth, today) {
  if (!startMonth || !endMonth || !today) {
    return { count: 0, soFar: false };
  }
  const first = dayNumber(`${startMonth}-01`);
  const [year, month] = endMonth.split("-").map(Number);
  const last = Date.UTC(year, month, 0) / DAY_MS;
  const now = dayNumber(today);
  const soFar = now < last;
  return { count: Math.max(0, Math.min(now, last) - first + 1), soFar };
}
