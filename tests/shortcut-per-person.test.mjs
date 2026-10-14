// The Apple Pay Shortcut has one connection per person (DOMAIN.md "Shortcut
// connection"): its own key, Default account order and card for other
// currencies, and every entry saved through it belongs to that person. Real
// Worker and real local D1 (demo household: Tim is the owner, Joyce the
// partner). The test Worker runs with FX_RATES_OFFLINE, so only saved rates
// are read.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, saveRate, TOKEN } from "./support/foreign-wallet.mjs";
import {
  buildDefaultShortcutAccountPriorityIds,
  completeShortcutPriorityIds,
  parseStoredShortcutConnection,
  shortcutKeyPersonId,
  shortcutSettingsKey
} from "../src/domain/shortcut-connections.ts";
import { findShortcutConnectionByKey } from "../src/server/shortcut-gateway.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const JOYCE_KEY = "mm_joyce-phone-key";
const TIM = "person-tim";
const JOYCE = "person-joyce";

async function accountIds(db) {
  const all = await rows(db, "SELECT id, account_name FROM accounts");
  const byName = (name) => all.find((row) => row.account_name === name).id;
  return { uobOne: byName("UOB One"), uobLadys: byName("UOB Lady's"), citiRewards: byName("Citi Rewards"), float: byName("Household Float") };
}

