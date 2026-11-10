import "./summary-cards.css";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { investmentsCopy as copy, shortMonth } from "./copy/summary-cards-copy";
import { money } from "./formatters";
import { buildInvestmentsChart, shortDollars } from "./investments-chart-model";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { getPersonColourVars } from "./person-colour";
import { queryKeys } from "./query-keys";
import { requestInvestmentsOverTime } from "./summary-cards-api";
import { useSummaryCardQuery } from "./use-summary-card-query";
import { useIsMobileLayout } from "./use-viewport";
import { investmentPutInFigure } from "../domain/money-figures";
import { signTone } from "../domain/money-tone";

// Investments over time (design.md "Investments over time"; DOMAIN.md
// "Investments Over Time"): a Summary card built only from what the
// statements say each investment account was worth and the money moved
// into each account this year. A month with no statement is left blank;
// nothing is guessed and there is no forecast. In Spending Mix's lazy chunk;
// its data is read only once the top summary is usable, and it shows nothing
// for a household with no investment statement.
//
// Every figure is openable (design.md "Openable figures"), in the household
// view (data-fig-view: the card counts whole amounts): "put in" opens
// exactly the moves it counted (`invested`, or `took_out` below zero), and
// worth, grew by and paid out open the statements on Imports.

// "+$2,410" or "−$500"; with money hidden just "••••", so no sign shows.
function signed(minor) {
  const amount = money(Math.abs(minor));
  return amount.includes("$") ? `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${amount}` : amount;
}

function PutInFigure({ putIn, name, className = "" }) {
  if (!putIn.ids.length) {
    return <span className={className}>{money(putIn.amountMinor)}</span>;
  }
  return (
    <span className={className} data-fig={investmentPutInFigure(putIn.amountMinor)} data-fig-ids={putIn.ids.join(" ")} data-fig-name={name} tabIndex={0} role="button">
      {putIn.amountMinor < 0 ? signed(putIn.amountMinor) : money(putIn.amountMinor)}
    </span>
  );
}

// A statement figure: opens that account's statements (none: every import).
function StatementFigure({ account = "", name, className = "", children }) {
  return (
    <span className={className} data-fig="statement" data-fig-arg={account || undefined} data-fig-name={name} tabIndex={0} role="button">
      {children}
    </span>
  );
}

function Chart({ months, compact = false, startWorthMinor }) {
  const chart = useMemo(() => buildInvestmentsChart(months, compact
    ? { width: 340, height: 64 }
    : { width: 770, height: 250, left: 40, bottom: 24, ticks: 4 }), [compact, months]);
  if (!chart) {
    return null;
  }
  if (compact) {
    return (
      <svg className="invest-spark" viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true" preserveAspectRatio="none">
        <polyline className="invest-putin-line" points={chart.putIn} />
        {chart.segments.map((points) => <polyline key={points} className="invest-worth-line" points={points} />)}
        {chart.dots.map((dot) => <circle key={dot.month} className="invest-dot" cx={dot.x} cy={dot.y} r="2.5" />)}
      </svg>
    );
  }
  return (
    <>
      <svg className="invest-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={copy.chartLabel(months[0].month, months[months.length - 1].month)}>
        <g className="invest-grid">
          {chart.yTicks.map((tick) => <line key={tick.y} x1={chart.gridLeft} y1={tick.y} x2={chart.gridRight} y2={tick.y} />)}
        </g>
        <g className="invest-axis">
          {chart.yTicks.map((tick) => <text key={tick.y} x="0" y={tick.y + 4}>{shortDollars(tick.valueMinor)}</text>)}
          {chart.xLabels.map((label) => <text key={label.month} x={label.x} y={chart.height - 4} textAnchor="middle">{shortMonth(label.month)}</text>)}
        </g>
        <polyline className="invest-putin-line" points={chart.putIn} />
        {chart.segments.map((points) => <polyline key={points} className="invest-worth-line" points={points} />)}
        {chart.dots.map((dot) => <circle key={dot.month} className="invest-dot" cx={dot.x} cy={dot.y} r="3.5" />)}
      </svg>
      <div className="invest-legend">
        <span><span className="invest-key is-worth" aria-hidden="true" />{copy.worthLegend}</span>
        <span><span className="invest-key is-putin" aria-hidden="true" />{startWorthMinor > 0 ? copy.putInLegendFromStart : copy.putInLegend}</span>
      </div>
    </>
  );
}

