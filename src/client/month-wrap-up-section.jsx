import "./month-wrap-up.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed } from "lucide-react";

import { monthWrapUpCopy as copy } from "./copy/month-wrap-up-copy";
import { money, moneyWithCurrency } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { queryKeys } from "./query-keys";
import { requestMonthWrapUp } from "./month-wrap-up-api";
import { buildMonthWrapUpView, longMonthName } from "./month-wrap-up-model";
import { useSummaryCardQuery } from "./use-summary-card-query";
import { CardHead } from "./summary-card-head";

// The month wrap-up (design.md "Month wrap-up"; DOMAIN.md "Month Wrap-up"):
// one calm checklist on the Month page for a month that has ended (or the
// month in progress in its last days). Each row is a check with a count or
// figure and one action that opens the place that deals with it; a done
// check stays as a quiet tick, and once every check is done the card is
// one line. It rides Spending mix's lazy chunk with the other Summary
// cards, and its data (GET /api/month-wrap-up) is read once the Month page
// is usable. The plan and the monthly note come from the Month page itself.

/** An openable figure (design.md "Openable figures"), its text unchanged. */
function Figure({ figure }) {
  const text = figure.currency ? moneyWithCurrency(figure.amountMinor, figure.currency) : money(figure.amountMinor);
  return (
    <span
      className={figure.tone ? moneyToneClass(figure.tone) : undefined}
      data-fig={figure.fig}
      data-fig-ids={figure.ids?.length ? figure.ids.join(" ") : undefined}
      data-fig-arg={figure.arg}
      data-fig-name={figure.name}
      data-fig-plan={figure.fig === "plan" ? "" : undefined}
      tabIndex={0}
      role="button"
    >
      {text}
    </span>
  );
}

function ChangedBlock({ changed, onSeeAll }) {
  return (
    <div className="wrapup-changed">
      <div className="wrapup-changed-head">
        <span className="wrapup-label">{changed.label}</span>
        <span className="wrapup-changed-against">{changed.against}</span>
        <button type="button" className="wrapup-action is-quiet" onClick={onSeeAll}>{changed.seeAll}</button>
      </div>
      <ul className="wrapup-changed-rows">
        {changed.rows.map((row) => (
          <li key={row.key} data-wrapup-changed={row.name}>
            <span className="wrapup-changed-name">{row.name}</span>
            {row.diffMinor !== null ? <span className="wrapup-changed-move">{row.move} {money(row.diffMinor)}</span> : null}
            {row.figure ? <Figure figure={row.figure} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ row, onAction }) {
  return (
    <li className={`wrapup-row ${row.done ? "is-done" : "is-open"}`} data-wrapup-check={row.id} data-done={row.done ? "true" : "false"}>
      <span className="wrapup-mark">
        {row.done ? <Check size={18} aria-hidden="true" /> : <CircleDashed size={18} aria-hidden="true" />}
        <span className="sr-only">{row.done ? copy.done : copy.toDo}</span>
      </span>
      <div className="wrapup-body">
        <span className="wrapup-label">{row.label}</span>
        {row.value || row.figure ? (
          <span className="wrapup-value">
            {row.value}
            {row.value && row.figure ? " · " : ""}
            {row.figure ? <Figure figure={row.figure} /> : null}
          </span>
        ) : null}
        {row.lines.length ? (
          <ul className="wrapup-lines">
            {row.lines.map((line) => (
              <li key={line.key}>
                {line.text}
                {line.figure ? <> <Figure figure={line.figure} /></> : null}
                {line.after ? ` ${line.after}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {row.action ? (
        <button type="button" className="wrapup-action" onClick={() => onAction(row.action)}>{row.action.label}</button>
      ) : null}
    </li>
  );
}

/**
 * @param {{ view: { id: string, selectedScope: string }, month: string, planSections: any[], monthNote: string, enabled: boolean, fetchRequiredQuery: (options: any) => Promise<any>, onAction: (action: { kind: string, ids?: string[] }) => void, onSeeAllChanged: () => void }} props
 */
export function MonthWrapUpSection({ view, month, planSections, monthNote, enabled, fetchRequiredQuery, onAction, onSeeAllChanged }) {
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  const viewId = view?.id ?? "household";
  const scope = view?.selectedScope;
  const queryKey = useMemo(() => queryKeys.monthWrapUp(viewId, scope, month), [month, scope, viewId]);
  const fetcher = useCallback((options) => requestMonthWrapUp(viewId, scope, month, options), [month, scope, viewId]);
  const answer = useSummaryCardQuery({ queryClient, queryKey, enabled, fetchRequiredQuery, fetcher, abortMessage: "Month wrap-up request aborted." });
  const card = useMemo(
    () => (answer?.wrapUp?.month === month ? buildMonthWrapUpView({ answer, planSections, monthNote, hidden: !areTotalsVisible }) : null),
    [answer, areTotalsVisible, month, monthNote, planSections]
  );

  // The month checklist reminder in Ask opens the Month page at this card
  // (#month-wrap-up): it is scrolled into view once it has drawn.
  const { hash, key } = useLocation();
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const scrolledFor = useRef("");
  useEffect(() => {
    if (hash === "#month-wrap-up" && card && ref.current && scrolledFor.current !== key) {
      scrolledFor.current = key;
      ref.current.scrollIntoView({ block: "start" });
    }
  }, [card, hash, key]);

  if (!card) {
    return null;
  }
  const monthName = longMonthName(card.month);
  if (card.wrappedUp) {
    return (
      <section ref={ref} id="month-wrap-up" className="chart-card wrapup-card is-wrapped" data-wrapped-up="true" aria-label={card.line}>
        <p className="wrapup-done"><Check size={18} aria-hidden="true" />{card.line}</p>
      </section>
    );
  }
  return (
    <section ref={ref} id="month-wrap-up" className="chart-card wrapup-card" aria-labelledby="wrapup-title" data-wrapped-up="false" data-fig-period={`${card.month}:${card.month}`}>
      <CardHead id="wrapUp" titleId="wrapup-title" context={{ month: card.month, done: card.done, total: card.total }} className="is-spaced" />
      {card.changed ? <ChangedBlock changed={card.changed} onSeeAll={onSeeAllChanged} /> : null}
      <ul className="wrapup-list" aria-label={copy.listLabel(monthName)}>
        {card.rows.map((row) => <Row key={row.id} row={row} onAction={onAction} />)}
      </ul>
    </section>
  );
}
