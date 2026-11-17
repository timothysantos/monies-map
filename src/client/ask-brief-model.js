// Ask's "Since you last looked" figures (ask-brief-card.jsx). Lives in the
// Ask chunk, never the first screen's.
import { isInvestmentsCategoryName, isSavingsCategoryName } from "../domain/money-jobs";
import { splitMoneyUse } from "./money-jobs-model";

// One month of a Summary page DTO (summary-projection.ts) as its spend job
// reads it: spending without the money filed under Investments or Savings
// (the month's category share), against the plan without the savings target
// and the Investments plan rows (`plannedInvestByMonth`). The Month and
// Summary lead and Ask's plan answer ("of $X plan") say these, so Ask's
// "Since you last looked" does too (Ask audit A15: it used the whole plan,
// savings and investing included, and showed a second, larger plan for the
// same month). Null when the page has no row for the month.
export function summaryMonthSpendJob(summaryPage, monthKey) {
  const month = summaryPage?.months?.find((item) => item.month === monthKey);
  if (!month) {
    return null;
  }
  let investedMinor = 0;
  let savedMovedMinor = 0;
  for (const slice of summaryPage.categoryShareByMonth?.find((item) => item.month === monthKey)?.data ?? []) {
    if (isInvestmentsCategoryName(slice.label)) investedMinor += slice.valueMinor;
    else if (isSavingsCategoryName(slice.label)) savedMovedMinor += slice.valueMinor;
  }
  const figures = splitMoneyUse({
    incomeMinor: month.actualIncomeMinor ?? 0,
    spentMinor: month.realExpensesMinor ?? 0,
    investedMinor,
    savedMovedMinor,
    plannedSpendMinor: month.estimatedExpensesMinor ?? 0,
    savingsTargetMinor: month.savingsGoalMinor ?? 0,
    plannedInvestMinor: summaryPage.plannedInvestByMonth?.find((item) => item.month === monthKey)?.plannedInvestMinor ?? 0
  });
  return { spentMinor: figures.spending, planMinor: figures.spendPlan };
}
