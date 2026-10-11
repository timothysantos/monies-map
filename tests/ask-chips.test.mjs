// The Ask page's chip row (src/client/ask-chips.js) and its routes
// (src/client/app-routing.js): which chips show in each mode and card
// state, how questions are worded, and the URLs that open Ask.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAskChips, describeOption, describeQuestion, suggestCategories } from "../src/client/ask-chips.js";
import { applyEntryDraft, createAskCard, markCardSaved, setCardField, setCardVariant } from "../src/client/ask-card-model.js";
import { readEntryDraftResponse } from "../src/client/ask-api.js";
import { buildAskLocation, buildPageViewFromRouteData, getSelectedTabId, sanitizeTabParams } from "../src/client/app-routing.js";

const context = {
  today: "2026-09-29",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [{ id: "acct-citi", name: "Citi Rewards", currency: "SGD", isActive: true }, { id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true }],
  categories: [{ name: "Other" }, { name: "Food & Drinks" }, { name: "Transport" }, { name: "Shopping" }, { name: "Income" }, { name: "Transfer" }]
};
const actions = new Proxy({}, { get: (_, name) => () => name });
const labels = (result) => result.items.map((item) => item.label);
const chat = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };
const add = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };

test("chat mode with no card offers Scan receipt, Paste, Add entry, Add expense", () => {
  assert.deepEqual(labels(buildAskChips({ intent: chat, card: null, context, actions })), ["Scan receipt", "Paste", "Add entry", "Add expense"]);
});

test("add mode: back to Entries first, then the empty card's chips, Edit in form last", () => {
  const result = buildAskChips({ intent: add, card: createAskCard(context), context, actions });
  assert.deepEqual(labels(result), ["‹ Entries", "Scan receipt", "Paste", "Transfer", "Income", "Edit in form"]);
  assert.equal(result.items[0].back, true);
  assert.equal(result.prompt, "");
  assert.deepEqual(labels(buildAskChips({ intent: { ...add, from: "splits", mode: "expense" }, card: createAskCard(context), context, actions }))[0], "‹ Splits");
});

test("a card with content offers Split with the partner, Add a note, Different card", () => {
  const card = setCardField(createAskCard(context), { amountInput: "12.50", description: "Koufu" }, context);
  assert.deepEqual(labels(buildAskChips({ intent: add, card, context, partner: "Joyce", actions })), ["‹ Entries", "Split with Joyce", "Add a note", "Different card", "Edit in form"]);
  const shared = { ...card, share: { on: true, splitGroupId: "" } };
  assert.ok(labels(buildAskChips({ intent: add, card: shared, context, partner: "Joyce", actions })).includes("Not shared"));
});

test("the transfer and income variants have their own chips", () => {
  const transfer = setCardVariant(createAskCard(context), "transfer", context);
  assert.deepEqual(labels(buildAskChips({ intent: add, card: transfer, context, actions })), ["‹ Entries", "Swap direction", "Add a note", "Edit in form"]);
  const income = setCardVariant(createAskCard(context), "income", context);
  assert.deepEqual(labels(buildAskChips({ intent: add, card: income, context, actions })), ["‹ Entries", "Add a note", "Different wallet", "Edit in form"]);
});

test("a draft's question becomes the prompt line and its options the chips", () => {
  const draft = readEntryDraftResponse({
    draft: {
      fields: { description: { value: "Grab", source: "sentence" }, amountMinor: { value: 1800, source: "sentence" } },
      questions: [{ field: "accountId", reason: "ambiguous", options: [{ accountId: "acct-citi", accountName: "Citi Rewards" }, { accountId: "acct-uob", accountName: "UOB One" }] }]
    }
  });
  const card = applyEntryDraft(createAskCard(context), draft, context);
  const result = buildAskChips({ intent: chat, card, context, actions });
  assert.equal(result.prompt, "Which card or account was it?");
  assert.deepEqual(labels(result), ["Citi Rewards", "UOB One"]);
});

