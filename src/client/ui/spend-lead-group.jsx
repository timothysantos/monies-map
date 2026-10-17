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
import { LeadViewSwitch } from "../lead-view-switch";

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
// Every figure here is openable (design.md "Openable figures"): it carries
// `data-fig` (figure-menu.js reads it; `fig` below) and the group carries
// the period, so a tap opens View entries, Open plan and Ask about this.
//
// `view` is "plan" or "simple" (lead-view.js), switched in the card's head.
// Simple is "Earned $x · Spent $y" over the same savings bar without its plan
// bar, and nothing else: the plan line, the money jobs and the Income, Saved
// and Remaining budget figures (each a plan or a repeat of the lead) go.
export function SpendLeadGroup({ model, periodLabel, period, view = "plan", onViewChange, categoryShare = [], className = "", leadClassName = "", inline = false, children = null, supportHeader = null }) {
  const simple = view === "simple";
  const over = model.headroom?.isOver;
  return (
    <div className={`summary-lead-group ${inline ? "is-inline" : ""} ${simple ? "is-simple" : ""} ${className}`} data-lead-view={view} data-fig-period={period ? `${period.startMonth}:${period.endMonth}` : undefined}>
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
            <SimpleFigure label={copy.earned} figure={model.simple.earned} name="earned" fig="earned" />
            <span aria-hidden="true">·</span>
            <SimpleFigure label={copy.savingsBar.spentName} figure={model.simple.spent} name="spent" fig="spending" ask={model.simple.spent.tone === "short" ? "spentMore" : ""} />
          </span>
        ) : (
          <span className={`summary-lead-spent ${moneyToneClass(model.spent.tone)}`} {...fig("spending", "", over ? "spentOverPlan" : "")}>
            <PrivateMoney>{money(model.spent.amountMinor)}</PrivateMoney>
          </span>
        )}
        amountAside={simple ? null : (
          <span className={`summary-lead-plan ${moneyToneClass("plan")}`} {...fig("plan", "")}>
            {planWords.planPrefix} <PrivateMoney>{money(model.plannedSpendMinor)}</PrivateMoney> {planWords.planSuffix}
          </span>
        )}
      >
        {simple ? null : <SpendLine model={model} />}
        <MoneyUse model={model} period={period} simple={simple} categoryShare={categoryShare} />
        {simple ? null : inline ? (
          <div className="lead-columns">
            <LeadColumn metric="income" label={copy.income} amountMinor={model.income.amountMinor} tone={model.income.tone} planLabel={copy.incomePlan} planMinor={model.income.planMinor} open={fig("earned", "income")} />
            <LeadColumn metric="saved" label={copy.saved} amountMinor={model.saved.amountMinor} tone={model.saved.tone} planLabel={copy.savedTarget} planMinor={model.saved.planMinor} open={fig("kept", "")} />
            {children}
          </div>
        ) : null}
      </LeadCard>
      {inline || simple ? null : <div className="summary-support-pills">
        {supportHeader}
        <SummarySupportPill
          metric="income"
          label={copy.income}
          amountMinor={model.income.amountMinor}
          tone={model.income.tone}
          planLabel={copy.incomePlan}
          planMinor={model.income.planMinor}
          open={fig("earned", "income")}
        />
        <SummarySupportPill
          metric="saved"
          label={copy.saved}
          amountMinor={model.saved.amountMinor}
          tone={model.saved.tone}
          planLabel={copy.savedTarget}
          planMinor={model.saved.planMinor}
          open={fig("kept", "")}
        />
        {children}
      </div>}
    </div>
  );
}

// An openable figure's attributes (figure-menu.js): what it is, the part of
// the plan it has a line in ("" the whole plan, null none) and the question
// for Ask when not the figure's own.
export const fig = (kind, plan = null, ask = "") => ({
  "data-fig": kind,
  "data-fig-plan": plan ?? undefined,
  "data-fig-ask": ask || undefined,
  role: "button",
  tabIndex: 0
});

// The savings bar and the money jobs under it read the lead's split of the
// period's money (`model.figures`, splitMoneyUse): spend, invested and kept,
// and the plan's spend, investment and savings jobs. `period` is
// { startMonth, endMonth, inProgress } for the parts' menus and "so far".
function MoneyUse({ model, period, simple, categoryShare }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const hidden = !areTotalsVisible;
  return (
    <>
      <SavingsBar figures={model.figures} hidden={hidden} period={period} withPlan={!simple} />
      {simple ? (
        <Suspense fallback={null}>
          <SimpleDetail part="metrics" figures={model.figures} categoryShare={categoryShare} period={period} />
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
function SimpleFigure({ label, figure, name, fig: kind, ask = "" }) {
  return (
    <span className="lead-simple-figure" data-simple={name}>
      <small>{label}</small>
      <span className={moneyToneClass(figure.tone)} {...fig(kind, null, ask)}><PrivateMoney>{money(figure.amountMinor)}</PrivateMoney></span>
    </span>
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
    <div className="lsd-progress-line summary-lead-line" {...fig("spending", "", headroom?.isOver ? "spentOverPlan" : "plan")}>
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
export function LeadColumn({ metric, label, amountMinor, tone, planLabel = null, planMinor = null, open = {} }) {
  return (
    <div className="lead-column" data-metric={metric} {...open}>
      <span className="lead-column-label">{label}</span>
      <strong className={moneyToneClass(tone)}><PrivateMoney>{money(amountMinor)}</PrivateMoney></strong>
      {planLabel ? <small>{planLabel} <PrivateMoney>{money(planMinor)}</PrivateMoney></small> : null}
    </div>
  );
}

// A Support figure on Summary: a soft tint when it is an outcome (mint
// income, mint or rose savings), its plan as a quiet line inside it.
function SummarySupportPill({ metric, label, amountMinor, tone, planLabel, planMinor, open }) {
  return (
    <div className={`summary-support-pill ${metricCardToneClass(tone)}`} data-metric={metric} {...open}>
      <span className="summary-support-pill-label">{label}</span>
      <strong><PrivateMoney>{money(amountMinor)}</PrivateMoney></strong>
      <small>{planLabel} <PrivateMoney>{money(planMinor)}</PrivateMoney></small>
    </div>
  );
}
