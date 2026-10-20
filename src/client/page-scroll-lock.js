// The page's keyboard scroll lock while a mobile sheet is open
// (entry-mobile-sheet.jsx).
//
// `overflow: hidden` on <html> stops Space, Page Down and arrow keys from
// scrolling the page behind the sheet. Unlike a change on <body>, it restyles
// only the root. Where the page shows a classic scrollbar (a narrow desktop
// window), a stable gutter keeps the page from shifting sideways.
//
// The lock is counted, not saved and restored per sheet. A sheet opened from
// another (Transfer details from Edit entry) can close in the same commit as
// the one below it (Use match closes both), and React runs the outer sheet's
// cleanup before the inner one's: a per-sheet "put back what was there" let
// the inner sheet put back the outer sheet's `hidden`, and the page never
// scrolled again (owner report 2026-10-20). The first sheet in saves the
// page's own styles; only the last one out restores them, in any order.
let pageScrollLocks = 0;
let pageStylesBeforeLock = null;

/** @returns {() => void} the release; calling it twice releases once. */
export function lockPageKeyboardScroll(root = document.documentElement, win = window) {
  if (pageScrollLocks === 0) {
    pageStylesBeforeLock = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    const hasClassicScrollbar = win.innerWidth - root.clientWidth > 0;
    root.style.overflow = "hidden";
    if (hasClassicScrollbar) {
      root.style.scrollbarGutter = "stable";
    }
  }
  pageScrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pageScrollLocks -= 1;
    if (pageScrollLocks === 0 && pageStylesBeforeLock) {
      root.style.overflow = pageStylesBeforeLock.overflow;
      root.style.scrollbarGutter = pageStylesBeforeLock.scrollbarGutter;
      pageStylesBeforeLock = null;
    }
  };
}
