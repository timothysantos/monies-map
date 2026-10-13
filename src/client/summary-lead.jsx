import { messages } from "./copy/en-SG";
import { buildSummaryLeadModel, formatSummaryLeadRange } from "./summary-lead-model";
import { SpendLeadGroup } from "./ui-components";

const copy = messages.summary.lead;

// The Summary top (design.md, "Lead · Support · Detail"): the lead card is
// spend against plan over the range; Income and Saved are soft pills beside
// it with their plans inside. Phone stacks them; desktop puts the pills in a
// column to the right of the lead. Hidden money: the amounts are dots in
// plain ink, the bar keeps only its track, the percent and "under/over plan"
// go, and the pills lose their tint (the money-tone rule in styles.css).
// Until the cards arrive nothing shows (the old tile row scrolled sideways
// on a phone).
export function SummaryLead({ metricCards, rangeStartMonth, rangeEndMonth }) {
  const model = buildSummaryLeadModel(metricCards);
  if (!model) {
    return null;
  }
  return (
    <SpendLeadGroup
      model={model}
      leadClassName="summary-lead"
      eyebrow={copy.spent(formatSummaryLeadRange(rangeStartMonth, rangeEndMonth))}
    />
  );
}
