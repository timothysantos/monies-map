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
  loadMonthIncomeRowsForViews,
  loadMonthPlanRows,
  resolveLoginIdentityPersonId,
  loadTrackedMonths,
  loadUnresolvedTransfers,
  seedEmptyStateReferenceData,
  loadSummaryMonths,
  loadSummaryMonthsForScopes
} from "./app-repository";
import type {
  AccountDto,
  AppBootstrapDto,
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

export async function buildBootstrapDto(
  db: D1Database,
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared",
  summaryStartMonth?: string,
  summaryEndMonth?: string,
  viewerEmail?: string,
  appEnvironment?: AppBootstrapDto["appEnvironment"]
): Promise<AppBootstrapDto> {
  const demo = await ensureAppData(db);
  const [household, accounts, categories, categoryMatchRuleSuggestions, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadCategoryMatchRuleSuggestions(db),
    loadTrackedMonths(db)
  ]);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const [monthEntries, monthPlanRows] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth)
  ]);
  const primaryPersonId = household.people[0]?.id ?? "person-primary";
  const partnerPersonId = household.people[1]?.id ?? "person-partner";
  const viewIds = ["household", primaryPersonId, partnerPersonId];
  const [summaryMonthsByView, incomeRowsByView] = await Promise.all([
    loadSummaryMonthsForScopes(db, viewIds),
    loadMonthIncomeRowsForViews(db, viewIds, effectiveSelectedMonth)
  ]);
  const summaryRangeMonths = buildSummaryRange(
    trackedMonths,
    summaryStartMonth,
    summaryEndMonth ?? effectiveSelectedMonth
  );
  const summaryEntries = await loadEntriesForMonths(db, summaryRangeMonths);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewerPersonId = await resolveLoginIdentityPersonId(db, viewerEmail);
  const suggestedPersonId = viewerEmail && !viewerPersonId
    ? await findSuggestedLoginPersonId(db)
    : undefined;
  const views: ContextViewDto[] = [
    buildContextView("household", "Household", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, [], [], [], [], categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById),
    buildContextView(primaryPersonId, personNameById[primaryPersonId] ?? "Primary", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, [], [], [], [], categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById),
    buildContextView(partnerPersonId, personNameById[partnerPersonId] ?? "Partner", selectedScope, summaryMonthsByView, incomeRowsByView, summaryEntries, monthEntries, monthPlanRows, [], [], [], [], categories, accounts, effectiveSelectedMonth, summaryRangeMonths, trackedMonths, personNameById)
  ];

  return {
    appEnvironment,
    household,
    accounts,
    categories,
    views,
    selectedViewId: "household",
    viewerPersonId,
    viewerIdentity: viewerEmail ? {
      email: viewerEmail,
      personId: viewerPersonId
    } : undefined,
    viewerRegistration: viewerEmail && suggestedPersonId ? {
      email: viewerEmail,
      suggestedPersonId
    } : undefined,
    importsPage: {
      recentImports: [],
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    },
    settingsPage: {
      demo,
      categoryMatchRules: [],
      categoryMatchRuleSuggestions,
      unresolvedTransfers: [],
      reconciliationExceptions: [],
      recentAuditEvents: []
    }
  };
}

export async function buildEntriesPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<EntriesPageDto> {
  await ensureAppData(db);

  const [household, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadTrackedMonths(db)
  ]);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const monthEntries = await loadEntries(db, effectiveSelectedMonth);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const label = viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";

  return {
    viewId,
    label,
    monthPage: {
      month: effectiveSelectedMonth,
      selectedPersonId: viewId,
      selectedScope: viewId === "household" ? "direct_plus_shared" : "direct_plus_shared",
      scopes: buildPersonScopes(viewId),
      entries: adjustEntriesForView(monthEntries, viewId)
    }
  };
}

