// An Ask answer's numbers: the filter goes through the Entries URL it opens
// (buildEntriesFilterSearch) and back through the reader the Entries page
// uses (readEntriesFilterParams), then through the Entries page's own
// selector (getEntryDerivedData) over the same Entries page DTO. So the
// answer card and the Entries page it opens show the same rows and totals
// by construction (tests/ask-filter-answer.test.mjs proves it).

import { buildEntriesFilterSearch, readEntriesFilterParams } from "./entry-filter-params";
import { getEntryDerivedData, getInvestmentAccountIds } from "./entry-filtering";

/**
 * @typedef {{ kind: "spend" | "income" | "transfersOut" | "transfersIn", amountMinor: number, shareMinor: number | null }} AnswerLead
 */

/**
 * @param {{ viewId?: string, monthPage: { selectedScope?: string, entries: any[] } }} page The Entries page DTO for the filter's view and month.
 * @param {import("./ask-filter-reader").EntriesFilter & { investmentMovesIn?: boolean }} filter
 * @param {{ accounts?: Array<{ id: string, kind: string }> }} [reference] The accounts, whose kinds name the investment accounts (entry_invest_moves).
 */
export function summarizeFilterAnswer(page, filter, { accounts = [] } = {}) {
  const params = buildEntriesFilterSearch(filter);
  const { selectedScope, entryFilters } = readEntriesFilterParams(params, page.monthPage.selectedScope ?? "direct_plus_shared");
  const viewId = params.get("view") ?? page.viewId ?? "household";
  const derived = getEntryDerivedData({
    entries: page.monthPage.entries ?? [],
    entryFilters,
    selectedScope,
    viewId,
    pinnedEntryIds: [],
    investmentAccountIds: getInvestmentAccountIds(accounts)
  });
  return {
    count: derived.filteredEntries.length,
    entryIds: derived.filteredEntries.map((entry) => entry.id),
    totals: derived.entryTotals,
    lead: pickLead(filter.type, derived.entryTotals)
  };
}

// The figure the answer leads with, matching an Entries totals strip item:
// Spend (the whole amount, with the view's share beside it when it
// differs), Income, or Transfers out (in, when only money came in).
/** @returns {AnswerLead} */
export function pickLead(type, totals) {
  if (type === "income") {
    return { kind: "income", amountMinor: totals.incomeMinor, shareMinor: null };
  }
  if (type === "transfer") {
    if (!totals.grossTransferOutMinor && totals.transferInMinor) {
      return { kind: "transfersIn", amountMinor: totals.transferInMinor, shareMinor: null };
    }
    return {
      kind: "transfersOut",
      amountMinor: totals.grossTransferOutMinor,
      shareMinor: totals.grossTransferOutMinor !== totals.transferOutMinor ? totals.transferOutMinor : null
    };
  }
  return {
    kind: "spend",
    amountMinor: totals.grossSpendMinor,
    shareMinor: totals.grossSpendMinor !== totals.spendMinor ? totals.spendMinor : null
  };
}
