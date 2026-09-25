import { Component } from "react";

import { messages } from "./copy/en-SG";
import { ErrorPanel } from "./ui-states";

// Contains a render crash so it cannot unmount the whole app. The screen
// boundary wraps only the active page, so navigation keeps working; it clears
// itself when the route changes. The app boundary is the last resort around
// everything and can only offer a reload.

// React.lazy keeps a failed code download failed, so for those only a reload
// helps (usually a deploy replaced the old files).
function isCodeLoadError(error) {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError/i
    .test(String(error?.message ?? error ?? ""));
}

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
      this.reset();
    }
  }

  // The crash log also lands on the shell's loading-issue line; onReset lets
  // App clear it once the page is drawn again.
  reset() {
    this.setState({ error: null, retrying: false });
    this.props.onReset?.();
  }

  async handleRetry() {
    this.setState({ retrying: true });
    try {
      await this.props.onRetry?.();
    } finally {
      this.reset();
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    const copy = messages.common;
    const isAppLevel = this.props.level === "app";
    const needsReload = isAppLevel || isCodeLoadError(this.state.error);
    const title = isCodeLoadError(this.state.error)
      ? copy.codeLoadCrashTitle
      : isAppLevel ? copy.appCrashTitle : copy.screenCrashTitle;
    const reloadAction = { label: copy.screenCrashReload, onClick: () => window.location.reload(), primary: needsReload };
    const panel = (
      <ErrorPanel
        className="screen-error-panel"
        title={title}
        detail={needsReload ? copy.appCrashDetail : copy.screenCrashDetail}
        actions={needsReload ? [reloadAction] : [
          {
            label: this.state.retrying ? copy.working : copy.screenCrashRetry,
            onClick: this.handleRetry,
            disabled: this.state.retrying,
            primary: true
          },
          reloadAction
        ]}
      />
    );
    return isAppLevel ? <main className="shell">{panel}</main> : panel;
  }
}
