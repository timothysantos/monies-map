import { categories as defaultCategories, defaultDemoSettings, household as defaultHousehold, type DemoSettings } from "./demo-data";
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
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  loadAuditEvents,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  loadReconciliationExceptions,
  findSuggestedLoginPersonId,
  loadMonthIncomeRows,
  loadMonthPlanRows,
  resolveLoginIdentityPersonId,
  loadTrackedMonths,
  loadUnresolvedTransfers,
  seedEmptyStateReferenceData,
  loadSummaryMonths,
} from "./app-repository";
import type {
  AccountDto,
  AppShellDto,
  EntriesShellDto,
  CategoryDto,
  ContextViewDto,
  DonutChartDatumDto,
  EntriesPageDto,
  EntryDto,
  EntrySplitDto,
  ImportsPageDto,
  MetricCardDto,
  MonthPageDto,
  MonthIncomeRowDto,
  MonthPlanRowDto,
  SettingsPageDto,
  SplitActivityDto,
  SplitExpenseDto,
  SplitGroupDto,
  SplitGroupPillDto,
  SplitMatchCandidateDto,
  SplitSettlementDto,
  SplitsPageDto,
  PersonScope,
  SummaryAccountPillDto,
  SummaryDonutMonthDto,
  SummaryPageDto,
  SummaryMonthDto
} from "../types/dto";

let appDataReadyPromise: Promise<DemoSettings> | null = null;

export function invalidateAppDataCache() {
  appDataReadyPromise = null;
}

export async function loadAppShellContext(
  db: D1Database,
  viewerEmail?: string,
  appEnvironment?: EntriesShellDto["appEnvironment"]
): Promise<AppShellDto> {
  // Load the global shell metadata without pulling any route-specific page
  // payloads into the shell response.
  const [household, accounts, categories, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadTrackedMonths(db)
  ]);
  const viewerPersonId = await resolveLoginIdentityPersonId(db, viewerEmail);
  const suggestedPersonId = viewerEmail && !viewerPersonId
    ? await findSuggestedLoginPersonId(db)
    : undefined;

  return {
    appEnvironment,
    household,
    accounts,
    categories,
    availableViewIds: ["household", ...household.people.map((person) => person.id)],
    selectedViewId: "household",
    trackedMonths,
    viewerPersonId,
    viewerIdentity: viewerEmail ? {
      email: viewerEmail,
      personId: viewerPersonId
    } : undefined,
    viewerRegistration: viewerEmail && suggestedPersonId ? {
      email: viewerEmail,
      suggestedPersonId
    } : undefined
  };
}

export async function ensureAppData(db: D1Database) {
  appDataReadyPromise ??= initializeAppData(db);
  try {
    return await appDataReadyPromise;
  } catch (error) {
    appDataReadyPromise = null;
    throw error;
  }
}

async function initializeAppData(db: D1Database) {
  const demo = await loadDemoSettings(db).catch(() => defaultDemoSettings);
  await ensureDemoSchema(db);
  if (demo.emptyState) {
    await seedEmptyStateReferenceData(db);
  } else {
    await ensureSeedData(db, demo);
  }
  return demo;
}

export async function loadPageShell(db: D1Database, selectedViewId: string) {
  await ensureAppData(db);
  const [household, accounts, categories, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadTrackedMonths(db)
  ]);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const label = viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";

  return {
    household,
    accounts,
    categories,
    trackedMonths,
    viewId,
    label,
    personNameById
  };
}

