import { countActiveEntryFilters } from "./entry-filter-values";
import { getEntryDerivedData, getFilteredEntries } from "./entry-filtering";
import {
  entryMatchesSearch,
  getEntrySearchSuggestions
} from "./entry-search";
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

export { getEntryDerivedData, getFilteredEntries };
export { entryMatchesSearch, getEntrySearchSuggestions };
export { getEntryTotals, getExpenseBreakdown };
