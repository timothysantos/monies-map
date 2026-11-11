// This device's own storage, or null when the browser blocks it. Safari throws
// from the `localStorage` property itself (not only from getItem) when all
// cookies are blocked, and setItem throws once the quota is full. Anything
// that runs while the app starts, or outside a screen's error boundary, reads
// storage through here so a blocked or full store can only mean "not
// remembered", never an app that does not draw.

/** @returns {Storage | null} */
export function deviceStorage() {
  try {
    // `window` is the global in a browser; a stand-in `window` (tests, a host
    // that scopes storage to its window object) is read first so both agree.
    const host = typeof window !== "undefined" && window ? window : globalThis;
    return host.localStorage ?? null;
  } catch {
    return null;
  }
}
