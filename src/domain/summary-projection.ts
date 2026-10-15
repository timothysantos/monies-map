// Summary projection (H15e): the Summary page DTO, derived and empty summary
// months, actuals applied from entries, planned months per view, the summary
// range and donut months, and the accounts shown for a person.

import { buildPlanRowsForView } from "./month-projection";
import { incomeMinor, spendingMinor } from "./category-offset";
import { buildDonutChart } from "./donut-chart-projection";
import { flowTone, signTone, spendTone } from "./money-tone";
import { plannedInvestMinor } from "./money-job-plan";
import { loadMonthIncomeRows, loadMonthPlanRows } from "./app-repository-months";
import type {
  AccountDto,
  CategoryDto,
  EntryDto,
  InvestmentMovesDto,
  MetricCardDto,
  SummaryAccountPillDto,
  SummaryDonutMonthDto,
  SummaryMonthDto
} from "../types/dto";

// A month's planned totals from its current plan rows, with the investment
// goal (money-jobs.ts) beside them. The goal is summed into the Summary's
// "Planned investments" card and never sent per month.
export type PlannedSummaryMonth = SummaryMonthDto & { plannedInvestMinor?: number };

export function buildSummaryPage(
  personId: string,
  visibleEntries: EntryDto[],
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  plannedSummaryMonthsByView: Record<string, PlannedSummaryMonth[]>,
  categories: CategoryDto[],
  selectedMonth: string,
  summaryRangeMonths: string[],
  trackedMonths: string[],
  personNameById: Record<string, string>,
  // The view's transfers into and out of investment accounts over the
  // range (investment-moves.ts), left out when nothing moved, and the same
  // per month (only the months where something moved).
  investmentMoves?: InvestmentMovesDto,
  investmentMovesByMonth: Array<InvestmentMovesDto & { month: string }> = []
) {
  const snapshotMonths = buildSummaryMonthsForView(personId, summaryMonthsByView);
  const plannedFallbackMonths = plannedSummaryMonthsByView[personId] ?? [];
  const summaryMonthByKey = new Map(snapshotMonths.map((month) => [month.month, month]));
  const plannedFallbackMonthByKey = new Map(plannedFallbackMonths.map((month) => [month.month, month]));
  const availableMonths = Array.from(
    new Set([
      ...trackedMonths,
      ...snapshotMonths.map((month) => month.month),
      ...plannedFallbackMonths.map((month) => month.month)
    ])
  ).sort();
  const rangeMonths = summaryRangeMonths.length
    ? summaryRangeMonths.filter((month) => availableMonths.includes(month))
    : buildSummaryRange(availableMonths, undefined, selectedMonth);
  const months = rangeMonths.map((month) => {
    const base = summaryMonthByKey.get(month) ?? plannedFallbackMonthByKey.get(month) ?? buildEmptySummaryMonth(month);
    return applyActualsFromEntries(base, visibleEntries, month);
  });
  const plannedTotalMinor = sumMinor(months, "estimatedExpensesMinor");
  const actualTotalMinor = sumMinor(months, "realExpensesMinor");
  const plannedIncomeTotalMinor = sumMinor(months, "plannedIncomeMinor");
  const actualIncomeTotalMinor = sumMinor(months, "actualIncomeMinor");
  const targetSavingsMinor = sumMinor(months, "savingsGoalMinor");
  const realizedSavingsMinor = sumMinor(months, "realizedSavingsMinor");
  // The investment goal comes from the plan rows of the range's months (the
  // stored month totals have no field for it).
  const plannedInvestTotalMinor = rangeMonths.reduce(
    (sum, month) => sum + (plannedFallbackMonthByKey.get(month)?.plannedInvestMinor ?? 0),
    0
  );
  const metricCards: MetricCardDto[] = [
    {
      label: "Planned income",
      amountMinor: plannedIncomeTotalMinor,
      tone: "plan"
    },
    {
      label: "Actual income",
      amountMinor: actualIncomeTotalMinor,
      tone: flowTone(actualIncomeTotalMinor)
    },
    {
      label: "Planned spend",
      amountMinor: plannedTotalMinor,
      tone: "plan"
    },
    {
      label: "Actual spend",
      amountMinor: actualTotalMinor,
      tone: spendTone(actualTotalMinor, plannedTotalMinor)
    },
    {
      label: "Savings target",
      amountMinor: targetSavingsMinor,
      tone: "plan"
    },
    {
      label: "Realized savings",
      amountMinor: realizedSavingsMinor,
      tone: signTone(realizedSavingsMinor)
    },
    {
      label: "Planned investments",
      amountMinor: plannedInvestTotalMinor,
      tone: "plan"
    }
  ];

  return {
    metricCards,
    availableMonths,
    rangeStartMonth: rangeMonths[0] ?? selectedMonth,
    rangeEndMonth: rangeMonths[rangeMonths.length - 1] ?? selectedMonth,
    rangeMonths,
    months,
    categoryShareChart: buildDonutChart(visibleEntries, categories),
    categoryShareByMonth: buildSummaryDonutMonths(visibleEntries, categories, rangeMonths),
    ...(investmentMoves ? { investmentMoves } : {}),
    ...(investmentMovesByMonth.length ? { investmentMovesByMonth } : {}),
    notes:
      personId === "household"
        ? [
            "This app is not only asking what got spent. It is trying to show what was intended, what happened, and which assumption broke.",
            "Planned rows are meant for recurring or intentional commitments. Monthly budgets are the flexible layer for categories that should stay broad."
          ]
        : [
            `This view is filtered to ${personNameById[personId] ?? personId}. Shared actuals are weighted to this person's split share.`,
            "The planning model stays the same: intention first, transactions second."
          ]
  };
}

