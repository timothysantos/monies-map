// Pure warmup policy: decides whether one optional module or data request may
// start now, and which exact destinations are worth considering. No DOM,
// React, timers, fetch or imports; the scheduler (H05/H07) injects time,
// capabilities and route work. Reason strings are for tests and development
// diagnostics only, never user-visible copy.

export const WARMUP_LIMITS = Object.freeze({
  desktop: Object.freeze({ quietMs: 1200, autoModulesPerVisit: 1, dataPerVisit: 2, dataSpacingMs: 1500 }),
  mobile: Object.freeze({
    quietMs: 2000,
    autoModulesPerVisit: 1,
    dataPerVisit: 1,
    maxModuleBytes: 50_000,
    autoModulesPerWindow: 2,
    windowMs: 60_000,
    maxDataBytes: 50_000,
    maxDataHandlerMs: 250,
    maxRecentRequiredMs: 500
  }),
  speculativeDeadlineMs: 1500
});

const SLOW_CONNECTIONS = new Set(["slow-2g", "2g", "3g"]);
// Routes whose code is never warmed automatically: large, rarely next, or
// workflow-heavy. Explicit link intent may still warm them.
const NO_AUTOMATIC_MODULE_ROUTES = new Set(["imports", "settings", "faq"]);
const INTENT_TRIGGERS = new Set(["hover", "focus", "pointerdown"]);
const TRIGGERS = new Set(["auto", ...INTENT_TRIGGERS]);

// Hybrid and unknown devices get the conservative mobile policy: a touch
// laptop or a missing media query must not unlock desktop speculation.
export function selectWarmupMode({ narrowViewport, coarsePointer } = {}) {
  if (narrowViewport === false && coarsePointer === false) {
    return "desktop";
  }
  return "mobile";
}

function deny(reason) {
  return { allowed: false, reason };
}

function isValidInput(input) {
  return Boolean(
    input
    && (input.mode === "desktop" || input.mode === "mobile")
    && Number.isFinite(input.now)
    && Number.isFinite(input.quietSince)
    && input.page
    && input.work
    && input.visit
    && Array.isArray(input.recentModuleStarts)
    && input.candidate
    && (input.candidate.kind === "module" || input.candidate.kind === "data")
    && TRIGGERS.has(input.candidate.trigger)
    && typeof input.candidate.routeId === "string"
  );
}

export function evaluateWarmup(input) {
  // Malformed input fails closed rather than accidentally allowing work.
  if (!isValidInput(input)) {
    return deny("invalid-input");
  }

  const { mode, now, page, work, quietSince, visit, recentModuleStarts, candidate } = input;
  const limits = WARMUP_LIMITS[mode];
  const isMobile = mode === "mobile";

  // 1-3: safety gates that no trigger bypasses.
  if (!page.visible) return deny("hidden");
  if (!page.online) return deny("offline");
  if (page.saveData) return deny("save-data");
  if (isMobile && SLOW_CONNECTIONS.has(page.effectiveType)) return deny("slow-connection");
  if (!work.ready) return deny("not-ready");
  if (work.busy) return deny("busy");
  if (work.requiredCount > 0) return deny("required-work");

  // 4: already loaded (module) or fresh (data) costs nothing and is not charged.
  if (candidate.alreadyLoaded) return deny("already-loaded");

  const isQuiet = now - quietSince >= limits.quietMs;

  if (candidate.kind === "module") {
    if (candidate.trigger !== "auto") {
      // 6: precise link intent bypasses quiet, byte, visit and rate limits.
      if (candidate.trigger === "hover" && isMobile) return deny("hover-on-mobile");
      return { allowed: true, reason: "ok" };
    }

    // 5: automatic likely-next module.
    if (NO_AUTOMATIC_MODULE_ROUTES.has(candidate.routeId)) return deny("forbidden-route");
    if (!isQuiet) return deny("quiet-period");
    if (input.moduleInFlight) return deny("module-in-flight");
    if (visit.moduleStarts >= limits.autoModulesPerVisit) return deny("visit-module-budget");
    if (isMobile) {
      if (candidate.missingBytes === null || candidate.missingBytes === undefined) return deny("unknown-cost");
      if (candidate.missingBytes > limits.maxModuleBytes) return deny("over-byte-cap");
      // A start exactly windowMs old has expired.
      const startsInWindow = recentModuleStarts.filter((startedAt) => now - startedAt < limits.windowMs).length;
      if (startsInWindow >= limits.autoModulesPerWindow) return deny("rate-limit");
    }
    return { allowed: true, reason: "ok" };
  }

  // 7: speculative data. Intent never starts data before navigation.
  if (candidate.trigger !== "auto") return deny("data-needs-auto");
  if (!isQuiet) return deny("quiet-period");
  if (input.dataInFlight) return deny("data-in-flight");
  if (isMobile && input.moduleInFlight) return deny("module-before-data");
  if (visit.dataStarts >= limits.dataPerVisit) return deny("visit-data-budget");
  if (!isMobile) {
    if (visit.lastDataStartAt !== null && visit.lastDataStartAt !== undefined
      && now - visit.lastDataStartAt < limits.dataSpacingMs) {
      return deny("data-spacing");
    }
    return { allowed: true, reason: "ok" };
  }

  // Missing connection information is not permission to spend data.
  if (page.effectiveType !== "4g") return deny("connection-not-4g");
  if (input.recentRequiredDurationMs === null || input.recentRequiredDurationMs === undefined
    || input.recentRequiredDurationMs > limits.maxRecentRequiredMs) {
    return deny("recent-required-slow");
  }
  if (!candidate.admission) return deny("not-admitted");
  if (candidate.admission.responseBytes > limits.maxDataBytes
    || candidate.admission.handlerMs > limits.maxDataHandlerMs) {
    return deny("over-data-cap");
  }
  return { allowed: true, reason: "ok" };
}

