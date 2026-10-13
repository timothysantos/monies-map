// The Entries list's filtering and its totals, as leaf functions: the
// Entries page (through entry-selectors.js) and the Ask page's answers
// (ask-filter-answer.js) both run exactly this, so a filter shows the same
// rows and totals on both. Kept off the client service facade so the Ask
// route does not load the Entries helpers it does not use.
import { entryBypassesFieldFilters } from "./entry-filter-pins";
import { categoryMatchesEntryFilter } from "./entry-filter-values";
import { entryMatchesScope, getVisibleAmountMinor, groupEntriesByDate } from "./entry-helpers";
import { entryMatchesSearch } from "./entry-search";
import { projectEntriesForView } from "./entry-row-projection";
import { getEntryTotals, getExpenseBreakdown } from "./entry-totals";
import { findInvestmentMoves } from "../domain/investment-moves";

// The transfers into investment accounts (the same rule as the invested
// totals, investment-moves.ts), when the filter asks for them
// (entry_invest_moves) and the investment accounts are known.
function investmentMoveIds(entries, entryFilters, investmentAccountIds) {
  if (!entryFilters.investmentMovesIn || !investmentAccountIds?.size) {
    return null;
  }
  return new Set(findInvestmentMoves(entries, entries, investmentAccountIds).into.map((entry) => entry.id));
}

/** The ids of the accounts of kind Investment. */
export function getInvestmentAccountIds(accounts = []) {
  return new Set(accounts.filter((account) => account.kind === "investment").map((account) => account.id));
}

export function getFilteredEntries({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds = [], investmentAccountIds = undefined }) {
  const movesIn = investmentMoveIds(entries, entryFilters, investmentAccountIds);
  return entries.filter((entry) => {
    // Scope is the first gate because it is the page-level visibility rule.
    if (!entryMatchesScope(entry, viewId, selectedScope)) {
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
    // A transfer into an investment account counts with the Investments
    // category (invested), whatever its own category.
    if (!categoryMatchesEntryFilter(entry.categoryName, entryFilters.categories) && !movesIn?.has(entry.id)) {
      return false;
    }
    if (entryFilters.type && entry.entryType !== entryFilters.type) {
      return false;
    }
    if (entryFilters.search && !entryMatchesSearch(entry, entryFilters.search)) {
      return false;
    }
    if (!entryMatchesAmountRange(entry, viewId, entryFilters)) {
      return false;
    }
    return true;
  });
}

// An Ask answer's "over $50" / "under $20" (entry_min, entry_max): the
// amount the row shows for this view, so a person's share of a shared
// entry is what is compared.
function entryMatchesAmountRange(entry, viewId, { minAmountMinor = null, maxAmountMinor = null }) {
  if (!Number.isFinite(minAmountMinor) && !Number.isFinite(maxAmountMinor)) {
    return true;
  }
  const amountMinor = Math.abs(getVisibleAmountMinor(entry, viewId));
  if (Number.isFinite(minAmountMinor) && amountMinor < minAmountMinor) {
    return false;
  }
  return !(Number.isFinite(maxAmountMinor) && amountMinor > maxAmountMinor);
}

export function getEntryDerivedData({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds, investmentAccountIds = undefined }) {
  const filteredEntries = getFilteredEntries({ entries, entryFilters, selectedScope, viewId, pinnedEntryIds, investmentAccountIds });
  const { aggregateEntries, rowEntries } = projectEntriesForView(filteredEntries, viewId);
  const groupedEntries = groupEntriesByDate(rowEntries);
  const entryTotals = getEntryTotals(aggregateEntries);

  return {
    filteredEntries,
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
