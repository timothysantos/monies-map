import { useEffect, useMemo, useState } from "react";

import {
  buildDeterministicFinancialInsight,
  buildFinancialInsightCacheKey
} from "../domain/ai-assistance-insights";

const INSIGHT_DEBOUNCE_MS = 700;
const INSIGHT_CACHE_TTL_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INSIGHT_CACHE_ENTRIES = 48;
const insightCache = new Map();

// This is deliberately in-memory only: it avoids repeat requests while the
// app is open without retaining financial wording or merchant data in storage.
export function FinancialInsight({ facts, actions = [], className = "" }) {
  const cacheKey = useMemo(() => buildFinancialInsightCacheKey(facts), [facts]);
  const deterministicNarrative = useMemo(() => buildDeterministicFinancialInsight(facts), [facts]);
  const [response, setResponse] = useState(null);
  const visibleNarrative = response?.key === cacheKey
    ? response.narrative
    : deterministicNarrative;

  useEffect(() => {
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setResponse({ key: cacheKey, narrative: cached.narrative });
      return undefined;
    }

    setResponse(null);
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const fetchResponse = await fetch("/api/ai-assist/financial-insight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ facts }),
          signal: controller.signal
        });
        const payload = await fetchResponse.json();
        const narrative = typeof payload?.narrative === "string" && payload.narrative.trim()
          ? payload.narrative.trim()
          : deterministicNarrative;
        setInsightCache(cacheKey, {
          narrative,
          expiresAt: Date.now() + (payload?.available ? INSIGHT_CACHE_TTL_MS : UNAVAILABLE_CACHE_TTL_MS)
        });
        if (!cancelled) {
          setResponse({ key: cacheKey, narrative });
        }
      } catch {
        if (!controller.signal.aborted) {
          setInsightCache(cacheKey, {
            narrative: deterministicNarrative,
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
  }, [cacheKey, deterministicNarrative, facts]);

  return (
    <section className={`financial-insight ${className}`.trim()} aria-label="Financial insight">
      <span className="financial-insight-label">Financial insight</span>
      <div className="financial-insight-content">
        <p aria-live="polite">{visibleNarrative}</p>
        {facts.decisionMap?.enabled ? <FinancialDecisionMap decisionMap={facts.decisionMap} /> : null}
        {actions.length ? (
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
