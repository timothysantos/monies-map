import { messages } from "./copy/en-SG";

// Loading and error chrome for the app shell. Presentation only: App decides
// which state applies and owns every retry handler.

// Trim long route labels and status text so loading chrome stays readable
// without expanding into the whole shell.
function ellipsizeText(value, maxLength = 52) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

// Show a small environment badge only when the app is running locally or in
// the demo environment.
export function EnvironmentBanner({ environment }) {
  if (environment !== "demo" && environment !== "local") {
    return null;
  }

  return (
    <div className={`environment-banner environment-banner-${environment}`}>
      {environment}
    </div>
  );
}

// A whole-shell failure with one retry. `issuePlacement` keeps the loading
// issue line where each screen has always shown it: after the copy block, or
// inside it for page failures.
export function ShellErrorScreen({ environment, title, message, diagnosis = null, issue, issuePlacement = "after", retryLabel, onRetry }) {
  const issueLine = issue ? <p className="app-loading-issue-inline">{issue}</p> : null;
  return (
    <main className="shell">
      <EnvironmentBanner environment={environment} />
      <section className="panel app-loading-panel app-loading-panel-error">
        <div>
          <p>{title}</p>
          <p className="app-loading-error-copy">{message}</p>
          {diagnosis}
          {issuePlacement === "inside" ? issueLine : null}
        </div>
        {issuePlacement === "after" ? issueLine : null}
        <button type="button" className="button-primary" onClick={onRetry}>
          {retryLabel}
        </button>
      </section>
    </main>
  );
}

// The shell while either the shell or the active page is still resolving.
export function ShellLoadingScreen({ environment, status, elapsedSeconds }) {
  return (
    <main className="shell">
      <EnvironmentBanner environment={environment} />
      <AppLoadingPanel status={status} elapsedSeconds={elapsedSeconds} />
    </main>
  );
}

// Compact the loading copy and status line so the startup panel stays readable
// while the shell is still assembling.
function AppLoadingStatusText({ status, elapsedSeconds, compact = false }) {
  const percentText = typeof status?.percent === "number" ? `${Math.max(0, Math.min(100, Math.round(status.percent)))}%` : null;
  const elapsedText = elapsedSeconds > 0 ? `${elapsedSeconds}s` : null;
  const detailText = ellipsizeText(status?.detail ?? "");
  const meta = [percentText, detailText, elapsedText].filter(Boolean).join(" · ");

  return (
    <div className={`app-loading-status ${compact ? "is-compact" : ""}`}>
      <small title={status?.detail ?? ""}>{meta}</small>
      {status?.issue ? <small className="is-error" title={status.issue}>{ellipsizeText(status.issue, compact ? 64 : 84)}</small> : null}
    </div>
  );
}

// Full-screen startup state used before the shell or route payload is ready.
function AppLoadingPanel({ status, elapsedSeconds }) {
  return (
    <section className="panel app-loading-panel" role="status" aria-live="polite">
      <div className="app-loading-main">
        <span className="app-spinner" aria-hidden="true" />
        <p>{messages.common.loading}</p>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} />
    </section>
  );
}

// Overlay status used while a route fetch is still hydrating the current
// screen.
export function AppLoadingOverlay({ status, elapsedSeconds }) {
  return (
    <div className="app-loading-overlay" role="status" aria-live="polite">
      <div className="app-loading-overlay-main">
        <span className="app-spinner" aria-hidden="true" />
        <span>{messages.common.loadingLatest}</span>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} compact />
    </div>
  );
}

// In-panel fallback for route hydration, separate from the full startup state.
export function RouteChunkLoadingFallback({ status, elapsedSeconds }) {
  return (
    <section className="route-loading-panel" role="status" aria-live="polite">
      <div className="app-loading-main">
        <span className="app-spinner" aria-hidden="true" />
        <p>{messages.common.loadingLatest}</p>
      </div>
      <AppLoadingStatusText status={status} elapsedSeconds={elapsedSeconds} compact />
    </section>
  );
}
