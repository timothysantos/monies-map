// Ask habits, suggestions and Done for you (docs/flows/ask-flow.md
// "Hands-off"), through the real Worker on a local D1 seeded with the demo
// household. Habits are counted from commands the person runs; Ask applies
// only the safe set, only when every gate holds, logs every one and Undo
// reverses it through the existing commands. No AI is involved: none of
// these routes has a provider.
import assert from "node:assert/strict";
import test from "node:test";

import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const TOKEN = "mm_habits_key";

const shop = (name) => ({ date: TODAY, description: name, categoryName: "Food & Drinks", amountMinor: 1_200 });

// Establishes a habit through the real commands: each new entry is a
// category confirmation, each add to splits a split confirmation.
async function teachShop(api, name, { times = 3, split = false, category = "Food & Drinks", basisPoints = 5000 } = {}) {
  const ids = [];
  for (let index = 0; index < times; index += 1) {
    const entryId = await createEntry(api, { ...shop(`${name} ${91_000_000 + index}`), categoryName: category });
    ids.push(entryId);
    if (split) {
      const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: basisPoints });
      assert.equal(added.status, 200, JSON.stringify(added.payload));
    }
  }
  return ids;
}

async function habits(api) {
  const { payload } = await api("/api/ask/habits");
  return payload;
}

async function enableShortcut(api) {
  const settings = await api("/api/settings-page?view=household");
  const activeIds = settings.payload.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  const saved = await api("/api/settings/shortcuts/save", { apiKey: TOKEN, defaultAccountPriorityIds: activeIds });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
}

async function applePayEntry(fetchRoute, description) {
  const response = await fetchRoute("/api/shortcuts/entries/create", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Monies-Shortcut-Token": TOKEN },
    body: JSON.stringify({ amount: "12.30", description, accountName: "UOB One", date: TODAY, requestId: `habits-${Math.round(Math.random() * 1e9)}` })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.entryId;
}

async function entryState(db, entryId) {
  const [entry] = await rows(db, "SELECT categories.name AS category, transactions.note FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?", entryId);
  const [split] = await rows(db, "SELECT id, deleted_at, split_group_id FROM split_expenses WHERE linked_transaction_id = ? ORDER BY rowid DESC", entryId);
  const shares = split ? await rows(db, "SELECT person_id, ratio_basis_points FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", split.id) : [];
  return { ...entry, onSplits: Boolean(split && !split.deleted_at), shares };
}

test("confirmations are counted from the person's own commands, and a key never carries a number", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Kopitiam Corner", { times: 3 });
  const stored = await rows(db, "SELECT kind, key, times_confirmed, times_overridden, source FROM ask_habits");
  assert.deepEqual(stored.map((row) => [row.kind, row.key, row.times_confirmed, row.times_overridden, row.source]), [["category", "kopitiam corner", 3, 0, "entries"]]);
  assert.ok(stored.every((row) => !/\d{4}/.test(row.key)));
  const shown = await habits(api);
  assert.equal(shown.available, true);
  assert.equal(shown.enabled, true, "Let Ask handle safe things is on by default");
  assert.deepEqual(shown.habits.map((habit) => [habit.label, habit.text, habit.sure]), [["Kopitiam Corner", "Food & Drinks", true]]);
});

test("changing a shop's category is an override: the new category starts again from one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await teachShop(api, "Kopitiam Corner", { times: 3 });
  const changed = await api("/api/entries/update-category", { entryId: ids[0], categoryName: "Groceries" });
  assert.equal(changed.status, 200);
  const [row] = await rows(db, "SELECT value_json, times_confirmed, times_overridden FROM ask_habits WHERE kind = 'category'");
  assert.deepEqual([JSON.parse(row.value_json), row.times_confirmed, row.times_overridden], [{ categoryName: "Groceries" }, 1, 1]);
  assert.equal((await habits(api)).habits[0].sure, false);
});

test("the usual split is learned from Add to Splits, from the payer's side, and a fixed amount is not a habit", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Hawker Dinner", { times: 3, split: true, basisPoints: 7000 });
  const [habit] = await rows(db, "SELECT key, value_json, times_confirmed FROM ask_habits WHERE kind = 'split'");
  assert.equal(habit.key, "hawker dinner");
  assert.equal(habit.times_confirmed, 3);
  assert.deepEqual(JSON.parse(habit.value_json), { groupId: null, payerPersonId: "person-tim", payerShareBasisPoints: 7000 });
  const fixed = await createEntry(api, shop("Fixed Amount Place"));
  await api("/api/splits/expenses/from-entry", { entryId: fixed, splitGroupId: null, splitAmountMinor: 300 });
  assert.equal((await rows(db, "SELECT 1 FROM ask_habits WHERE key = 'fixed amount place' AND kind = 'split'")).length, 0);
  const text = (await habits(api)).habits.find((item) => item.kind === "split").text;
  assert.equal(text, "Add to splits 70/30 with Joyce");
});