async function connectJoyce(api, db, overrides = {}) {
  const ids = await accountIds(db);
  const saved = await api("/api/settings/shortcuts/save", {
    personId: JOYCE,
    apiKey: JOYCE_KEY,
    defaultAccountPriorityIds: [ids.uobLadys, ids.citiRewards],
    defaultParams: "",
    foreignCurrencyAccountId: "",
    ...overrides
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  return ids;
}

function purchase(fetchWorker, key, body) {
  return fetchWorker(`/api/shortcuts/entries/create?shortcut_token=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-10-03", amount: "SGD 8.40", description: "Coffee", ...body })
  }).then(async (response) => ({ status: response.status, payload: await response.json() }));
}

async function ownerOf(db, entryId) {
  const [entry] = await rows(db, "SELECT owner_person_id, account_id FROM transactions WHERE id = ?", entryId);
  return entry;
}

test("the household key installed before connections still saves for the first person, with no reinstall", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  // Exactly what an older database holds: one "shortcut_api" row, no person.
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne] });

  const { status, payload } = await purchase(fetchWorker, TOKEN, { description: "Tim's coffee" });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.deepEqual(await ownerOf(db, payload.entryId), { owner_person_id: TIM, account_id: ids.uobOne });
  // The row was not touched: the same key keeps working.
  assert.deepEqual(
    (await rows(db, "SELECT key FROM app_settings WHERE key LIKE 'shortcut_api%' ORDER BY key")).map((row) => row.key),
    ["shortcut_api"]
  );
});

test("each person's key saves to that person's card order and owner", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne, ids.uobLadys] });
  await connectJoyce(api, db);

  const hers = await purchase(fetchWorker, JOYCE_KEY, { description: "Joyce's coffee" });
  const his = await purchase(fetchWorker, TOKEN, { description: "Tim's coffee" });

  assert.equal(hers.status, 200, JSON.stringify(hers.payload));
  assert.deepEqual(await ownerOf(db, hers.payload.entryId), { owner_person_id: JOYCE, account_id: ids.uobLadys });
  assert.equal(hers.payload.accountResolution, "priority");
  assert.deepEqual(await ownerOf(db, his.payload.entryId), { owner_person_id: TIM, account_id: ids.uobOne });
});

test("a key cannot save an entry as someone else, even when the request or the default params name them", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne], defaultParams: "ownerName=Joyce" });
  await connectJoyce(api, db, { defaultParams: "ownerName=Tim" });

  const hersAsTim = await purchase(fetchWorker, JOYCE_KEY, { description: "Joyce says Tim", ownerName: "Tim" });
  const hersOnHisCard = await purchase(fetchWorker, JOYCE_KEY, { description: "Joyce on Tim's card", accountName: "UOB One" });
  const hersShared = await purchase(fetchWorker, JOYCE_KEY, { description: "Joyce shared", ownershipType: "shared", ownerName: "Tim" });
  const hisAsJoyce = await purchase(fetchWorker, TOKEN, { description: "Tim says Joyce", ownerName: "Joyce" });

  for (const result of [hersAsTim, hersOnHisCard, hersShared, hisAsJoyce]) {
    assert.equal(result.status, 200, JSON.stringify(result.payload));
  }
  assert.equal((await ownerOf(db, hersAsTim.payload.entryId)).owner_person_id, JOYCE);
  assert.deepEqual(await ownerOf(db, hersOnHisCard.payload.entryId), { owner_person_id: JOYCE, account_id: ids.uobOne });
  assert.equal((await ownerOf(db, hersShared.payload.entryId)).owner_person_id, JOYCE);
  assert.equal((await ownerOf(db, hisAsJoyce.payload.entryId)).owner_person_id, TIM);
  // A shared purchase's split is paid by the key's person.
  const [split] = await rows(db, "SELECT payer_person_id FROM split_expenses WHERE linked_transaction_id = ?", hersShared.payload.entryId);
  assert.equal(split?.payer_person_id, JOYCE);
});

test("a revoked key is refused, the other person's key is untouched, and a new key replaces the old", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne] });
  await connectJoyce(api, db);
  assert.equal((await purchase(fetchWorker, JOYCE_KEY, {})).status, 200);

  const revoked = await api("/api/settings/shortcuts/revoke", { personId: JOYCE });
  assert.deepEqual([revoked.status, revoked.payload], [200, { ok: true, revoked: true }]);

  const refused = await purchase(fetchWorker, JOYCE_KEY, { description: "After revoke" });
  assert.deepEqual([refused.status, refused.payload], [401, { ok: false, error: "Invalid shortcut token." }]);
  assert.equal((await purchase(fetchWorker, TOKEN, { description: "Tim still works" })).status, 200);
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE description = 'After revoke'"), []);

  // Her card order is kept for the next key; a regenerated key works and the old one stays refused.
  const newKey = "mm_joyce-new-key";
  const saved = await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: newKey, defaultAccountPriorityIds: [ids.citiRewards], defaultParams: "" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.equal((await purchase(fetchWorker, newKey, { description: "New key" })).status, 200);
  assert.equal((await purchase(fetchWorker, JOYCE_KEY, { description: "Old key" })).status, 401);
});

test("regenerating a key refuses the old one at once", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  await connectJoyce(api, db);
  const ids = await accountIds(db);

  await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: "mm_regenerated", defaultAccountPriorityIds: [ids.uobLadys], defaultParams: "" });

  assert.equal((await purchase(fetchWorker, JOYCE_KEY, {})).status, 401);
  assert.equal((await purchase(fetchWorker, "mm_regenerated", {})).status, 200);
});

test("two phones cannot share one key, and an unknown person is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne] });

  const sameKey = await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: TOKEN, defaultAccountPriorityIds: [ids.uobLadys] });
  assert.deepEqual([sameKey.status, sameKey.payload.error], [400, "Another person's phone already uses this key. Generate a new key for this one."]);
  assert.deepEqual(await rows(db, "SELECT key FROM app_settings WHERE key = 'shortcut_api_person_person-joyce'"), []);

  const stranger = await api("/api/settings/shortcuts/save", { personId: "person-nobody", apiKey: "mm_x", defaultAccountPriorityIds: [ids.uobLadys] });
  assert.deepEqual([stranger.status, stranger.payload.error], [400, "Choose a person in this household."]);
  const strangerRevoke = await api("/api/settings/shortcuts/revoke", { personId: "person-nobody" });
  assert.deepEqual([strangerRevoke.status, strangerRevoke.payload.error], [400, "Choose a person in this household."]);
});

test("a missing, wrong or blank key is refused and nothing is saved", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  // Nothing configured at all.
  assert.deepEqual((await purchase(fetchWorker, "anything", {})).status, 503);
  await connectJoyce(api, db);

  assert.equal((await purchase(fetchWorker, "mm_wrong", {})).status, 401);
  const blank = await fetchWorker("/api/shortcuts/entries/create", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(blank.status, 401);
  const stillNoEntries = await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE description = 'Coffee'");
  assert.equal(stillNoEntries[0].n, 0);
});

test("a Worker secret still answers for the first person only until that person's key is revoked", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  const env = { DB: db, ...template.config.vars, SHORTCUT_INGEST_TOKEN: "env-secret" };
  const post = async (key) => {
    const response = await worker.fetch(new Request(`http://127.0.0.1/api/shortcuts/entries/create?shortcut_token=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-10-03", amount: "SGD 3.10", description: "Secret coffee", accountId: ids.uobOne })
    }), env);
    return { status: response.status, payload: await response.json() };
  };

  const viaSecret = await post("env-secret");
  assert.equal(viaSecret.status, 200, JSON.stringify(viaSecret.payload));
  assert.equal((await ownerOf(db, viaSecret.payload.entryId)).owner_person_id, TIM);

  // A person's own key may not equal the secret that answers for the first person.
  const clash = await worker.fetch(new Request("http://127.0.0.1/api/settings/shortcuts/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: JOYCE, apiKey: "env-secret", defaultAccountPriorityIds: [ids.uobLadys] })
  }), env);
  assert.equal(clash.status, 400);

  const revoke = await worker.fetch(new Request("http://127.0.0.1/api/settings/shortcuts/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: TIM })
  }), env);
  assert.equal(revoke.status, 200);
  assert.equal((await post("env-secret")).status, 503, "no key is left, so the secret no longer answers");
  assert.deepEqual(await rows(db, "SELECT id FROM transactions WHERE description = 'Secret coffee' AND owner_person_id = 'person-tim'").then((r) => r.length), 1);
});

