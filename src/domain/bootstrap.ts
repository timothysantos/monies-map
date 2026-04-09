import { defaultDemoSettings, household as defaultHousehold } from "./demo-data";
import { loadDemoSettings } from "./demo-settings";
import {
  ensureSeedData,
  loadAccounts,
  loadCategories,
  loadEntries,
  loadEntriesForMonths,
  loadHousehold,
  loadImportBatches,
  loadAuditEvents,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  loadUnresolvedTransfers,
  loadSummaryMonths
} from "./app-repository";
import type {
  AccountDto,
  AppBootstrapDto,
  CategoryDto,
  ContextViewDto,
  DonutChartDatumDto,
  EntryDto,
  EntrySplitDto,
  MetricCardDto,
  MonthPageDto,
  MonthIncomeRowDto,
  MonthPlanRowDto,
  PersonScope,
  SummaryAccountPillDto,
  SummaryDonutMonthDto,
  SummaryMonthDto
} from "../types/dto";

export async function buildBootstrapDto(
  db: D1Database,
  selectedMonth = "2025-10",
  selectedScope: PersonScope = "direct_plus_shared",
  summaryStartMonth?: string,
  summaryEndMonth?: string
): Promise<AppBootstrapDto> {
  const demo = await loadDemoSettings(db).catch(() => defaultDemoSettings);
  if (demo.emptyState) {
    const emptyViews: ContextViewDto[] = [
      buildContextView("household", "Household", selectedScope, { household: [], "person-tim": [], "person-joyce": [] }, { household: [], "person-tim": [], "person-joyce": [] }, [], [], [], [], selectedMonth, []),
      buildContextView("person-tim", "Tim", selectedScope, { household: [], "person-tim": [], "person-joyce": [] }, { household: [], "person-tim": [], "person-joyce": [] }, [], [], [], [], selectedMonth, []),
      buildContextView("person-joyce", "Joyce", selectedScope, { household: [], "person-tim": [], "person-joyce": [] }, { household: [], "person-tim": [], "person-joyce": [] }, [], [], [], [], selectedMonth, [])
    ];

    return {
      household: defaultHousehold,
      accounts: [],
      categories: [],
      views: emptyViews,
      selectedViewId: "household",
      importsPage: {
        recentImports: [],
        rollbackPolicy: "No imports yet."
      },
      settingsPage: {
        demo,
        unresolvedTransfers: [],
        recentAuditEvents: []
      }
    };
  }
  await ensureSeedData(db, demo);
  const [household, accounts, categories, importBatches, monthEntries, monthPlanRows, unresolvedTransfers, recentAuditEvents] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadImportBatches(db),
    loadEntries(db, selectedMonth),
    loadMonthPlanRows(db, selectedMonth),
    loadUnresolvedTransfers(db),
    loadAuditEvents(db)
  ]);
  const [householdSummaryMonths, timSummaryMonths, joyceSummaryMonths, householdIncomeRows, timIncomeRows, joyceIncomeRows] = await Promise.all([
    loadSummaryMonths(db, "household"),
    loadSummaryMonths(db, "person-tim"),
    loadSummaryMonths(db, "person-joyce"),
    loadMonthIncomeRows(db, "household", selectedMonth),
    loadMonthIncomeRows(db, "person-tim", selectedMonth),
    loadMonthIncomeRows(db, "person-joyce", selectedMonth)
  ]);
  const summaryMonthsByView = {
    household: householdSummaryMonths,
    "person-tim": timSummaryMonths,
    "person-joyce": joyceSummaryMonths
  };
  const incomeRowsByView = {
    household: householdIncomeRows,
    "person-tim": timIncomeRows,
    "person-joyce": joyceIncomeRows
  };
  const summaryRangeMonths = buildSummaryRange(
    householdSummaryMonths.map((month) => month.month),
    summaryStartMonth,
    summaryEndMonth ?? selectedMonth
  );
  const summaryEntries = await loadEntriesForMonths(db, summaryRangeMonths);
  const views: ContextViewDto[] = [
    buildContextView("household", "Household", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, categories, accounts, selectedMonth, summaryRangeMonths),
    buildContextView("person-tim", "Tim", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, categories, accounts, selectedMonth, summaryRangeMonths),
    buildContextView("person-joyce", "Joyce", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, categories, accounts, selectedMonth, summaryRangeMonths)
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
    },
    settingsPage: {
      demo,
      unresolvedTransfers,
      recentAuditEvents
    }
  };
}

