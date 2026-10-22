// What the Splits donut adds up: "share" is the person's own share of each
// open expense, "group" is each category's full amount (the lead chip's own
// set). The choice is kept per device and per page; the same choice stays
// when the group changes. The household reading has one chart (both would be
// equal), so it always reads as "group" and shows no switch.

export const DONUT_MODE_STORAGE_KEY = "monies.splits.donutMode";

const MODES = ["share", "group"];

export function resolveDonutMode(stored, isHousehold) {
  if (isHousehold) return "group";
  return MODES.includes(stored) ? stored : "share";
}

// Storage can be missing or blocked (a private window): the default is used
// and the choice lasts for the visit.
export function createDonutModeStore(storage = globalThis.localStorage) {
  return {
    read() {
      try {
        const stored = storage?.getItem(DONUT_MODE_STORAGE_KEY);
        return MODES.includes(stored) ? stored : "share";
      } catch {
        return "share";
      }
    },
    write(mode) {
      if (!MODES.includes(mode)) return;
      try {
        storage?.setItem(DONUT_MODE_STORAGE_KEY, mode);
      } catch {
        // Not remembered on this device; the switch still works for this visit.
      }
    }
  };
}
