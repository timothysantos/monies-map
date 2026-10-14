import { useSyncExternalStore } from "react";

import { APP_SHELL_PERSISTED_CACHE_KEY } from "./app-shell-query";

// Which way the Summary and Month lead reads (DOMAIN.md "Lead View",
// design.md "Plan or Simple"): "plan" is spend against the plan with the
// money jobs; "simple" is only what was earned and what was spent, for a
// household that keeps no plan. The person's choice wins; without one, a
// period with a plan shows Plan and a period with none shows Simple. One
// choice for both pages.
//
// The choice belongs to the signed-in login: the app shell carries it
// (`leadView`, stored on the server under the login) and a switch saves it
// with POST /api/viewer-preferences/lead-view. This device's storage is only
// a first-paint cache that the shell's value replaces. Without a login (the
// demo, local dev) the device's storage is where it is kept. A device that
// kept an older app shell for a fast start shows that shell's choice until
// the shell is fetched again; a switch updates the kept shell. Storage can be
// missing or blocked (a private window): then the default is used and the
// choice lasts for the visit.
export const LEAD_VIEW_STORAGE_KEY = "monies-map:lead-view";
const LEAD_VIEW_PATH = "/api/viewer-preferences/lead-view";

const isLeadView = (value) => value === "plan" || value === "simple";

/** The stored choice, or null when there is none (or storage is blocked). */
export function readLeadView(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(LEAD_VIEW_STORAGE_KEY);
    return isLeadView(stored) ? stored : null;
  } catch {
    return null;
  }
}

// Writes the cache; null clears it.
export function saveLeadView(view, storage = globalThis.localStorage) {
  try {
    if (view) storage?.setItem(LEAD_VIEW_STORAGE_KEY, view);
    else storage?.removeItem(LEAD_VIEW_STORAGE_KEY);
  } catch {
    // Not remembered on this device; the switch still works for this visit.
  }
}

// `hasPlan` is null while the period's figures are still loading: Plan, as
// before, so the page does not swap views when they arrive.
export function chooseLeadView(stored, hasPlan) {
  return stored ?? (hasPlan === false ? "simple" : "plan");
}

// One store for the page: Summary and Month read the same choice.
// `signedIn` says whether the shell named a login; `saving` is a choice on
// its way to the server, which a shell that arrives meanwhile (with the old
// value) must not undo.
export function createLeadViewStore({ storage = globalThis.localStorage, send = sendLeadView } = {}) {
  let chosen = readLeadView(storage);
  let signedIn = false;
  let saving = 0;
  const listeners = new Set();
  const set = (next) => {
    if (next === chosen) return;
    chosen = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => chosen,
    // The app shell's word: with a login, its choice (or none) replaces
    // this device's cache; without one, the device keeps its own.
    applyShell(shell) {
      if (!shell) return;
      signedIn = Boolean(shell.viewerIdentity);
      if (!signedIn || saving > 0) return;
      const fromServer = isLeadView(shell.leadView) ? shell.leadView : null;
      saveLeadView(fromServer, storage);
      set(fromServer);
    },
    // The switch: shown at once, then saved for the login. A failed save
    // keeps the choice for this visit and on this device.
    async choose(view) {
      set(view);
      saveLeadView(view, storage);
      if (!signedIn) return;
      // The shell this device keeps for its next load (app-shell-query.js)
      // must not bring the old choice back.
      patchPersistedShell(view, storage);
      saving += 1;
      try {
        await send(view);
      } catch {
        // Kept locally; the next successful switch saves it.
      } finally {
        saving -= 1;
      }
    }
  };
}

function patchPersistedShell(leadView, storage) {
  try {
    const cached = JSON.parse(storage.getItem(APP_SHELL_PERSISTED_CACHE_KEY));
    if (cached?.data) {
      cached.data.leadView = leadView;
      storage.setItem(APP_SHELL_PERSISTED_CACHE_KEY, JSON.stringify(cached));
    }
  } catch {
    // No kept shell, or storage blocked: the next load asks the server.
  }
}

async function sendLeadView(leadView) {
  const response = await fetch(LEAD_VIEW_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadView })
  });
  if (!response.ok) throw new Error(`lead view not saved (${response.status})`);
}

export const leadViewStore = createLeadViewStore();

/** [view, choose]: the view to show and the switch's handler. */
export function useLeadView(hasPlan) {
  const stored = useSyncExternalStore(leadViewStore.subscribe, leadViewStore.get, leadViewStore.get);
  return [chooseLeadView(stored, hasPlan), leadViewStore.choose];
}
