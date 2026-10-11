import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { composeCheckIn, pickQuote, recordVisit } from "../domain/money-signals/checkin";
import { SIGNAL_KIND_LABELS } from "../domain/money-signals/types";
import { readVisitMemory, writeVisitMemory } from "./checkin-visit-memory";
import { useMoneyPrivacy } from "./money-privacy";
// The check-in's own styles ship with the route that shows it, not with
// the first-screen stylesheet.
import "./money-checkin.css";

// Money insights (the money check-in in code): one computed signal worth
// knowing (with its kind chip, a way to think about it and at most one
// existing action), a Just for fun line, and the long view. "See all
// insights" adds up to three more signals, a fitting quote and the page's
// remaining review links (`actions`).
//
// `checkIn` carries the page's signals (src/domain/money-signals), the
// page and period being viewed (what rotates follows the period, so nothing
// repeats within a year of months: rotation.ts), the page's trivia schedule
// and calm lines, the visit memory key and context, and the visit's clock.
// What was shown is remembered only in this browser
// (checkin-visit-memory.js), and only adds rests, quiet visits and sorted.
//
// `checkIn` is null while a page's insights module is still loading
// (Summary's loads beside the first screen: money-insights-loader.js); the
// insights then show their frame only, one line high.
//
// The headline is always the computed fact (bold) and its think line as
// written: no AI rewording.
//
// `audienceName` is the person a person view's insights address ("Tim's
// money insights"); it is empty for the household.
//
// `isCheckInActionShown(action)` lets a page hide the headline's link when
// pressing it would change nothing (Entries, already filtered to those
// records).
export function FinancialInsight(props) {
  return props.checkIn ? <FinancialInsightCheckIn {...props} /> : <FinancialInsightFrame {...props} />;
}

function insightLabelFor(audienceName) {
  return audienceName ? `${audienceName}'s money insights` : "Household money insights";
}

// The insights' frame while their module loads: the label and one empty
// line, with the same box as the insights, so nothing new is said.
function FinancialInsightFrame({ audienceName = "", className = "" }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return (
    <section className={`financial-insight ${className}`.trim()} aria-label="Money insights" aria-busy={areTotalsVisible ? "true" : undefined} data-checkin-mode={areTotalsVisible ? "loading" : undefined}>
      <span className="financial-insight-label">{insightLabelFor(audienceName)}</span>
      <div className="financial-insight-content">
        {areTotalsVisible
          ? <p className="financial-insight-narrative" aria-hidden="true">{"\u00a0"}</p>
          : <p className="financial-insight-private-copy">Reveal money totals to read these insights.</p>}
      </div>
    </section>
  );
}

