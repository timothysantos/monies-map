import "./ui/states.css";
import { CircleAlert } from "lucide-react";

import { describeLoadFailure } from "./request-errors";
import { BottomActions } from "./ui/lead-support-detail";

// Shared presentation for "nothing here", "this failed" and "this screen
// failed" states, so every page words, structures and retries them the same
// way. Presentation only: callers own the copy (from copy/en-SG.js) and every
// retry handler. Structure is Lead · Support · Detail (design.md "States"):
// the title is the Lead, one quiet detail line is the Support, the technical
// line is the Detail, and one primary action closes the card.

// The action bar: the `primary` action last (under the thumb), any others
// quiet beside it. `actions` are `{ label, onClick, disabled, primary }`.
function StateActions({ actions }) {
  const primary = actions.find((action) => action.primary);
  return (
    <BottomActions
      primaryLabel={primary?.label}
      onPrimary={primary?.onClick}
      primaryDisabled={primary?.disabled}
      secondary={actions.filter((action) => action !== primary).map((action, index) => (
        <button key={index} type="button" className="lsd-quiet" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    />
  );
}

// The Lead card behind every titled state: an optional icon bubble, the
// title, one support line, extra detail lines and the action bar.
function StateCard({ state, tone = undefined, icon = null, title, detail = null, detailClassName = "", className = "", role = undefined, technicalDetail = "", children = null, actions = null }) {
  return (
    <section className={["state-card", icon ? "has-icon" : "", className].filter(Boolean).join(" ")} data-state={state} data-tone={tone} role={role} data-technical-detail={technicalDetail || undefined}>
      <div className="state-head">
        {icon ? <span className="state-bubble" aria-hidden="true">{icon}</span> : null}
        <div className="state-text">
          <strong className="state-title">{title}</strong>
          {detail ? <p className={["state-detail", detailClassName].filter(Boolean).join(" ")}>{detail}</p> : null}
          {children}
        </div>
      </div>
      {actions}
    </section>
  );
}

// Nothing to show yet. A single muted line by default; with a title or an
// action it becomes a Lead card that says what is missing (the title), why
// or what next (the children, one quiet line) and the one next step
// (`action`, the primary; `secondary`, quiet beside it). `actions` still
// takes ready-made controls. `compact` is the same two lines with no card,
// for a section that already has its action nearby.
export function EmptyState({ title = null, children = null, actions = null, action = null, secondary = null, icon = null, compact = false, className = "" }) {
  if (compact && title) {
    return (
      <div className={["state-note", className].filter(Boolean).join(" ")} data-state="empty">
        <strong className="state-title">{title}</strong>
        {children ? <p className="state-detail">{children}</p> : null}
      </div>
    );
  }
  if (!title && !actions && !action) {
    return <p className={["empty-state", className].filter(Boolean).join(" ")}>{children}</p>;
  }
  const bar = action ? <StateActions actions={[{ ...action, primary: true }, ...(secondary ? [secondary] : [])]} /> : actions;
  return <StateCard state="empty" icon={icon} title={title} detail={children} className={className} actions={bar} />;
}

// A failure inside a section that the person can read in place, optionally
// with a retry. `className` replaces the default spacing class for contexts
// that already style their error line (for example the mobile sheet).
export function InlineError({ message, retryLabel = "", retryingLabel = "", isRetrying = false, onRetry = null, className = "form-error" }) {
  if (!message) {
    return null;
  }
  if (!onRetry) {
    return <p className={`inline-error ${className}`} role="alert">{message}</p>;
  }
  return (
    <div className={`inline-error has-retry ${className}`} role="alert">
      <span>{message}</span>
      <button type="button" className="subtle-action is-primary" onClick={onRetry} disabled={isRetrying}>
        {isRetrying && retryingLabel ? retryingLabel : retryLabel}
      </button>
    </div>
  );
}

// A whole screen (or the whole app) could not be shown: a rose Lead card
// centred in the viewport. `actions` lists the buttons in order; the first
// `primary` one is the main way forward and the rest sit quietly beside it.
// `technical` is the failure's technical reason: the card shows one plain line
// for it (describeLoadFailure) as the Detail and keeps the reason itself on the
// card as data-technical-detail, for inspection, never as screen text.
// `children` is any further Detail (a diagnosis).
export function ErrorPanel({ title, detail, technical = "", children = null, actions = [], className = "" }) {
  const plainLine = describeLoadFailure(technical);
  return (
    <StateCard
      state="error"
      tone="rose"
      icon={<CircleAlert />}
      title={title}
      detail={detail}
      detailClassName="app-loading-error-copy"
      className={["is-screen app-loading-panel app-loading-panel-error", className].filter(Boolean).join(" ")}
      role="alert"
      technicalDetail={technical}
      actions={actions.length ? <StateActions actions={actions} /> : null}
    >
      {plainLine ? <p className="app-loading-issue-inline">{plainLine}</p> : null}
      {children}
    </StateCard>
  );
}

// A notice above a page, in a pastel tone: the title leads, one quiet line
// supports it, and one primary action (plus an optional quiet one) closes it.
// `tone` is a pastel name: `butter` for something that needs a look, `sky`
// for information.
export function StateBanner({ tone, title, detail = null, actions = [], className = "", role = "status" }) {
  return (
    <section className={["state-banner", className].filter(Boolean).join(" ")} data-tone={tone} role={role}>
      <div className="state-text">
        <strong className="state-title">{title}</strong>
        {detail ? <span className="state-detail">{detail}</span> : null}
      </div>
      <StateActions actions={actions} />
    </section>
  );
}