// A visit is one route identity plus the workflow context the caller passes
// (for example the selected split group). Only listed identity fields count,
// so cosmetic params such as summary_focus or privacy never start a visit.
export function buildVisitKey(identity, workflowContext = {}) {
  const context = Object.entries(workflowContext)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return [
    identity.tabId,
    identity.viewId ?? "",
    identity.month ?? "",
    identity.scope ?? "",
    identity.summaryStart ?? "",
    identity.summaryEnd ?? "",
    context
  ].join("|");
}

function entriesIdentity({ viewId, month, scope }) {
  // Scope stays in the route intent even though the Entries API ignores it.
  return { tabId: "entries", viewId, month, scope, summaryStart: "", summaryEnd: "" };
}

// Route code is the same for every month and view, so module candidates
// dedupe by route; data candidates dedupe by exact destination.
function candidateId(candidate) {
  return candidate.kind === "module"
    ? `module:${candidate.routeId}`
    : `data:${candidate.purpose}:${buildVisitKey(candidate.identity)}`;
}

function module(identity, trigger = "auto") {
  return { kind: "module", routeId: identity.tabId, identity, trigger, purpose: "route-module" };
}

function data(routeId, identity, purpose) {
  return { kind: "data", routeId, identity, trigger: "auto", purpose };
}

function adjacentMonths(availableMonths, month) {
  const index = availableMonths.indexOf(month);
  if (index === -1) {
    return [];
  }
  return [availableMonths[index - 1], availableMonths[index + 1]].filter(Boolean);
}

// Candidates are abstract destinations; H05/H07 adapters turn them into
// loaders and exact query keys with the real route builders. Only
// destinations derivable from the current route and session are proposed:
// never another person's view, never a guessed month.
export function selectWarmupCandidates({
  mode,
  identity,
  availableMonths = [],
  summaryRange = null,
  recentDestination = null,
  intent = null
}) {
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    const id = candidateId(candidate);
    if (!seen.has(id)) {
      seen.add(id);
      candidates.push(candidate);
    }
  };
  const isMobile = mode !== "desktop";

  // 1: exact link intent (module only; data waits for real navigation).
  if (intent?.identity && INTENT_TRIGGERS.has(intent.trigger)) {
    add(module(intent.identity, intent.trigger));
  }

  // 2: the last destination the user chose from this route in this tab,
  // only within the same person view.
  if (recentDestination
    && recentDestination.viewId === identity.viewId
    && recentDestination.tabId !== identity.tabId) {
    if (!NO_AUTOMATIC_MODULE_ROUTES.has(recentDestination.tabId)) {
      add(module(recentDestination));
    }
    if (recentDestination.tabId === "entries") {
      add(data("entries", entriesIdentity(recentDestination), "entries-page"));
    }
  }

  // 3: the one defined route pair, for the exact month and view in the URL.
  if (identity.tabId === "summary" || identity.tabId === "month") {
    const next = entriesIdentity(identity);
    add(module(next));
    add(data("entries", next, "entries-page"));
  }

  // 5: mobile stops here; no adjacent months, ranges or banner on mobile.
  if (isMobile) {
    return candidates;
  }

  // 4: desktop keeps the useful current prefetch choices, in priority order.
  if (identity.tabId === "month") {
    for (const month of adjacentMonths(availableMonths, identity.month)) {
      add(data("month", { ...identity, month }, "month-page"));
    }
  }
  if (identity.tabId === "summary" && summaryRange) {
    const startIndex = availableMonths.indexOf(summaryRange.startMonth);
    const endIndex = availableMonths.indexOf(summaryRange.endMonth);
    if (startIndex !== -1 && endIndex !== -1) {
      for (const offset of [-1, 1]) {
        const summaryStart = availableMonths[startIndex + offset];
        const summaryEnd = availableMonths[endIndex + offset];
        if (summaryStart && summaryEnd) {
          add(data("summary", { ...identity, summaryStart, summaryEnd }, "summary-page"));
        }
      }
      // No pills candidate: account pills depend only on the view, so a
      // shifted range reuses the pills already loaded for this page.
    }
  }
  if (identity.tabId === "entries") {
    for (const month of adjacentMonths(availableMonths, identity.month)) {
      add(data("entries", entriesIdentity({ ...identity, month }), "entries-page"));
    }
  }
  if (identity.tabId === "summary" || identity.tabId === "month") {
    add(data("imports", { tabId: "imports", viewId: "", month: "", scope: "", summaryStart: "", summaryEnd: "" }, "imports-page"));
  }

  return candidates;
}
