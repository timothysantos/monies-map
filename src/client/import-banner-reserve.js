// The room kept for the import banner on Summary and Month (App.jsx,
// ImportInboxBannerSlot): the banner reads the Imports answer, which a desktop
// fetches only after the first screen is usable (route warmup), so it lands a
// few seconds late and would push the page down. A device that has seen it
// remembers its height and keeps that room (0 once it knows there is no
// banner). A device that has never seen it cannot remember, so on a wider
// screen, where warmup will run, it keeps the room a banner usually takes and
// gives it back if no answer comes. A phone never fetches Imports for the
// banner, so it keeps nothing.
export const IMPORT_BANNER_HEIGHT_KEY = "monies-map:import-banner-height";

// Measured on the demo household (a banner is one line from a 1,100px page,
// two lines below it); only a first-visit guess, replaced by the real height.
const USUAL_WIDE_HEIGHT = 74;
const USUAL_NARROW_HEIGHT = 95;
const WIDE_FROM = 1100;

// How long a guessed room waits for the Imports answer before it is given back.
export const GUESSED_RESERVE_MS = 10_000;

/** The remembered height: a number (0 for "no banner last time"), or null when never stored. */
export function readRememberedBannerHeight(storage) {
  try {
    const raw = storage?.getItem(IMPORT_BANNER_HEIGHT_KEY);
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.min(value, 400) : null;
  } catch {
    return null;
  }
}

/**
 * The room to keep before the Imports answer is known.
 * @param {{ storage?: Storage | null, phone: boolean, width: number }} input
 * @returns {{ height: number, guessed: boolean }}
 */
export function initialBannerReserve({ storage, phone, width }) {
  const remembered = readRememberedBannerHeight(storage);
  if (remembered !== null) return { height: remembered, guessed: false };
  // Never seen on this device (or storage is blocked): a guess, only where warmup will fetch the answer.
  if (phone) return { height: 0, guessed: false };
  return { height: width >= WIDE_FROM ? USUAL_WIDE_HEIGHT : USUAL_NARROW_HEIGHT, guessed: true };
}
