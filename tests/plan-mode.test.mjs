import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_MODE_STORAGE_KEY, choosePlanMode, createPlanModeStore, isPlanMode } from "../src/client/plan-mode.js";

// The Month plan's Studio | Tables mode (plan-mode.js, DOMAIN.md "Plan view"):
// Studio is the default; the choice is remembered per login on the app shell
// and on the device without one, the same way as the Plan | Simple lead view.

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}
const blockedStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
  removeItem() { throw new Error("SecurityError"); }
};
const signedIn = (planMode) => ({ viewerIdentity: { email: "tim@example.com" }, ...(planMode ? { planMode } : {}) });

test("Studio is the default, and only the two modes are modes", () => {
  assert.equal(choosePlanMode(null), "studio");
  assert.equal(choosePlanMode("grid"), "studio");
  assert.equal(choosePlanMode("tables"), "tables");
  assert.equal(isPlanMode("studio"), true);
  assert.equal(isPlanMode("simple"), false, "a lead view word is not a plan mode");
});

test("signed in, the shell's choice replaces the device's cache and none on the shell means the default", () => {
  const storage = memoryStorage({ [PLAN_MODE_STORAGE_KEY]: "studio" });
  const store = createPlanModeStore({ storage, send: async () => {} });
  assert.equal(store.get(), "studio");
  store.applyShell(signedIn("tables"));
  assert.equal(store.get(), "tables");
  assert.equal(storage.values.get(PLAN_MODE_STORAGE_KEY), "tables");
  store.applyShell(signedIn(null));
  assert.equal(store.get(), null);
  assert.equal(storage.values.has(PLAN_MODE_STORAGE_KEY), false);
  assert.equal(choosePlanMode(store.get()), "studio");
});

test("signed in, a switch is shown at once, saved for the login, and a shell that lands meanwhile does not undo it", async () => {
  const sent = [];
  let release;
  const store = createPlanModeStore({ storage: memoryStorage(), send: (mode) => { sent.push(mode); return new Promise((resolve) => { release = resolve; }); } });
  store.applyShell(signedIn("studio"));
  const saving = store.choose("tables");
  assert.equal(store.get(), "tables");
  assert.deepEqual(sent, ["tables"]);
  store.applyShell(signedIn("studio"));
  assert.equal(store.get(), "tables", "the old shell does not win over a save on its way");
  release();
  await saving;
  store.applyShell(signedIn("tables"));
  assert.equal(store.get(), "tables");
});

test("a switch updates the app shell this device keeps, so a reload does not bring the old mode back", async () => {
  const key = "monies-map-app-shell-cache-v4";
  const storage = memoryStorage({ [key]: JSON.stringify({ cacheKey: "", data: signedIn("studio") }) });
  const store = createPlanModeStore({ storage, send: async () => {} });
  store.applyShell(signedIn("studio"));
  await store.choose("tables");
  assert.equal(JSON.parse(storage.values.get(key)).data.planMode, "tables");
});

test("a failed save keeps the mode for the visit; without a login nothing is sent and the device keeps it; blocked storage still switches", async () => {
  const failing = createPlanModeStore({ storage: memoryStorage(), send: async () => { throw new Error("offline"); } });
  failing.applyShell(signedIn(null));
  await failing.choose("tables");
  assert.equal(failing.get(), "tables");

  const storage = memoryStorage({ [PLAN_MODE_STORAGE_KEY]: "tables" });
  const sent = [];
  const device = createPlanModeStore({ storage, send: async (mode) => { sent.push(mode); } });
  device.applyShell({ household: {} });
  assert.equal(device.get(), "tables");
  await device.choose("studio");
  assert.deepEqual(sent, []);
  assert.equal(storage.values.get(PLAN_MODE_STORAGE_KEY), "studio");

  const blocked = createPlanModeStore({ storage: blockedStorage, send: async () => {} });
  assert.equal(blocked.get(), null);
  await blocked.choose("tables");
  assert.equal(blocked.get(), "tables");
});

test("a stored word that is not a mode is ignored", () => {
  const store = createPlanModeStore({ storage: memoryStorage({ [PLAN_MODE_STORAGE_KEY]: "simple" }), send: async () => {} });
  assert.equal(store.get(), null);
});
