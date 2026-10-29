// The way back to "Check my books" (docs/flows/check-flow.md, "Fixing and
// coming back"). A problem on that page may send the person to another page
// (Entries, Splits, Month, Imports, Settings); the page keeps a marker first,
// the shell shows "‹ Check my books" above that page while the marker is for
// it, and Check reads the marker when it opens again.
//
// The marker lives in sessionStorage, not only in a history entry's state:
// the shell and the pages rewrite their own address (`replace: true`) while
// they open an entry or a split, which drops a history entry's state. It lives
// for one hop only: the shell forgets it as soon as the person goes to any
// page other than the one Check sent them to (or Check itself, which reads it
// and forgets it). Small and pure apart from the storage it is given, because
// the shell (first screen) imports it; the copy and the page's own behaviour
// stay in the lazy Check route.
import { useEffect } from "react";

export const RETURN_TO_CHECK_KEY = "monies.returnToCheck.v1";
const CHECK_PATH = "/check";

function count(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * A marker as kept in storage, checked, or null. The destination must be an
 * app path and the way back must be Check's own, so a kept value can never
 * lead outside the app.
 * @returns {{ id: string, destPath: string, checkPath: string, scrollY: number, before: number | null, expanded: string[], checkIdx: number | null } | null}
 */
export function readReturnToCheck(storage) {
  try {
    const value = JSON.parse(storage?.getItem(RETURN_TO_CHECK_KEY) ?? "null");
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id
      || typeof value.destPath !== "string" || !value.destPath.startsWith("/") || value.destPath.startsWith("//")) {
      return null;
    }
    const checkPath = typeof value.checkPath === "string" && (value.checkPath === CHECK_PATH || value.checkPath.startsWith(`${CHECK_PATH}?`))
      ? value.checkPath
      : CHECK_PATH;
    return {
      id: value.id,
      destPath: value.destPath,
      checkPath,
      scrollY: count(value.scrollY) ?? 0,
      before: count(value.before),
      expanded: Array.isArray(value.expanded) ? value.expanded.filter((key) => typeof key === "string").slice(0, 40) : [],
      checkIdx: count(value.checkIdx)
    };
  } catch {
    return null;
  }
}

export function rememberReturnToCheck(storage, marker) {
  try {
    storage?.setItem(RETURN_TO_CHECK_KEY, JSON.stringify(marker));
  } catch {
    // Private mode or a full storage: the page still opens, without the link.
  }
}

export function forgetReturnToCheck(storage) {
  try {
    storage?.removeItem(RETURN_TO_CHECK_KEY);
  } catch {
    // Nothing to forget.
  }
}

// The marker belongs to the page Check sent the person to, and to no other.
export function returnToCheckFor(marker, pathname) {
  return marker && marker.destPath === pathname ? marker : null;
}

// Any page but its destination and Check itself ends the hop.
export function isReturnToCheckOver(marker, pathname) {
  return Boolean(marker) && pathname !== marker.destPath && pathname !== CHECK_PATH;
}

function splitPath(path) {
  const index = path.indexOf("?");
  return index === -1 ? { pathname: path, search: "" } : { pathname: path.slice(0, index), search: path.slice(index) };
}

// The link and the phone's back gesture are one way when the destination is
// the very next history entry after Check: go back. Otherwise (the person
// moved around on the destination first) open Check's own address.
/** @returns {{ kind: "history" } | { kind: "navigate", to: { pathname: string, search: string } }} */
export function planReturnToCheck(marker, historyIdx) {
  if (Number.isFinite(historyIdx) && marker.checkIdx !== null && historyIdx === marker.checkIdx + 1) {
    return { kind: "history" };
  }
  return { kind: "navigate", to: splitPath(marker.checkPath) };
}

// The shell's use: the marker for the page on screen (null for everyone who
// did not come from Check), and the end of the hop when the person goes on.
export function useReturnToCheck(pathname) {
  let storage = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Blocked storage: no marker, no link.
  }
  // Read on every render (one small key), so a marker written by Check just
  // before it navigated is seen, and one forgotten below is gone.
  const marker = readReturnToCheck(storage);
  useEffect(() => {
    if (isReturnToCheckOver(marker, pathname)) {
      forgetReturnToCheck(storage);
    }
  }, [marker, pathname, storage]);
  return returnToCheckFor(marker, pathname);
}
