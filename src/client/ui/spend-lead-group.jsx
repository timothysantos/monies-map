import "../summary-lead.css";
import { ChevronRight } from "lucide-react";
import { createElement, lazy, Suspense } from "react";

import { messages } from "../copy/en-SG";
import { PrivateMoney, useMoneyPrivacy } from "../money-privacy";
import { metricCardToneClass, moneyToneClass } from "../money-tone-class";
import { money } from "../formatters";
import { LeadCard } from "./lead-support-detail";
import { MoneyJobs } from "./money-jobs";
import { SavingsBar } from "./savings-bar";

const copy = messages.summary.lead;
const planWords = messages.summary.monthChoice;

// The spend lead and its Income and Saved pills, shared by the Summary top
// and the Month top (month-overview.jsx, which adds Remaining budget as
// `children`). `model` is buildSummaryLeadModel's shape.
//
// The figure is the spend job's spending against the spend job's plan
// (summary-lead-model.js: money moved to Investments or Savings is not
// spend). Under it is its plan line ("63% of plan", "$x under plan"), then
// the savings bar (savings-bar.jsx) and the money jobs (money-jobs.jsx),
// all from the model's one split of the period's money (`model.figures`).
// The old spend-vs-plan bar is gone: three bars were too many, and the text
// line says the same.
//
// `inline` is the Month top: Income, Saved and `children` (Remaining budget)
// fold into the lead card as one row of equal columns under the bar, in
// text colour only, so the whole card stays compact on a phone.
//
// `view` is "plan" or "simple" (lead-view.js), switched in the card's head.
// Simple is "Earned $x · Spent $y" over the same savings bar without its plan
// bar, and nothing else: the plan line, the money jobs and the Income, Saved
// and Remaining budget figures (each a plan or a repeat of the lead) go.
export function SpendLeadGroup({ model, periodLabel, period, view = "plan", onViewChange, categoryShare = [], onOpenCategory, className = "", leadClassName = "", inline = false, children = null }) {
  const simple = view === "simple";
  return (
    <div className={`summary-lead-group ${inline ? "is-inline" : ""} ${simple ? "is-simple" : ""} ${className}`} data-lead-view={view}>
      <LeadCard
        className={leadClassName}
        tag={(
          <div className="lead-view-head">
            <span className="lsd-eyebrow">{simple ? periodLabel : copy.spent(periodLabel)}</span>
            <LeadViewSwitch view={view} onChange={onViewChange} />
          </div>
        )}
        amount={simple ? (
          <span className="lead-simple">
            <SimpleFigure label={copy.earned} figure={model.simple.earned} name="earned" />
            <span aria-hidden="true">·</span>
            <SimpleFigure label={copy.savingsBar.spentName} figure={model.simple.spent} name="spent" />
          </span>
        ) : (
          <span className={`summary-lead-spent ${moneyToneClass(model.spent.tone)}`}>
            <PrivateMoney>{money(model.spent.amountMinor)}</PrivateMoney>
          </span>
        )}
        amountAside={simple ? null : (
          <span className={`summary-lead-plan ${moneyToneClass("plan")}`}>
            {planWords.planPrefix} <PrivateMoney>{money(model.plannedSpendMinor)}</PrivateMoney> {planWords.planSuffix}
          </span>
        )}
      >
        {simple ? null : <SpendLine model={model} />}
        <MoneyUse model={model} period={period} simple={simple} categoryShare={categoryShare} onOpenCategory={onOpenCategory} />
        {simple ? null : inline ? (
          <div className="lead-columns">
            <LeadColumn metric="income" label={copy.income} amountMinor={model.income.amountMinor} tone={model.income.tone} planLabel={copy.incomePlan} planMinor={model.income.planMinor} />
            <LeadColumn metric="saved" label={copy.saved} amountMinor={model.saved.amountMinor} tone={model.saved.tone} planLabel={copy.savedTarget} planMinor={model.saved.planMinor} />
            {children}
          </div>
        ) : null}
      </LeadCard>
      {inline || simple ? null : <div className="summary-support-pills">
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

// The savings bar and the money jobs under it read the lead's split of the
// period's money (`model.figures`, splitMoneyUse): spend, invested and kept,
// and the plan's spend, investment and savings jobs. `period` is
// { startMonth, endMonth, inProgress } for the parts' menus and "so far".
function MoneyUse({ model, period, simple, categoryShare, onOpenCategory }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const hidden = !areTotalsVisible;
  return (
    <>
      <SavingsBar figures={model.figures} hidden={hidden} period={period} withPlan={!simple} />
      {simple ? (
        <Suspense fallback={null}>
          <SimpleDetail part="metrics" figures={model.figures} categoryShare={categoryShare} period={period} onOpenCategory={onOpenCategory} />
        </Suspense>
      ) : <MoneyJobs figures={model.figures} plannedIncomeMinor={model.income.planMinor} hidden={hidden} period={period} />}
    </>
  );
}

// The Simple view's parts that load only when Simple is shown: its facts
// under the bar here, and Summary's "Earned vs spent by month"
// (summary-panel.jsx). The module imports no React (simple-detail.js), so it
// is handed createElement and the chevron and adds no first-screen file.
export const SimpleDetail = lazy(() => import("../simple-detail.js").then(({ renderSimpleDetail }) => ({
  default: function SimpleDetailPart(props) {
    const { areTotalsVisible } = useMoneyPrivacy();
    return renderSimpleDetail(createElement, { ...props, hidden: !areTotalsVisible, MonthIcon: ChevronRight });
  }
})));

// One half of the Simple lead: "Earned" and its figure in its money tone.
function SimpleFigure({ label, figure, name }) {
  return (
    <span className="lead-simple-figure" data-simple={name}>
      <small>{label}</small>
      <span className={moneyToneClass(figure.tone)}><PrivateMoney>{money(figure.amountMinor)}</PrivateMoney></span>
    </span>
  );
}

// Plan | Simple, two native radio buttons drawn as one segmented control:
// the browser gives the radio group's keys (the arrows move the choice and
// the focus; only the chosen one is in the tab order). Each input is
// invisible and covers its label and the space around it, a 44 px target.
// One lead per page, so one group name.
function LeadViewSwitch({ view, onChange }) {
  return (
    <div className="lead-view-switch" role="radiogroup" aria-label={copy.view.label}>
      {["plan", "simple"].map((key) => (
        <label key={key}>
          <input type="radio" name="lead-view" checked={view === key} onChange={() => onChange(key)} />
          {copy.view[key]}
        </label>
      ))}
    </div>
  );
}

// The percent of plan and how far under or over it, as one line (no bar).
// Hidden money drops the whole line: both halves are side-of-zero words.
function SpendLine({ model }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { headroom } = model;
  if (!areTotalsVisible || (model.percentOfPlan === null && !headroom)) {
    return null;
  }
  return (
    <div className="lsd-progress-line summary-lead-line">
      {model.percentOfPlan === null ? null : <span>{copy.percentOfPlan(model.percentOfPlan)}</span>}
      {headroom ? (
        <span className={`summary-lead-headroom ${moneyToneClass(headroom.tone)}`}>
          {money(headroom.amountMinor)} {headroom.isOver ? copy.overPlan : copy.underPlan}
        </span>
      ) : null}
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
