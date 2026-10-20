// Marks a sticky day row (Entries, Splits) with data-stuck while it holds
// the top of the screen, so its CSS can turn it into its pinned look
// (design.md, "Entries list"). One IntersectionObserver per sticky top, no
// scroll listener: the root's top edge is pulled in to 1px below the row's
// sticky top (0, or just under the environment banner), so a row stuck there
// is just under 100% visible, and one resting lower is fully so. A row whose
// sticky top has changed since (the banner arrived late) moves to the right
// observer on its next callback. When a row pins, the space from the window's
// edges to its own goes to --date-bleed-left and --date-bleed-right, so the
// Entries band behind it reaches both edges of the window. The attribute and
// the variables are set on the element directly, so no render follows.

const observers = new Map();
const observerOf = new WeakMap();

function stickyTopOf(element) {
  return Math.ceil(parseFloat(getComputedStyle(element).top)) || 0;
}

function setBleed(element, rect, windowWidth) {
  element.style.setProperty("--date-bleed-left", `${Math.max(0, rect.left)}px`);
  element.style.setProperty("--date-bleed-right", `${Math.max(0, windowWidth - rect.right)}px`);
}

function observe(element, stickyTop) {
  let observer = observers.get(stickyTop);
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const row = entry.target;
        const top = stickyTopOf(row);
        if (top !== stickyTop) {
          observer.unobserve(row);
          observe(row, top);
          continue;
        }
        const stuck = entry.isIntersecting && entry.intersectionRatio < 1 && entry.boundingClientRect.top < stickyTop + 1;
        if (stuck) setBleed(row, entry.boundingClientRect, document.documentElement.clientWidth);
        row.toggleAttribute("data-stuck", stuck);
      }
    }, { rootMargin: `-${stickyTop + 1}px 0px 0px 0px`, threshold: [0, 1] });
    observers.set(stickyTop, observer);
  }
  observer.observe(element);
  observerOf.set(element, observer);
}

// A resize moves the column, not the pinned row's top: re-measure the bleed
// of the rows pinned now.
let listening = false;
function listenForResize() {
  if (listening) return;
  listening = true;
  window.addEventListener("resize", () => {
    const width = document.documentElement.clientWidth;
    for (const row of document.querySelectorAll("[data-stuck]")) setBleed(row, row.getBoundingClientRect(), width);
  }, { passive: true });
}

// A ref callback (React 19: the returned function runs on unmount).
export function trackStuckDateRow(element) {
  if (!element || typeof IntersectionObserver !== "function") return undefined;
  listenForResize();
  observe(element, stickyTopOf(element));
  return () => observerOf.get(element)?.unobserve(element);
}