export function buildEntriesContextView(
  id: string,
  label: string,
  entries: EntryDto[],
  splitGroups: SplitGroupDto[],
  selectedMonth: string,
  availableMonths: string[]
): ContextViewDto {
  return {
    id,
    label,
    summaryPage: {
      metricCards: [],
      availableMonths,
      rangeStartMonth: selectedMonth,
      rangeEndMonth: selectedMonth,
      rangeMonths: [selectedMonth],
      months: [buildEmptySummaryMonth(selectedMonth)],
      categoryShareChart: [],
      categoryShareByMonth: [],
      accountPills: [],
      notes: []
    },
    monthPage: {
      month: selectedMonth,
      selectedPersonId: id,
      selectedScope: "direct_plus_shared",
      scopes: buildPersonScopes(id),
      metricCards: [],
      monthNote: "",
      incomeRows: [],
      planSections: [],
      categoryShareChart: [],
      entries
    },
    splitsPage: {
      month: selectedMonth,
      groups: buildEntriesSplitShellGroups(splitGroups),
      activity: [],
      matches: [],
      donutChart: []
    }
  };
}

function buildEntriesSplitShellGroups(splitGroups: SplitGroupDto[]): SplitGroupPillDto[] {
  return [
    {
      id: "split-group-none",
      name: "Non-group expenses",
      iconKey: "receipt",
      balanceMinor: 0,
      summaryText: "",
      entryCount: 0,
      pendingMatchCount: 0,
      isDefault: false
    },
    ...splitGroups.map((group) => ({
      id: group.id,
      name: group.name,
      iconKey: group.iconKey,
      balanceMinor: 0,
      summaryText: "",
      entryCount: 0,
      pendingMatchCount: 0,
      isDefault: false
    }))
  ];
}

export function buildSummaryPage(
  personId: string,
  visibleEntries: EntryDto[],
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  plannedSummaryMonthsByView: Record<string, SummaryMonthDto[]>,
  categories: CategoryDto[],
  accountPills: SummaryAccountPillDto[],
  selectedMonth: string,
  summaryRangeMonths: string[],
  trackedMonths: string[],
  personNameById: Record<string, string>
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
  const metricCards: MetricCardDto[] = [
    {
      label: "Planned income",
      amountMinor: plannedIncomeTotalMinor,
      tone: "positive"
    },
    {
      label: "Actual income",
      amountMinor: actualIncomeTotalMinor,
      tone: "positive"
    },
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
            `This view is filtered to ${personNameById[personId] ?? personId}. Shared actuals are weighted to this person's split share.`,
            "The planning model stays the same: intention first, transactions second."
          ]
  };
}

export function buildDerivedSummaryMonth(month: string, visibleEntries: EntryDto[]): SummaryMonthDto {
  const monthEntries = visibleEntries.filter((entry) => entry.date.slice(0, 7) === month);
  const actualIncomeMinor = monthEntries
    .filter((entry) => entry.entryType === "income")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const realExpensesMinor = monthEntries
    .filter((entry) => entry.entryType === "expense")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);

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
  snapshot: SummaryMonthDto,
  visibleEntries: EntryDto[],
  month: string
): SummaryMonthDto {
  const derived = buildDerivedSummaryMonth(month, visibleEntries);

  return {
    ...snapshot,
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
): Promise<Record<string, SummaryMonthDto[]>> {
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
  const result = Object.fromEntries(uniqueViewIds.map((viewId) => [viewId, [] as SummaryMonthDto[]]));

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
        note: "Month derived from current planning rows."
      });
    }
  }

  return result;
}

