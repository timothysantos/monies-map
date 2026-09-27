import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  buildDeterministicFinancialInsight,
  buildFinancialInsightCacheKey
} from "../domain/ai-assistance-insights";
import { composeCheckIn, pickQuote, recordQuote, recordVisit } from "../domain/money-signals/checkin";
import { SIGNAL_KIND_LABELS } from "../domain/money-signals/types";
import { readVisitMemory, writeVisitMemory } from "./checkin-visit-memory";
import { useMoneyPrivacy } from "./money-privacy";
// The check-in's own styles ship with the route that shows it, not with
// the first-screen stylesheet.
import "./money-checkin.css";

const INSIGHT_DEBOUNCE_MS = 700;
const INSIGHT_CACHE_TTL_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INSIGHT_CACHE_ENTRIES = 48;
const AI_PERSON_PLACEHOLDER = "[selected person]";
const insightCache = new Map();

// Money insights (the money check-in in code): one computed signal worth
// knowing (with its kind chip, a way to think about it and at most one
// existing action), a Just for fun line, and the long view. "See all
// insights" adds up to three
// more signals, a fitting quote and the Money consequence map.
//
// `checkIn` carries the page's signals (src/domain/money-signals), the
// visit memory key and context, and the visit's clock. What was shown is
// remembered only in this browser (checkin-visit-memory.js).
//
// Optional AI wording is in-memory only: it avoids repeat requests while
// the app is open without retaining financial wording in storage.
// canRequestWording is the route's "usable" state (loaded, no editor or
// save in progress): AI wording never competes with protected work, and the
// computed wording is shown until a valid response arrives. The AI may only
// choose words around the fact and the think line, which stay verbatim.
export function FinancialInsight({ facts, checkIn, actions = [], onCheckInAction, className = "", canRequestWording = false }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { memoryKey, contextKey, signals, calmLine, clock, alsoLabel = "Also worth knowing", ready = true } = checkIn;
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
    calmLine,
    ready
  }), [calmLine, clock.nowMs, clock.today, contextKey, memorySnapshot, ready, seed, signals]);
  const { headline } = view;
  const headlineFacts = useMemo(() => (
    headline.kind && headline.kind !== "long_view" && headline.kind !== "just_for_fun" && headline.think
      ? { headlineKind: headline.kind, fact: headline.fact, think: headline.think }
      : null
  ), [headline.fact, headline.kind, headline.think]);
  const cacheKey = useMemo(() => (headlineFacts ? buildFinancialInsightCacheKey(facts, headlineFacts) : ""), [facts, headlineFacts]);
  const aiFacts = useMemo(() => (headlineFacts
    ? {
      ...facts,
      ...(facts.audienceKind === "person" ? { audienceName: AI_PERSON_PLACEHOLDER } : {}),
      ...headlineFacts
    }
    : null), [facts, headlineFacts]);
  const deterministicNarrative = headlineFacts ? buildDeterministicFinancialInsight(headlineFacts) : "";
  const insightLabel = facts.audienceKind === "person" && facts.audienceName
    ? `${facts.audienceName}'s money insights`
    : "Household money insights";
  const [response, setResponse] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [quote, setQuote] = useState(null);
  const alsoId = useId();
  const detailsId = useId();
  const aiNarrative = cacheKey && response?.key === cacheKey && response.narrative !== deterministicNarrative
    ? response.narrative
    : null;
  // Latest values for the request, read when it starts, so a new facts object
  // with the same content never restarts the debounce.
  const latestRef = useRef({ facts, aiFacts, deterministicNarrative, cacheKey });
  latestRef.current = { facts, aiFacts, deterministicNarrative, cacheKey };

  useEffect(() => {
    setIsExpanded(false);
  }, [cacheKey, contextKey]);

  // Remember this visit (only while the numbers are visible and the page's
  // data is complete). Merged into the latest stored memory.
  useEffect(() => {
    if (!areTotalsVisible || !ready) {
      return;
    }
    const latest = readVisitMemory(memoryKey);
    writeVisitMemory(memoryKey, recordVisit(latest, view, signals, { nowMs: clock.nowMs, today: clock.today, contextKey }));
  }, [areTotalsVisible, clock.nowMs, clock.today, contextKey, memoryKey, ready, signals, view]);

  // A quote only in the expanded view, never beside a bigger question. The
  // library loads on demand, so it is never part of the first screen.
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
        const picked = pickQuote(QUOTES, view.quoteTopic, memorySnapshot, clock.nowMs, seed);
        setQuote(picked ? { id: picked.id, text: picked.text, citation: quoteCitation(picked) } : null);
        if (picked) {
          writeVisitMemory(memoryKey, recordQuote(readVisitMemory(memoryKey), picked.id, clock.nowMs));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [areTotalsVisible, clock.nowMs, isExpanded, memoryKey, memorySnapshot, seed, view.quoteTopic]);

  useEffect(() => {
    if (!areTotalsVisible || !cacheKey) {
      setResponse(null);
      return undefined;
    }
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setResponse({ key: cacheKey, narrative: cached.narrative });
      return undefined;
    }
    setResponse(null);
    if (!canRequestWording) {
      return undefined;
    }

    const requestKey = cacheKey;
    const { facts: requestFacts, aiFacts: requestAiFacts, deterministicNarrative: fallbackNarrative } = latestRef.current;
    let cancelled = false;
    const controller = new AbortController();
    // Only a response for these exact facts, from a request that was not
    // cancelled by an edit, a privacy change or new facts, is kept.
    const isCurrent = () => !cancelled && latestRef.current.cacheKey === requestKey;
    const timer = window.setTimeout(async () => {
      try {
        const fetchResponse = await fetch("/api/ai-assist/financial-insight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ facts: requestAiFacts }),
          signal: controller.signal
        });
        let payload = null;
        if (fetchResponse.ok) {
          try {
            payload = await fetchResponse.json();
          } catch {
            payload = null;
          }
        }
        if (!isCurrent()) {
          return;
        }
        const candidate = typeof payload?.narrative === "string" && payload.narrative.trim()
          ? localizeFinancialInsightNarrative(payload.narrative.trim(), requestFacts)
          : null;
        // Wording is kept only when it still carries the fact and the think
        // line word for word; anything else falls back to computed wording.
        const aiWording = candidate && requestAiFacts && candidate.includes(requestAiFacts.fact) && candidate.includes(requestAiFacts.think)
          ? candidate
          : null;
        const narrative = aiWording ?? fallbackNarrative;
        setInsightCache(requestKey, {
          narrative,
          expiresAt: Date.now() + (aiWording && payload?.available ? INSIGHT_CACHE_TTL_MS : UNAVAILABLE_CACHE_TTL_MS)
        });
        setResponse({ key: requestKey, narrative });
      } catch {
        if (isCurrent() && !controller.signal.aborted) {
          setInsightCache(requestKey, {
            narrative: fallbackNarrative,
            expiresAt: Date.now() + UNAVAILABLE_CACHE_TTL_MS
          });
        }
      }
    }, INSIGHT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [areTotalsVisible, cacheKey, canRequestWording]);

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
          {aiNarrative ? (
            <NarrativeWithFact narrative={aiNarrative} fact={headline.fact} />
          ) : (
            <>
              <strong className="checkin-fact">{headline.fact}</strong>
              {headline.think ? <span className="checkin-think"> {headline.think}</span> : null}
            </>
          )}
        </p>
        {headline.action && onCheckInAction ? (
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
          <p className="checkin-fun">
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
          {isExpanded && facts.decisionMap?.enabled ? <FinancialDecisionMap decisionMap={facts.decisionMap} /> : null}
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

// AI wording keeps the computed fact verbatim, so it is found and kept bold.
function NarrativeWithFact({ narrative, fact }) {
  const index = fact ? narrative.indexOf(fact) : -1;
  if (index < 0) {
    return narrative;
  }
  return (
    <>
      {narrative.slice(0, index)}
      <strong className="checkin-fact is-inline">{fact}</strong>
      {narrative.slice(index + fact.length)}
    </>
  );
}

function localizeFinancialInsightNarrative(narrative, facts) {
  if (facts.audienceKind !== "person" || !facts.audienceName) {
    return narrative;
  }
  return narrative.split(AI_PERSON_PLACEHOLDER).join(facts.audienceName);
}

function FinancialDecisionMap({ decisionMap }) {
  return (
    <section className="financial-decision-map" aria-label="Money consequence map">
      <div className="financial-decision-map-head">
        <strong>Money consequence map</strong>
        <span>{decisionMap.needsReview ? "Bank-record checks needed" : "Grounded in visible records"}</span>
      </div>
      <div className="financial-decision-map-lanes">
        {decisionMap.lanes.map((lane) => (
          <div key={lane.id} className={`financial-decision-lane is-${lane.tone}`}>
            <span>{lane.label}</span>
            <strong>{lane.value}</strong>
            <p>{lane.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function setInsightCache(key, value) {
  const now = Date.now();
  for (const [cachedKey, cachedValue] of insightCache) {
    if (cachedValue.expiresAt <= now) {
      insightCache.delete(cachedKey);
    }
  }
  if (insightCache.size >= MAX_INSIGHT_CACHE_ENTRIES) {
    const oldestKey = insightCache.keys().next().value;
    if (oldestKey) {
      insightCache.delete(oldestKey);
    }
  }
  insightCache.set(key, value);
}