export function buildDerivedSummaryMonth(month: string, visibleEntries: EntryDto[]): SummaryMonthDto {
  const monthEntries = visibleEntries.filter((entry) => entry.date.slice(0, 7) === month);
  // A payback counts as less spending, not income (category-offset.ts).
  const actualIncomeMinor = monthEntries.reduce((sum, entry) => sum + incomeMinor(entry), 0);
  const realExpensesMinor = monthEntries.reduce((sum, entry) => sum + spendingMinor(entry), 0);

  return {
    month,
    plannedIncomeMinor: 0,
    actualIncomeMinor,
    estimatedExpensesMinor: 0,
    realExpensesMinor,
    savingsGoalMinor: 0,
    realizedSavingsMinor: actualIncomeMinor - realExpensesMinor,
    estimatedDiffMinor: 0,
    realDiffMinor: actualIncomeMinor - realExpensesMinor,
    note: "Month derived from tracked activity."
  };
}

export function buildEmptySummaryMonth(month: string): SummaryMonthDto {
  return {
    month,
    plannedIncomeMinor: 0,
    actualIncomeMinor: 0,
    estimatedExpensesMinor: 0,
    realExpensesMinor: 0,
    savingsGoalMinor: 0,
    realizedSavingsMinor: 0,
    estimatedDiffMinor: 0,
    realDiffMinor: 0,
    note: "Month derived from tracked activity."
  };
}

export function applyActualsFromEntries(
  snapshot: PlannedSummaryMonth,
  visibleEntries: EntryDto[],
  month: string
): SummaryMonthDto {
  const derived = buildDerivedSummaryMonth(month, visibleEntries);
  // A planned month's investment goal stays on the server (buildSummaryPage).
  const { plannedInvestMinor: _plannedInvest, ...summaryMonth } = snapshot;

  return {
    ...summaryMonth,
    actualIncomeMinor: derived.actualIncomeMinor,
    realExpensesMinor: derived.realExpensesMinor,
    realizedSavingsMinor: derived.actualIncomeMinor - derived.realExpensesMinor,
    realDiffMinor: derived.actualIncomeMinor - derived.realExpensesMinor
  };
}