test("a catch-all category is never a habit", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Mystery Shop", { times: 3, category: "Other" });
  assert.equal((await rows(db, "SELECT 1 FROM ask_habits")).length, 0);
});

test("an Apple Pay entry is handled by Ask: category set, added to splits, logged, and Undo reverses it and starts the habit again", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await enableShortcut(api);
  await teachShop(api, "Bengawan Solo", { times: 3, split: true });

  const entryId = await applePayEntry(fetch, "BENGAWAN SOLO 91234567");
  const state = await entryState(db, entryId);
  assert.equal(state.category, "Food & Drinks");
  assert.equal(state.onSplits, true);
  assert.deepEqual(state.shares.map((share) => share.ratio_basis_points), [5000, 5000]);

  const done = (await api("/api/ask/done")).payload.items;
  assert.deepEqual(done.map((item) => [item.kind, item.entryId, item.summary, item.undone]).sort(), [
    ["category", entryId, "Category set to Food & Drinks", false],
    ["split", entryId, "Added to splits 50/50 with Joyce", false]
  ]);
  assert.ok(done.every((item) => item.entryDescription === "BENGAWAN SOLO 91234567" && Date.parse(item.at) > 0));

  // Undo the split, then the category, through the existing commands.
  const splitItem = done.find((item) => item.kind === "split");
  const undoSplit = await api("/api/ask/done/undo", { id: splitItem.id });
  assert.equal(undoSplit.status, 200, JSON.stringify(undoSplit.payload));
  assert.equal((await entryState(db, entryId)).onSplits, false);
  const undoCategory = await api("/api/ask/done/undo", { id: done.find((item) => item.kind === "category").id });
  assert.equal(undoCategory.status, 200, JSON.stringify(undoCategory.payload));
  assert.equal((await entryState(db, entryId)).category, "Other", "back to the rules' default");
  assert.deepEqual((await api("/api/ask/done")).payload.items.map((item) => item.undone), [true, true]);

  // Undo counts as an override: both habits are back to nothing and the
  // same entry is not handled again when it is opened.
  const counters = await rows(db, "SELECT kind, times_confirmed, times_overridden FROM ask_habits WHERE key = 'bengawan solo' ORDER BY kind");
  assert.deepEqual(counters.map((row) => [row.kind, row.times_confirmed, row.times_overridden]), [["category", 0, 1], ["split", 0, 1]]);
  const reopened = await api("/api/ask/entry-habits", { entryId });
  assert.deepEqual(reopened.payload.done, []);
  assert.equal(reopened.payload.suggestion, null);
  assert.equal((await entryState(db, entryId)).onSplits, false);
  const next = await applePayEntry(fetch, "BENGAWAN SOLO 55555555");
  assert.equal((await entryState(db, next)).onSplits, false, "a decayed habit does not apply");
});