test("the card for other currencies is per connection and falls back to the household's", async (t) => {
  const { db, api, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await saveRate(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne], foreignCurrencyAccountId: ids.citiRewards });
  await connectJoyce(api, db);

  // Joyce chose no card for other currencies: the household's applies.
  const fallback = await purchase(fetchWorker, JOYCE_KEY, { amount: "IDR 140,250", description: "Bali satay" });
  assert.equal(fallback.status, 200, JSON.stringify(fallback.payload));
  assert.deepEqual([fallback.payload.accountId, fallback.payload.accountResolution], [ids.citiRewards, "foreign_currency"]);
  assert.equal((await ownerOf(db, fallback.payload.entryId)).owner_person_id, JOYCE);

  // Her own choice wins.
  await api("/api/settings/shortcuts/save", { personId: JOYCE, apiKey: JOYCE_KEY, defaultAccountPriorityIds: [ids.uobLadys, ids.citiRewards], foreignCurrencyAccountId: ids.uobLadys });
  const own = await purchase(fetchWorker, JOYCE_KEY, { amount: "IDR 140,250", description: "Bali nasi" });
  assert.deepEqual([own.payload.accountId, own.payload.accountResolution], [ids.uobLadys, "foreign_currency"]);
});

test("Settings lists one connection per person and starts a new one with that person's own cards", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await accountIds(db);
  await enableShortcut(db, { defaultAccountPriorityIds: [ids.uobOne] });

  const before = (await api("/api/settings-page?view=household")).payload.settingsPage.shortcutSettings;
  assert.deepEqual(before.connections.map((connection) => [connection.personId, connection.personName, connection.apiKeySource]), [
    [TIM, "Tim", "app"],
    [JOYCE, "Joyce", "none"]
  ]);
  assert.equal(before.apiKey, TOKEN, "the flat fields are the first person's, as before");
  assert.equal(before.connections[0].defaultAccountPriorityIds[0], ids.uobOne);
  const joyceOrder = before.connections[1].defaultAccountPriorityIds;
  assert.deepEqual(joyceOrder.slice(0, 2).sort(), [ids.citiRewards, ids.uobLadys].sort(), "her own cards come first");

  await connectJoyce(api, db);
  const after = (await api("/api/settings-page?view=household")).payload.settingsPage.shortcutSettings;
  assert.deepEqual([after.connections[1].apiKey, after.connections[1].apiKeySource], [JOYCE_KEY, "app"]);
  assert.deepEqual(after.connections[1].defaultAccountPriorityIds.slice(0, 2), [ids.uobLadys, ids.citiRewards]);
  assert.equal(after.apiKey, TOKEN);

  // The app shell never carries a key or the other person's connection.
  const shell = (await api("/api/app-shell")).payload;
  const shellShortcut = shell.settingsPage?.shortcutSettings ?? shell.appShell?.settingsPage?.shortcutSettings;
  if (shellShortcut) {
    assert.equal(shellShortcut.apiKey, "");
    assert.equal(shellShortcut.connections, undefined);
  }
});

