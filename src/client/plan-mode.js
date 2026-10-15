import { useSyncExternalStore } from "react";

import { watchAppShell } from "./app-shell-watch";
import { createPreferenceStore } from "./viewer-preference-store";

// Which way the Month plan reads (DOMAIN.md "Plan view"): "studio" is the one
// list of sliders grouped by what the money does (Plan Studio); "tables" is the
// plan tables with notes, accounts, matching entries and adding or removing
// lines. Studio is the default. The choice is remembered per login like the
// Plan | Simple lead view (viewer-preference-store.js), saved with POST
// /api/viewer-preferences/plan-mode and carried on the app shell (`planMode`).
export const PLAN_MODE_STORAGE_KEY = "monies-map:plan-mode";
export const PLAN_MODE_PATH = "/api/viewer-preferences/plan-mode";

export const isPlanMode = (value) => value === "studio" || value === "tables";

/** The stored choice, or Studio when there is none. */
export const choosePlanMode = (stored) => (isPlanMode(stored) ? stored : "studio");

export function createPlanModeStore(options = {}) {
  return createPreferenceStore({ field: "planMode", storageKey: PLAN_MODE_STORAGE_KEY, path: PLAN_MODE_PATH, isValid: isPlanMode, ...options });
}

export const planModeStore = createPlanModeStore();
// The app shell carries the login's choice; this route's code is not in the
// first screen, so it listens for the shell instead of the shell reaching it.
watchAppShell((shell) => planModeStore.applyShell(shell));

/** [mode, choose]: the mode to show and the switch's handler. */
export function usePlanMode() {
  const stored = useSyncExternalStore(planModeStore.subscribe, planModeStore.get, planModeStore.get);
  return [choosePlanMode(stored), planModeStore.choose];
}