export async function loadPlannedSummaryMonthsForViews(
  db: D1Database,
  viewIds: string[],
  months: string[]
): Promise<Record<string, PlannedSummaryMonth[]>> {
  const uniqueViewIds = [...new Set(viewIds)].filter(Boolean);
  const uniqueMonths = [...new Set(months)].filter(Boolean).sort();
  const monthPlanRowsByMonth = new Map(
    await Promise.all(uniqueMonths.map(async (month) => [month, await loadMonthPlanRows(db, month)] as const))
  );
  const incomeRowsByViewMonth = new Map(
    await Promise.all(
      uniqueViewIds.flatMap((viewId) => uniqueMonths.map(async (month) => ([
        `${viewId}:${month}`,
        await loadMonthIncomeRows(db, viewId, month)
      ] as const)))
    )
  );
  const result = Object.fromEntries(uniqueViewIds.map((viewId) => [viewId, [] as PlannedSummaryMonth[]]));

  for (const viewId of uniqueViewIds) {
    for (const month of uniqueMonths) {
      const monthPlanRows = monthPlanRowsByMonth.get(month) ?? [];
      const incomeRows = incomeRowsByViewMonth.get(`${viewId}:${month}`) ?? [];
      const visibleRows = buildPlanRowsForView(monthPlanRows, viewId);
      if (!visibleRows.length && !incomeRows.length) {
        continue;
      }

      const plannedIncomeMinor = incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
      const estimatedExpensesMinor = visibleRows.reduce((sum, row) => sum + row.plannedMinor, 0);
      const savingsGoalMinor = visibleRows
        .filter((row) => row.label === "Savings")
        .reduce((sum, row) => sum + row.plannedMinor, 0);

      result[viewId].push({
        month,
        plannedIncomeMinor,
        actualIncomeMinor: 0,
        estimatedExpensesMinor,
        realExpensesMinor: 0,
        savingsGoalMinor,
        realizedSavingsMinor: 0,
        estimatedDiffMinor: plannedIncomeMinor - estimatedExpensesMinor,
        realDiffMinor: 0,
        note: "Month derived from current planning rows.",
        plannedInvestMinor: plannedInvestMinor(visibleRows)
      });
    }
  }

  return result;
}

export function accountsForSummary(personId: string, accounts: AccountDto[]): SummaryAccountPillDto[] {
  return accounts
    .filter((account) => account.isActive)
    .filter((account) => (
      personId === "household"
        ? true
        : account.isJoint || account.ownerPersonId === personId
    ))
    .map((account) => ({
      accountId: account.id,
      accountName: account.name,
      ownerLabel: account.ownerLabel,
      balanceMinor: account.balanceMinor ?? 0,
      unresolvedTransferCount: account.unresolvedTransferCount ?? 0,
      latestCheckpointMonth: account.latestCheckpointMonth,
      latestCheckpointDeltaMinor: account.latestCheckpointDeltaMinor,
      reconciliationStatus: account.reconciliationStatus
    }));
}

export function buildSummaryMonthsForView(personId: string, summaryMonthsByView: Record<string, SummaryMonthDto[]>) {
  return summaryMonthsByView[personId] ?? summaryMonthsByView.household;
}

export function buildSummaryRange(
  availableMonths: string[],
  summaryStartMonth?: string,
  summaryEndMonth?: string,
  count = 12
) {
  const sortedMonths = [...availableMonths].sort();
  if (!sortedMonths.length) {
    return [];
  }

  const resolvedEndMonth = summaryEndMonth && sortedMonths.includes(summaryEndMonth)
    ? summaryEndMonth
    : sortedMonths[sortedMonths.length - 1];
  const anchorIndex = sortedMonths.indexOf(resolvedEndMonth);
  const requestedStartIndex = summaryStartMonth && sortedMonths.includes(summaryStartMonth)
    ? sortedMonths.indexOf(summaryStartMonth)
    : Math.max(0, anchorIndex - (count - 1));
  const startIndex = Math.min(requestedStartIndex, anchorIndex);
  return sortedMonths.slice(startIndex, anchorIndex + 1);
}

export function buildSummaryDonutMonths(
  entries: EntryDto[],
  categories: CategoryDto[],
  months: string[]
): SummaryDonutMonthDto[] {
  return months.map((month) => ({
    month,
    data: buildDonutChart(
      entries.filter((entry) => entry.date.slice(0, 7) === month),
      categories
    )
  }));
}

function sumMinor(months: SummaryMonthDto[], key: keyof Pick<
  SummaryMonthDto,
  "plannedIncomeMinor" | "actualIncomeMinor" | "estimatedExpensesMinor" | "realExpensesMinor" | "savingsGoalMinor" | "realizedSavingsMinor"
>) {
  return months.reduce((sum, month) => sum + month[key], 0);
}