function buildContextView(
  id: string,
  label: string,
  selectedScope: PersonScope,
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  incomeRowsByView: Record<string, MonthIncomeRowDto[]>,
  summaryEntries: EntryDto[],
  monthEntries: EntryDto[],
  monthPlanRows: MonthPlanRowDto[],
  categories: CategoryDto[],
  accounts: AccountDto[],
  selectedMonth: string,
  summaryRangeMonths: string[]
): ContextViewDto {
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, id);
  const adjustedSummaryEntries = adjustEntriesForView(summaryEntries, id);
  const visibleEntries = filterEntriesForView(adjustedMonthEntries, id, selectedScope);
  const visibleSummaryEntries = filterEntriesForView(adjustedSummaryEntries, id, selectedScope);
  const currentSummaryMonth = (summaryMonthsByView[id] ?? []).find((month) => month.month === selectedMonth) ?? null;

  return {
    id,
    label,
    summaryPage: buildSummaryPage(id, visibleSummaryEntries, summaryMonthsByView, categories, accountsForSummary(id, accounts), selectedMonth, summaryRangeMonths),
    monthPage: buildMonthPage(
      id,
      selectedScope,
      incomeRowsByView[id] ?? [],
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      selectedMonth,
      currentSummaryMonth
    )
  };
}

