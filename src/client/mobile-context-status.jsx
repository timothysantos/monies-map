import { useState } from "react";

// The island's polite live region (design.md, "Island context line"): always
// mounted so a change is announced. First-screen code, so it stays tiny; the
// line's buttons are in mobile-context-line.jsx (a lazy chunk).
export function MobileContextStatus({ message }) {
  return <p className="sr-only" role="status" aria-live="polite">{message}</p>;
}

// What the status says: the filters while applied, "Filters cleared" once
// after they go. State adjusted during render (no effect).
export function useContextAnnouncement(announce) {
  const [previous, setPrevious] = useState("");
  const [cleared, setCleared] = useState(false);
  if (announce !== previous) {
    setPrevious(announce);
    setCleared(!announce);
  }
  return announce || (cleared ? "Filters cleared" : "");
}
