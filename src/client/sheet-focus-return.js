// Where focus goes back to when a mobile sheet closes.
//
// iPhone and iPad Safari (and WebKit in general) do not focus a button that
// is tapped or clicked, so when a tap opens a sheet, document.activeElement
// is <body> and cannot name the control that opened it. This module watches
// trusted clicks in the capture phase and remembers the focusable control
// each one landed on. A sheet takes that control as its opener when it
// opens, and gives focus back to it when it closes.
//
// In Chromium the remembered control is the element the click focused, so
// the result there is the same as reading document.activeElement.

const FOCUSABLE_OPENER = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

/** @type {HTMLElement | null} */
let lastActivated = null;
let isWatching = false;
let dialogReturnInstalled = false;

function watchActivations() {
  if (isWatching || typeof document === "undefined") {
    return;
  }
  isWatching = true;
  document.addEventListener("click", (event) => {
    // Only a person's own tap, click or Enter/Space counts: the Entries
    // floating add button forwards its tap with a script click on a hidden
    // trigger, and the tapped button, not that trigger, is the opener.
    if (!event.isTrusted) {
      return;
    }
    const target = event.target instanceof Element ? event.target.closest(FOCUSABLE_OPENER) : null;
    lastActivated = target instanceof HTMLElement ? target : null;
  }, true);
  // A key press means focus is being driven from the keyboard, where
  // document.activeElement is reliable (Enter on a row opens it without a
  // click), so an older tap must not win over it.
  document.addEventListener("keydown", (event) => {
    if (event.isTrusted) {
      lastActivated = null;
    }
  }, true);
}

// Installed when the sheet module loads, which is before any control that
// opens a sheet can be tapped: the routes that render those controls import
// the sheet statically.
watchActivations();

function isPageRoot(element) {
  return element === document.body || element === document.documentElement;
}

/**
 * The control that opened a sheet: the one last tapped or clicked, else the
 * focused element. Call it while the sheet first renders, before it moves
 * focus. It only reads, so a Strict Mode double render gets the same answer.
 * @returns {HTMLElement | null}
 */
export function findSheetOpener() {
  if (typeof document === "undefined") {
    return null;
  }
  if (lastActivated?.isConnected) {
    return lastActivated;
  }
  const active = document.activeElement;
  return active instanceof HTMLElement && !isPageRoot(active) ? active : null;
}

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/**
 * A safety net for every dialog, sheet and popover opened from a control
 * without a Radix trigger (most of them are): when one leaves the page and
 * focus has fallen to <body> (a field that took focus on open is what Radix
 * remembers, and it is gone), focus goes back to the control that opened
 * it, else to <main>. It never moves focus a dialog already returned. Call
 * once; it watches only the direct children of <body>, where portals attach.
 */
export function installDialogFocusReturn() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined" || dialogReturnInstalled) {
    return;
  }
  dialogReturnInstalled = true;
  /** @type {{ node: Node, opener: HTMLElement | null }[]} */
  const open = [];
  const hasDialog = (/** @type {Node} */ node) => node instanceof Element && (node.matches(DIALOG_SELECTOR) || node.querySelector(DIALOG_SELECTOR) !== null);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (hasDialog(node)) {
          open.push({ node, opener: findSheetOpener() });
        }
      }
      for (const node of record.removedNodes) {
        const index = open.findIndex((item) => item.node === node);
        if (index === -1) {
          continue;
        }
        const [{ opener }] = open.splice(index, 1);
        // After Radix has had its own turn at returning focus.
        window.setTimeout(() => {
          const active = document.activeElement;
          if (!active || isPageRoot(active)) {
            returnFocusFromSheet(opener);
          }
        }, 60);
      }
    }
  }).observe(document.body, { childList: true });
}

/**
 * Gives focus back to the sheet's opener when it is still on the page.
 * Otherwise (the opener was removed, or the sheet opened from a link) and
 * only if nothing else has taken focus, focus goes to the page's <main>
 * landmark, so a screen reader carries on from the page content rather than
 * from the top of the document.
 * @param {HTMLElement | null} opener
 */
export function returnFocusFromSheet(opener) {
  if (opener instanceof HTMLElement && opener.isConnected && !isPageRoot(opener)) {
    opener.focus({ preventScroll: true });
    if (document.activeElement === opener) {
      return;
    }
  }
  const active = document.activeElement;
  if (active && !isPageRoot(active)) {
    return;
  }
  const landmark = document.querySelector("main");
  if (landmark instanceof HTMLElement) {
    if (!landmark.hasAttribute("tabindex")) {
      landmark.setAttribute("tabindex", "-1");
      // The landmark needs no focus ring. Set here rather than in
      // styles.css, which counts towards the first-screen budget. Outline
      // does not inherit, so the page's rows are not restyled.
      landmark.style.outline = "none";
    }
    landmark.focus({ preventScroll: true });
  }
}
