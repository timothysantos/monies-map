// No duplicate entry after a reload during an Ask save (docs/flows/ask-flow.md
// "Continuity"). Each Ask card carries a stable client id, kept with the card
// in the conversation store, and sends it as the create route's
// externalReference (`ask:<id>`). A repeat create with the same reference
// returns the entry it already made instead of adding a row, so a card that
// comes back as a draft after a reload resolves to that entry when saved
// again. Real Worker routes on a real local D1 seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { buildCardCreateDraft, createAskCard, markCardSaved, markCardSaving, markCardUndone, setCardField, setShare, validateCard } from "../src/client/ask-card-model.js";
import { saveCardEntry, undoSavedEntry } from "../src/client/ask-api.js";
import { createAskConversationStore } from "../src/client/ask-conversation-store.js";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const DATE = "2026-05-16";
const ADD = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };
const ADD_KEY = "add|entries||";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function createBody(overrides = {}) {
  return {
    date: DATE,
    description: "Dedupe kopi",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 450,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "",
    ...overrides
  };
}

async function entryRows(db, description) {
  return rows(db, "SELECT id, external_reference FROM transactions WHERE description = ?", description);
}

async function activeSplitsOf(db, entryId) {
  return rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId);
}

async function cardContext(db) {
  const accounts = await rows(db, "SELECT id, account_name AS name, currency, is_active FROM accounts ORDER BY account_name");
  return {
    today: DATE,
    viewId: "person-tim",
    people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    accounts: accounts.map((account) => ({ ...account, isActive: account.is_active !== 0 })),
    categories: [{ name: "Other" }, { name: "Groceries" }],
    defaultAccountPriorityIds: []
  };
}

async function filledCard(db, description, { share = false } = {}) {
  const context = await cardContext(db);
  const uob = context.accounts.find((account) => account.name === "UOB One");
  let card = setCardField(createAskCard(context), { amountInput: "4.50", description, date: DATE, accountId: uob.id, categoryName: "Groceries" }, context);
  if (share) card = setShare(card, { on: true, splitGroupId: "" });
  assert.equal(validateCard(card).canSave, true, JSON.stringify(validateCard(card)));
  return { card, context };
}

// --- the create route ---------------------------------------------------

test("the same externalReference sent twice makes one entry; the repeat returns it as not created", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const reference = "ask:0f8e7d6c-1111-4222-8333-944455556666";

  const first = await api("/api/entries/create", createBody({ externalReference: reference }));
  const repeat = await api("/api/entries/create", createBody({ externalReference: reference }));

  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(repeat.status, 200, JSON.stringify(repeat.payload));
  assert.equal(first.payload.created, true);
  assert.equal(repeat.payload.created, false);
  assert.equal(repeat.payload.entryId, first.payload.entryId);
  assert.deepEqual(await entryRows(db, "Dedupe kopi"), [{ id: first.payload.entryId, external_reference: reference }]);

  // Without a reference every create is a new entry, as before.
  await api("/api/entries/create", createBody({ description: "No reference" }));
  await api("/api/entries/create", createBody({ description: "No reference" }));
  assert.equal((await entryRows(db, "No reference")).length, 2);
});

test("a repeat with the same reference but different details is refused and writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const reference = "ask:5a5a5a5a-2222-4333-8444-955566667777";
  const first = await api("/api/entries/create", createBody({ externalReference: reference }));
  assert.equal(first.status, 200);
  const before = await dumpDatabase(db);

  const changed = await api("/api/entries/create", createBody({ externalReference: reference, amountMinor: 900 }));

  assert.equal(changed.status, 400);
  assert.equal(changed.payload.error, "This entry was already saved with different details. Check Entries before saving it again.");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("only an Ask reference is accepted; a Shortcut's or a malformed one is refused before anything is written", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  for (const externalReference of ["shortcut:abc12345", "ask:short", `ask:${"a".repeat(80)}`, "ask:has spaces in it", 42]) {
    const response = await api("/api/entries/create", createBody({ externalReference }));
    assert.equal(response.status, 400, String(externalReference));
    assert.equal(response.payload.error, "Invalid entry reference");
  }
  assertSameDatabase(await dumpDatabase(db), before);
});

// --- the Ask card through the store --------------------------------------

