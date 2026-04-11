import { categories as defaultCategories, defaultDemoSettings, household as defaultHousehold } from "./demo-data";
import { loadDemoSettings } from "./demo-settings";
import { getCurrentMonthKey } from "../lib/month";
import {
  ensureDemoSchema,
  ensureSeedData,
  loadAccounts,
  loadCategories,
  loadEntries,
  loadEntriesForMonths,
  loadHousehold,
  loadImportBatches,
  loadSplitExpenses,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  loadAuditEvents,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  loadTrackedMonths,
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
  SplitActivityDto,
  SplitExpenseDto,
  SplitGroupPillDto,
  SplitMatchCandidateDto,
  SplitSettlementDto,
  PersonScope,
  SummaryAccountPillDto,
  SummaryDonutMonthDto,
  SummaryMonthDto
} from "../types/dto";

export async function buildBootstrapDto(
  db: D1Database,
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared",
  summaryStartMonth?: string,
  summaryEndMonth?: string
): Promise<AppBootstrapDto> {
  const demo = await loadDemoSettings(db).catch(() => defaultDemoSettings);
  await ensureDemoSchema(db);
  if (!demo.emptyState) {
    await ensureSeedData(db, demo);
  }
  const [household, accounts, categories, importBatches, trackedMonths, unresolvedTransfers, recentAuditEvents] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadImportBatches(db),
    loadTrackedMonths(db),
    loadUnresolvedTransfers(db),
    loadAuditEvents(db)
  ]);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const [monthEntries, monthPlanRows, splitExpenses, splitSettlements, splitMatches] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth),
    loadSplitExpenses(db, effectiveSelectedMonth),
    loadSplitSettlements(db, effectiveSelectedMonth),
    loadSplitMatchCandidates(db, effectiveSelectedMonth)
  ]);
  const [householdSummaryMonths, timSummaryMonths, joyceSummaryMonths, householdIncomeRows, timIncomeRows, joyceIncomeRows] = await Promise.all([
    loadSummaryMonths(db, "household"),
    loadSummaryMonths(db, "person-tim"),
    loadSummaryMonths(db, "person-joyce"),
    loadMonthIncomeRows(db, "household", effectiveSelectedMonth),
    loadMonthIncomeRows(db, "person-tim", effectiveSelectedMonth),
    loadMonthIncomeRows(db, "person-joyce", effectiveSelectedMonth)
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
    trackedMonths,
    summaryStartMonth,
    summaryEndMonth ?? effectiveSelectedMonth
  );
  const summaryEntries = await loadEntriesForMonths(db, summaryRangeMonths);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const views: ContextViewDto[] = [
    buildContextView("household", "Household", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, splitExpenses, splitSettlements, splitMatches, categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById),
    buildContextView("person-tim", personNameById["person-tim"] ?? defaultHousehold.people[0]?.name ?? "Primary", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, splitExpenses, splitSettlements, splitMatches, categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById),
    buildContextView("person-joyce", personNameById["person-joyce"] ?? defaultHousehold.people[1]?.name ?? "Partner", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, splitExpenses, splitSettlements, splitMatches, categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById)
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
  splitExpenses: SplitExpenseDto[],
  splitSettlements: SplitSettlementDto[],
  splitMatches: SplitMatchCandidateDto[],
  categories: CategoryDto[],
  accounts: AccountDto[],
  selectedMonth: string,
  summaryRangeMonths: string[],
  trackedMonths: string[],
  personNameById: Record<string, string>
): ContextViewDto {
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, id);
  const adjustedSummaryEntries = adjustEntriesForView(summaryEntries, id);
  const visibleEntries = filterEntriesForView(adjustedMonthEntries, id, selectedScope);
  const visibleSummaryEntries = filterEntriesForView(adjustedSummaryEntries, id, selectedScope);
  const currentSummaryMonth = (summaryMonthsByView[id] ?? []).find((month) => month.month === selectedMonth) ?? null;

  return {
    id,
    label,
    summaryPage: buildSummaryPage(id, visibleSummaryEntries, summaryMonthsByView, categories, accountsForSummary(id, accounts), selectedMonth, summaryRangeMonths, trackedMonths, personNameById),
    monthPage: buildMonthPage(
      id,
      selectedScope,
      incomeRowsByView[id] ?? [],
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      selectedMonth,
      currentSummaryMonth
    ),
    splitsPage: buildSplitsPage(id, splitExpenses, splitSettlements, splitMatches, categories, selectedMonth, personNameById)
  };
}

