import {
  accounts,
  categories,
  household,
  importBatches,
  monthEntries,
  monthPlanRows,
  summaryMonths,
  summaryMonthsByView
} from "./demo-data";
import type {
  AppBootstrapDto,
  ContextViewDto,
  DonutChartDatumDto,
  EntryDto,
  EntrySplitDto,
  MetricCardDto,
  MonthPageDto,
  MonthPlanRowDto,
  PersonScope,
  SummaryMonthDto
} from "../types/dto";

export function buildBootstrapDto(): AppBootstrapDto {
  const selectedScope: PersonScope = "direct_plus_shared";
  const views: ContextViewDto[] = [
    buildContextView("household", "Household", selectedScope),
    buildContextView("person-tim", "Tim", selectedScope),
    buildContextView("person-joyce", "Joyce", selectedScope)
  ];

  return {
    household,
    accounts,
    categories,
    views,
    selectedViewId: "household",
    importsPage: {
      recentImports: importBatches,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}

function buildContextView(id: string, label: string, selectedScope: PersonScope): ContextViewDto {
  const visibleEntries = filterEntriesForView(monthEntries, id, selectedScope);

  return {
    id,
    label,
    summaryPage: buildSummaryPage(id, visibleEntries),
    monthPage: buildMonthPage(id, selectedScope)
  };
}

function buildSummaryPage(personId: string, visibleEntries: EntryDto[]) {
  const months = buildSummaryMonthsForView(personId);
  const plannedTotalMinor = sumMinor(months, "estimatedExpensesMinor");
  const actualTotalMinor = sumMinor(months, "realExpensesMinor");
  const targetSavingsMinor = sumMinor(months, "savingsGoalMinor");
  const realizedSavingsMinor = sumMinor(months, "realizedSavingsMinor");
  const metricCards: MetricCardDto[] = [
    {
      label: "Planned spend",
      amountMinor: plannedTotalMinor
    },
    {
      label: "Actual spend",
      amountMinor: actualTotalMinor,
      tone: actualTotalMinor > plannedTotalMinor ? "negative" : "positive"
    },
    {
      label: "Savings target",
      amountMinor: targetSavingsMinor
    },
    {
      label: "Realized savings",
      amountMinor: realizedSavingsMinor,
      tone: realizedSavingsMinor >= 0 ? "positive" : "negative"
    }
  ];

  return {
    metricCards,
    months,
    categoryShareChart: buildDonutChart(visibleEntries),
    notes:
      personId === "household"
        ? [
            "This app is not only asking what got spent. It is trying to show what was intended, what happened, and which assumption broke.",
            "Planned rows are meant for recurring or intentional commitments. Budget buckets are the flexible layer for categories that should stay broad."
          ]
        : [
            `This view is filtered to ${personId === "person-tim" ? "Tim" : "Joyce"}. Shared rows are weighted to this person's split share.`,
            "The planning model stays the same: intention first, transactions second."
          ]
  };
}

function buildMonthPage(selectedPersonId: string, selectedScope: PersonScope): MonthPageDto {
  const visibleEntries = filterEntriesForView(monthEntries, selectedPersonId, selectedScope);
  const visiblePlanRows = buildPlanRowsForView(selectedPersonId, selectedScope);
  const plannedExpenseMinor = visiblePlanRows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const actualExpenseMinor = visiblePlanRows.reduce((sum, row) => sum + row.actualMinor, 0);
  const varianceMinor = plannedExpenseMinor - actualExpenseMinor;
  const targetSavingsMinor = visiblePlanRows
    .filter((row) => row.label === "Savings")
    .reduce((sum, row) => sum + row.plannedMinor, 0);

  return {
    month: "2025-10",
    selectedPersonId,
    selectedScope,
    scopes: selectedPersonId === "household"
      ? [
          { key: "direct_plus_shared", label: "Combined" },
          { key: "shared", label: "Shared" }
        ]
      : [
          { key: "direct", label: "Direct ownership" },
          { key: "shared", label: "Shared" },
          { key: "direct_plus_shared", label: "Direct + Shared" }
        ],
    metricCards: [
      {
        label: "Planned spend",
        amountMinor: plannedExpenseMinor
      },
      {
        label: "Actual spend",
        amountMinor: actualExpenseMinor,
        tone: actualExpenseMinor > plannedExpenseMinor ? "negative" : "positive"
      },
      {
        label: "Variance",
        amountMinor: varianceMinor,
        tone: varianceMinor >= 0 ? "positive" : "negative",
        detail: varianceMinor >= 0 ? "Under plan" : "Over plan"
      },
      {
        label: "Savings target",
        amountMinor: targetSavingsMinor
      }
    ],
    planSections: [
      {
        key: "planned_items",
        label: "Planned Items",
        description: "Intentional commitments and recurring obligations for the month.",
        rows: visiblePlanRows.filter((row) => row.section === "planned_items")
      },
      {
        key: "budget_buckets",
        label: "Budget Buckets",
        description: "Flexible categories where the plan is a budget, not a merchant-by-merchant script.",
        rows: visiblePlanRows.filter((row) => row.section === "budget_buckets")
      }
    ],
    categoryShareChart: buildDonutChart(visibleEntries),
    notes: [
      selectedPersonId === "household"
        ? "The household monthly view combines person-owned plan rows with shared plan rows into one unioned household plan."
        : `${selectedPersonId === "person-tim" ? "Tim" : "Joyce"} sees only direct rows plus weighted shared rows in this demo.`,
      "Over-granular planning would mean budgeting too many unstable one-off merchants individually instead of leaving them inside a broader bucket."
    ],
    entries: visibleEntries
  };
}

function buildSummaryMonthsForView(personId: string) {
  return summaryMonthsByView[personId] ?? summaryMonths;
}

function buildPlanRowsForView(personId: string, scope: PersonScope): MonthPlanRowDto[] {
  const visibleRows = monthPlanRows
    .filter((row) => rowMatchesView(row.ownershipType, row.splits, personId, scope))
    .map((row) => adjustPlanRowForView(row, personId));

  if (personId === "household" && scope === "direct_plus_shared") {
    return combineHouseholdPlanRows(visibleRows);
  }

  return visibleRows;
}

function filterEntriesForView(entries: EntryDto[], personId: string, scope: PersonScope): EntryDto[] {
  if (personId === "household") {
    if (scope === "shared") {
      return entries.filter((entry) => entry.ownershipType === "shared");
    }

    if (scope === "direct") {
      return entries.filter((entry) => entry.ownershipType === "direct");
    }

    return entries;
  }

  return entries.filter((entry) => rowMatchesView(entry.ownershipType, entry.splits, personId, scope));
}

function rowMatchesView(
  ownershipType: "direct" | "shared",
  splits: EntrySplitDto[],
  personId: string,
  scope: PersonScope
) {
  if (personId === "household") {
    return scope === "shared"
      ? ownershipType === "shared"
      : scope === "direct"
        ? ownershipType === "direct"
        : true;
  }

  if (scope === "shared") {
    return ownershipType === "shared" && splits.some((split) => split.personId === personId);
  }

  if (scope === "direct") {
    return ownershipType === "direct" && splits.some((split) => split.personId === personId);
  }

  return splits.some((split) => split.personId === personId);
}

function adjustPlanRowForView(row: MonthPlanRowDto, personId: string): MonthPlanRowDto {
  if (personId === "household" || row.ownershipType === "direct") {
    return row;
  }

  const matchingSplit = row.splits.find((split) => split.personId === personId);
  if (!matchingSplit) {
    return row;
  }

  const ratio = matchingSplit.ratioBasisPoints / 10000;
  return {
    ...row,
    plannedMinor: Math.round(row.plannedMinor * ratio),
    actualMinor: matchingSplit.amountMinor,
    note: `${row.note ?? "Shared row"} • weighted to ${matchingSplit.personName}'s share`
  };
}

function combineHouseholdPlanRows(rows: MonthPlanRowDto[]): MonthPlanRowDto[] {
  const grouped = new Map<string, MonthPlanRowDto>();

  for (const row of rows) {
    const key = [
      row.section,
      row.categoryName,
      row.label,
      row.dayLabel ?? "",
      row.accountName ?? ""
    ].join("::");

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        ownershipType: row.ownershipType === "shared" ? "shared" : "direct",
        ownerName: undefined
      });
      continue;
    }

    grouped.set(key, {
      ...existing,
      plannedMinor: existing.plannedMinor + row.plannedMinor,
      actualMinor: existing.actualMinor + row.actualMinor,
      ownershipType: existing.ownershipType === "shared" || row.ownershipType === "shared" ? "shared" : "direct",
      note: mergeNotes(existing.note, row.note),
      splits: [...existing.splits, ...row.splits]
    });
  }

  return [...grouped.values()];
}

function mergeNotes(left?: string, right?: string) {
  const unique = new Set([left, right].filter(Boolean));
  return unique.size ? [...unique].join(" | ") : undefined;
}

function buildDonutChart(entries: EntryDto[]): DonutChartDatumDto[] {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    if (entry.entryType !== "expense") {
      continue;
    }

    totals.set(entry.categoryName, (totals.get(entry.categoryName) ?? 0) + entry.amountMinor);
  }

  return [...totals.entries()]
    .map(([label, valueMinor]) => {
      const category = categories.find((item) => item.name === label);
      return {
      key: label,
      categoryId: category?.id,
      label,
      valueMinor
      };
    })
    .sort((left, right) => right.valueMinor - left.valueMinor)
    .slice(0, 5);
}

function sumMinor(months: SummaryMonthDto[], key: keyof Pick<
  SummaryMonthDto,
  "estimatedExpensesMinor" | "realExpensesMinor" | "savingsGoalMinor" | "realizedSavingsMinor"
>) {
  return months.reduce((sum, month) => sum + month[key], 0);
}