export async function buildSummaryPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared",
  summaryStartMonth?: string,
  summaryEndMonth?: string
): Promise<{ viewId: string; label: string; summaryPage: SummaryPageDto }> {
  const { household, accounts, categories, trackedMonths, viewId, label, personNameById } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const summaryRangeMonths = buildSummaryRange(trackedMonths, summaryStartMonth, summaryEndMonth ?? effectiveSelectedMonth);
  const [summaryMonths, summaryEntries] = await Promise.all([
    loadSummaryMonths(db, viewId),
    loadEntriesForMonths(db, summaryRangeMonths)
  ]);
  const adjustedSummaryEntries = adjustEntriesForView(summaryEntries, viewId);
  const visibleSummaryEntries = filterEntriesForView(adjustedSummaryEntries, viewId, selectedScope);

  return {
    viewId,
    label,
    summaryPage: buildSummaryPage(
      viewId,
      visibleSummaryEntries,
      { [viewId]: summaryMonths },
      categories,
      accountsForSummary(viewId, accounts),
      effectiveSelectedMonth,
      summaryRangeMonths,
      trackedMonths,
      personNameById
    )
  };
}

export async function buildMonthPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  selectedScope: PersonScope = "direct_plus_shared"
): Promise<{ viewId: string; label: string; summaryPage: Pick<SummaryPageDto, "months">; monthPage: MonthPageDto; householdMonthEntries: EntryDto[] }> {
  const { categories, trackedMonths, viewId, label } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const [monthEntries, monthPlanRows, incomeRows, summaryMonths] = await Promise.all([
    loadEntries(db, effectiveSelectedMonth),
    loadMonthPlanRows(db, effectiveSelectedMonth),
    loadMonthIncomeRows(db, viewId, effectiveSelectedMonth),
    loadSummaryMonths(db, viewId)
  ]);
  const adjustedMonthEntries = adjustEntriesForView(monthEntries, viewId);
  const visibleEntries = filterEntriesForView(adjustedMonthEntries, viewId, viewId === "household" ? "direct_plus_shared" : selectedScope);
  const currentSnapshotMonth = summaryMonths.find((month) => month.month === effectiveSelectedMonth) ?? null;
  const currentSummaryMonth = currentSnapshotMonth
    ? applyActualsFromEntries(currentSnapshotMonth, visibleEntries, effectiveSelectedMonth)
    : buildDerivedSummaryMonth(effectiveSelectedMonth, visibleEntries);

  return {
    viewId,
    label,
    summaryPage: { months: [currentSummaryMonth] },
    monthPage: buildMonthPage(
      viewId,
      selectedScope,
      incomeRows,
      adjustedMonthEntries,
      monthPlanRows,
      categories,
      effectiveSelectedMonth,
      currentSummaryMonth
    ),
    householdMonthEntries: monthEntries
  };
}

export async function buildSplitsPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<{ viewId: string; label: string; splitsPage: SplitsPageDto }> {
  const { categories, trackedMonths, viewId, label, personNameById } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const [splitGroups, splitExpenses, splitSettlements, splitMatches] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db, effectiveSelectedMonth),
    loadSplitSettlements(db, effectiveSelectedMonth),
    loadSplitMatchCandidates(db, effectiveSelectedMonth)
  ]);

  return {
    viewId,
    label,
    splitsPage: buildSplitsPage(viewId, splitGroups, splitExpenses, splitSettlements, splitMatches, categories, effectiveSelectedMonth, personNameById)
  };
}