test("a card restored as a draft after a reload during its save resolves to the entry already made, and Undo removes it", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db } = workspace;
  const fetchImpl = (pathname, init) => workspace.fetch(pathname, init);
  const storage = memoryStorage();
  const description = "Ask reload kopi";
  const { card, context } = await filledCard(db, description);

  const store = createAskConversationStore({ storage });
  store.begin(ADD_KEY, () => ({ intent: ADD, thread: [], card, cardSlot: 0, composerText: "", pending: null, scrollFromBottom: 0 }));
  // Save tapped: the card is saving and its create request reaches the
  // server, but the page reloads before the answer comes back.
  const saving = markCardSaving(store.read(ADD_KEY).card);
  store.update(ADD_KEY, (current) => ({ ...current, card: saving }));
  const lost = await saveCardEntry(buildCardCreateDraft(saving, context), { fetchImpl });
  assert.equal(lost.ok, true, JSON.stringify(lost));

  // The reload: the card comes back as a draft with the same client id.
  const restored = createAskConversationStore({ storage }).read(ADD_KEY).card;
  assert.equal(restored.status, "draft");
  assert.equal(restored.clientId, card.clientId);
  assert.match(restored.clientId, /^[A-Za-z0-9-]{8,64}$/);

  // Saving again resolves to the entry already made: one row, Saved.
  const again = await saveCardEntry(buildCardCreateDraft(markCardSaving(restored), context), { fetchImpl });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.entryId, lost.entryId);
  assert.deepEqual((await entryRows(db, description)).map((row) => row.id), [lost.entryId]);
  const saved = markCardSaved(restored, again);
  assert.equal(saved.status, "saved");
  assert.equal(saved.saved.entryId, lost.entryId);

  // Undo still removes it; the card that comes back has a new id, so saving
  // it once more is a new entry, not the removed one.
  const undone = await undoSavedEntry(saved.saved, { fetchImpl });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(await entryRows(db, description), []);
  const back = markCardUndone(saved);
  assert.notEqual(back.clientId, card.clientId);
  const resaved = await saveCardEntry(buildCardCreateDraft(markCardSaving(back), context), { fetchImpl });
  assert.equal(resaved.ok, true);
  assert.notEqual(resaved.entryId, lost.entryId);
  assert.equal((await entryRows(db, description)).length, 1);
});

test("a shared card saved again after a reload keeps one entry and one split, and Undo removes both", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db } = workspace;
  const fetchImpl = (pathname, init) => workspace.fetch(pathname, init);
  const description = "Ask reload split";
  const { card, context } = await filledCard(db, description, { share: true });

  const lost = await saveCardEntry(buildCardCreateDraft(markCardSaving(card), context), { fetchImpl });
  assert.equal(lost.ok, true, JSON.stringify(lost));
  assert.ok(lost.splitExpenseId);

  const again = await saveCardEntry(buildCardCreateDraft(markCardSaving(card), context), { fetchImpl });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.splitAddError, "");
  assert.equal(again.entryId, lost.entryId);
  assert.equal(again.splitExpenseId, lost.splitExpenseId);
  assert.equal(again.splitExpenseMonth, lost.splitExpenseMonth);
  assert.equal((await entryRows(db, description)).length, 1);
  assert.deepEqual((await activeSplitsOf(db, lost.entryId)).map((row) => row.id), [lost.splitExpenseId]);

  const undone = await undoSavedEntry(markCardSaved(card, again).saved, { fetchImpl });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(await entryRows(db, description), []);
  assert.deepEqual(await rows(db, "SELECT id FROM split_expenses WHERE id = ? AND deleted_at IS NULL", lost.splitExpenseId), []);
});

test("a reload after the entry but before its split: saving again adds the split once", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db } = workspace;
  const fetchImpl = (pathname, init) => workspace.fetch(pathname, init);
  const description = "Ask reload half";
  const { card, context } = await filledCard(db, description, { share: true });
  const draft = buildCardCreateDraft(markCardSaving(card), context);

  // Only the entry create reached the server.
  const entryOnly = await workspace.api("/api/entries/create", { ...draft, addToSplits: undefined, externalReference: draft.externalReference });
  assert.equal(entryOnly.status, 200, JSON.stringify(entryOnly.payload));

  const again = await saveCardEntry(draft, { fetchImpl });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.entryId, entryOnly.payload.entryId);
  assert.ok(again.splitExpenseId);
  assert.equal(again.splitAddError, "");
  assert.equal((await entryRows(db, description)).length, 1);
  assert.equal((await activeSplitsOf(db, again.entryId)).length, 1);
});

test("every new card gets its own client id, sent as an ask: reference", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const { card, context } = await filledCard(db, "Ids");
  const other = createAskCard(context);
  assert.ok(card.clientId);
  assert.notEqual(card.clientId, other.clientId);
  assert.equal(buildCardCreateDraft(card, context).externalReference, `ask:${card.clientId}`);
  // A card kept from before client ids gets one when it is saved.
  const { clientId: _dropped, ...legacy } = card;
  const sending = markCardSaving(legacy);
  assert.match(sending.clientId, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(buildCardCreateDraft(sending, context).externalReference, `ask:${sending.clientId}`);
});
