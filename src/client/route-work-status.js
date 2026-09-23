// Route work status: which route is active, whether its owners have the data
// they need (ready), and whether any protected workflow is open (busy).
// Pure and framework-free so the shell, later warmup policy, and tests share
// one definition. Owners report; nothing here fetches or stores DTOs.

const ROUTES_WITH_MONTH = new Set(["summary", "month", "entries", "splits"]);

// Normalized identity of the ACTIVE route. Cosmetic params (summary_focus,
// money privacy, sheet toggles) are never inputs, so they cannot change it.
// Entries and Splits keep scope even though their data ignores it, because it
// is still part of where the user is.
export function buildRouteIdentity({ tabId, viewId, month, scope, summaryStart, summaryEnd }) {
  const usesMonth = ROUTES_WITH_MONTH.has(tabId);
  return Object.freeze({
    tabId,
    viewId: usesMonth ? viewId ?? "household" : "",
    month: usesMonth ? month ?? "" : "",
    scope: usesMonth ? scope ?? "direct_plus_shared" : "",
    summaryStart: tabId === "summary" ? summaryStart ?? "" : "",
    summaryEnd: tabId === "summary" ? summaryEnd ?? "" : ""
  });
}

export function buildRouteWorkKey(identity) {
  return [
    identity.tabId,
    identity.viewId,
    identity.month,
    identity.scope,
    identity.summaryStart,
    identity.summaryEnd
  ].join("|");
}

// Aggregates reports from every mounted owner. An owner ID identifies one
// mounted instance, so one idle component can never clear another's busy
// state, and cleanup releases only its own report.
export function createRouteWorkRegistry() {
  const reports = new Map();
  const listeners = new Set();
  let version = 0;

  const notify = () => {
    version += 1;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    report({ ownerId, routeKey, ready, busy }) {
      const previous = reports.get(ownerId);
      const next = { routeKey, ready: Boolean(ready), busy: Boolean(busy) };
      if (previous && previous.routeKey === next.routeKey && previous.ready === next.ready && previous.busy === next.busy) {
        return false;
      }
      reports.set(ownerId, next);
      notify();
      return true;
    },
    release(ownerId) {
      if (!reports.delete(ownerId)) {
        return false;
      }
      notify();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version() {
      return version;
    },
    snapshot(routeKey) {
      let reportCount = 0;
      let ready = true;
      const busyOwnerIds = [];
      for (const [ownerId, report] of reports) {
        if (report.busy) {
          // A dialog still closing on the previous route keeps blocking until
          // it releases.
          busyOwnerIds.push(ownerId);
        }
        if (report.routeKey === routeKey) {
          reportCount += 1;
          ready = ready && report.ready;
        }
      }
      return {
        hasReport: reportCount > 0,
        ready: reportCount > 0 && ready,
        busy: busyOwnerIds.length > 0,
        busyOwnerIds
      };
    }
  };
}

// Counts required fetches the shell awaits outside its loading counter.
// Optional prefetch, banner and AI requests must never be counted, or later
// scheduling would wait on its own work.
export function createRequiredWorkCounter() {
  const active = new Map();
  const listeners = new Set();
  let nextId = 0;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    begin(label) {
      const id = nextId;
      nextId += 1;
      active.set(id, label);
      notify();
      let ended = false;
      return () => {
        if (ended) {
          return;
        }
        ended = true;
        active.delete(id);
        notify();
      };
    },
    count() {
      return active.size;
    },
    labels() {
      return [...active.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export async function withRequiredWork(counter, label, task) {
  const end = counter.begin(label);
  try {
    return await task();
  } finally {
    end();
  }
}

// Evaluates in a fixed order and returns the FIRST failing reason. Reason
// strings are for tests and development diagnostics only.
export function deriveRouteWork({
  routeKey,
  hasPageView,
  isAppShellLoading,
  hasShellError,
  hasRouteError,
  hasReferenceData,
  routeDataReady,
  snapshot,
  requiredCount,
  mobileContextOpen,
  loginRegistrationBlocking
}) {
  const readyReason = !hasPageView ? "no-page-view"
    : isAppShellLoading ? "shell-loading"
    : hasShellError ? "shell-error"
    : hasRouteError ? "route-error"
    : !hasReferenceData ? "no-reference-data"
    : !routeDataReady ? "route-data-pending"
    : !snapshot.hasReport ? "no-report"
    : !snapshot.ready ? "not-ready"
    : null;
  const busyReason = mobileContextOpen ? "mobile-context-open"
    : loginRegistrationBlocking ? "login-registration"
    : snapshot.busy ? "busy"
    : null;
  const ready = readyReason === null;
  const busy = busyReason !== null;
  const reason = readyReason ?? busyReason ?? (requiredCount > 0 ? "required-work" : "usable");

  return {
    routeKey,
    ready,
    busy,
    requiredCount,
    usable: ready && !busy && requiredCount === 0,
    reason
  };
}
