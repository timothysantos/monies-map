// This device's own storage, or null when the browser blocks it. Safari throws
// from the `localStorage` property itself (not only from getItem) when all
// cookies are blocked, and setItem throws once the quota is full. Anything
// that runs while the app starts, or outside a screen's error boundary, reads
// storage through here so a blocked or full store can only mean "not
// remembered", never an app that does not draw.

/** @returns {Storage | null} */
export function deviceStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
