const MOBILE_WIDTH_QUERY = "(max-width: 760px)";
const FOCUSABLE_FORM_CONTROL_SELECTOR = [
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[contenteditable='true']"
].join(",");

function isMobileViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    window.matchMedia?.(MOBILE_WIDTH_QUERY).matches ||
    (window.visualViewport && window.visualViewport.width <= 760)
  );
}

function isFormControl(element) {
  return element instanceof Element && element.matches(FOCUSABLE_FORM_CONTROL_SELECTOR);
}

export function keepFocusedControlVisible(target, options = {}) {
  if (!isFormControl(target) || !isMobileViewport()) {
    return;
  }

  const visualViewport = window.visualViewport;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const bottomPadding = options.bottomPadding ?? 132;
  const topPadding = options.topPadding ?? 24;
  const safeTop = viewportTop + topPadding;
  const safeBottom = viewportBottom - bottomPadding;
  const rect = target.getBoundingClientRect();

  let scrollDelta = 0;
  if (rect.bottom > safeBottom) {
    scrollDelta = rect.bottom - safeBottom;
  } else if (rect.top < safeTop) {
    scrollDelta = rect.top - safeTop;
  }

  if (Math.abs(scrollDelta) > 1) {
    window.scrollBy({
      top: scrollDelta,
      behavior: options.behavior ?? "auto"
    });
  }
}

export function installMobileFocusVisibility() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const timers = new Set();
  const scheduledTargets = new WeakMap();

  function clearTimer(timer) {
    timers.delete(timer);
  }

  function scheduleVisibilityCheck(target) {
    if (!isFormControl(target)) {
      return;
    }

    const currentTimer = scheduledTargets.get(target);
    if (currentTimer) {
      window.clearTimeout(currentTimer);
      clearTimer(currentTimer);
    }

    const timer = window.setTimeout(() => {
      clearTimer(timer);
      scheduledTargets.delete(target);
      keepFocusedControlVisible(target);
    }, 240);
    scheduledTargets.set(target, timer);
    timers.add(timer);
  }

  function handleFocusIn(event) {
    scheduleVisibilityCheck(event.target);
  }

  function handleVisualViewportChange() {
    scheduleVisibilityCheck(document.activeElement);
  }

  document.addEventListener("focusin", handleFocusIn, true);
  window.visualViewport?.addEventListener("resize", handleVisualViewportChange);

  return () => {
    document.removeEventListener("focusin", handleFocusIn, true);
    window.visualViewport?.removeEventListener("resize", handleVisualViewportChange);
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.clear();
  };
}
