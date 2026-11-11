import "./summary-cards.css";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { taxReliefsCopy as copy, timesWords } from "./copy/summary-cards-copy";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { getPersonColourVars } from "./person-colour";
import { queryKeys } from "./query-keys";
import { requestTaxReliefs } from "./summary-cards-api";
import { useSummaryCardQuery } from "./use-summary-card-query";
import { CardHead } from "./summary-card-head";

// Tax reliefs this year (design.md "Tax reliefs"; DOMAIN.md "Tax Relief"):
// for each person, the SRS and CPF cash top-ups and charity gifts that lower
// next year's income tax, against each yearly limit, the room left and the
// days until 31 December. It never shows the tax saved (the app does not
// know anyone's income) and never advises. In Spending Mix's lazy chunk; its
// data is read only once the top summary is usable, and it shows nothing in
// a year nobody used a relief.
//
// Each amount used is an openable figure in the household view
// (data-fig-view: whole amounts): `outflow` narrowed to exactly the entries
// it counted, whose Entries total is the amount (money-figures.ts,
// taxReliefFigureMinor). A limit is IRAS's, not the household's money, so it
// is plain text. With money hidden the bars and the room left are not shown.

// "$15,300" for a whole-dollar amount, "$12.50" otherwise.
function amount(minor) {
  const text = money(minor);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}

function Figure({ figure, name }) {
  if (!figure.ids.length) {
    return <b>{amount(figure.amountMinor)}</b>;
  }
  return (
    <b data-fig="outflow" data-fig-ids={figure.ids.join(" ")} data-fig-name={name} data-fig-ask="taxRelief" tabIndex={0} role="button">
      {amount(figure.amountMinor)}
    </b>
  );
}

function ReliefLine({ relief, personName, shown }) {
  const share = relief.limitMinor > 0 ? Math.min(100, Math.round((relief.amountMinor / relief.limitMinor) * 100)) : 0;
  const isFull = relief.amountMinor >= relief.limitMinor;
  return (
    <div className="tax-relief" data-relief={relief.key}>
      <div className="tax-relief-line">
        <span>{copy.reliefs[relief.key]}</span>
        <span><Figure figure={relief} name={`${personName} · ${copy.reliefNames[relief.key]}`} />{copy.of}{amount(relief.limitMinor)}</span>
      </div>
      {shown ? (
        <>
          <div className="tax-bar" aria-hidden="true">{share > 0 ? <div className="tax-bar-fill" style={{ width: `${share}%` }} /> : null}</div>
          {isFull ? <span className="tax-full">{copy.full}</span> : relief.amountMinor > 0 ? <span className="tax-room">{copy.roomLeft(amount(relief.roomMinor))}</span> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * @param {{ view: any, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any> }} props
 */
export function TaxReliefsCard({ view, enabled, fetchRequiredQuery }) {
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  const viewId = view?.id ?? "household";
  const queryKey = useMemo(() => queryKeys.taxReliefs(viewId), [viewId]);
  const fetcher = useCallback((options) => requestTaxReliefs(viewId, options), [viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "Tax reliefs request aborted." });
  if (!answer || !answer.people.length) {
    return null;
  }
  const times = timesWords(answer.charityTimes);
  return (
    <section className="chart-card tax-card" aria-labelledby="tax-title" data-fig-view="household" data-fig-period={`${answer.year}-01:${answer.today.slice(0, 7)}`}>
      <CardHead id="taxreliefs" titleId="tax-title" context={{ year: answer.year }} className="tax-head" action={<span className="tax-deadline">{copy.daysLeft(answer.daysLeft)}</span>} />
      <p className="tax-sub">{copy.filedIn(answer.year)}</p>
      {answer.people.map((person) => (
        <div key={person.personId} className="tax-person" data-person={person.personId} style={getPersonColourVars(person.name)}>
          <h4 className="tax-person-name"><span className="tax-person-dot" aria-hidden="true" />{person.name}</h4>
          {person.reliefs.map((relief) => <ReliefLine key={relief.key} relief={relief} personName={person.name} shown={areTotalsVisible} />)}
          {person.charity.amountMinor > 0 ? (
            <div className="tax-charity" data-relief="charity">
              <span>{copy.charity}</span>
              <span>
                <Figure figure={person.charity} name={`${person.name} · ${copy.charityName}`} />
                {areTotalsVisible ? copy.charityCounted(times, amount(person.charity.deductionMinor)) : null}
              </span>
            </div>
          ) : null}
        </div>
      ))}
      <p className="tax-footnote">{answer.limitsFallback ? copy.footnoteFallback(answer.limitsYear, answer.year) : copy.footnote(answer.year)}</p>
    </section>
  );
}