function AccountRows({ accounts, compact = false }) {
  return (
    <div className="invest-rows" role="table" aria-label={copy.accountsLabel} style={{ "--invest-columns": compact ? 2 : 3 }}>
      <div className="invest-row is-head" role="row">
        <span role="columnheader">{copy.account}</span>
        {compact ? null : <span role="columnheader">{copy.putIn}</span>}
        <span role="columnheader">{copy.worth}</span>
        <span role="columnheader">{copy.grewBy}</span>
      </div>
      {accounts.map((row) => {
        const name = `${row.personName ? `${row.personName} · ` : ""}${row.provider}`;
        return (
          <div key={row.accountId} className="invest-row" role="row" data-account={row.accountId} style={getPersonColourVars(row.personName || "shared")}>
            <span role="cell" className="invest-name">
              <span>{name}</span>
              <span className="invest-meta">{row.fromMonth ? copy.fromMonth(row.fromMonth) : copy.statementOn(row.asOfDate)}</span>
            </span>
            {compact ? null : <span role="cell"><PutInFigure putIn={row.putIn} name={name} /></span>}
            <span role="cell"><StatementFigure account={row.name} name={name}>{money(row.worthMinor)}</StatementFigure></span>
            <span role="cell" className={moneyToneClass(signTone(row.grewMinor))}>
              <StatementFigure account={row.name} name={name}>{signed(row.grewMinor)}</StatementFigure>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any> }} props
 */
export function InvestmentsCard({ view, enabled, fetchRequiredQuery }) {
  const queryClient = useQueryClient();
  const phone = useIsMobileLayout();
  const { areTotalsVisible } = useMoneyPrivacy();
  const [showRows, setShowRows] = useState(false);
  const viewId = view?.id ?? "household";
  const queryKey = useMemo(() => queryKeys.investmentsOverTime(viewId), [viewId]);
  const fetcher = useCallback((options) => requestInvestmentsOverTime(viewId, options), [viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "Investments request aborted." });
  if (!answer || !answer.accounts.length) {
    return null;
  }
  const lastMonth = answer.today.slice(0, 7);
  const period = `${answer.year}-01:${lastMonth}`;
  const grewTone = moneyToneClass(signTone(answer.grewMinor), "soft");
  return (
    <section className="chart-card invest-card" aria-labelledby="invest-title" data-fig-view="household" data-fig-period={period}>
      <div className="invest-head">
        <div>
          <h3 id="invest-title" className="invest-eyebrow">{copy.title}</h3>
          {phone ? null : <p className="invest-sub">{copy.worthOn(answer.asOfDate)}</p>}
        </div>
        <StatementFigure className="invest-worth" name={copy.title}>{money(answer.worthMinor)}</StatementFigure>
      </div>
      {phone ? (
        <>
          <p className="invest-phone-line">
            {copy.phonePutIn}<PutInFigure putIn={answer.putIn} name={copy.putInSince} />{copy.phoneSince}
            <StatementFigure className={moneyToneClass(signTone(answer.grewMinor))} name={copy.grewBy}>{signed(answer.grewMinor)}</StatementFigure>
          </p>
          {areTotalsVisible ? <Chart months={answer.months} compact startWorthMinor={answer.startWorthMinor} /> : null}
          <button type="button" className="invest-toggle" aria-expanded={showRows} onClick={() => setShowRows((open) => !open)}>
            {showRows ? copy.hideAccounts : copy.showAccounts}
          </button>
          {showRows ? <AccountRows accounts={answer.accounts} compact /> : null}
        </>
      ) : (
        <>
          <div className="invest-tiles">
            <div className="invest-tile">
              <span className="invest-tile-label">{copy.putInSince}</span>
              <PutInFigure className="invest-tile-figure" putIn={answer.putIn} name={copy.putInSince} />
            </div>
            <div className={`invest-tile ${grewTone}`}>
              <span className="invest-tile-label">{copy.grewBy}</span>
              <StatementFigure className="invest-tile-figure" name={copy.grewBy}>{signed(answer.grewMinor)}</StatementFigure>
            </div>
            <div className="invest-tile">
              <span className="invest-tile-label">{copy.paidOut}</span>
              <StatementFigure className="invest-tile-figure" name={copy.paidOut}>{money(answer.paidOutMinor)}</StatementFigure>
            </div>
          </div>
          {areTotalsVisible ? <Chart months={answer.months} startWorthMinor={answer.startWorthMinor} /> : null}
          <AccountRows accounts={answer.accounts} />
        </>
      )}
    </section>
  );
}