export function buildSplitsPage(
  viewId: string,
  splitGroups: SplitGroupDto[],
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
  const groupMap = new Map<string, { id: string; name: string; iconKey?: string; sortOrder?: number; balanceMinor: number; entryCount: number; pendingMatchCount: number }>();

  groupMap.set("split-group-none", {
    id: "split-group-none",
    name: "Non-group expenses",
    iconKey: "receipt",
    sortOrder: -1,
    balanceMinor: 0,
    entryCount: 0,
    pendingMatchCount: 0
  });

  // Persisted groups must exist in the UI even before their first split entry.
  for (const group of splitGroups) {
    groupMap.set(group.id, {
      id: group.id,
      name: group.name,
      iconKey: group.iconKey ?? "receipt",
      sortOrder: group.sortOrder,
      balanceMinor: 0,
      entryCount: 0,
      pendingMatchCount: 0
    });
  }

  for (const expense of visibleExpenses) {
    const groupId = expense.groupId ?? "split-group-none";
    const current = groupMap.get(groupId) ?? {
      id: groupId,
      name: expense.groupName,
      iconKey: iconKeyForCategory(expense.categoryName, categories),
      sortOrder: Number.MAX_SAFE_INTEGER,
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
      sortOrder: Number.MAX_SAFE_INTEGER,
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
      sortOrder: Number.MAX_SAFE_INTEGER,
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
      return Math.abs(right.balanceMinor) - Math.abs(left.balanceMinor)
        || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
        || left.name.localeCompare(right.name);
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

  const nonGroup = groups.find((group) => group.id === "split-group-none");
  const defaultGroupId = (nonGroup && nonGroup.entryCount > 0 ? nonGroup.id : undefined)
    ?? groups.find((group) => group.id !== "split-group-none" && group.entryCount > 0 && group.balanceMinor !== 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none" && group.entryCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none" && group.pendingMatchCount > 0)?.id
    ?? groups.find((group) => group.id !== "split-group-none")?.id
    ?? (nonGroup && (nonGroup.entryCount > 0 || nonGroup.pendingMatchCount > 0) ? nonGroup.id : undefined)
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

export function buildMonthPage(
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
    buildPlanRowsForView(monthPlanRows, selectedPersonId),
    visibleEntries,
    selectedPersonId
  );
  const visibleIncomeRows = deriveIncomeRowActuals(incomeRows, visibleEntries, selectedPersonId);
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
    scopes: buildPersonScopes(selectedPersonId),
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

export function buildPersonScopes(selectedPersonId: string): Array<{ key: PersonScope; label: string }> {
  return selectedPersonId === "household"
    ? [{ key: "direct_plus_shared", label: "Combined" }]
    : [
        { key: "direct", label: "Direct ownership" },
        { key: "shared", label: "Shared" },
        { key: "direct_plus_shared", label: "Direct + Shared" }
      ];
}

export function deriveIncomeRowActuals(
  rows: MonthIncomeRowDto[],
  entries: EntryDto[],
  personId: string
) {
  return rows.map((row) => {
    const rowCategory = normalizeCategoryLabel(row.categoryName);
    const actualEntries = entries.filter((entry) => {
      if (entry.entryType !== "income") {
        return false;
      }

      if (personId !== "household" && row.ownerName && entry.ownerName && row.ownerName !== entry.ownerName) {
        return false;
      }

      const entryCategory = normalizeCategoryLabel(entry.categoryName);
      if (rowCategory && rowCategory !== "income" && entryCategory !== rowCategory) {
        return false;
      }

      return true;
    });
    const actualMinor = actualEntries.reduce((sum, entry) => sum + entry.amountMinor, 0);

    return {
      ...row,
      actualMinor,
      actualEntryIds: actualEntries.map((entry) => entry.id)
    };
  });
}

export function derivePlanRowActuals(rows: MonthPlanRowDto[], entries: EntryDto[], viewerPersonId: string) {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const rowsWithLinkedActuals = rows.map((row) => {
    if (row.section !== "planned_items") {
      return row;
    }

    if (!row.linkedEntryIds?.length) {
      return {
        ...row,
        actualMinor: 0,
        linkedEntryCount: 0,
        actualEntryIds: []
      };
    }

    const linkedEntries = row.linkedEntryIds
      .map((entryId) => entriesById.get(entryId))
      .filter((entry): entry is EntryDto => Boolean(entry) && entry.entryType === "expense");
    const actualMinor = linkedEntries.reduce((sum, entry) => {
      return sum + getVisibleLinkedEntryAmountMinor(entry, viewerPersonId);
    }, 0);

    return {
      ...row,
      actualMinor,
      linkedEntryCount: row.linkedEntryIds.length,
      actualEntryIds: linkedEntries.map((entry) => entry.id)
    };
  });

  const linkedExpenseIdsByCategory = rowsWithLinkedActuals.reduce((map, row) => {
    if (row.section !== "planned_items" || !row.actualEntryIds?.length) {
      return map;
    }

    for (const entryId of row.actualEntryIds) {
      const entry = entriesById.get(entryId);
      if (!entry || entry.entryType !== "expense") {
        continue;
      }
      const key = normalizeCategoryLabel(entry.categoryName);
      if (!key) {
        continue;
      }
      const existing = map.get(key) ?? new Set<string>();
      existing.add(entry.id);
      map.set(key, existing);
    }
    return map;
  }, new Map<string, Set<string>>());

  return rowsWithLinkedActuals.map((row) => {
    if (row.section !== "budget_buckets") {
      return row;
    }

    const rowCategory = normalizeCategoryLabel(row.categoryName);
    const linkedExpenseIds = linkedExpenseIdsByCategory.get(rowCategory) ?? new Set<string>();
    const actualEntries = entries.filter((entry) => {
      if (normalizeCategoryLabel(entry.categoryName) !== rowCategory) {
        return false;
      }

      if (entry.entryType === "expense") {
        return !linkedExpenseIds.has(entry.id);
      }

      if (entry.entryType === "income" && entry.offsetsCategory) {
        return true;
      }

      return false;
    });
    const categoryActualMinor = actualEntries.reduce((sum, entry) => {
      if (entry.entryType === "expense") {
        return sum + entry.amountMinor;
      }
      if (entry.entryType === "income" && entry.offsetsCategory) {
        return sum - entry.amountMinor;
      }
      return sum;
    }, 0);
    const actualMinor = Math.max(0, categoryActualMinor);

    return {
      ...row,
      actualMinor,
      actualEntryIds: actualEntries.map((entry) => entry.id)
    };
  });
}

export function getVisibleLinkedEntryAmountMinor(entry: EntryDto, viewerPersonId: string) {
  if (viewerPersonId === "household" || entry.ownershipType !== "shared") {
    return entry.amountMinor;
  }

  const matchingSplit = entry.splits.find((split) => split.personId === viewerPersonId);
  return matchingSplit?.amountMinor ?? entry.amountMinor;
}

export function normalizeCategoryLabel(value?: string) {
  return (value ?? "").trim().toLowerCase();
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

export function buildPlanRowsForView(rows: MonthPlanRowDto[], personId: string): MonthPlanRowDto[] {
  if (personId === "household") {
    return combineHouseholdPlanRows(rows.map((row) => normalizePlanRowForView(row)));
  }

  return rows
    .filter((row) => row.personId === personId || row.splits.some((split) => split.personId === personId))
    .map((row) => normalizePlanRowForView(row));
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

export function adjustEntriesForView(entries: EntryDto[], personId: string): EntryDto[] {
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

function normalizePlanRowForView(row: MonthPlanRowDto): MonthPlanRowDto {
  return {
    ...row,
    note: stripWeightedPlanNoteText(row.note),
    isDerived: row.isDerived ?? false,
    sourceRowIds: row.sourceRowIds ?? [row.id],
    sourcePlannedMinor: row.sourcePlannedMinor ?? row.plannedMinor,
    sourceNote: stripWeightedPlanNoteText(row.sourceNote ?? row.note),
    actualEntryIds: row.actualEntryIds ?? [],
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
        sourcePlannedMinor: row.sourcePlannedMinor ?? row.plannedMinor,
        sourceNote: row.sourceNote ?? row.note,
        actualEntryIds: row.actualEntryIds ?? [],
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
      sourcePlannedMinor: undefined,
      sourceNote: undefined,
      linkedEntryIds: [...(existing.linkedEntryIds ?? []), ...(row.linkedEntryIds ?? [])],
      linkedEntryCount: (existing.linkedEntryCount ?? existing.linkedEntryIds?.length ?? 0) + (row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0),
      actualEntryIds: [...(existing.actualEntryIds ?? []), ...(row.actualEntryIds ?? [])],
      planMatchHints: [...(existing.planMatchHints ?? []), ...(row.planMatchHints ?? [])]
    });
  }

  return [...grouped.values()];
}

function mergeNotes(left?: string, right?: string) {
  const unique = new Set([left, right].filter(Boolean));
  return unique.size ? [...unique].join(" | ") : undefined;
}

function stripWeightedPlanNoteText(note?: string) {
  return (note ?? "")
    .replace(/\s*• weighted to .*? share/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || undefined;
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
  const [primaryShare, partnerShare] = expense.shares;
  const primaryShareMinor = primaryShare?.amountMinor ?? 0;
  const partnerShareMinor = partnerShare?.amountMinor ?? 0;
  const primaryPersonId = primaryShare?.personId ?? "";
  const partnerPersonId = partnerShare?.personId ?? "";
  const balanceFromPrimaryPerspective = expense.payerPersonId === primaryPersonId ? partnerShareMinor : -primaryShareMinor;
  if (viewId === partnerPersonId) {
    return -balanceFromPrimaryPerspective;
  }
  return balanceFromPrimaryPerspective;
}

function splitSettlementBalanceForView(settlement: SplitSettlementDto, viewId: string) {
  if (viewId === settlement.toPersonId) {
    return settlement.amountMinor;
  }

  if (viewId === settlement.fromPersonId) {
    return -settlement.amountMinor;
  }

  return settlement.amountMinor;
}

function formatSplitBalanceSummary(balanceMinor: number, viewId: string, personNameById: Record<string, string>) {
  if (balanceMinor === 0) {
    return "Settled up";
  }

  const abs = formatCompactMoney(balanceMinor);
  if (viewId === "household") {
    return `Net balance ${abs}`;
  }

  const [primaryPersonId, partnerPersonId] = getOrderedPersonIds(personNameById);
  const primaryName = personNameById[primaryPersonId] ?? "Primary";
  const secondaryName = personNameById[partnerPersonId] ?? "Partner";
  if (viewId === primaryPersonId) {
    return balanceMinor > 0 ? `${secondaryName} owes you ${abs}` : `You owe ${secondaryName} ${abs}`;
  }

  if (viewId === partnerPersonId) {
    return balanceMinor > 0 ? `${primaryName} owes you ${abs}` : `You owe ${primaryName} ${abs}`;
  }

  return balanceMinor > 0 ? `${secondaryName} owes ${primaryName} ${abs}` : `${primaryName} owes ${secondaryName} ${abs}`;
}

function getOrderedPersonIds(personNameById: Record<string, string>) {
  const personIds = Object.keys(personNameById);
  return [personIds[0] ?? "person-primary", personIds[1] ?? "person-partner"];
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
    const editableShare = canonicalEditableExpenseShare(expense, personNameById);
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
      editableSplitPersonName: editableShare?.personName,
      editableSplitBasisPoints: editableShare?.ratioBasisPoints,
      editableSplitAmountMinor: editableShare?.amountMinor,
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

  const viewerShare = expense.shares.find((share) => share.personId === viewId)?.amountMinor ?? 0;
  if (expense.payerPersonId === viewId) {
    return expense.totalAmountMinor - viewerShare;
  }

  return viewerShare;
}

function canonicalEditableExpenseShare(expense: SplitExpenseDto, personNameById: Record<string, string>) {
  const [primaryPersonId] = getOrderedPersonIds(personNameById);
  return expense.shares.find((share) => share.personId === primaryPersonId) ?? expense.shares[0];
}

function formatExpenseDirectionLabel(expense: SplitExpenseDto, viewId: string, personNameById: Record<string, string>) {
  if (viewId === "household") {
    return "";
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
    .sort((left, right) => right.valueMinor - left.valueMinor);
}

function sumMinor(months: SummaryMonthDto[], key: keyof Pick<
  SummaryMonthDto,
  "plannedIncomeMinor" | "actualIncomeMinor" | "estimatedExpensesMinor" | "realExpensesMinor" | "savingsGoalMinor" | "realizedSavingsMinor"
>) {
  return months.reduce((sum, month) => sum + month[key], 0);
}