function buildSummaryPage(
  personId: string,
  visibleEntries: EntryDto[],
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  categories: CategoryDto[],
  accountPills: SummaryAccountPillDto[],
  selectedMonth: string,
  summaryRangeMonths: string[],
  trackedMonths: string[],
  personNameById: Record<string, string>
) {
  const snapshotMonths = buildSummaryMonthsForView(personId, summaryMonthsByView);
  const summaryMonthByKey = new Map(snapshotMonths.map((month) => [month.month, month]));
  const availableMonths = Array.from(new Set([...trackedMonths, ...snapshotMonths.map((month) => month.month)])).sort();
  const rangeMonths = summaryRangeMonths.length
    ? summaryRangeMonths.filter((month) => availableMonths.includes(month))
    : buildSummaryRange(availableMonths, undefined, selectedMonth);
  const months = rangeMonths.map((month) => summaryMonthByKey.get(month) ?? buildDerivedSummaryMonth(month, visibleEntries));
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
            `This view is filtered to ${personNameById[personId] ?? personId}. Shared rows are weighted to this person's split share.`,
            "The planning model stays the same: intention first, transactions second."
          ]
  };
}

function buildDerivedSummaryMonth(month: string, visibleEntries: EntryDto[]): SummaryMonthDto {
  const monthEntries = visibleEntries.filter((entry) => entry.date.slice(0, 7) === month);
  const incomeMinor = monthEntries
    .filter((entry) => entry.entryType === "income")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const realExpensesMinor = monthEntries
    .filter((entry) => entry.entryType === "expense")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);

  return {
    month,
    incomeMinor,
    estimatedExpensesMinor: 0,
    realExpensesMinor,
    savingsGoalMinor: 0,
    realizedSavingsMinor: incomeMinor - realExpensesMinor,
    estimatedDiffMinor: incomeMinor,
    realDiffMinor: incomeMinor - realExpensesMinor,
    note: "Month derived from tracked activity."
  };
}

