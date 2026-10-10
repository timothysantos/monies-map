import { entryBypassesFieldFilters } from "./entry-filter-pins";
import {
  categoryMatchesEntryFilter,
  countActiveEntryFilters
} from "./entry-filter-values";
import {
  entryMatchesSearch,
  getEntrySearchSuggestions
} from "./entry-search";
import { projectEntriesForView } from "./entry-row-projection";
import { getEntryTotals, getExpenseBreakdown } from "./entry-totals";
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
    ownerOptions: people.map((person) => person.name)
  };
}

export function getActiveEntryFilterCount(entryFilters) {
  return countActiveEntryFilters(entryFilters);
}

export function getFilteredEntries({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds = [] }) {
  return entries.filter((entry) => {
    // Scope is the first gate because it is the page-level visibility rule.
    if (!entryService.entryMatchesScope(entry, viewId, selectedScope)) {
      return false;
    }
    if (entryBypassesFieldFilters(entry.id, pinnedEntryIds)) {
      return true;
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
    if (!categoryMatchesEntryFilter(entry.categoryName, entryFilters.categories)) {
      return false;
    }
    if (entryFilters.type && entry.entryType !== entryFilters.type) {
      return false;
    }
    if (entryFilters.search && !entryMatchesSearch(entry, entryFilters.search)) {
      return false;
    }
    return true;
  });
}

export { entryMatchesSearch, getEntrySearchSuggestions };
export { getEntryTotals, getExpenseBreakdown };

export function getEntryDerivedData({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds }) {
  const filteredEntries = getFilteredEntries({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds });
  const { aggregateEntries, rowEntries } = projectEntriesForView(filteredEntries, viewId);
  const groupedEntries = entryService.groupByDate(rowEntries);
  const entryTotals = getEntryTotals(aggregateEntries);

  return {
    filteredEntries,
    aggregateEntries,
    groupedEntries,
    entryTotals,
    // "Outflow" includes transfers out, while "net" ignores transfer pairs and
    // only compares income against expenses.
    entryOutflowMinor: entryTotals.spendMinor + entryTotals.transferOutMinor,
    entryGrossOutflowMinor: entryTotals.grossSpendMinor + entryTotals.grossTransferOutMinor,
    entryNetMinor: entryTotals.incomeMinor - entryTotals.spendMinor,
    expenseBreakdown: getExpenseBreakdown(aggregateEntries)
  };
}
