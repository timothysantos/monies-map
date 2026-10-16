// This shortcut deliberately uses a small DOM module. It is imported after a
// route has painted, so the initial Summary bundle remains within its budget.
const SHOW_AFTER_PX = 160;
const DIRECTION_DELTA_PX = 24;
const HIDE_AFTER_MS = 5000;

export function mountScrollDirectionFab() {
  if (typeof window === "undefined") return () => {};
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scroll-direction-fab";
  let direction = null;
  let hideTimer = null;
  let lastScrollY = Math.max(0, window.scrollY);

  const hide = () => {
    direction = null;
    button.remove();
  };
  const clearHideTimer = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const show = (nextDirection) => {
    direction = nextDirection;
    button.setAttribute("aria-label", nextDirection === "top" ? "Go to top" : "Go to bottom");
    button.title = button.getAttribute("aria-label");
    button.textContent = nextDirection === "top" ? "↑" : "↓";
    if (!button.isConnected) document.body.appendChild(button);
    clearHideTimer();
    hideTimer = window.setTimeout(hide, HIDE_AFTER_MS);
  };
  const update = () => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const current = Math.max(0, window.scrollY);
    const delta = current - lastScrollY;
    lastScrollY = current;
    if (maximum < window.innerHeight * 0.65) {
      clearHideTimer();
      hide();
      return;
    }
    if (Math.abs(delta) < DIRECTION_DELTA_PX) return;
    const nextDirection = delta > 0
      ? (current > SHOW_AFTER_PX ? "top" : null)
      : (current < maximum - SHOW_AFTER_PX ? "bottom" : null);
    if (nextDirection) show(nextDirection);
    else {
      clearHideTimer();
      hide();
    }
  };
  const move = () => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: direction === "top" ? 0 : document.documentElement.scrollHeight, behavior: reduced ? "instant" : "smooth" });
    clearHideTimer();
    hide();
  };

  button.addEventListener("click", move);
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  return () => {
    clearHideTimer();
    button.removeEventListener("click", move);
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    button.remove();
  };
}
