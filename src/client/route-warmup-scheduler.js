// Optional route warmup scheduler: route code first, then at most a few
// speculative data requests. Owns only bookkeeping for optional work: the
// current visit and generation, per-visit budgets, the rolling start list,
// one module and one data request in flight, one timer and one idle handle.
// Everything else is injected, so tests drive it with a fake clock and
// deferred promises. Actual navigation and required reads never go through
// here and are never blocked by it.

import { WARMUP_LIMITS } from "./route-warmup-policy.js";

// Denials that apply to this candidate only; the next candidate may still be
// eligible. Every other denial is a global gate and ends the pass.
const CANDIDATE_SPECIFIC_DENIALS = new Set(["already-loaded", "already-pending", "forbidden-route", "unknown-cost", "over-byte-cap", "not-admitted", "over-data-cap"]);
// Module-only limits: they stop further module candidates in this pass, but
// data candidates may still run.
const MODULE_LIMIT_DENIALS = new Set(["module-in-flight", "visit-module-budget", "rate-limit"]);
// If the quiet period is still running when the idle callback fires, retry
// no sooner than this, so a clock or limit mismatch can never busy-loop.
const QUIET_RETRY_MIN_DELAY_MS = 250;

export function createRouteWarmupScheduler({
  clock,
  idle,
  loadModule,
  readInput,
  evaluate,
  selectCandidates,
  costFor,
  // (candidate) -> { key, fresh, admission, start() -> { promise, cancel } } | null
  dataFor = () => null
}) {
  let generation = 0;
  let visitKey = null;
  let visit = { moduleStarts: 0, dataStarts: 0, lastDataStartAt: null };
  let recentModuleStarts = [];
  let moduleInFlight = false;
  let dataAttempt = null;
  // Data keys already attempted in this visit: never retried, whatever the
  // outcome, until the visit changes.
  let attemptedDataKeys = new Set();
  const pendingRoutes = new Set();
  let timer = null;
  let idleHandle = null;
  let disposed = false;

  function clearScheduled() {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    if (idleHandle !== null) {
      idle.cancel(idleHandle);
      idleHandle = null;
    }
  }

  function currentInput() {
    const input = readInput();
    if (!input || input.warmupMode === "off") {
      return null;
    }
    return input;
  }

  function policyInput(input, candidate) {
    return {
      mode: input.mode,
      now: clock.now(),
      page: input.page,
      work: input.work,
      quietSince: input.quietSince,
      visit,
      recentModuleStarts,
      moduleInFlight,
      dataInFlight: dataAttempt !== null,
      recentRequiredDurationMs: input.recentRequiredDurationMs ?? null,
      candidate
    };
  }

  function moduleCandidate(routeId, trigger) {
    const cost = costFor(routeId);
    return {
      kind: "module",
      routeId,
      trigger,
      alreadyLoaded: Boolean(cost.alreadyLoaded),
      missingBytes: cost.missingBytes ?? null,
      admission: null
    };
  }

  function evaluateModule(input, routeId, trigger) {
    if (pendingRoutes.has(routeId) || costFor(routeId).pending) {
      return { allowed: false, reason: "already-pending" };
    }
    return evaluate(policyInput(input, moduleCandidate(routeId, trigger)));
  }

  function track(routeId) {
    pendingRoutes.add(routeId);
    const settle = () => {
      pendingRoutes.delete(routeId);
    };
    // Start the import synchronously (pointer-down should not wait a tick).
    // Speculative work never surfaces a rejection or a synchronous throw.
    let loading;
    try {
      loading = Promise.resolve(loadModule(routeId));
    } catch (error) {
      loading = Promise.reject(error);
    }
    return loading.then(settle, settle);
  }

  function startAutomatic(routeId) {
    const now = clock.now();
    const startedGeneration = generation;
    // Reserve the slot before the import starts; a failure keeps it spent.
    visit = { ...visit, moduleStarts: visit.moduleStarts + 1 };
    recentModuleStarts = [...recentModuleStarts.filter((startedAt) => now - startedAt < WARMUP_LIMITS.mobile.windowMs), now];
    moduleInFlight = true;
    // Code settles before data may follow in the same visit. An import from
    // an older generation or a disposed scheduler just ends.
    return track(routeId).then(() => {
      moduleInFlight = false;
      if (!disposed && startedGeneration === generation) {
        schedule();
      }
    });
  }

  function startData(candidateData) {
    const startedGeneration = generation;
    // Reserve the slot before the request starts. Failed and aborted
    // attempts stay charged: no refunds, so nothing can retry in a loop.
    visit = { ...visit, dataStarts: visit.dataStarts + 1, lastDataStartAt: clock.now() };
    attemptedDataKeys.add(candidateData.key);
    let handle;
    try {
      handle = candidateData.start();
    } catch {
      handle = null;
    }
    if (!handle) {
      return;
    }
    const attempt = { generation: startedGeneration, cancel: handle.cancel };
    dataAttempt = attempt;
    Promise.resolve(handle.promise).catch(() => undefined).then(() => {
      if (dataAttempt === attempt) {
        dataAttempt = null;
      }
      if (!disposed && startedGeneration === generation) {
        schedule();
      }
    });
  }

  // Stop an exclusively speculative request when the visit or generation
  // changes, the tab hides, or protected work starts. A request that a
  // required reader joined is left running by its own cancel().
  function cancelDataAttempt() {
    if (dataAttempt) {
      dataAttempt.cancel();
    }
  }

  function runAutomatic(runGeneration) {
    if (disposed || runGeneration !== generation) {
      return;
    }
    const input = currentInput();
    if (!input || input.warmupMode === "intent-only") {
      return;
    }
    let modulesBlocked = false;
    for (const candidate of selectCandidates()) {
      let decision;
      let candidateData = null;
      if (candidate.kind === "module") {
        if (modulesBlocked) {
          continue;
        }
        decision = evaluateModule(input, candidate.routeId, "auto");
        if (decision.allowed) {
          startAutomatic(candidate.routeId);
          return;
        }
        if (MODULE_LIMIT_DENIALS.has(decision.reason)) {
          modulesBlocked = true;
          continue;
        }
      } else {
        candidateData = dataFor(candidate);
        if (!candidateData || attemptedDataKeys.has(candidateData.key)) {
          continue;
        }
        decision = evaluate(policyInput(input, {
          kind: "data",
          routeId: candidate.routeId,
          trigger: "auto",
          alreadyLoaded: Boolean(candidateData.fresh),
          missingBytes: null,
          admission: candidateData.admission ?? null
        }));
        if (decision.allowed) {
          startData(candidateData);
          return;
        }
        if (decision.reason === "data-spacing") {
          const spacingMs = WARMUP_LIMITS[input.mode]?.dataSpacingMs ?? 0;
          schedule(Math.max(QUIET_RETRY_MIN_DELAY_MS, visit.lastDataStartAt + spacingMs - clock.now()));
          return;
        }
      }
      if (decision.reason === "quiet-period") {
        // Interaction moved quietSince after the timer was armed.
        schedule(QUIET_RETRY_MIN_DELAY_MS);
        return;
      }
      if (!CANDIDATE_SPECIFIC_DENIALS.has(decision.reason)) {
        return;
      }
    }
  }

  function schedule(minimumDelay = 0) {
    clearScheduled();
    if (disposed) {
      return;
    }
    const input = currentInput();
    if (!input || input.warmupMode === "intent-only") {
      return;
    }
    const quietMs = WARMUP_LIMITS[input.mode]?.quietMs ?? WARMUP_LIMITS.mobile.quietMs;
    const delay = Math.max(minimumDelay, input.quietSince + quietMs - clock.now());
    const armedGeneration = generation;
    timer = clock.setTimeout(() => {
      timer = null;
      if (disposed || armedGeneration !== generation) {
        return;
      }
      // The timer only opens the window; readiness and budgets are re-read
      // when the idle callback runs.
      idleHandle = idle.request(() => {
        idleHandle = null;
        runAutomatic(armedGeneration);
      });
    }, delay);
  }

  return {
    // Call on every input change. A new visit key starts a new visit (fresh
    // per-visit budget); newGeneration alone (for example a query epoch
    // change) invalidates queued work without refilling the visit budget.
    updateContext({ visitKey: nextVisitKey, newGeneration = false } = {}) {
      if (disposed) {
        return;
      }
      if (nextVisitKey !== visitKey) {
        visitKey = nextVisitKey;
        generation += 1;
        visit = { moduleStarts: 0, dataStarts: 0, lastDataStartAt: null };
        attemptedDataKeys = new Set();
        cancelDataAttempt();
      } else if (newGeneration) {
        generation += 1;
        cancelDataAttempt();
      } else {
        const input = readInput();
        if (!input || !input.page?.visible || input.work?.busy || input.warmupMode === "off") {
          cancelDataAttempt();
        }
      }
      schedule();
    },

    // Exact link intent. Returns the policy decision for diagnostics.
    offerIntent({ routeId, trigger }) {
      if (disposed) {
        return { allowed: false, reason: "disposed" };
      }
      const input = currentInput();
      if (!input) {
        return { allowed: false, reason: "warmup-off" };
      }
      const decision = evaluateModule(input, routeId, trigger);
      if (decision.allowed) {
        // Precise intent replaces the pending automatic guess for this visit;
        // the next context update re-arms it if budget remains.
        clearScheduled();
        track(routeId);
      }
      return decision;
    },

    dispose() {
      disposed = true;
      clearScheduled();
      cancelDataAttempt();
    },

    // Diagnostics for tests and development only.
    inspect() {
      return {
        generation,
        visitKey,
        visit: { ...visit },
        recentModuleStarts: [...recentModuleStarts],
        moduleInFlight,
        dataInFlight: dataAttempt !== null,
        pendingRoutes: [...pendingRoutes],
        hasTimer: timer !== null,
        hasIdle: idleHandle !== null,
        disposed
      };
    }
  };
}
