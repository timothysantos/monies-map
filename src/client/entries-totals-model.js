import { entryTotalsTones, flowTone, signTone } from "../domain/money-tone";
import { messages } from "./copy/en-SG";
import { figureCopy } from "./copy/figure-copy";
import { formatMonthLabel } from "./formatters";

// The Entries top in the Lead · Support · Detail language (design.md): the
// lead is what was spent this month, the pills are Income, Difference,
// Transfers and Outflow. Every figure is the one entry-totals.js computed
// for the filtered view, so the lead never disagrees with the strip it
// replaced; only the layout and the tones changed. A person's share of a
// figure (the old bracketed number) shows only where it differs from the
// whole figure, which is only ever so in one person's view.
//
// A figure opened from a card (entry_figure, design.md "Openable figures")
// becomes the lead: "Invested · Jun 2025 – May 2026" and its total, so the
// figure tapped and the figure shown are the same to the cent. A money
// job's figure (`figureMinor`, worked out by entry-filtering.js through the
// same split the card used) is at the view's amounts; the Entries page's
// own figures (its Spent lead, Transfers, Outflow, Difference) are the
// lead's or the pill's, whole amounts with the person's share beside. A
// period of months (`rangeStartMonth`) names the whole period.
export function buildEntriesTotalsModel({
  entryTotals,
  entryOutflowMinor,
  entryGrossOutflowMinor,
  entryNetMinor,
  month,
  rangeStartMonth = "",
  personLabel,
  figure = "",
  figureMinor = null
}) {
  const tones = entryTotalsTones({ incomeMinor: entryTotals.incomeMinor, netMinor: entryNetMinor });
  const share = (wholeMinor, shareMinor) => (shareMinor === wholeMinor ? null : shareMinor);
  const period = rangeStartMonth ? `${formatMonthLabel(rangeStartMonth)} – ${formatMonthLabel(month)}` : formatMonthLabel(month);
  const spent = {
    amountMinor: entryTotals.grossSpendMinor,
    tone: tones.spend,
    shareMinor: share(entryTotals.grossSpendMinor, entryTotals.spendMinor)
  };
  const pills = [
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
  ];
  return {
    month: period,
    eyebrow: figure ? figureCopy.eyebrow(figure, period) : messages.entries.totals.spentEyebrow(period),
    figure,
    spent: figureLead({ figure, figureMinor, spent, pills }),
    pills,
    personLabel
  };
}

// The lead for an opened figure: a money job's own total, or the Entries
// pill it names; Spent (and no figure) is the Spent lead.
function figureLead({ figure, figureMinor, spent, pills }) {
  if (figureMinor !== null && figure) {
    return { amountMinor: figureMinor, tone: figureTone(figure, figureMinor), shareMinor: null };
  }
  const pill = pills.find((item) => item.key === figure);
  return pill ? { amountMinor: pill.amountMinor, tone: pill.tone, shareMinor: pill.shareMinor } : spent;
  // ("expenses", and no figure, is the Spent lead.)
}

// Money in is mint, kept is mint or rose by its sign, spending past income
// is rose; spending, investing and money taken out are plain ink.
function figureTone(figure, amountMinor) {
  if (figure === "earned") return flowTone(amountMinor);
  if (figure === "kept") return signTone(amountMinor);
  if (figure === "from_savings") return amountMinor > 0 ? "short" : "neutral";
  return "neutral";
}

// The phone's Filters row: what the View and scope sheet's filters hold now.
export function describeEntryFilters(activeFilterCount) {
  return activeFilterCount > 0 ? messages.entries.totals.filtersOn(activeFilterCount) : messages.entries.totals.filtersAll;
}