function FinancialInsightCheckIn({ audienceName = "", checkIn, actions = [], onCheckInAction, isCheckInActionShown, className = "" }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { memoryKey, contextKey, signals, page, period, triviaRotation, calmLines, clock, alsoLabel = "Also worth knowing", ready = true } = checkIn;
  const seed = `${memoryKey}|${contextKey}`;
  // The memory as this visit found it: the check-in is composed from it,
  // so recording the visit never changes what is on screen.
  const memorySnapshot = useMemo(() => readVisitMemory(memoryKey), [memoryKey]);
  const view = useMemo(() => composeCheckIn({
    signals,
    memory: memorySnapshot,
    nowMs: clock.nowMs,
    today: clock.today,
    seed,
    contextKey,
    period,
    triviaRotation,
    calmLines,
    ready
  }), [calmLines, clock.nowMs, clock.today, contextKey, memorySnapshot, period, ready, seed, signals, triviaRotation]);
  const { headline } = view;
  const insightLabel = insightLabelFor(audienceName);
  const [isExpanded, setIsExpanded] = useState(false);
  const [quote, setQuote] = useState(null);
  const alsoId = useId();
  const detailsId = useId();

  // A new headline or context closes "See all insights".
  useEffect(() => {
    setIsExpanded(false);
  }, [contextKey, headline.fact, headline.kind, headline.think]);

  // Remember this visit (only while the numbers are visible and the page's
  // data is complete). Merged into the latest stored memory.
  useEffect(() => {
    if (!areTotalsVisible || !ready) {
      return;
    }
    const latest = readVisitMemory(memoryKey);
    writeVisitMemory(memoryKey, recordVisit(latest, view, signals, { nowMs: clock.nowMs, today: clock.today, contextKey }));
  }, [areTotalsVisible, clock.nowMs, clock.today, contextKey, memoryKey, ready, signals, view]);

  // A quote only in the expanded view, never beside a bigger question,
  // chosen by page and period. The library loads on demand, so it is never
  // part of the first screen.
  useEffect(() => {
    if (!isExpanded || !view.quoteTopic || !areTotalsVisible) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    import("../domain/money-signals/quotes")
      .then(({ QUOTES, quoteCitation }) => {
        if (cancelled) {
          return;
        }
        const picked = pickQuote(QUOTES, view.quoteTopic, { page, period });
        setQuote(picked ? { id: picked.id, text: picked.text, citation: quoteCitation(picked) } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [areTotalsVisible, isExpanded, page, period, view.quoteTopic]);

  if (!areTotalsVisible) {
    return (
      <section className={`financial-insight ${className}`.trim()} aria-label="Money insights">
        <span className="financial-insight-label">{insightLabel}</span>
        <div className="financial-insight-content">
          <p className="financial-insight-private-copy">Reveal money totals to read these insights.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`financial-insight ${className}`.trim()} aria-label="Money insights" data-checkin-mode={view.mode}>
      <span className="financial-insight-label">{insightLabel}</span>
      <div className="financial-insight-content">
        {headline.kind ? <CheckInChip kind={headline.kind} /> : null}
        <p className="financial-insight-narrative" aria-live="polite">
          <strong className="checkin-fact">{headline.fact}</strong>
          {headline.think ? <span className="checkin-think"> {headline.think}</span> : null}
        </p>
        {headline.action && onCheckInAction && (!isCheckInActionShown || isCheckInActionShown(headline.action)) ? (
          <button type="button" className="checkin-action" onClick={() => onCheckInAction(headline.action)}>
            {headline.action.label}
          </button>
        ) : null}
        <div id={alsoId} hidden={!isExpanded || !view.also.length}>
          {isExpanded && view.also.length ? (
            <div className="checkin-also">
              <span className="checkin-line-label">{alsoLabel}</span>
              <ul>
                {view.also.map((line) => (
                  <li key={line.key}>
                    <CheckInChip kind={line.kind} />
                    <span>{line.fact}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {view.fun ? (
          <p className="checkin-fun" data-trivia-type={view.fun.type}>
            <span className="checkin-line-label">{SIGNAL_KIND_LABELS.just_for_fun}</span>
            {view.fun.text}
          </p>
        ) : null}
        {isExpanded && quote ? (
          <figure className="checkin-quote">
            <blockquote>{`“${quote.text}”`}</blockquote>
            <figcaption>{quote.citation}</figcaption>
          </figure>
        ) : null}
        {view.longView ? (
          <p className="checkin-long-view">
            <span className="checkin-line-label">{SIGNAL_KIND_LABELS.long_view}</span>
            {view.longView.fact} {view.longView.think}
          </p>
        ) : null}
        <button
          type="button"
          className="financial-insight-toggle"
          aria-expanded={isExpanded}
          aria-controls={`${alsoId} ${detailsId}`}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {isExpanded ? "Show less" : "See all insights"}
        </button>
        <div id={detailsId} hidden={!isExpanded}>
          {isExpanded && actions.length ? (
            <div className="financial-insight-actions" aria-label="Review related records">
              {actions.map((action) => (
                <button key={action.label} type="button" className="subtle-action" onClick={action.onClick}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CheckInChip({ kind }) {
  return <span className={`checkin-chip is-${kind.replace(/_/g, "-")}`}>{SIGNAL_KIND_LABELS[kind]}</span>;
}