test("connection storage keys, parsing and default order", () => {
  assert.equal(shortcutSettingsKey("person-tim", "person-tim"), "shortcut_api");
  assert.equal(shortcutSettingsKey("person-joyce", "person-tim"), "shortcut_api_person_person-joyce");
  assert.equal(shortcutKeyPersonId("shortcut_api", "person-tim"), "person-tim");
  assert.equal(shortcutKeyPersonId("shortcut_api_person_person-joyce", "person-tim"), "person-joyce");
  assert.equal(shortcutKeyPersonId("payment_ways", "person-tim"), "");

  assert.deepEqual(parseStoredShortcutConnection("not json"), { apiKey: "", defaultAccountPriorityIds: [], defaultParams: "", foreignCurrencyAccountId: "", revoked: false });
  assert.deepEqual(
    parseStoredShortcutConnection(JSON.stringify({ apiKey: " k ", defaultAccountPriorityIds: ["a", 3], revoked: true })),
    { apiKey: "k", defaultAccountPriorityIds: ["a"], defaultParams: "", foreignCurrencyAccountId: "", revoked: true }
  );

  const accounts = [
    { id: "tim-bank", name: "B", institution: "UOB", kind: "bank", ownerPersonId: "person-tim", isJoint: false, isActive: true },
    { id: "joyce-card", name: "C", institution: "Citi", kind: "credit_card", ownerPersonId: "person-joyce", isJoint: false, isActive: true },
    { id: "tim-card", name: "A", institution: "UOB", kind: "credit_card", ownerPersonId: "person-tim", isJoint: false, isActive: true },
    { id: "joint", name: "J", institution: "DBS", kind: "bank", ownerPersonId: undefined, isJoint: true, isActive: true },
    { id: "old", name: "Old", institution: "DBS", kind: "credit_card", ownerPersonId: "person-joyce", isJoint: false, isActive: false }
  ];
  assert.deepEqual(buildDefaultShortcutAccountPriorityIds(accounts, "person-joyce"), ["joyce-card", "joint", "tim-card", "tim-bank"]);
  assert.deepEqual(buildDefaultShortcutAccountPriorityIds(accounts), ["joyce-card", "tim-card", "joint", "tim-bank"]);
  // Saved order first, inactive and unknown ids dropped, new accounts appended.
  assert.deepEqual(completeShortcutPriorityIds(accounts, ["joint", "old", "gone"], "person-joyce"), ["joint", "joyce-card", "tim-card", "tim-bank"]);
});

test("a key matches exactly one connection, and a connection with no key matches nothing", async () => {
  const connections = [{ id: "tim", apiKey: "mm_tim" }, { id: "joyce", apiKey: "mm_joyce" }, { id: "none", apiKey: "" }];
  assert.equal((await findShortcutConnectionByKey(connections, "mm_joyce"))?.id, "joyce");
  assert.equal((await findShortcutConnectionByKey(connections, "mm_tim"))?.id, "tim");
  assert.equal(await findShortcutConnectionByKey(connections, ""), null);
  assert.equal(await findShortcutConnectionByKey(connections, "mm_tim "), null);
  assert.equal(await findShortcutConnectionByKey([], "mm_tim"), null);
});
