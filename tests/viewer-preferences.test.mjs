// The Plan | Simple choice is remembered per login (DOMAIN.md "Lead View"):
// stored server-side under a hash of the signed-in Access email, read back
// on the app shell, written by POST /api/viewer-preferences/lead-view. Two
// logins choose independently, a choice follows the login to any browser,
// a write with no login or from another site is refused, and the write is
// one statement in one batch (real local D1, demo household).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { loadViewerPreferences, saveLeadViewPreference, savePlanModePreference, saveSummaryCardsPreference, viewerPreferencesKey } from "../src/domain/app-repository-viewer-preferences.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TIM = "tim@example.com";
const JOYCE = "joyce@example.com";
const as = (email) => (email ? { "Cf-Access-Authenticated-User-Email": email } : {});

function choose(workspace, email, leadView, headers = {}) {
  return workspace.fetch("/api/viewer-preferences/lead-view", {
    method: "POST",
    headers: { "content-type": "application/json", ...as(email), ...headers },
    body: JSON.stringify({ leadView })
  });
}

async function shellFor(workspace, email) {
  const response = await workspace.fetch("/api/app-shell", { headers: as(email) });
  assert.equal(response.status, 200);
  return response.json();
}

test("two logins keep their own choice, and each one's comes back on the app shell from any browser", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  assert.equal((await shellFor(workspace, TIM)).leadView, undefined, "no choice yet: nothing on the shell");

  const saved = await choose(workspace, TIM, "simple");
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, leadView: "simple" });
  assert.equal((await choose(workspace, JOYCE, "plan")).status, 200);

  // A new browser has no storage: the shell alone carries the choice.
  assert.equal((await shellFor(workspace, TIM)).leadView, "simple");
  assert.equal((await shellFor(workspace, JOYCE)).leadView, "plan");
  // The header is case-insensitive in the identity: the same login.
  assert.equal((await shellFor(workspace, "Tim@Example.com")).leadView, "simple");
  // No login: nothing to remember it by.
  assert.equal((await shellFor(workspace, null)).leadView, undefined);

  // Changing one login's choice leaves the other's.
  await choose(workspace, TIM, "plan");
  assert.equal((await shellFor(workspace, TIM)).leadView, "plan");
  assert.equal((await shellFor(workspace, JOYCE)).leadView, "plan");
  await choose(workspace, JOYCE, "simple");
  assert.equal((await shellFor(workspace, TIM)).leadView, "plan");
  assert.equal((await shellFor(workspace, JOYCE)).leadView, "simple");

  // Stored under a hash, never the email itself.
  const stored = await rows(workspace.db, "SELECT key, value_json FROM app_settings WHERE key LIKE 'viewer_preferences:%' ORDER BY key");
  assert.equal(stored.length, 2);
  assert.ok(stored.every((row) => /^viewer_preferences:[0-9a-f]{32}$/.test(row.key)));
  assert.ok(stored.every((row) => !row.key.includes("@") && !row.value_json.includes("@")));
  assert.deepEqual(stored.map((row) => row.key).sort(), [await viewerPreferencesKey(TIM), await viewerPreferencesKey(JOYCE)].sort());
});

test("a write is refused without a login, with an unknown view, too large, or from another site", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const before = await dumpDatabase(workspace.db);

  const noLogin = await choose(workspace, null, "simple");
  assert.equal(noLogin.status, 401);
  assert.equal((await noLogin.json()).ok, false);

  const unknown = await choose(workspace, TIM, "fancy");
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { ok: false, error: "Choose Plan or Simple." });

  const tooLarge = await workspace.fetch("/api/viewer-preferences/lead-view", {
    method: "POST",
    headers: { "content-type": "application/json", ...as(TIM) },
    body: JSON.stringify({ leadView: "simple", padding: "x".repeat(2_000) })
  });
  assert.equal(tooLarge.status, 413);

  const crossSite = await choose(workspace, TIM, "simple", { "Sec-Fetch-Site": "cross-site" });
  assert.equal(crossSite.status, 403);

  const read = await workspace.fetch("/api/viewer-preferences/lead-view", { headers: as(TIM) });
  assert.equal(read.status, 405);

  assertSameDatabase(await dumpDatabase(workspace.db), before);
  assert.equal((await shellFor(workspace, TIM)).leadView, undefined);
});

test("a save that fails leaves the stored choice as it was; a save is one statement in one batch", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveLeadViewPreference(db, TIM, "simple");
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO app_settings/);

  await assert.rejects(saveLeadViewPreference(faulty.db, TIM, "plan"), /injected_failure_missing_table/);
  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);

  const batches = [];
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return (statements) => {
          batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  await saveLeadViewPreference(counting, TIM, "plan");
  assert.deepEqual(batches, [1]);
  const [row] = await rows(db, "SELECT value_json FROM app_settings WHERE key = ?", await viewerPreferencesKey(TIM));
  assert.deepEqual(JSON.parse(row.value_json), { leadView: "plan" });
  await assert.rejects(saveLeadViewPreference(db, TIM, "fancy"), /Choose Plan or Simple/);
});

