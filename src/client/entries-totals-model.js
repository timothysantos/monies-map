import { entryTotalsTones } from "../domain/money-tone";
import { messages } from "./copy/en-SG";
import { formatMonthLabel } from "./formatters";

// The Entries top in the Lead · Support · Detail language (design.md): the
// lead is what was spent this month, the pills are Income, Difference,
// Transfers and Outflow. Every figure is the one entry-totals.js computed
// for the filtered view, so the lead never disagrees with the strip it
// replaced; only the layout and the tones changed. A person's share of a
// figure (the old bracketed number) shows only where it differs from the
// whole figure, which is only ever so in one person's view.
export function buildEntriesTotalsModel({ entryTotals, entryOutflowMinor, entryGrossOutflowMinor, entryNetMinor, month, personLabel }) {
  const tones = entryTotalsTones({ incomeMinor: entryTotals.incomeMinor, netMinor: entryNetMinor });
  const share = (wholeMinor, shareMinor) => (shareMinor === wholeMinor ? null : shareMinor);
  return {
    month: formatMonthLabel(month),
    spent: {
      amountMinor: entryTotals.grossSpendMinor,
      tone: tones.spend,
      shareMinor: share(entryTotals.grossSpendMinor, entryTotals.spendMinor)
    },
    pills: [
      { key: "income", amountMinor: entryTotals.incomeMinor, tone: tones.income, shareMinor: null },
      { key: "difference", amountMinor: entryNetMinor, tone: tones.difference, shareMinor: null },
      {
        key: "transfers",
        amountMinor: entryTotals.grossTransferOutMinor,
        tone: tones.transfers,
        shareMinor: share(entryTotals.grossTransferOutMinor, entryTotals.transferOutMinor)
      },
      {
        key: "outflow",
        amountMinor: entryGrossOutflowMinor,
        tone: tones.outflow,
        shareMinor: share(entryGrossOutflowMinor, entryOutflowMinor)
      }
    ],
    personLabel
  };
}

// The phone's Filters row: what the View and scope sheet's filters hold now.
export function describeEntryFilters(activeFilterCount) {
  return activeFilterCount > 0 ? messages.entries.totals.filtersOn(activeFilterCount) : messages.entries.totals.filtersAll;
}
