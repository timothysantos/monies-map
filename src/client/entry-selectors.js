import { getAccountSelectOptions } from "./account-display";
import { getCategoryNameOptions } from "./category-utils";
import { entryMatchesScope, groupEntriesByDate, uniqueValues } from "./entry-helpers";

export function getEntryFilterOptions(entries) {
  return {
    wallets: uniqueValues(entries.map((entry) => entry.accountName)),
    entryCategoryOptions: uniqueValues(entries.map((entry) => entry.categoryName)),
    peopleFilterOptions: uniqueValues(entries.flatMap((entry) => (
      entry.ownershipType === "shared" ? ["Shared"] : [entry.ownerName ?? ""]
    )))
  };
}

export function getEntryWalletFilterOptions(accounts) {
  return getAccountSelectOptions(accounts.filter((account) => account.isActive !== false), { valueKey: "id" })
    .filter((option) => option.value);
}

export function getEntryFormOptions({ accounts, categories, people }) {
  return {
    categoryOptions: getCategoryNameOptions(categories),
    accountOptions: getAccountSelectOptions(accounts.filter((account) => account.isActive !== false), { valueKey: "id" }),
    ownerOptions: [...people.map((person) => person.name), "Shared"]
  };
}

export function getActiveEntryFilterCount(entryFilters) {
  return ["category", "person", "type"].reduce(
    (count, key) => count + (entryFilters[key] ? 1 : 0),
    entryFilters.wallets?.length ? 1 : 0
  );
}

export function getFilteredEntries({ entries, entryFilters, selectedScope, viewId }) {
  return entries.filter((entry) => {
    if (!entryMatchesScope(entry, viewId, selectedScope)) {
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
    if (entryFilters.person) {
      if (entryFilters.person === "Shared") {
        return entry.ownershipType === "shared";
      }
      return entry.ownerName === entryFilters.person || entry.splits.some((split) => split.personName === entryFilters.person);
    }
    return true;
  });
}

export function getEntryTotals(entries) {
  return entries.reduce((totals, entry) => {
    if (entry.entryType === "income") {
      totals.incomeMinor += entry.amountMinor;
    } else if (entry.entryType === "expense") {
      totals.spendMinor += entry.amountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "out") {
      totals.transferOutMinor += entry.amountMinor;
    } else if (entry.entryType === "transfer" && entry.transferDirection === "in") {
      totals.transferInMinor += entry.amountMinor;
    }

    return totals;
  }, { incomeMinor: 0, spendMinor: 0, transferInMinor: 0, transferOutMinor: 0 });
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
    current.valueMinor += entry.amountMinor;
    current.entryCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.valueMinor - left.valueMinor);
}

export function getEntryDerivedData({ entries, entryFilters, selectedScope, viewId }) {
  const filteredEntries = getFilteredEntries({ entries, entryFilters, selectedScope, viewId });
  const groupedEntries = groupEntriesByDate(filteredEntries);
  const entryTotals = getEntryTotals(filteredEntries);

  return {
    filteredEntries,
    groupedEntries,
    entryTotals,
    entryOutflowMinor: entryTotals.spendMinor + entryTotals.transferOutMinor,
    entryNetMinor: entryTotals.incomeMinor - entryTotals.spendMinor,
    expenseBreakdown: getExpenseBreakdown(filteredEntries)
  };
}
