// This shortcut deliberately uses a small DOM module. It is imported after a
// route has painted, so the initial Summary bundle remains within its budget.
const SHOW_AFTER_PX = 160;
const DIRECTION_DELTA_PX = 24;
const HIDE_AFTER_MS = 5000;

// The app's icon family is lucide (lucide-react elsewhere). This plain DOM
// module draws the same chevron-up / chevron-down paths at the island month
// arrows' size and stroke (19 px, 2.2), so the pair matches the rest of the
// chrome in every font (tests/scroll-direction-fab.test.mjs).
const ICON_PATHS = { top: "m18 15-6-6-6 6", bottom: "m6 9 6 6 6-6" };

export function scrollFabIcon(direction) {
  const path = ICON_PATHS[direction];
  if (!path) throw new Error(`Unknown scroll direction: ${direction}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

// A long page's chrome (App.jsx): the direction button, and `onScroll`, run
// now and on every scroll or resize (App shows the wide floating bar once the
// header has scrolled away). This module imports nothing, so loading it never
// changes how the first screen's shared modules are grouped into files.
export function mountLongPageChrome(onScroll) {
  const disposeFab = mountScrollDirectionFab();
  if (typeof window === "undefined") return disposeFab;
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  return () => {
    disposeFab();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
  };
}

export function mountScrollDirectionFab() {
  if (typeof window === "undefined") return () => {};
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scroll-direction-fab";
  let direction = null;
  let hideTimer = null;
  let bottomSettleTimer = null;
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
  const clearBottomSettleTimer = () => {
    if (bottomSettleTimer !== null) {
      window.clearTimeout(bottomSettleTimer);
      bottomSettleTimer = null;
    }
  };
  const show = (nextDirection) => {
    direction = nextDirection;
    button.setAttribute("aria-label", nextDirection === "top" ? "Go to top" : "Go to bottom");
    button.title = button.getAttribute("aria-label");
    button.innerHTML = scrollFabIcon(nextDirection);
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
      ? (current < maximum - SHOW_AFTER_PX ? "bottom" : null)
      : (current > SHOW_AFTER_PX ? "top" : null);
    if (nextDirection) show(nextDirection);
    else {
      clearHideTimer();
      hide();
    }
  };
  const move = () => {
    clearBottomSettleTimer();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const pageEnd = () => Math.max(
      0,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0
    );
    const target = direction === "top" ? 0 : pageEnd();
    const behavior = reduced ? "instant" : "smooth";
    window.scrollTo({ top: target, behavior });
    // A long page can measure taller after the first layout at its end. One
    // frame later keeps the promise of "bottom" without a persistent control.
    if (direction === "bottom") {
      window.requestAnimationFrame(() => window.scrollTo({ top: pageEnd(), behavior }));
      bottomSettleTimer = window.setTimeout(() => {
        bottomSettleTimer = null;
        window.scrollTo({ top: pageEnd(), behavior });
      }, 120);
    }
    clearHideTimer();
    hide();
  };

  button.addEventListener("click", move);
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  return () => {
    clearHideTimer();
    clearBottomSettleTimer();
    button.removeEventListener("click", move);
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    button.remove();
  };
}
