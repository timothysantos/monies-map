// Shared presentation for "nothing here", "this failed" and "this screen
// failed" states, so every page words, structures and retries them the same
// way. Presentation only: callers own the copy (from copy/en-SG.js) and every
// retry handler.

// Nothing to show yet. A single line by default; with a title or actions it
// becomes a small block that explains the state and offers the next step.
export function EmptyState({ title = null, children = null, actions = null, className = "" }) {
  const classes = ["empty-state", title || actions ? "is-detailed" : "", className].filter(Boolean).join(" ");
  if (!title && !actions) {
    return <p className={classes}>{children}</p>;
  }
  return (
    <section className={classes}>
      {title ? <strong>{title}</strong> : null}
      {children ? <p>{children}</p> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </section>
  );
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

// A whole screen (or the whole app) could not be shown. `actions` lists the
// buttons in order; the first `primary` one is the main way forward.
export function ErrorPanel({ title, detail, children = null, actions = [], className = "" }) {
  return (
    <section className={["panel app-loading-panel app-loading-panel-error", className].filter(Boolean).join(" ")} role="alert">
      <div>
        <p>{title}</p>
        {detail ? <p className="app-loading-error-copy">{detail}</p> : null}
        {children}
      </div>
      {actions.length ? (
        <div className="screen-error-actions">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={action.primary ? "dialog-primary" : "subtle-action"}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