function buildSplitsPage(
  viewId: string,
  splitExpenses: SplitExpenseDto[],
  splitSettlements: SplitSettlementDto[],
  splitMatches: SplitMatchCandidateDto[],
  categories: CategoryDto[],
  selectedMonth: string,
  personNameById: Record<string, string>
) {
  const visibleExpenses = splitExpenses.filter((expense) => splitExpenseMatchesView(expense, viewId));
  const visibleSettlements = splitSettlements.filter((settlement) => splitSettlementMatchesView(settlement, viewId));
  const openExpenses = visibleExpenses.filter((expense) => !expense.batchClosedAt);
  const openSettlements = visibleSettlements.filter((settlement) => !settlement.batchClosedAt);
  const groupMap = new Map<string, { id: string; name: string; iconKey?: string; balanceMinor: number; entryCount: number; pendingMatchCount: number }>();

  groupMap.set("split-group-none", {
    id: "split-group-none",
    name: "Non-group expenses",
    iconKey: "receipt",
    balanceMinor: 0,
    entryCount: 0,
    pendingMatchCount: 0
  });

  for (const expense of visibleExpenses) {
    const groupId = expense.groupId ?? "split-group-none";
    const current = groupMap.get(groupId) ?? {
      id: groupId,
      name: expense.groupName,
      iconKey: iconKeyForCategory(expense.categoryName, categories),
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0
    };
    groupMap.set(groupId, current);
  }

  for (const settlement of visibleSettlements) {
    const groupId = settlement.groupId ?? "split-group-none";
    const current = groupMap.get(groupId) ?? {
      id: groupId,
      name: settlement.groupName,
      iconKey: "arrow-right-left",
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0
    };
    groupMap.set(groupId, current);
  }

  for (const expense of openExpenses) {
    const groupId = expense.groupId ?? "split-group-none";
    const current = groupMap.get(groupId);
    if (!current) {
      continue;
    }
    current.balanceMinor += splitExpenseBalanceForView(expense, viewId);
    current.entryCount += 1;
  }

  for (const settlement of openSettlements) {
    const groupId = settlement.groupId ?? "split-group-none";
    const current = groupMap.get(groupId);
    if (!current) {
      continue;
    }
    current.balanceMinor -= splitSettlementBalanceForView(settlement, viewId);
    current.entryCount += 1;
  }

  for (const match of splitMatches.filter((item) => splitMatchMatchesView(item, visibleExpenses, visibleSettlements, viewId))) {
    const current = groupMap.get(match.groupId) ?? {
      id: match.groupId,
      name: match.groupName,
      iconKey: "receipt",
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0
    };
    current.pendingMatchCount += 1;
    groupMap.set(match.groupId, current);
  }

  const groups: SplitGroupPillDto[] = [...groupMap.values()]
    .sort((left, right) => {
      if (left.id === "split-group-none") {
        return -1;
      }
      if (right.id === "split-group-none") {
        return 1;
      }
      return Math.abs(right.balanceMinor) - Math.abs(left.balanceMinor) || left.name.localeCompare(right.name);
    })
    .map((group) => ({
      id: group.id,
      name: group.name,
      iconKey: group.iconKey,
      balanceMinor: group.balanceMinor,
      summaryText: formatSplitBalanceSummary(group.balanceMinor, viewId, personNameById),
      entryCount: group.entryCount,
      pendingMatchCount: group.pendingMatchCount,
      isDefault: false
    }));

  const defaultGroupId = groups.find((group) => group.id !== "split-group-none" && group.entryCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none" && group.pendingMatchCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none")?.id
    ?? groups.find((group) => group.id === "split-group-none" && (group.entryCount > 0 || group.pendingMatchCount > 0))?.id
    ?? "split-group-none";

  const activity: SplitActivityDto[] = buildSplitActivity(viewId, visibleExpenses, visibleSettlements, personNameById);
  const donutChart = buildDonutChart(
    openExpenses.map((expense) => ({
      id: expense.id,
      date: expense.date,
      description: expense.description,
      accountName: expense.groupName,
      categoryName: expense.categoryName,
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: viewerExpenseAmountForChart(expense, viewId),
      offsetsCategory: false,
      splits: expense.shares
    })),
    categories
  );

  return {
    month: selectedMonth,
    groups: groups.map((group) => ({ ...group, isDefault: group.id === defaultGroupId })),
    activity,
    matches: splitMatches.filter((item) => splitMatchMatchesView(item, visibleExpenses, visibleSettlements, viewId)),
    donutChart
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
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const rowsWithLinkedActuals = rows.map((row) => {
    if (row.section !== "planned_items" || !row.linkedEntryIds?.length) {
      return row;
    }

    const actualMinor = row.linkedEntryIds.reduce((sum, entryId) => {
      const entry = entriesById.get(entryId);
      if (!entry || entry.entryType !== "expense") {
        return sum;
      }
      return sum + entry.amountMinor;
    }, 0);

    return {
      ...row,
      actualMinor,
      linkedEntryCount: row.linkedEntryIds.length
    };
  });

  const plannedActualsByCategory = rowsWithLinkedActuals.reduce((map, row) => {
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

  return rowsWithLinkedActuals.map((row) => {
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
      sourceRowIds: row.sourceRowIds ?? [row.id],
      linkedEntryIds: row.linkedEntryIds ?? [],
      linkedEntryCount: row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0,
      planMatchHints: row.planMatchHints ?? []
    };
  }

  const matchingSplit = row.splits.find((split) => split.personId === personId);
  if (!matchingSplit) {
    return {
      ...row,
      isDerived: row.isDerived ?? false,
      sourceRowIds: row.sourceRowIds ?? [row.id],
      linkedEntryIds: row.linkedEntryIds ?? [],
      linkedEntryCount: row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0,
      planMatchHints: row.planMatchHints ?? []
    };
  }

  const ratio = matchingSplit.ratioBasisPoints / 10000;
  return {
    ...row,
    plannedMinor: Math.round(row.plannedMinor * ratio),
    actualMinor: matchingSplit.amountMinor,
    note: `${row.note ?? "Shared row"} • weighted to ${matchingSplit.personName}'s share`,
    isDerived: true,
    sourceRowIds: row.sourceRowIds ?? [row.id],
    linkedEntryIds: row.linkedEntryIds ?? [],
    linkedEntryCount: row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0,
    planMatchHints: row.planMatchHints ?? []
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
        sourceRowIds: row.sourceRowIds ?? [row.id],
        planMatchHints: row.planMatchHints ?? []
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
      sourceRowIds: [...(existing.sourceRowIds ?? [existing.id]), ...(row.sourceRowIds ?? [row.id])],
      linkedEntryIds: [...(existing.linkedEntryIds ?? []), ...(row.linkedEntryIds ?? [])],
      linkedEntryCount: (existing.linkedEntryCount ?? existing.linkedEntryIds?.length ?? 0) + (row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0),
      planMatchHints: [...(existing.planMatchHints ?? []), ...(row.planMatchHints ?? [])]
    });
  }

  return [...grouped.values()];
}

function mergeNotes(left?: string, right?: string) {
  const unique = new Set([left, right].filter(Boolean));
  return unique.size ? [...unique].join(" | ") : undefined;
}

function splitExpenseMatchesView(expense: SplitExpenseDto, viewId: string) {
  if (viewId === "household") {
    return true;
  }

  return expense.shares.some((share) => share.personId === viewId);
}

function splitSettlementMatchesView(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === "household") {
    return true;
  }

  return settlement.fromPersonId === viewId || settlement.toPersonId === viewId;
}