export async function buildImportsPageDto(db: D1Database): Promise<{ importsPage: ImportsPageDto }> {
  await ensureAppData(db);
  const importBatches = await loadImportBatches(db, { includeOverlapDetails: false });
  return {
    importsPage: {
      recentImports: importBatches,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}

export async function buildSettingsPageDto(db: D1Database): Promise<{ settingsPage: SettingsPageDto }> {
  const demo = await ensureAppData(db);
  const [categoryMatchRules, categoryMatchRuleSuggestions, unresolvedTransfers, reconciliationExceptions, recentAuditEvents] = await Promise.all([
    loadCategoryMatchRules(db),
    loadCategoryMatchRuleSuggestions(db),
    loadUnresolvedTransfers(db),
    loadReconciliationExceptions(db),
    loadAuditEvents(db)
  ]);
  return {
    settingsPage: {
      demo,
      categoryMatchRules,
      categoryMatchRuleSuggestions,
      unresolvedTransfers,
      reconciliationExceptions,
      recentAuditEvents
    }
  };
}

async function ensureAppData(db: D1Database) {
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

async function loadPageShell(db: D1Database, selectedViewId: string) {
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

function buildContextView(
  id: string,
  label: string,
  selectedScope: PersonScope,
  summaryMonthsByView: Record<string, SummaryMonthDto[]>,
  incomeRowsByView: Record<string, MonthIncomeRowDto[]>,
  summaryEntries: EntryDto[],
  monthEntries: EntryDto[],
  monthPlanRows: MonthPlanRowDto[],
  splitGroups: SplitGroupDto[],
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
  const currentSnapshotMonth = (summaryMonthsByView[id] ?? []).find((month) => month.month === selectedMonth) ?? null;
  const currentSummaryMonth = currentSnapshotMonth
    ? applyActualsFromEntries(currentSnapshotMonth, visibleEntries, selectedMonth)
    : buildDerivedSummaryMonth(selectedMonth, visibleEntries);

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
    splitsPage: buildSplitsPage(id, splitGroups, splitExpenses, splitSettlements, splitMatches, categories, selectedMonth, personNameById)
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
  const months = rangeMonths.map((month) => {
    const snapshot = summaryMonthByKey.get(month);
    return snapshot
      ? applyActualsFromEntries(snapshot, visibleEntries, month)
      : buildDerivedSummaryMonth(month, visibleEntries);
  });
  const plannedTotalMinor = sumMinor(months, "estimatedExpensesMinor");
  const actualTotalMinor = sumMinor(months, "realExpensesMinor");
  const incomeTotalMinor = sumMinor(months, "incomeMinor");
  const targetSavingsMinor = sumMinor(months, "savingsGoalMinor");
  const realizedSavingsMinor = sumMinor(months, "realizedSavingsMinor");
  const metricCards: MetricCardDto[] = [
    {
      label: "Income",
      amountMinor: incomeTotalMinor,
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

function applyActualsFromEntries(
  snapshot: SummaryMonthDto,
  visibleEntries: EntryDto[],
  month: string
): SummaryMonthDto {
  const derived = buildDerivedSummaryMonth(month, visibleEntries);
  const hasLedgerActivity = visibleEntries.some((entry) => entry.date.slice(0, 7) === month);
  if (!hasLedgerActivity) {
    return snapshot;
  }

  return {
    ...snapshot,
    incomeMinor: derived.incomeMinor,
    realExpensesMinor: derived.realExpensesMinor,
    realizedSavingsMinor: derived.incomeMinor - derived.realExpensesMinor,
    realDiffMinor: derived.incomeMinor - derived.realExpensesMinor
  };
}

function buildSplitsPage(
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

function buildPersonScopes(selectedPersonId: string): Array<{ key: PersonScope; label: string }> {
  return selectedPersonId === "household"
    ? [{ key: "direct_plus_shared", label: "Combined" }]
    : [
        { key: "direct", label: "Direct ownership" },
        { key: "shared", label: "Shared" },
        { key: "direct_plus_shared", label: "Direct + Shared" }
      ];
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
    .sort((left, right) => right.valueMinor - left.valueMinor)
    .slice(0, 5);
}

function sumMinor(months: SummaryMonthDto[], key: keyof Pick<
  SummaryMonthDto,
  "incomeMinor" | "estimatedExpensesMinor" | "realExpensesMinor" | "savingsGoalMinor" | "realizedSavingsMinor"
>) {
  return months.reduce((sum, month) => sum + month[key], 0);
}
