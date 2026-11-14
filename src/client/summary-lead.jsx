import { getCurrentMonthKey } from "../lib/month";
import { formatSummaryLeadRange } from "./summary-lead-model";
import { SpendLeadGroup } from "./ui/spend-lead-group";
import { buildSpendChangeNote } from "./spend-change-model";
import { useMoneyPrivacy } from "./money-privacy";
import { useMemo } from "react";
import { useIsMobileLayout } from "./use-viewport";

// The Summary top (design.md, "Lead · Support · Detail" and "Summary lead"):
// the lead card is spend against plan over the range, the full width of the
// Summary. Wider than a phone, Income and Saved are its stat strip (the
// Month lead's), beside the money jobs, and from a 960 px card the lead is
// two columns (summary-lead.css). A phone keeps them as soft pills under the
// card. Hidden money: the amounts are dots in plain ink, the bar keeps only
// its track, the percent and "under/over plan" go, and the figures lose
// their tone (the money-tone rule in styles.css). Until the cards arrive
// nothing shows (the old tile row scrolled sideways on a phone). `model` is
// buildSummaryLeadModel's, built by the panel; `view` is Plan or Simple
// (lead-view.js; Simple until the person chooses).
export function SummaryLead({ model, view, onViewChange, categoryShare, rangeStartMonth, rangeEndMonth, spendChange = undefined }) {
  const phone = useIsMobileLayout();
  const { areTotalsVisible } = useMoneyPrivacy();
  // The same note, rule and words as under Spending mix's total (spend-change-model.js).
  const changeNote = useMemo(() => buildSpendChangeNote(spendChange, { hidden: !areTotalsVisible }), [spendChange, areTotalsVisible]);
  if (!model) {
    return null;
  }
  return (
    <SpendLeadGroup
      model={model}
      view={view}
      onViewChange={onViewChange}
      categoryShare={categoryShare}
      changeNote={changeNote}
      inline={!phone}
      leadClassName="summary-lead"
      periodLabel={formatSummaryLeadRange(rangeStartMonth, rangeEndMonth)}
      period={{ startMonth: rangeStartMonth, endMonth: rangeEndMonth, inProgress: rangeEndMonth === getCurrentMonthKey() }}
    />
  );
}
