import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  buildDeterministicFinancialInsight,
  buildFinancialInsightCacheKey
} from "../domain/ai-assistance-insights";
import { useMoneyPrivacy } from "./money-privacy";

const INSIGHT_DEBOUNCE_MS = 700;
const INSIGHT_CACHE_TTL_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INSIGHT_CACHE_ENTRIES = 48;
const AI_PERSON_PLACEHOLDER = "[selected person]";
const insightCache = new Map();

// This is deliberately in-memory only: it avoids repeat requests while the
// app is open without retaining financial wording or merchant data in storage.
// canRequestWording is the route's "usable" state (loaded, no editor or save
// in progress): optional AI wording never competes with protected work, and
// the deterministic wording is shown until a valid response arrives.
export function FinancialInsight({ facts, actions = [], className = "", canRequestWording = false }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const cacheKey = useMemo(() => buildFinancialInsightCacheKey(facts), [facts]);
  const deterministicNarrative = useMemo(() => buildDeterministicFinancialInsight(facts), [facts]);
  const aiFacts = useMemo(() => (
    facts.audienceKind === "person"
      ? { ...facts, audienceName: AI_PERSON_PLACEHOLDER }
      : facts
  ), [facts]);
  const insightLabel = facts.audienceKind === "person" && facts.audienceName
    ? `${facts.audienceName}'s money check-in`
    : "Household money check-in";
  const [response, setResponse] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const narrativeId = useId();
  const visibleNarrative = response?.key === cacheKey
    ? response.narrative
    : deterministicNarrative;
  // Latest values for the request, read when it starts, so a new facts object
  // with the same content never restarts the debounce.
  const latestRef = useRef({ facts, aiFacts, deterministicNarrative, cacheKey });
  latestRef.current = { facts, aiFacts, deterministicNarrative, cacheKey };

  useEffect(() => {
    setIsExpanded(false);
  }, [cacheKey]);

  useEffect(() => {
    if (!areTotalsVisible) {
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
        const aiNarrative = typeof payload?.narrative === "string" && payload.narrative.trim()
          ? payload.narrative.trim()
          : null;
        const localNarrative = localizeFinancialInsightNarrative(aiNarrative ?? fallbackNarrative, requestFacts);
        setInsightCache(requestKey, {
          narrative: localNarrative,
          expiresAt: Date.now() + (aiNarrative && payload?.available ? INSIGHT_CACHE_TTL_MS : UNAVAILABLE_CACHE_TTL_MS)
        });
        setResponse({ key: requestKey, narrative: localNarrative });
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
      <section className={`financial-insight ${className}`.trim()} aria-label="Financial insight">
        <span className="financial-insight-label">{insightLabel}</span>
        <div className="financial-insight-content">
          <p className="financial-insight-private-copy">Reveal money totals to read this insight.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`financial-insight ${className}`.trim()} aria-label="Financial insight">
      <span className="financial-insight-label">{insightLabel}</span>
      <div className="financial-insight-content">
        <p
          id={narrativeId}
          className={isExpanded ? "financial-insight-narrative" : "financial-insight-narrative is-collapsed"}
          aria-live="polite"
        >
          {visibleNarrative}
        </p>
        {!isExpanded && facts.notableFact ? (
          <p className="financial-insight-pattern">{facts.notableFact}</p>
        ) : null}
        <button
          type="button"
          className="financial-insight-toggle"
          aria-expanded={isExpanded}
          aria-controls={narrativeId}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {isExpanded ? "Show less" : "Read full insight"}
        </button>
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
    </section>
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
