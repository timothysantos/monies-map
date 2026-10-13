// Marks a sticky day row (Entries, Splits) with data-stuck while it holds
// the top of the screen, so its CSS can turn it into the rounded bar
// (design.md, "Entries list"). One IntersectionObserver for every row, no
// scroll listener: the root's top edge is pulled in by 1px, so a row stuck
// at top: 0 is just under 100% visible, and one resting lower is fully so.
// The attribute is set on the element directly, so no render follows.

let observer = null;

function watch() {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const stuck = entry.isIntersecting && entry.intersectionRatio < 1 && entry.boundingClientRect.top < 1;
      entry.target.toggleAttribute("data-stuck", stuck);
    }
  }, { rootMargin: "-1px 0px 0px 0px", threshold: [0, 1] });
  return observer;
}

// A ref callback (React 19: the returned function runs on unmount).
export function trackStuckDateRow(element) {
  if (!element || typeof IntersectionObserver !== "function") return undefined;
  const rows = watch();
  rows.observe(element);
  return () => rows.unobserve(element);
}
