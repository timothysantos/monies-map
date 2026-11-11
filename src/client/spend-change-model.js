// The note under Spending Mix's total (design.md "Change notes"): "▼ 6% vs
// the 6 months before", from the page's own `spendChange` (the range's
// complete months against the same number of months before them). Spending
// that went up is rose, down is mint (changeNote, summary-tiles-model.js).
// No note without that history, when nothing moved by a whole percent, or with
// money hidden (an arrow and percent would show which way it went).
import { changeNote } from "./summary-tiles-model";

const MIN_BASE_MINOR = 10_000;

/**
 * @param {{ months: number, currentMinor: number, previousMinor: number, partial: boolean } | undefined} spendChange
 * @param {{ hidden?: boolean }} [options]
 */
export function buildSpendChangeNote(spendChange, { hidden = false } = {}) {
  if (!spendChange || hidden) return null;
  const note = changeNote({
    current: spendChange.currentMinor - spendChange.previousMinor,
    base: spendChange.previousMinor,
    upIsGood: false,
    minBase: MIN_BASE_MINOR
  });
  return note ? { ...note, months: spendChange.months, partial: spendChange.partial } : null;
}