test("questions and options are worded by the client from structured fields", () => {
  assert.equal(describeQuestion({ field: "date", reason: "ambiguous", options: [] }, context), "Which day was it?");
  assert.equal(describeQuestion({ field: "accountId", reason: "transfer_from", options: [] }, context), "Which account did it come from?");
  assert.equal(describeQuestion({ field: "amountMinor", reason: "unclear", options: [] }, context), "Check the amount.");
  assert.match(describeQuestion({ field: "amountMinor", reason: "foreign_currency", foreignAmount: { amountMinor: 15900000, currency: "IDR" } }, context), /^That was .*159,000/);
  assert.equal(describeOption({ date: "2026-09-28" }, {}, context, "2026-09-29"), "Yesterday");
  assert.equal(describeOption({ date: "2026-09-20" }, {}, context, "2026-09-29"), "Sun 20 Sep");
  assert.equal(describeOption({ personName: "Joyce", splitBasisPoints: 5000 }, {}, context, "2026-09-29"), "Joyce 50%");
  assert.equal(describeOption({ amountMinor: 1250 }, {}, context, "2026-09-29"), "$12.50");
});

test("after a save: Back to Entries (filled), Open this entry, Open on Splits when shared, Undo", () => {
  const ready = setCardField(createAskCard(context), { amountInput: "5", description: "Kopi" }, context);
  const saved = markCardSaved(ready, { entryId: "txn-1" });
  const result = buildAskChips({ intent: add, card: saved, context, actions });
  assert.deepEqual(labels(result), ["Back to Entries", "Open this entry", "Undo"]);
  assert.equal(result.items[0].primary, true);
  const shared = markCardSaved(ready, { entryId: "txn-1", splitExpenseId: "split-1" });
  assert.deepEqual(labels(buildAskChips({ intent: { ...add, from: "splits", mode: "expense" }, card: shared, context, actions })), ["Back to Splits", "Open this entry", "Open on Splits", "Undo"]);
});

test("a Shortcut-saved entry in Other asks for a category, then offers Splits", () => {
  const ready = setCardField(createAskCard(context), { amountInput: "6.90", description: "STARBUCKS" }, context);
  const saved = markCardSaved(ready, { entryId: "txn-apple" });
  const entries = [
    { entryType: "expense", categoryName: "Transport" },
    { entryType: "expense", categoryName: "Food & Drinks" },
    { entryType: "expense", categoryName: "Food & Drinks" },
    { entryType: "income", categoryName: "Income" }
  ];
  const result = buildAskChips({
    intent: { mode: "chat", from: "shortcut", savedEntryId: "txn-apple", splitGroupId: "" },
    card: saved,
    context,
    entries,
    splitGroups: [{ id: "split-group-none", name: "Non-group expenses" }, { id: "group-home", name: "Home" }],
    actions
  });
  assert.equal(result.prompt, "It landed in Other. Which category fits?");
  assert.deepEqual(labels(result), ["Open this entry", "Food & Drinks", "Transport", "Shopping", "Choose category", "Add to Non-group expenses", "Add to Home"]);
  assert.deepEqual(suggestCategories([], context.categories), ["Food & Drinks", "Shopping", "Transport"]);
});

test("Ask has its own route; its params never leak into other tabs", () => {
  assert.equal(getSelectedTabId("/ask"), "ask");
  assert.equal(getSelectedTabId("/asks"), "summary");
  const current = new URLSearchParams("view=person-tim&month=2026-04&scope=direct&entry_wallet=acct-citi&split_group=g1");
  assert.deepEqual(buildAskLocation(current, { mode: "add", from: "entries" }), { pathname: "/ask", search: "?view=person-tim&month=2026-04&scope=direct&mode=add&from=entries" });
  assert.deepEqual(buildAskLocation(current, { mode: "expense", from: "splits", splitGroup: "g1" }).search, "?view=person-tim&month=2026-04&scope=direct&mode=expense&from=splits&split_group=g1");
  const leaving = new URLSearchParams("view=person-tim&mode=add&from=entries&saved_entry=txn-1&split_action=add-expense");
  sanitizeTabParams(leaving, "entries");
  assert.equal(leaving.toString(), "view=person-tim");
  const staying = new URLSearchParams("mode=add&from=entries");
  sanitizeTabParams(staying, "ask");
  assert.equal(staying.toString(), "mode=add&from=entries");
  assert.deepEqual(buildPageViewFromRouteData("ask", null, "person-joyce", { household: { people: [{ id: "person-joyce", name: "Joyce" }] } }), { id: "person-joyce", label: "Joyce" });
});
