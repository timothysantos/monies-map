// Month projection (H15e): the Month page DTO, person scopes, plan-row and
// income-row actuals, and how entries and plan rows are adjusted and
// filtered for a person view. Pure functions over loaded rows.

import { buildDonutChart } from "./donut-chart-projection";
import type {
  CategoryDto,
  EntryDto,
  MonthPageDto,
  MonthIncomeRowDto,
  MonthPlanRowDto,
  PersonScope,
  SummaryMonthDto
} from "../types/dto";

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
      .filter((entry): entry is EntryDto => entry?.entryType === "expense");
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
      return entries.filter((entry) => isEntryLinkedToSplitExpense(entry));
    }

    if (scope === "direct") {
      return entries.filter((entry) => !isEntryLinkedToSplitExpense(entry));
    }

    return entries;
  }

  return entries.filter((entry) => rowMatchesView(entry, personId, scope));
}

export function adjustEntriesForView(entries: EntryDto[], personId: string): EntryDto[] {
  return entries.map((entry) => adjustEntryForView(entry, personId));
}

function adjustEntryForView(entry: EntryDto, personId: string): EntryDto {
  if (personId !== "household" && isEntryLinkedToSplitExpense(entry)) {
    const matchingLinkedShare = entry.linkedSplitShares?.find((split) => split.personId === personId);
    if (matchingLinkedShare) {
      return {
        ...entry,
        amountMinor: matchingLinkedShare.amountMinor,
        totalAmountMinor: entry.amountMinor,
        viewerSplitRatioBasisPoints: matchingLinkedShare.ratioBasisPoints
      };
    }
  }

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
  entry: EntryDto,
  personId: string,
  scope: PersonScope
) {
  const isLinkedToSplits = isEntryLinkedToSplitExpense(entry);
  const directShares = entry.splits ?? [];
  const linkedShares = entry.linkedSplitShares ?? [];

  if (personId === "household") {
    return scope === "shared"
      ? isLinkedToSplits
      : scope === "direct"
        ? !isLinkedToSplits
        : true;
  }

  if (scope === "shared") {
    return isLinkedToSplits && linkedShares.some((split) => split.personId === personId);
  }

  if (scope === "direct") {
    return !isLinkedToSplits && directShares.some((split) => split.personId === personId);
  }

  return directShares.some((split) => split.personId === personId)
    || linkedShares.some((split) => split.personId === personId);
}

function isEntryLinkedToSplitExpense(entry: EntryDto) {
  return Boolean(entry.linkedSplitExpenseId);
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