function buildSummaryPage(
  personId: string,
  visibleEntries: EntryDto[],
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  categories: CategoryDto[],
  accountPills: SummaryAccountPillDto[],
  selectedMonth: string,
  summaryRangeMonths: string[]
) {
  const availableMonths = buildSummaryMonthsForView(personId, summaryMonthsByView).map((month) => month.month);
  const rangeMonths = summaryRangeMonths.length
    ? summaryRangeMonths.filter((month) => availableMonths.includes(month))
    : buildSummaryRange(availableMonths, undefined, selectedMonth);
  const months = buildSummaryMonthsForView(personId, summaryMonthsByView)
    .filter((month) => rangeMonths.includes(month.month));
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
    availableMonths,
    rangeStartMonth: rangeMonths[0] ?? selectedMonth,
    rangeEndMonth: rangeMonths[rangeMonths.length - 1] ?? selectedMonth,
    rangeMonths,
    months,
    categoryShareChart: buildDonutChart(visibleEntries, categories),
    categoryShareByMonth: buildSummaryDonutMonths(visibleEntries, categories, rangeMonths),
    accountPills,
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

function accountsForSummary(personId: string, accounts: AccountDto[]): SummaryAccountPillDto[] {
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

function buildMonthPage(
  selectedPersonId: string,
  selectedScope: PersonScope,
  incomeRows: MonthIncomeRowDto[],
  monthEntries: EntryDto[],
  monthPlanRows: MonthPlanRowDto[],
  categories: CategoryDto[],
  selectedMonth: string,
  currentSummaryMonth: SummaryMonthDto | null
): MonthPageDto {
  const effectiveScope = selectedPersonId === "household" ? "direct_plus_shared" : selectedScope;
  const visibleEntries = filterEntriesForView(monthEntries, selectedPersonId, effectiveScope);
  const visiblePlanRows = derivePlanRowActuals(
    buildPlanRowsForView(monthPlanRows, selectedPersonId, effectiveScope),
    visibleEntries
  );
  const visibleIncomeRows = effectiveScope === "shared"
    ? []
    : deriveIncomeRowActuals(incomeRows, visibleEntries, selectedPersonId);
  const plannedExpenseMinor = visiblePlanRows.reduce((sum, row) => sum + row.plannedMinor, 0);
  const actualExpenseMinor = currentSummaryMonth?.realExpensesMinor
    ?? visibleEntries.reduce((sum, entry) => entry.entryType === "expense" ? sum + entry.amountMinor : sum, 0);
  const varianceMinor = plannedExpenseMinor - actualExpenseMinor;
  const targetSavingsMinor = visiblePlanRows
    .filter((row) => row.label === "Savings")
    .reduce((sum, row) => sum + row.plannedMinor, 0);

  return {
    month: selectedMonth,
    selectedPersonId,
    selectedScope: effectiveScope,
    scopes: selectedPersonId === "household"
      ? [{ key: "direct_plus_shared", label: "Combined" }]
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
    monthNote: currentSummaryMonth?.note ?? "",
    incomeRows: visibleIncomeRows,
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
    categoryShareChart: buildDonutChart(visibleEntries, categories),
    entries: monthEntries
  };
}

function deriveIncomeRowActuals(
  rows: MonthIncomeRowDto[],
  entries: EntryDto[],
  personId: string
) {
  return rows.map((row) => {
    const rowCategory = normalizeCategoryLabel(row.categoryName);
    const actualMinor = entries.reduce((sum, entry) => {
      if (entry.entryType !== "income") {
        return sum;
      }

      if (personId !== "household" && row.ownerName && entry.ownerName && row.ownerName !== entry.ownerName) {
        return sum;
      }

      const entryCategory = normalizeCategoryLabel(entry.categoryName);
      if (rowCategory && rowCategory !== "income" && entryCategory !== rowCategory) {
        return sum;
      }

      return sum + entry.amountMinor;
    }, 0);

    return {
      ...row,
      actualMinor
    };
  });
}

function derivePlanRowActuals(rows: MonthPlanRowDto[], entries: EntryDto[]) {
  const plannedActualsByCategory = rows.reduce((map, row) => {
    if (row.section !== "planned_items") {
      return map;
    }

    const key = normalizeCategoryLabel(row.categoryName);
    if (!key) {
      return map;
    }

    map.set(key, (map.get(key) ?? 0) + row.actualMinor);
    return map;
  }, new Map<string, number>());

  return rows.map((row) => {
    if (row.section !== "budget_buckets") {
      return row;
    }

    const rowCategory = normalizeCategoryLabel(row.categoryName);
    const categoryActualMinor = entries.reduce((sum, entry) => {
      if (entry.entryType !== "expense") {
        return sum;
      }

      return normalizeCategoryLabel(entry.categoryName) === rowCategory
        ? sum + entry.amountMinor
        : sum;
    }, 0);
    const actualMinor = Math.max(0, categoryActualMinor - (plannedActualsByCategory.get(rowCategory) ?? 0));

    return {
      ...row,
      actualMinor
    };
  });
}

function normalizeCategoryLabel(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function buildSummaryMonthsForView(personId: string, summaryMonthsByView: Record<string, SummaryMonthDto[]>) {
  return summaryMonthsByView[personId] ?? summaryMonthsByView.household;
}

function buildSummaryRange(
  availableMonths: string[],
  summaryStartMonth?: string,
  summaryEndMonth?: string,
  count = 13
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

function buildSummaryDonutMonths(
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

function buildPlanRowsForView(rows: MonthPlanRowDto[], personId: string, scope: PersonScope): MonthPlanRowDto[] {
  const visibleRows = rows
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

function adjustEntriesForView(entries: EntryDto[], personId: string): EntryDto[] {
  return entries.map((entry) => adjustEntryForView(entry, personId));
}

function adjustEntryForView(entry: EntryDto, personId: string): EntryDto {
  if (personId === "household" || entry.ownershipType !== "shared") {
    return entry;
  }

  const matchingSplit = entry.splits.find((split) => split.personId === personId);
  if (!matchingSplit) {
    return entry;
  }

  return {
    ...entry,
    amountMinor: matchingSplit.amountMinor,
    totalAmountMinor: entry.amountMinor,
    viewerSplitRatioBasisPoints: matchingSplit.ratioBasisPoints
  };
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
    return {
      ...row,
      isDerived: row.isDerived ?? false,
      sourceRowIds: row.sourceRowIds ?? [row.id]
    };
  }

  const matchingSplit = row.splits.find((split) => split.personId === personId);
  if (!matchingSplit) {
    return {
      ...row,
      isDerived: row.isDerived ?? false,
      sourceRowIds: row.sourceRowIds ?? [row.id]
    };
  }

  const ratio = matchingSplit.ratioBasisPoints / 10000;
  return {
    ...row,
    plannedMinor: Math.round(row.plannedMinor * ratio),
    actualMinor: matchingSplit.amountMinor,
    note: `${row.note ?? "Shared row"} • weighted to ${matchingSplit.personName}'s share`,
    isDerived: true,
    sourceRowIds: row.sourceRowIds ?? [row.id]
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
        ownerName: undefined,
        isDerived: false,
        sourceRowIds: row.sourceRowIds ?? [row.id]
      });
      continue;
    }

    grouped.set(key, {
      ...existing,
      id: `combined:${key}`,
      plannedMinor: existing.plannedMinor + row.plannedMinor,
      actualMinor: existing.actualMinor + row.actualMinor,
      ownershipType: existing.ownershipType === "shared" || row.ownershipType === "shared" ? "shared" : "direct",
      note: mergeNotes(existing.note, row.note),
      splits: [...existing.splits, ...row.splits],
      isDerived: true,
      sourceRowIds: [...(existing.sourceRowIds ?? [existing.id]), ...(row.sourceRowIds ?? [row.id])]
    });
  }

  return [...grouped.values()];
}

function mergeNotes(left?: string, right?: string) {
  const unique = new Set([left, right].filter(Boolean));
  return unique.size ? [...unique].join(" | ") : undefined;
}

function buildDonutChart(entries: EntryDto[], categories: CategoryDto[]): DonutChartDatumDto[] {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.entryType !== "expense") {
      continue;
    }

    totals.set(entry.categoryName, (totals.get(entry.categoryName) ?? 0) + entry.amountMinor);
    counts.set(entry.categoryName, (counts.get(entry.categoryName) ?? 0) + 1);
  }

  return [...totals.entries()]
    .map(([label, valueMinor]) => {
      const category = categories.find((item) => item.name === label);
      return {
      key: label,
      categoryId: category?.id,
      label,
      valueMinor,
      entryCount: counts.get(label) ?? 0
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