test("every excluded case is left alone: low confidence, old, certified, imported, setting off", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await enableShortcut(api);

  // Low confidence: two confirmations suggest, they never apply.
  await teachShop(api, "Two Times Cafe", { times: 2, split: true });
  const low = await applePayEntry(fetch, "TWO TIMES CAFE");
  assert.equal((await entryState(db, low)).onSplits, false);
  const lowAsk = await api("/api/ask/entry-habits", { entryId: low });
  assert.equal(lowAsk.payload.suggestion.text, "Food & Drinks \u00b7 Add to splits 50/50 with Joyce, as you usually do");
  assert.deepEqual(lowAsk.payload.done, []);

  // Three entries are made before the shop has a split habit, then made
  // old, certified and imported; the habit becomes high afterwards.
  const old = await createEntry(api, shop("Gate Shop"));
  const certified = await createEntry(api, shop("Gate Shop"));
  const imported = await createEntry(api, shop("Gate Shop"));
  const hours = await createEntry(api, shop("Gate Shop"));
  await db.prepare("UPDATE transactions SET created_at = datetime('now', '-3 hours') WHERE id IN (?, ?)").bind(old, hours).run();
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(certified).run();
  await db.prepare("INSERT INTO imports (id, household_id, source_type, source_label) VALUES ('import-elsewhere', 'household-1', 'csv', 'statement.csv')").run();
  await db.prepare("UPDATE transactions SET import_id = 'import-elsewhere' WHERE id = ?").bind(imported).run();
  await teachShop(api, "Gate Shop", { times: 3, split: true });
  assert.equal((await habits(api)).habits.find((habit) => habit.kind === "split").sure, true);
  for (const entryId of [old, certified, imported, hours]) {
    const result = await api("/api/ask/entry-habits", { entryId });
    assert.deepEqual(result.payload.done, [], entryId);
    assert.equal((await entryState(db, entryId)).onSplits, false, entryId);
  }

  // A new hand-made entry keeps the category the person chose; only the
  // habitual split is added, and it is logged.
  const handMade = await createEntry(api, { ...shop("Gate Shop"), categoryName: "Groceries" });
  const state = await entryState(db, handMade);
  assert.equal(state.category, "Groceries", "never replaces the person's own category");
  assert.equal(state.onSplits, true, "the habitual split is added to a new hand-made entry");
  assert.deepEqual((await api("/api/ask/done")).payload.items.map((item) => [item.kind, item.entryId]), [["split", handMade]]);

  // Setting off: nothing happens by itself, the suggestion still shows.
  const off =await api("/api/ask/habits/setting", { enabled: false });
  assert.deepEqual([off.status, off.payload.enabled], [200, false]);
  const manual = await createEntry(api, shop("Gate Shop"));
  assert.equal((await entryState(db, manual)).onSplits, false);
  const suggested = await api("/api/ask/entry-habits", { entryId: manual });
  assert.deepEqual(suggested.payload.done, []);
  assert.equal(suggested.payload.suggestion.text, "Add to splits 50/50 with Joyce, as you usually do");
  assert.equal((await api("/api/ask/done")).payload.items.filter((item) => item.entryId === manual).length, 0);
});

test("a split habit does not apply to someone else's entry, and an entry already on Splits has nothing to suggest", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Bengawan Solo", { times: 3, split: true });
  // Joyce pays: the habit is Tim's.
  const joyce = await createEntry(api, { ...shop("Bengawan Solo"), ownerName: "Joyce" });
  assert.equal((await entryState(db, joyce)).onSplits, false);
  assert.equal((await api("/api/ask/entry-habits", { entryId: joyce })).payload.suggestion, null);
  // Already on Splits: nothing to add.
  const added = await createEntry(api, { ...shop("Bengawan Solo"), splitBasisPoints: 5000 });
  assert.equal((await api("/api/ask/entry-habits", { entryId: added })).payload.suggestion, null);
});

test("Undo is refused once the entry changed, and a second Undo is refused", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await enableShortcut(api);
  await teachShop(api, "Bengawan Solo", { times: 3 });
  const first = await applePayEntry(fetch, "BENGAWAN SOLO");
  const second = await applePayEntry(fetch, "BENGAWAN SOLO");
  const items = (await api("/api/ask/done")).payload.items;
  const firstItem = items.find((candidate) => candidate.entryId === first);
  const secondItem = items.find((candidate) => candidate.entryId === second);
  assert.equal(firstItem.kind, "category");

  assert.equal((await api("/api/ask/done/undo", { id: secondItem.id })).status, 200);
  const again = await api("/api/ask/done/undo", { id: secondItem.id });
  assert.equal(again.status, 409);
  assert.match(again.payload.error, /already undone/);
  assert.equal((await api("/api/ask/done/undo", { id: "done-missing" })).status, 409);

  await api("/api/entries/update-category", { entryId: first, categoryName: "Groceries" });
  const refused = await api("/api/ask/done/undo", { id: firstItem.id });
  assert.equal(refused.status, 409);
  assert.match(refused.payload.error, /changed since/);
  assert.equal((await entryState(db, first)).category, "Groceries");
});

test("Done for you lists the last 30 days only", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await enableShortcut(api);
  await teachShop(api, "Bengawan Solo", { times: 3 });
  await applePayEntry(fetch, "BENGAWAN SOLO");
  assert.equal((await api("/api/ask/done")).payload.items.length, 1);
  await db.prepare("UPDATE audit_events SET created_at = datetime('now', '-31 days') WHERE entity_type = 'ask_auto'").run();
  assert.deepEqual((await api("/api/ask/done")).payload.items, []);
});