function splitMatchMatchesView(
  match: SplitMatchCandidateDto,
  expenses: SplitExpenseDto[],
  settlements: SplitSettlementDto[],
  viewId: string
) {
  if (viewId === "household") {
    return true;
  }

  if (match.kind === "expense") {
    const expense = expenses.find((item) => item.id === match.splitRecordId);
    return expense ? splitExpenseMatchesView(expense, viewId) : false;
  }

  const settlement = settlements.find((item) => item.id === match.splitRecordId);
  return settlement ? splitSettlementMatchesView(settlement, viewId) : false;
}

function splitExpenseBalanceForView(expense: SplitExpenseDto, viewId: string) {
  const timShare = expense.shares.find((share) => share.personId === "person-tim")?.amountMinor ?? 0;
  const joyceShare = expense.shares.find((share) => share.personId === "person-joyce")?.amountMinor ?? 0;
  const balanceFromTimPerspective = expense.payerPersonId === "person-tim" ? joyceShare : -timShare;
  if (viewId === "person-joyce") {
    return -balanceFromTimPerspective;
  }
  return balanceFromTimPerspective;
}

function splitSettlementBalanceForView(settlement: SplitSettlementDto, viewId: string) {
  const balanceFromTimPerspective = settlement.fromPersonId === "person-joyce"
    ? settlement.amountMinor
    : -settlement.amountMinor;
  if (viewId === "person-joyce") {
    return -balanceFromTimPerspective;
  }
  return balanceFromTimPerspective;
}

