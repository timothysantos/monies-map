import { messages } from "./copy/en-SG";
import { describeLoadFailure } from "./request-errors";
import { ErrorPanel } from "./ui-states";

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

// A whole-shell failure with one retry. The detail line is plain language;
// the technical reason (the loading issue, or the raw error when no issue was
// recorded) goes to the panel, which words it plainly (see ErrorPanel).
export function ShellErrorScreen({ environment, title, detail = messages.common.loadFailedDetail, message, diagnosis = null, issue, retryLabel, onRetry }) {
  const technical = issue && (!message || String(issue).includes(message)) ? issue : [message, issue].filter(Boolean).join(" · ");
  return (
    <main className="shell">
      <EnvironmentBanner environment={environment} />
      <ErrorPanel
        title={title}
        detail={detail}
        technical={technical}
        actions={[{ label: retryLabel, onClick: onRetry, primary: true }]}
      >
        {diagnosis}
      </ErrorPanel>
    </main>
  );
}

// What each first screen is made of, top to bottom, so the placeholder has
// the same blocks and about the same height as the page that replaces it
// and nothing jumps when the data lands. Summary: the month chips, the lead
// figures, the insight lines and a chart card. Entries: the totals strip,
// the insight lines, the filter bar and a day of rows. Splits: the group
// row, the lead summary and activity rows.
const SKELETON_SHAPES = {
  summary: "chips lead lines card",
  entries: "totals lines filter day row row row",
  splits: "nav lead day row row row"
};
const PAGE_SHAPES = "lead row row row";

// The shell while the first page is still resolving: the header, then the
// page's own Lead · Support · Detail layout as quiet placeholders, with one
// support line saying what is happening. No buttons, no figures.
export function ShellLoadingScreen({ environment, tabId, status, elapsedSeconds }) {
  const detail = ellipsizeText(status?.detail ?? "");
  // A past failure is worded plainly here too, never as its technical reason.
  const issueLine = describeLoadFailure(status?.issue);
  const support = [messages.common.loading, detail, elapsedSeconds >= 5 ? `${elapsedSeconds}s` : ""].filter(Boolean).join(" · ");
  return (
    <main className="shell">
      <EnvironmentBanner environment={environment} />
      <section className="state-skeleton app-loading-panel" data-state="loading" data-skeleton={SKELETON_SHAPES[tabId] ? tabId : "page"} role="status" aria-live="polite" aria-busy="true">
        <div className="sk sk-bar" />
        <div className="sk-panel">
          <div className="sk sk-title" />
          <p className="state-detail">{support}</p>
          {(SKELETON_SHAPES[tabId] ?? PAGE_SHAPES).split(" ").map((shape, index) => <div key={index} className={`sk sk-${shape}`} />)}
          {issueLine ? <p className="app-loading-issue-inline" title={status.issue}>{issueLine}</p> : null}
        </div>
      </section>
    </main>
  );
}

// A route is fetching the latest data while the previous page stays on
// screen: one quiet pill, clear of the period picker. The figures behind it
// (percent, detail, elapsed) are the tooltip; only a problem is spelled out.
export function AppLoadingOverlay({ status = null, elapsedSeconds = 0, className = "" }) {
  const progress = [typeof status?.percent === "number" ? `${Math.max(0, Math.min(100, Math.round(status.percent)))}%` : "", ellipsizeText(status?.detail ?? ""), elapsedSeconds > 0 ? `${elapsedSeconds}s` : ""].filter(Boolean).join(" · ");
  // A past failure is worded plainly here too, never as its technical reason.
  const issueLine = describeLoadFailure(status?.issue);
  return (
    <div className={["state-pill app-loading-overlay", className].filter(Boolean).join(" ")} role="status" aria-live="polite" title={progress}>
      <span className="app-spinner" aria-hidden="true" />
      <span>{messages.common.loadingLatest}</span>
      {issueLine ? <small title={status.issue}>{issueLine}</small> : null}
    </div>
  );
}
