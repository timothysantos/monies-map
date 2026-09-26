// Page-wide flags on <body> for CSS that restyles the rest of the page while
// something is on screen, for example `body[data-entry-inline-editor]
// .entries-fab { display: none }`.
//
// They replace `body:has(.entry-inline-editor) ...` rules. A :has() that
// searches all descendants makes Chromium walk the whole page each time an
// element the rule styles is restyled; on the 2,000-row month those rules
// cost about 25 ms of style work per mobile sheet open or close at CPU 4x
// (see "Mobile sheet: page rules" in docs/audits/macro-loading-baseline.md).
// Setting an attribute restyles only the elements the rules name.
//
// Portalled layers (the mobile sheet, dialog overlays) are direct children of
// <body>, so their rules stay in CSS as `body:has(> .entry-mobile-sheet)`,
// which checks only <body>'s children.
//
// A flag is held by the element it stands for through a ref, so it is set
// and cleared in the same commit that adds or removes the element, as the
// :has() rule was.
export const PAGE_FLAG = Object.freeze({
  entryInlineEditor: "entry-inline-editor",
  splitInlineEditor: "split-inline-editor",
  splitsPanel: "splits-panel"
});

const KNOWN_FLAGS = new Set(Object.values(PAGE_FLAG));
const holders = new Map();

function assertKnown(name) {
  if (!KNOWN_FLAGS.has(name)) {
    throw new Error(`Unknown page flag "${name}".`);
  }
}

// Sets `data-<name>` on <body> until every holder has released it. The
// returned release is safe to call more than once.
export function holdPageFlag(name) {
  assertKnown(name);
  const count = (holders.get(name) ?? 0) + 1;
  holders.set(name, count);
  if (count === 1) {
    document.body.setAttribute(`data-${name}`, "");
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (holders.get(name) ?? 1) - 1;
    if (remaining > 0) {
      holders.set(name, remaining);
      return;
    }
    holders.delete(name);
    document.body.removeAttribute(`data-${name}`);
  };
}

const sharedRefs = new Map();
const elementRefs = new WeakMap();

// A ref callback that holds the flag while its element is attached (React 19
// runs the returned cleanup on detach). With `elementRef` it also fills that
// object ref, for components that already read the element. The callback is
// cached per flag and element ref, so React keeps it attached across renders
// without a hook in every row.
export function pageFlagRef(name, elementRef = null) {
  assertKnown(name);
  const cache = elementRef ? elementRefs.get(elementRef) ?? new Map() : sharedRefs;
  if (elementRef && !elementRefs.has(elementRef)) {
    elementRefs.set(elementRef, cache);
  }
  let ref = cache.get(name);
  if (!ref) {
    ref = (node) => {
      if (elementRef) {
        elementRef.current = node;
      }
      if (!node) {
        return undefined;
      }
      const release = holdPageFlag(name);
      return () => {
        if (elementRef) {
          elementRef.current = null;
        }
        release();
      };
    };
    cache.set(name, ref);
  }
  return ref;
}
