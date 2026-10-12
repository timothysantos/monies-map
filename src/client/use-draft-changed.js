import { useState } from "react";

/**
 * Whether an open draft differs from what it was when it opened: the
 * `isDirty` a bottom sheet's swipe-to-close reads (sheet-swipe.jsx). `draft`
 * is null while the sheet is closed; the first non-null draft is the
 * baseline, and closing clears it. `toComparable` picks the fields a person
 * edits, so derived or display-only fields never count as a change.
 * @template T
 * @param {T | null | undefined} draft
 * @param {(draft: T) => unknown} [toComparable]
 */
export function useDraftChanged(draft, toComparable = (value) => value) {
  const current = draft == null ? null : JSON.stringify(toComparable(draft));
  const [baseline, setBaseline] = useState(current);
  // Adjusting state while rendering (React's pattern for state that follows
  // a prop): the baseline is set the render the draft opens.
  if ((current === null) !== (baseline === null)) {
    setBaseline(current);
    return false;
  }
  return current !== null && current !== baseline;
}
