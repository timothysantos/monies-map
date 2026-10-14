import { isInvestmentsCategoryName, isSavingsCategoryName } from "../domain/money-jobs";
import { splitMoneyUse } from "./money-jobs-model";

// Summary's "Earned vs spent by month" (the Simple view's stand-in for
// Intent vs Outcome, summary-earned-spent.jsx): newest month first, each
// month's income, spending and what was kept or overspent, with no plan.
// Every month goes through the lead's split (splitMoneyUse): money filed
// under Investments is invested and money filed under Savings is kept, so a
// month's "Spent" is the Month page lead's "Spent". The figures are the
// Summary page's own month rows and per-month category share; nothing is
// fetched. The Summary page has transfers into investment accounts for the
// whole range only, so a month's invested here is its Investments category.
//
// `bar` is a thin bar on one scale per month (what was earned, or what went
// out when that is more): spent, the part of it past the income (it came
// out of savings, hatched), invested and kept, as percentages of the bar.
export function buildEarnedSpentMonths(months = [], categoryShareByMonth = []) {
  const shareByMonth = new Map(categoryShareByMonth.map((entry) => [entry.month, entry.data ?? []]));
  return [...months]
    .sort((left, right) => right.month.localeCompare(left.month))
    .map((month) => {
      let investedMinor = 0;
      let savedMovedMinor = 0;
      for (const slice of shareByMonth.get(month.month) ?? []) {
        if (isInvestmentsCategoryName(slice.label)) investedMinor += slice.valueMinor;
        else if (isSavingsCategoryName(slice.label)) savedMovedMinor += slice.valueMinor;
      }
      const figures = splitMoneyUse({
        incomeMinor: month.actualIncomeMinor,
        spentMinor: month.realExpensesMinor,
        investedMinor,
        savedMovedMinor
      });
      return {
        month: month.month,
        earnedMinor: figures.income,
        spentMinor: figures.spending,
        investedMinor: figures.invested,
        keptMinor: figures.kept,
        isOver: figures.kept < 0,
        spentPercent: figures.income > 0 ? Math.round((figures.spending * 100) / figures.income) : null,
        bar: buildBar(figures)
      };
    });
}

function buildBar({ income, spending, invested, kept }) {
  const scaleMinor = Math.max(income, spending + invested);
  if (scaleMinor === 0) {
    return [];
  }
  const percent = (minor) => Math.round((minor * 1000) / scaleMinor) / 10;
  return [
    { key: "spent", tone: "short", widthPercent: percent(Math.min(spending, income)) },
    { key: "savings", tone: "short", widthPercent: percent(Math.max(0, spending - income)), hatched: true },
    { key: "invested", tone: "in", widthPercent: percent(invested) },
    { key: "kept", tone: "in", widthPercent: percent(Math.max(0, kept)) }
  ].filter((part) => part.widthPercent > 0);
}
