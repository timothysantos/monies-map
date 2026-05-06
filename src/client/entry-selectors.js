import { moniesClient } from "./monies-client-service";

const {
  accounts: accountService,
  categories: categoryService,
  entries: entryService
} = moniesClient;

// These selectors keep the Entries panel declarative. The component asks for
// "what should I render?" while the filtering and aggregation rules stay here.

export function getEntryFilterOptions(entries) {
  return {
    wallets: entryService.uniqueValues(entries.map((entry) => entry.accountName)),
    entryCategoryOptions: entryService.uniqueValues(entries.map((entry) => entry.categoryName))
  };
}

export function getEntryWalletFilterOptions(accounts) {
  return accountService.getSelectOptions(accounts.filter((account) => account.isActive !== false), { valueKey: "id" })
    .filter((option) => option.value);
}

export function getEntryFormOptions({ accounts, categories, people }) {
  return {
    categoryOptions: categoryService.getNameOptions(categories),
    accountOptions: accountService.getSelectOptions(accounts.filter((account) => account.isActive !== false), { valueKey: "id" }),
    ownerOptions: [...people.map((person) => person.name), "Shared"]
  };
}

export function getActiveEntryFilterCount(entryFilters) {
  return ["category", "type"].reduce(
    (count, key) => count + (entryFilters[key] ? 1 : 0),
    (entryFilters.wallets?.length ? 1 : 0) + (entryFilters.entryIds?.length ? 1 : 0)
  );
}

export function getFilteredEntries({ entries, entryFilters, selectedScope, viewId }) {
  return entries.filter((entry) => {
    // Scope is the first gate because it is the page-level visibility rule.
    if (!entryService.entryMatchesScope(entry, viewId, selectedScope)) {
      return false;
    }
    if (
      entryFilters.entryIds?.length
      && !entryFilters.entryIds.includes(entry.id)
    ) {
      return false;
    }
    if (
      entryFilters.wallets?.length
      && !entryFilters.wallets.some((wallet) => entry.accountId === wallet || entry.accountName === wallet)
    ) {
      return false;
    }
    if (entryFilters.category && entry.categoryName !== entryFilters.category) {
      return false;
    }
    if (entryFilters.type && entry.entryType !== entryFilters.type) {
      return false;
    }
    return true;
  });
}

export function getEntryTotals(entries) {
  return entries.reduce((totals, entry) => {
    const visibleAmountMinor = entry.visibleAmountMinor ?? entry.amountMinor;
    const grossAmountMinor = entry.grossAmountMinor ?? entry.totalAmountMinor ?? entry.amountMinor;

    // Entries keeps income/expense/transfer math separate so the page can show
    // both net cash flow and total money moved out.
    if (entry.entryType === "income") {
      totals.incomeMinor += visibleAmountMinor;
    } else if (entry.entryType === "expense") {
      totals.spendMinor += visibleAmountMinor;
      totals.grossSpendMinor += grossAmountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "out") {
      totals.transferOutMinor += visibleAmountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "in") {
      totals.transferInMinor += visibleAmountMinor;
    }

    return totals;
  }, { incomeMinor: 0, spendMinor: 0, grossSpendMinor: 0, transferInMinor: 0, transferOutMinor: 0 });
}

export function getExpenseBreakdown(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (entry.entryType !== "expense") {
      continue;
    }
    const key = entry.categoryName;
    const current = grouped.get(key) ?? {
      key,
      label: key,
      categoryName: key,
      valueMinor: 0,
      entryCount: 0
    };
    current.valueMinor += entry.visibleAmountMinor ?? entry.amountMinor;
    current.entryCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.valueMinor - left.valueMinor);
}

export function getEntryDerivedData({ entries, entryFilters, selectedScope, viewId }) {
  const filteredEntries = getFilteredEntries({ entries, entryFilters, selectedScope, viewId });
  const aggregateEntries = filteredEntries.map((entry) => ({
    ...entry,
    visibleAmountMinor: entryService.getVisibleAmountMinor(entry, viewId),
    grossAmountMinor: entryService.getTotalAmountMinor(entry)
  }));
  const groupedEntries = entryService.groupByDate(aggregateEntries.map((entry) => ({
    ...entry,
    amountMinor: entry.visibleAmountMinor
  })));
  const entryTotals = getEntryTotals(aggregateEntries);

  return {
    filteredEntries,
    groupedEntries,
    entryTotals,
    // "Outflow" includes transfers out, while "net" ignores transfer pairs and
    // only compares income against expenses.
    entryOutflowMinor: entryTotals.spendMinor + entryTotals.transferOutMinor,
    entryNetMinor: entryTotals.incomeMinor - entryTotals.spendMinor,
    expenseBreakdown: getExpenseBreakdown(aggregateEntries)
  };
}
