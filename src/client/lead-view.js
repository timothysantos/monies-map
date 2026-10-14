import { useState } from "react";

// Which way the Summary and Month lead reads (design.md, "Plan or Simple"):
// "plan" is spend against the plan with the money jobs; "simple" is only
// what was earned and what was spent, for a household that keeps no plan.
// The person's choice is remembered on this device and wins; without one,
// a period with a plan shows Plan and a period with none shows Simple.
// One choice for both pages. Storage can be missing or blocked (a private
// window): then the default is used and nothing is remembered.
export const LEAD_VIEW_STORAGE_KEY = "monies-map:lead-view";

/** The stored choice, or null when there is none (or storage is blocked). */
export function readLeadView(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(LEAD_VIEW_STORAGE_KEY);
    return stored === "plan" || stored === "simple" ? stored : null;
  } catch {
    return null;
  }
}

export function saveLeadView(view, storage = globalThis.localStorage) {
  try {
    storage?.setItem(LEAD_VIEW_STORAGE_KEY, view);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}

// `hasPlan` is null while the period's figures are still loading: Plan, as
// before, so the page does not swap views when they arrive.
export function chooseLeadView(stored, hasPlan) {
  return stored ?? (hasPlan === false ? "simple" : "plan");
}

/** [view, choose]: the view to show and the switch's handler. */
export function useLeadView(hasPlan) {
  const [stored, setStored] = useState(readLeadView);
  return [chooseLeadView(stored, hasPlan), (view) => {
    setStored(view);
    saveLeadView(view);
  }];
}
