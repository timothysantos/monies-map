// What the app leaves behind when a screen or the whole app crashes, so the
// next report can be read from the app_error_diagnostics table (Settings >
// Error diagnostics) instead of guessed from a screen recording.
//
// Bounded and private by design: the error message, a trimmed stack and the
// component stack are code, never data. Only the page's path is kept (the
// query carries the person and month being viewed), and nothing here ever
// blocks or breaks the crash screen: the post is fire and forget.

const MESSAGE_LIMIT = 1500;
const STACK_LIMIT = 1500;
const COMPONENT_STACK_LIMIT = 1500;

const ACTIONS = {
  render: { app: "App crashed while rendering", screen: "Page crashed while rendering", section: "Section crashed while rendering" },
  "stylesheet-preload": { page: "A stylesheet failed to load (ridden out)" }
};

const trim = (value, limit) => String(value ?? "").slice(0, limit);

/**
 * @param {{ kind: string, level: string, error: unknown, componentStack?: string,
 *   location: { pathname: string, search?: string }, userAgent: string }} input
 */
export function buildCrashReport({ kind, level, error, componentStack = "", location, userAgent }) {
  const failure = /** @type {any} */ (error);
  const path = trim(location?.pathname ?? "", 200);
  return {
    source: "client_crash",
    action: ACTIONS[kind]?.[level] ?? `${kind} (${level})`,
    method: "GET",
    route: path,
    errorMessage: trim(failure?.message ?? failure, MESSAGE_LIMIT),
    possibleReason: kind === "stylesheet-preload"
      ? "A lazy chunk's stylesheet did not download, so the sheet may look unstyled."
      : "A component threw while rendering; see the stack in the request context.",
    requestContextJson: JSON.stringify({
      kind,
      level,
      path,
      name: trim(failure?.name ?? "", 80),
      stack: trim(failure?.stack ?? "", STACK_LIMIT),
      componentStack: trim(componentStack, COMPONENT_STACK_LIMIT),
      userAgent: trim(userAgent, 300)
    })
  };
}

/**
 * A reporter that posts each distinct crash once per page load. `post`
 * receives the diagnostic body and may reject; failures are swallowed.
 * @param {{ post: (body: object) => Promise<unknown>, location: { pathname: string, search?: string } | (() => { pathname: string, search?: string }), userAgent: string | (() => string) }} options
 */
export function createCrashReporter({ post, location, userAgent }) {
  const seen = new Set();
  // The page's path is read when a crash happens, not when this is created.
  const readLocation = () => (typeof location === "function" ? location() : location);
  const readUserAgent = () => (typeof userAgent === "function" ? userAgent() : userAgent);
  return (/** @type {{ kind: string, level: string, error: unknown, componentStack?: string }} */ crash) => {
    try {
      const report = buildCrashReport({ ...crash, location: readLocation(), userAgent: readUserAgent() });
      const key = `${crash.kind}|${crash.level}|${report.errorMessage}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      Promise.resolve(post(report)).catch(() => {});
    } catch {
      // Reporting must never add a second failure to the first.
    }
  };
}

/** The reporter wired to the browser and the diagnostics endpoint. */
export const reportClientCrash = createCrashReporter({
  post: (body) => fetch("/api/error-diagnostics/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true
  }),
  location: () => globalThis.location ?? { pathname: "", search: "" },
  userAgent: () => globalThis.navigator?.userAgent ?? ""
});
