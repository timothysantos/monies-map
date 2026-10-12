import "../summary-lead.css";
import { messages } from "../copy/en-SG";
import { PrivateMoney } from "../money-privacy";
import { metricCardToneClass, moneyToneClass } from "../money-tone-class";
import { money } from "../formatters";
import { LeadCard } from "./lead-support-detail";

const copy = messages.summary.lead;
const planWords = messages.summary.monthChoice;

// The spend lead and its Income and Saved pills, shared by the Summary top
// and the Month top (month-overview.jsx, which adds Remaining budget as
// `children`). `model` is buildSummaryLeadModel's shape.
//
// `inline` is the Month top: Income, Saved and `children` (Remaining budget)
// fold into the lead card as one row of equal columns under the bar, in
// text colour only, so the whole card stays compact on a phone.
export function SpendLeadGroup({ model, eyebrow, className = "", leadClassName = "", inline = false, children = null }) {
  const { headroom } = model;
  return (
    <div className={`summary-lead-group ${inline ? "is-inline" : ""} ${className}`}>
      <LeadCard
        className={leadClassName}
        eyebrow={eyebrow}
        amount={(
          <span className={`summary-lead-spent ${moneyToneClass(model.spent.tone)}`}>
            <PrivateMoney>{money(model.spent.amountMinor)}</PrivateMoney>
          </span>
        )}
        amountAside={(
          <span className={`summary-lead-plan ${moneyToneClass("plan")}`}>
            {planWords.planPrefix} <PrivateMoney>{money(model.plannedSpendMinor)}</PrivateMoney> {planWords.planSuffix}
          </span>
        )}
        progress={model.progress}
        progressStart={model.percentOfPlan === null ? null : copy.percentOfPlan(model.percentOfPlan)}
        progressEnd={headroom ? (
          <span className={`summary-lead-headroom ${moneyToneClass(headroom.tone)}`}>
            {money(headroom.amountMinor)} {headroom.isOver ? copy.overPlan : copy.underPlan}
          </span>
        ) : null}
      >
        {inline ? (
          <div className="lead-columns">
            <LeadColumn metric="income" label={copy.income} amountMinor={model.income.amountMinor} tone={model.income.tone} planLabel={copy.incomePlan} planMinor={model.income.planMinor} />
            <LeadColumn metric="saved" label={copy.saved} amountMinor={model.saved.amountMinor} tone={model.saved.tone} planLabel={copy.savedTarget} planMinor={model.saved.planMinor} />
            {children}
          </div>
        ) : null}
      </LeadCard>
      {inline ? null : <div className="summary-support-pills">
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
      </div>}
    </div>
  );
}

// One column of the Month lead's support row: a small label, the figure on
// one line (its money tone as text colour only) and the plan or target as a
// quiet line under it.
export function LeadColumn({ metric, label, amountMinor, tone, planLabel = null, planMinor = null }) {
  return (
    <div className="lead-column" data-metric={metric}>
      <span className="lead-column-label">{label}</span>
      <strong className={moneyToneClass(tone)}><PrivateMoney>{money(amountMinor)}</PrivateMoney></strong>
      {planLabel ? <small>{planLabel} <PrivateMoney>{money(planMinor)}</PrivateMoney></small> : null}
    </div>
  );
}

// A Support figure on Summary: a soft tint when it is an outcome (mint
// income, mint or rose savings), its plan as a quiet line inside it.
function SummarySupportPill({ metric, label, amountMinor, tone, planLabel, planMinor }) {
  return (
    <div className={`summary-support-pill ${metricCardToneClass(tone)}`} data-metric={metric}>
      <span className="summary-support-pill-label">{label}</span>
      <strong><PrivateMoney>{money(amountMinor)}</PrivateMoney></strong>
      <small>{planLabel} <PrivateMoney>{money(planMinor)}</PrivateMoney></small>
    </div>
  );
}
