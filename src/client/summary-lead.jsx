import "./summary-lead.css";
import { messages } from "./copy/en-SG";
import { PrivateMoney } from "./money-privacy";
import { metricCardToneClass, moneyToneClass } from "./money-tone-class";
import { moniesClient } from "./monies-client-service";
import { buildSummaryLeadModel, formatSummaryLeadRange } from "./summary-lead-model";
import { LeadCard } from "./ui/lead-support-detail";

const { format: formatService } = moniesClient;
const copy = messages.summary.lead;
const planWords = messages.summary.monthChoice;

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

// The spend lead and its Income and Saved pills, shared by the Summary top
// and the Month top (month-overview.jsx, which adds Remaining budget as
// `children`). `model` is buildSummaryLeadModel's shape.
export function SpendLeadGroup({ model, eyebrow, className = "", leadClassName = "", children = null }) {
  const { headroom } = model;
  return (
    <div className={`summary-lead-group ${className}`}>
      <LeadCard
        className={leadClassName}
        eyebrow={eyebrow}
        amount={(
          <span className={`summary-lead-spent ${moneyToneClass(model.spent.tone)}`}>
            <PrivateMoney>{formatService.money(model.spent.amountMinor)}</PrivateMoney>
          </span>
        )}
        amountAside={(
          <span className={`summary-lead-plan ${moneyToneClass("plan")}`}>
            {planWords.planPrefix} <PrivateMoney>{formatService.money(model.plannedSpendMinor)}</PrivateMoney> {planWords.planSuffix}
          </span>
        )}
        progress={model.progress}
        progressStart={model.percentOfPlan === null ? null : copy.percentOfPlan(model.percentOfPlan)}
        progressEnd={headroom ? (
          <span className={`summary-lead-headroom ${moneyToneClass(headroom.tone)}`}>
            {formatService.money(headroom.amountMinor)} {headroom.isOver ? copy.overPlan : copy.underPlan}
          </span>
        ) : null}
      />
      <div className="summary-support-pills">
        <SummarySupportPill
          metric="income"
          label={copy.income}
          amountMinor={model.income.amountMinor}
          tone={model.income.tone}
          planLabel={copy.incomePlan}
          planMinor={model.income.planMinor}
        />
        <SummarySupportPill
          metric="saved"
          label={copy.saved}
          amountMinor={model.saved.amountMinor}
          tone={model.saved.tone}
          planLabel={copy.savedTarget}
          planMinor={model.saved.planMinor}
        />
        {children}
      </div>
    </div>
  );
}

// A Support figure on Summary: a soft tint when it is an outcome (mint
// income, mint or rose savings), its plan as a quiet line inside it.
function SummarySupportPill({ metric, label, amountMinor, tone, planLabel, planMinor }) {
  return (
    <div className={`summary-support-pill ${metricCardToneClass(tone)}`} data-metric={metric}>
      <span className="summary-support-pill-label">{label}</span>
      <strong><PrivateMoney>{formatService.money(amountMinor)}</PrivateMoney></strong>
      <small>{planLabel} <PrivateMoney>{formatService.money(planMinor)}</PrivateMoney></small>
    </div>
  );
}