test("the suggestion's cross counts as an override; Stop doing this and Forget everything delete habits", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Kopitiam Corner", { times: 3 });
  await teachShop(api, "Hawker Dinner", { times: 3, split: true });
  const declined = await api("/api/ask/habits/decline", { id: "category:kopitiam corner" });
  assert.equal(declined.status, 200);
  const [row] = await rows(db, "SELECT times_confirmed, times_overridden FROM ask_habits WHERE key = 'kopitiam corner'");
  assert.deepEqual([row.times_confirmed, row.times_overridden], [0, 1]);

  const deleted = await api("/api/ask/habits/delete", { id: "split:hawker dinner" });
  assert.equal(deleted.status, 200);
  assert.equal((await rows(db, "SELECT 1 FROM ask_habits WHERE kind = 'split'")).length, 0);
  assert.equal((await api("/api/ask/habits/delete", { id: "split:hawker dinner" })).status, 400);
  assert.equal((await api("/api/ask/habits/delete", { id: "nonsense" })).status, 400);

  const forgot = await api("/api/ask/habits/forget-all", {});
  assert.deepEqual([forgot.status, forgot.payload.forgotten], [200, 2]);
  assert.equal((await rows(db, "SELECT 1 FROM ask_habits")).length, 0);
  const actions = (await rows(db, "SELECT action FROM audit_events WHERE entity_id = 'ask_habits' ORDER BY rowid")).map((event) => event.action);
  assert.deepEqual(actions, ["ask_habit_deleted", "ask_habits_forgotten"]);
});

test("a habit edited in Settings is used at once, and bad edits are refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await teachShop(api, "Kopitiam Corner", { times: 2 });
  assert.equal((await habits(api)).habits[0].sure, false);
  const edited = await api("/api/ask/habits/update", { id: "category:kopitiam corner", categoryName: "Groceries" });
  assert.equal(edited.status, 200, JSON.stringify(edited.payload));
  const shown = (await habits(api)).habits[0];
  assert.deepEqual([shown.text, shown.sure], ["Groceries", true]);
  assert.equal((await api("/api/ask/habits/update", { id: "category:kopitiam corner", categoryName: "No Such Category" })).status, 400);
  assert.equal((await api("/api/ask/habits/update", { id: "category:nobody", categoryName: "Groceries" })).status, 400);
  const [row] = await rows(db, "SELECT source FROM ask_habits");
  assert.equal(row.source, "settings");
});

test("aliases: a confirmed nickname is kept; a person's own name, a phrase and numbers are not", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await api("/api/ask/habits/alias", { alias: "J", personId: "person-joyce" });
  await api("/api/ask/habits/alias", { alias: "Joyce", personId: "person-joyce" });
  await api("/api/ask/habits/alias", { alias: "my wife", personId: "person-joyce" });
  await api("/api/ask/habits/alias", { alias: "9123", personId: "person-joyce" });
  await api("/api/ask/habits/alias", { alias: "X", personId: "person-nobody" });
  const stored = await rows(db, "SELECT kind, key, value_json FROM ask_habits");
  assert.deepEqual(stored.map((row) => [row.kind, row.key, JSON.parse(row.value_json)]), [["alias", "j", { personId: "person-joyce" }]]);
  const shown = (await habits(api)).habits[0];
  assert.deepEqual([shown.label, shown.text], ["J", "Means Joyce"]);
});

test("the feature is simply off while the table is missing: commands still work and nothing errors", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await enableShortcut(api);
  await db.prepare("DROP TABLE ask_habits").run();
  const entryId = await createEntry(api, shop("Kopitiam Corner"));
  assert.equal((await api("/api/entries/update-category", { entryId, categoryName: "Groceries" })).status, 200);
  assert.equal((await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null })).status, 200);
  const shown = await habits(api);
  assert.deepEqual([shown.available, shown.habits], [false, []]);
  const asked = await api("/api/ask/entry-habits", { entryId });
  assert.deepEqual([asked.status, asked.payload.done, asked.payload.suggestion], [200, [], null]);
  assert.ok((await applePayEntry(fetch, "ANYWHERE 12345678")));
  assert.deepEqual((await api("/api/ask/done")).payload.items, []);
});

test("negative: an entry that is not there, a bad body and a wrong method are refused", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  assert.equal((await api("/api/ask/entry-habits", { entryId: "txn-not-there" })).status, 404);
  assert.equal((await api("/api/ask/entry-habits", {})).status, 400);
  assert.equal((await api("/api/ask/habits/setting", { enabled: "yes" })).status, 400);
  assert.equal((await fetch("/api/ask/habits", { method: "DELETE" })).status, 405);
  assert.equal((await fetch("/api/ask/entry-habits")).status, 405);
});
