import { flowTone, headroomTone, signTone, spendTone } from "../domain/money-tone";

// One month of Summary's Intent vs Outcome as a compact Lead · Support ·
// Detail card (design.md). The section compares what each month planned to
// spend with what it spent: the row it headlined was the spend variance and
// its two bars were planned and actual spend. So the lead is the month's
// actual spend against planned spend, and the "under/over plan" figure is
// that same variance. Income is Support; the old table's three rows (income,
// expected spend, savings goal: planned, actual, variance) are the Detail.
// Every figure is the Summary month DTO's own (SummaryMonthDto).
export function buildIntentMonthCard(month) {
  const plannedSpendMinor = month.estimatedExpensesMinor;
  const actualSpendMinor = month.realExpensesMinor;
  const spendVarianceMinor = plannedSpendMinor - actualSpendMinor;
  const incomeVarianceMinor = month.actualIncomeMinor - month.plannedIncomeMinor;
  const savingsVarianceMinor = month.realizedSavingsMinor - month.savingsGoalMinor;
  return {
    month: month.month,
    spent: { amountMinor: actualSpendMinor, tone: spendTone(actualSpendMinor, plannedSpendMinor) },
    plannedSpendMinor,
    percentOfPlan: plannedSpendMinor > 0 ? Math.round((actualSpendMinor / plannedSpendMinor) * 100) : null,
    // Nothing spent against no plan is neither under nor over.
    headroom: plannedSpendMinor > 0 || actualSpendMinor > 0
      ? { amountMinor: Math.abs(spendVarianceMinor), isOver: spendVarianceMinor < 0, tone: headroomTone(spendVarianceMinor) }
      : null,
    progress: { valueMinor: actualSpendMinor, planMinor: plannedSpendMinor },
    plannedIncomeMinor: month.plannedIncomeMinor,
    actualIncomeMinor: month.actualIncomeMinor,
    metrics: [
      {
        key: "income",
        plannedMinor: month.plannedIncomeMinor,
        actualMinor: month.actualIncomeMinor,
        actualTone: flowTone(month.actualIncomeMinor),
        varianceMinor: incomeVarianceMinor,
        varianceTone: headroomTone(incomeVarianceMinor)
      },
      {
        key: "spend",
        plannedMinor: plannedSpendMinor,
        actualMinor: actualSpendMinor,
        actualTone: spendTone(actualSpendMinor, plannedSpendMinor),
        varianceMinor: spendVarianceMinor,
        varianceTone: headroomTone(spendVarianceMinor)
      },
      {
        key: "savings",
        plannedMinor: month.savingsGoalMinor,
        actualMinor: month.realizedSavingsMinor,
        actualTone: signTone(month.realizedSavingsMinor),
        varianceMinor: savingsVarianceMinor,
        varianceTone: headroomTone(savingsVarianceMinor)
      }
    ],
    note: month.note ?? ""
  };
}