// Studio | Tables (DOMAIN.md "Plan view"): the Month plan's mode is kept the
// same way, beside the lead view in the same stored object.
function chooseMode(workspace, email, planMode, headers = {}) {
  return workspace.fetch("/api/viewer-preferences/plan-mode", {
    method: "POST",
    headers: { "content-type": "application/json", ...as(email), ...headers },
    body: JSON.stringify({ planMode })
  });
}

test("the plan mode is kept per login beside the lead view, and each save keeps the other choice", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  assert.equal((await shellFor(workspace, TIM)).planMode, undefined, "no choice yet: nothing on the shell");

  const saved = await chooseMode(workspace, TIM, "tables");
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, planMode: "tables" });
  assert.equal((await choose(workspace, TIM, "plan")).status, 200);
  assert.equal((await chooseMode(workspace, JOYCE, "studio")).status, 200);

  const tim = await shellFor(workspace, TIM);
  assert.equal(tim.planMode, "tables");
  assert.equal(tim.leadView, "plan", "saving the lead view did not drop the plan mode, nor the other way round");
  const joyce = await shellFor(workspace, JOYCE);
  assert.equal(joyce.planMode, "studio");
  assert.equal(joyce.leadView, undefined);
  assert.equal((await shellFor(workspace, null)).planMode, undefined, "no login, nothing to remember it by");

  const [row] = await rows(workspace.db, "SELECT value_json FROM app_settings WHERE key = ?", await viewerPreferencesKey(TIM));
  assert.deepEqual(JSON.parse(row.value_json), { leadView: "plan", planMode: "tables" });
});

test("a plan mode write is refused without a login, with an unknown mode, or from another site, and writes nothing", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const before = await dumpDatabase(workspace.db);
  assert.equal((await chooseMode(workspace, null, "tables")).status, 401);
  const unknown = await chooseMode(workspace, TIM, "grid");
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { ok: false, error: "Choose Sliders or List." });
  assert.equal((await chooseMode(workspace, TIM, "plan")).status, 400, "a lead view word is not a plan mode");
  assert.equal((await chooseMode(workspace, TIM, "tables", { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assertSameDatabase(await dumpDatabase(workspace.db), before);
});

test("a plan mode save that fails leaves the stored choices as they were", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveLeadViewPreference(db, TIM, "simple");
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO app_settings/);
  await assert.rejects(savePlanModePreference(faulty.db, TIM, "tables"), /injected_failure_missing_table/);
  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
  await assert.rejects(savePlanModePreference(db, TIM, "grid"), /Choose Sliders or List/);
});

// Arrange Summary (design.md "Arrange Summary"): each login's card order is
// its own, comes back on the app shell only once it is changed, and Reset
// (null) takes it off the shell again; a bad value and no login are refused.
test("the Summary card order is saved for one login and not the other; Reset removes it", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const arrange = (email, summaryCards) => workspace.fetch("/api/viewer-preferences/summary-cards", {
    method: "POST",
    headers: { "content-type": "application/json", ...as(email) },
    body: JSON.stringify({ summaryCards })
  });
  assert.equal((await shellFor(workspace, TIM)).summaryCards, undefined, "the shell does not grow for anyone who never arranged");
  const saved = await arrange(TIM, "insights,mix,subs,plan,-accounts");
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, summaryCards: "insights,mix,subs,plan,-accounts" });
  assert.equal((await shellFor(workspace, TIM)).summaryCards, "insights,mix,subs,plan,-accounts");
  assert.equal((await shellFor(workspace, JOYCE)).summaryCards, undefined);
  // Saving one preference keeps the others.
  assert.equal((await choose(workspace, TIM, "plan")).status, 200);
  assert.equal((await shellFor(workspace, TIM)).summaryCards, "insights,mix,subs,plan,-accounts");
  const reset = await arrange(TIM, null);
  assert.deepEqual(await reset.json(), { ok: true, summaryCards: null });
  const shell = await shellFor(workspace, TIM);
  assert.equal(shell.summaryCards, undefined);
  assert.equal(shell.leadView, "plan");

  const before = await dumpDatabase(workspace.db);
  for (const bad of ["Mix", "insights;mix", "x".repeat(200), 7]) {
    assert.equal((await arrange(TIM, bad)).status, 400, String(bad));
  }
  assert.equal((await arrange(null, "mix,insights")).status, 401);
  assertSameDatabase(await dumpDatabase(workspace.db), before);
});

test("a Summary card order save that fails leaves the stored choices as they were", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveLeadViewPreference(db, TIM, "simple");
  await saveSummaryCardsPreference(db, TIM, "insights,mix,subs,plan,accounts");
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO app_settings/);
  await assert.rejects(saveSummaryCardsPreference(faulty.db, TIM, "mix,insights"), /injected_failure_missing_table/);
  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
  await assert.rejects(saveSummaryCardsPreference(db, TIM, "Mix;plan"), /not one Summary knows/);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a stored card order that is not the right shape reads as the usual order and keeps the other choices", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await saveLeadViewPreference(db, TIM, "simple");
  await db.prepare("UPDATE app_settings SET value_json = json_patch(value_json, ?) WHERE key = ?")
    .bind(JSON.stringify({ summaryCards: "<script>" }), await viewerPreferencesKey(TIM)).run();
  assert.deepEqual(await loadViewerPreferences(db, TIM), { leadView: "simple", planMode: null, summaryCards: null });
});
