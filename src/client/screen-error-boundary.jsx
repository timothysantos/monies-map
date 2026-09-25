import { Component } from "react";

import { messages } from "./copy/en-SG";

// Contains a render crash so it cannot unmount the whole app. The screen
// boundary wraps only the active page, so navigation keeps working; it clears
// itself when the route changes. The app boundary is the last resort around
// everything and can only offer a reload.
export class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retrying: false };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Still reported to the console so the loading-issue line and devtools
    // show what broke.
    console.error("A page failed to render.", error, info?.componentStack ?? "");
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, retrying: false });
    }
  }

  async handleRetry() {
    this.setState({ retrying: true });
    try {
      await this.props.onRetry?.();
    } finally {
      this.setState({ error: null, retrying: false });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    const copy = messages.common;
    const isAppLevel = this.props.level === "app";
    const panel = (
      <section className="panel app-loading-panel app-loading-panel-error screen-error-panel" role="alert">
        <div>
          <p>{isAppLevel ? copy.appCrashTitle : copy.screenCrashTitle}</p>
          <p className="app-loading-error-copy">{isAppLevel ? copy.appCrashDetail : copy.screenCrashDetail}</p>
        </div>
        <div className="screen-error-actions">
          {isAppLevel ? null : (
            <button type="button" className="subtle-action is-primary" onClick={this.handleRetry} disabled={this.state.retrying}>
              {this.state.retrying ? copy.working : copy.screenCrashRetry}
            </button>
          )}
          <button type="button" className={isAppLevel ? "subtle-action is-primary" : "subtle-action"} onClick={() => window.location.reload()}>
            {copy.screenCrashReload}
          </button>
        </div>
      </section>
    );
    return isAppLevel ? <main className="shell">{panel}</main> : panel;
  }
}
