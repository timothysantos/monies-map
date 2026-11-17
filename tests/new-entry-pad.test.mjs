// How a new entry leads to the Just paid pad (src/client/new-entry-pad.js;
// docs/flows/cash-entry-flow.md "Amount first"): which arrivals open the pad
// at once, when the card's $0.00 opens it, when the empty entry sits low,
// and that each switch off brings back the earlier behaviour.
import assert from "node:assert/strict";
import test from "node:test";

import { NEW_ENTRY_PAD } from "../src/domain/quick-pad-config.ts";
import { createAskCard, setCardField, setCardVariant } from "../src/client/ask-card-model.js";
import { amountOpensPad, emptyEntrySitsLow, justPaidLeads, PAD_SHOWN_STATE, newEntryPadConfig, shouldOpenPadOnArrival } from "../src/client/new-entry-pad.js";

const context = {
  today: "2026-11-17",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [{ id: "acct-citi", name: "Citi Rewards", currency: "SGD", isActive: true }],
  categories: [{ name: "Other" }, { name: "Food & Drinks" }]
};
const on = { openPadOnNewEntry: true, amountOpensPad: true, justPaidFirst: true, emptyEntryLow: true };
const off = { openPadOnNewEntry: false, amountOpensPad: false, justPaidFirst: false, emptyEntryLow: false };
const plus = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };
const plusState = { askOrigin: { id: "1", from: "entries", path: "/entries?view=person-tim" } };

test("every switch is on by default and the config reads them as set", () => {
  assert.deepEqual({ ...NEW_ENTRY_PAD }, on);
  assert.deepEqual(newEntryPadConfig(), on);
  assert.ok(Object.isFrozen(NEW_ENTRY_PAD));
});

test("only the plain + from Entries on a phone opens the pad on arrival", () => {
  const card = createAskCard(context);
  const base = { intent: plus, state: plusState, card, isPhone: true, config: on };
  assert.equal(shouldOpenPadOnArrival(base), true);
  // Desktop, the entry already marked (Ask marks it once shown), an entry the
  // person had started before leaving, the switch off.
  assert.equal(shouldOpenPadOnArrival({ ...base, isPhone: false }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, state: { ...plusState, [PAD_SHOWN_STATE]: true } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, card: setCardField(card, { description: "Taxi" }, context) }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, card: { ...card, status: "saved" } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, config: { ...on, openPadOnNewEntry: false } }), false);
  // A link straight to a new entry: same intent, no place kept by the +;
  // the Splits receipt button keeps one from Splits.
  assert.equal(shouldOpenPadOnArrival({ ...base, state: {} }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, state: { askOrigin: { id: "1", from: "splits" } } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, state: null }), false);
  // Ask's own Add entry (from: ask), the Splits receipt button, an Apple Pay
  // entry opened from its notification, and the chat.
  assert.equal(shouldOpenPadOnArrival({ ...base, intent: { ...plus, from: "ask" } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, intent: { ...plus, mode: "expense", from: "splits" } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, intent: { ...plus, savedEntryId: "txn-1" } }), false);
  assert.equal(shouldOpenPadOnArrival({ ...base, intent: { ...plus, mode: "chat" } }), false);
});

test("only the Entries + hands Ask a place kept from Entries, and App.jsx needs nothing new for it", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/client/App.jsx", import.meta.url), "utf8");
  const calls = app.match(/openAskFromPage\([^;]*\);/g) ?? [];
  assert.equal(calls.filter((call) => call.endsWith(', "entries");')).length, 1);
  assert.match(calls.find((call) => call.endsWith(', "entries");')), /\{ mode: "add", from: "entries" \}/);
  assert.doesNotMatch(app, /new-entry-pad|newEntryPad/);
});

test("the $0.00 opens the pad only on an empty new expense on a phone", () => {
  const empty = createAskCard(context);
  assert.equal(amountOpensPad({ intent: plus, card: empty, isPhone: true, config: on }), true);
  assert.equal(amountOpensPad({ intent: plus, card: empty, isPhone: false, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: empty, isPhone: true, config: off }), false);
  // Anything on it, a filled card, a saved entry being changed, income or a
  // transfer, a card on its way to the server: typed in place as before.
  assert.equal(amountOpensPad({ intent: plus, card: setCardField(empty, { description: "Coffee" }, context), isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: setCardField(empty, { amountInput: "4.20" }, context), isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: { ...empty, origin: "saved" }, isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: { ...empty, origin: "receipt" }, isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: setCardVariant(empty, "income", context), isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: setCardVariant(empty, "transfer", context), isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: { ...empty, status: "saving" }, isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: plus, card: null, isPhone: true, config: on }), false);
  // The Splits receipt button's expense and Ask's own Add entry from the chat.
  const splitsCard = createAskCard(context, { mode: "expense" });
  assert.equal(amountOpensPad({ intent: { ...plus, mode: "expense", from: "splits" }, card: splitsCard, isPhone: true, config: on }), false);
  assert.equal(amountOpensPad({ intent: { ...plus, from: "ask" }, card: empty, isPhone: true, config: on }), true);
});

test("Just paid leads the chips on a new entry only, and not with its switch off", () => {
  assert.equal(justPaidLeads({ intent: plus, config: on }), true);
  assert.equal(justPaidLeads({ intent: { ...plus, mode: "expense", from: "splits" }, config: on }), false);
  assert.equal(justPaidLeads({ intent: plus, config: { ...on, justPaidFirst: false } }), false);
});

test("the empty entry sits low on a phone until it has content", () => {
  const empty = createAskCard(context);
  assert.equal(emptyEntrySitsLow({ intent: plus, card: empty, isPhone: true, config: on }), true);
  assert.equal(emptyEntrySitsLow({ intent: plus, card: empty, isPhone: false, config: on }), false);
  assert.equal(emptyEntrySitsLow({ intent: plus, card: empty, isPhone: true, config: { ...on, emptyEntryLow: false } }), false);
  assert.equal(emptyEntrySitsLow({ intent: plus, card: setCardField(empty, { description: "c" }, context), isPhone: true, config: on }), false);
  // A changed date, or a chip opening its row's picker, brings the rows back.
  assert.equal(emptyEntrySitsLow({ intent: plus, card: setCardField(empty, { date: "2026-11-16" }, context), isPhone: true, config: on }), false);
  assert.equal(emptyEntrySitsLow({ intent: plus, card: empty, isPhone: true, rowsInUse: true, config: on }), false);
  assert.equal(emptyEntrySitsLow({ intent: { ...plus, mode: "expense", from: "splits" }, card: empty, isPhone: true, config: on }), false);
});