function formatSplitBalanceSummary(balanceMinor: number, viewId: string, personNameById: Record<string, string>) {
  if (balanceMinor === 0) {
    return "Settled up";
  }

  const abs = formatCompactMoney(balanceMinor);
  const primaryName = personNameById["person-tim"] ?? "Primary";
  const secondaryName = personNameById["person-joyce"] ?? "Partner";
  if (viewId === "person-tim") {
    return balanceMinor > 0 ? `${secondaryName} owes you ${abs}` : `You owe ${secondaryName} ${abs}`;
  }

  if (viewId === "person-joyce") {
    return balanceMinor > 0 ? `${primaryName} owes you ${abs}` : `You owe ${primaryName} ${abs}`;
  }

  return balanceMinor > 0 ? `${secondaryName} owes ${primaryName} ${abs}` : `${primaryName} owes ${secondaryName} ${abs}`;
}

function buildSplitActivity(
  viewId: string,
  expenses: SplitExpenseDto[],
  settlements: SplitSettlementDto[],
  personNameById: Record<string, string>
): SplitActivityDto[] {
  const activity: SplitActivityDto[] = [];

  for (const expense of expenses) {
    const viewerShare = viewerExpenseAmountForChart(expense, viewId);
    activity.push({
      id: expense.id,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      batchId: expense.batchId,
      batchLabel: expense.batchLabel,
      batchClosedAt: expense.batchClosedAt,
      isArchived: Boolean(expense.batchClosedAt),
      date: expense.date,
      description: expense.description,
      categoryName: expense.categoryName,
      paidByPersonName: expense.payerPersonName,
      totalAmountMinor: expense.totalAmountMinor,
      viewerAmountMinor: viewerShare,
      viewerDirectionLabel: formatExpenseDirectionLabel(expense, viewId, personNameById),
      note: expense.note,
      linkedTransactionId: expense.linkedTransactionId,
      linkedTransactionDescription: expense.linkedTransactionDescription,
      matched: Boolean(expense.linkedTransactionId)
    });
  }

  for (const settlement of settlements) {
    activity.push({
      id: settlement.id,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      batchId: settlement.batchId,
      batchLabel: settlement.batchLabel,
      batchClosedAt: settlement.batchClosedAt,
      isArchived: Boolean(settlement.batchClosedAt),
      date: settlement.date,
      description: "Settle up",
      fromPersonName: settlement.fromPersonName,
      toPersonName: settlement.toPersonName,
      totalAmountMinor: settlement.amountMinor,
      viewerDirectionLabel: formatSettlementDirectionLabel(settlement, viewId),
      note: settlement.note,
      linkedTransactionId: settlement.linkedTransactionId,
      linkedTransactionDescription: settlement.linkedTransactionDescription,
      matched: Boolean(settlement.linkedTransactionId)
    });
  }

  return activity.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

function viewerExpenseAmountForChart(expense: SplitExpenseDto, viewId: string) {
  if (viewId === "household") {
    return expense.totalAmountMinor;
  }

  return expense.shares.find((share) => share.personId === viewId)?.amountMinor ?? 0;
}

function formatExpenseDirectionLabel(expense: SplitExpenseDto, viewId: string, personNameById: Record<string, string>) {
  if (viewId === "household") {
    const balance = splitExpenseBalanceForView(expense, "household");
    const primaryName = personNameById["person-tim"] ?? "Primary";
    const secondaryName = personNameById["person-joyce"] ?? "Partner";
    return balance === 0 ? "shared evenly" : balance > 0 ? `${primaryName} covered more` : `${secondaryName} covered more`;
  }

  if (expense.payerPersonId === viewId) {
    return "you lent";
  }

  return "you borrowed";
}

function formatSettlementDirectionLabel(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === "household") {
    return `${settlement.fromPersonName} paid ${settlement.toPersonName}`;
  }

  if (settlement.fromPersonId === viewId) {
    return "you paid";
  }

  return "you received";
}

function iconKeyForCategory(categoryName: string, categories: CategoryDto[]) {
  return categories.find((category) => category.name === categoryName)?.iconKey ?? "receipt";
}

function formatCompactMoney(valueMinor: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(Math.abs(valueMinor) / 100);
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
