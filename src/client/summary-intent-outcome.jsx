import "./summary-intent-outcome.css";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { messages } from "./copy/en-SG";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { formatMonthLabel, money } from "./formatters";
import { buildIntentMonthCard } from "./summary-intent-outcome-model";
import { DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui-components";

const copy = messages.summary.intent;
const leadCopy = messages.summary.lead;
const planWords = messages.summary.monthChoice;
const table = messages.summary.table;
const METRIC_LABELS = { income: table.income, spend: table.expectedExpenses, savings: table.expectedSavings };
// What each Details row's actual opens (design.md "Openable figures"): the
// month's income, its spending (every expense, as the card's lead counts it)
// and income less spending (its realized savings), with that row's part of
// the plan.
const METRIC_FIGURES = {
  income: { fig: "earned", plan: "income" },
  spend: { fig: "spent", plan: "" },
  savings: { fig: "difference", plan: "" }
};
// An openable figure's attributes (figure-menu.js).
const open = (fig, plan = null, ask = "") => ({
  "data-fig": fig,
  "data-fig-plan": plan ?? undefined,
  "data-fig-ask": ask || undefined,
  role: "button",
  tabIndex: 0
});

// Summary's month-by-month plan review (design.md, "Lead · Support ·
// Detail"): newest month first, each a compact card. Lead: the month's spend
// against its plan, with the bar. Support: planned and actual income. Detail:
// the planned, actual and variance figures for income, spend and savings and
// the month note, folded under "Details"; the latest month starts open. The
// month name opens the month. Every figure is openable (design.md "Openable
// figures": View entries for that month, Open plan, Ask about this). Nothing
// is wider than the card, so a phone never scrolls sideways.
export function SummaryIntentVsOutcomeSection({ months, onOpenMonth, onEditNote, chart = null }) {
  const sortedMonths = [...months].sort((left, right) => right.month.localeCompare(left.month));
  return (
    <section className="chart-card summary-intent">
      <div className="chart-head">
        <h3>{messages.summary.intentVsOutcome}</h3>
        <p>{messages.summary.intentVsOutcomeDetail}</p>
      </div>
      {/* The column + line chart (earned-spent-chart.js): earned, spent and the plan, month by month. */}
      {chart}
      <div className="summary-intent-months">
        {sortedMonths.map((month, index) => (
          <IntentMonthCard
            key={month.month}
            card={buildIntentMonthCard(month)}
            isInitiallyOpen={index === 0}
            onOpenMonth={onOpenMonth}
            onEditNote={onEditNote}
          />
        ))}
      </div>
    </section>
  );
}

function IntentMonthCard({ card, isInitiallyOpen, onOpenMonth, onEditNote }) {
  const monthLabel = formatMonthLabel(card.month);
  // The card widens when its Details are open; a class on the card does that
  // without a :has() that scans every descendant.
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const { headroom } = card;
  return (
    <LeadCard
      className={isOpen ? "summary-intent-month is-details-open" : "summary-intent-month"}
      data-month={card.month}
      data-fig-period={`${card.month}:${card.month}`}
      tag={(
        <button type="button" className="summary-month-link" onClick={() => onOpenMonth(card.month)}>
          {monthLabel}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
      amount={(
        <span className={`summary-intent-spent ${moneyToneClass(card.spent.tone)}`} {...open("spent", "", headroom?.isOver ? "spentOverPlan" : "")}>
          <PrivateMoney>{money(card.spent.amountMinor)}</PrivateMoney>
        </span>
      )}
      amountAside={(
        <span className={`summary-intent-plan ${moneyToneClass("plan")}`} {...open("plan", "")}>
          {planWords.planPrefix} <PrivateMoney>{money(card.plannedSpendMinor)}</PrivateMoney> {planWords.planSuffix}
        </span>
      )}
      progress={card.progress}
      progressStart={card.percentOfPlan === null ? null : leadCopy.percentOfPlan(card.percentOfPlan)}
      progressEnd={headroom ? (
        <span className={`summary-intent-headroom ${moneyToneClass(headroom.tone)}`} {...open("spent", "", headroom.isOver ? "spentOverPlan" : "plan")}>
          {money(headroom.amountMinor)} {headroom.isOver ? leadCopy.overPlan : leadCopy.underPlan}
        </span>
      ) : null}
      chips={[
        <MetaChip key="planned" {...open("plan", "income")}>{copy.plannedIncome} <PrivateMoney>{money(card.plannedIncomeMinor)}</PrivateMoney></MetaChip>,
        <MetaChip key="actual" {...open("earned", "income")}>{copy.actualIncome} <PrivateMoney>{money(card.actualIncomeMinor)}</PrivateMoney></MetaChip>
      ]}
    >
      <DetailRows label={copy.detailsFor(monthLabel)}>
        <MoreDetails label={copy.details} openLabel={copy.details} summary={copy.detailsHint} open={isOpen} onOpenChange={setIsOpen}>
          {card.metrics.map((metric) => (
            <div key={metric.key} className="lsd-row is-readonly summary-intent-metric" data-metric={metric.key}>
              <span className="lsd-row-label">{METRIC_LABELS[metric.key]}</span>
              <dl className="summary-intent-figures">
                <div>
                  <dt>{table.estimate}</dt>
                  <dd><span {...open("plan", METRIC_FIGURES[metric.key].plan)}><PrivateMoney>{money(metric.plannedMinor)}</PrivateMoney></span></dd>
                </div>
                <div>
                  <dt>{table.actual}</dt>
                  <dd className={moneyToneClass(metric.actualTone)}><span {...open(METRIC_FIGURES[metric.key].fig, METRIC_FIGURES[metric.key].plan)}><PrivateMoney>{money(metric.actualMinor)}</PrivateMoney></span></dd>
                </div>
                <div>
                  <dt>{table.variance}</dt>
                  <dd className={moneyToneClass(metric.varianceTone)}><span {...open("plan", METRIC_FIGURES[metric.key].plan)}><PrivateMoney>{money(metric.varianceMinor)}</PrivateMoney></span></dd>
                </div>
              </dl>
            </div>
          ))}
          <DetailRow
            className="summary-note-trigger"
            label={messages.month.table.note}
            value={card.note}
            emptyLabel={messages.common.emptyValue}
            onClick={() => onEditNote(card.month, card.note)}
          />
        </MoreDetails>
      </DetailRows>
    </LeadCard>
  );
}
