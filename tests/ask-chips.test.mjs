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

test("with the header's back link (the phone's Ask page), the chip row keeps ‹ Entries only while the card is untouched", () => {
  const untouched = createAskCard(context);
  assert.deepEqual(labels(buildAskChips({ intent: add, card: untouched, context, headerBack: true, actions }))[0], "‹ Entries");
  const started = setCardField(untouched, { amountInput: "4.20" }, context);
  const startedLabels = labels(buildAskChips({ intent: add, card: started, context, headerBack: true, partner: "Joyce", actions }));
  assert.deepEqual(startedLabels, ["Split with Joyce", "Add a note", "Different card", "Edit in form"]);
  // A card filled by a message or a receipt counts as started too.
  const filled = { ...untouched, origin: "message" };
  assert.ok(!labels(buildAskChips({ intent: { ...add, from: "splits", mode: "expense" }, card: filled, context, headerBack: true, actions })).includes("‹ Splits"));
  // Without the header link (the desktop panel, Add entry from the chat),
  // the chip stays the only way back.
  assert.equal(labels(buildAskChips({ intent: add, card: started, context, actions }))[0], "‹ Entries");
  assert.equal(labels(buildAskChips({ intent: { ...add, from: "ask" }, card: started, context, headerBack: false, actions }))[0], "‹ Ask");
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

test("an answer leads the chips with Open in Entries; a follow-up shows only its options; a view change waits for its chip", async () => {
  const { buildFilterChips } = await import("../src/client/ask-chips.js");
  const { applyFilterOption } = await import("../src/client/ask-filter-reader.js");
  const base = buildAskChips({ intent: chat, card: null, context, actions });

  const answer = buildFilterChips({ focus: { kind: "answer", filter: {} }, base, actions });
  assert.deepEqual(labels(answer), ["Open in Entries", "Scan receipt", "Paste", "Add entry", "Add expense"]);
  assert.equal(answer.items[0].primary, true);
  assert.ok(answer.items.slice(1).every((item) => !item.primary));

  const option = { key: "acct-uob", label: "UOB One", patch: { wallets: ["acct-uob"] } };
  const question = buildFilterChips({ focus: { kind: "question", filter: {}, questions: [{ field: "wallet", options: [option, { key: "all", label: "All of them", patch: { wallets: ["acct-citi", "acct-uob"] } }] }] }, base, actions });
  assert.equal(question.prompt, "Which card or account?");
  assert.deepEqual(labels(question), ["UOB One", "All of them"]);
  const unknown = buildFilterChips({ focus: { kind: "question", filter: {}, questions: [{ field: "category", reason: "unknown", word: "groceriez", options: [] }] }, base, actions });
  assert.equal(unknown.prompt, "I couldn't find a category called “groceriez”. Did you mean one of these?");

  const view = buildFilterChips({ focus: { kind: "view", viewId: "person-joyce", scope: "shared" }, base, viewLabel: "Joyce · Shared", actions });
  assert.equal(view.prompt, "Change the view?");
  assert.deepEqual(labels(view).slice(0, 2), ["Switch to Joyce · Shared", "Scan receipt"]);

  // A chosen option adds a wallet or category, and replaces the month or the view.
  assert.deepEqual(applyFilterOption({ wallets: ["acct-citi"], month: "2026-09" }, option), { wallets: ["acct-citi", "acct-uob"], month: "2026-09" });
  assert.deepEqual(applyFilterOption({ wallets: [], month: "2026-09" }, { patch: { month: "2026-08" } }), { wallets: [], month: "2026-08" });
});

test("sanitizeTabParams drops the Ask answer's Entries params from other tabs", () => {
  const params = new URLSearchParams("view=person-tim&month=2026-05&entry_min=50.00&entry_max=80.00&from_ask=1&entry_category=Bills");
  sanitizeTabParams(params, "summary");
  assert.equal(params.toString(), "view=person-tim&month=2026-05");
});

// The chip row and the composer's Save follow the newest thing in the
// thread (docs/flows/ask-flow.md "State Flow"): an answer below an unsaved
// card owns the row, and the card keeps only a way back to it.
test("the newest thread item owns the chips: an answer below an unsaved card never mixes in the card's chips", async () => {
  const { buildChipRow, findActiveItem } = await import("../src/client/ask-chips.js");
  const card = setCardField(createAskCard(context), { amountInput: "12.50", description: "Koufu" }, context);
  const thread = [
    { id: "m1", kind: "me", text: "Koufu 12.50" },
    { id: "m2", kind: "me", text: "how much on bills?" },
    { id: "a1", kind: "answer", filter: { month: "2026-09", categories: ["Bills"] } }
  ];

  // The card sits after the first message; a later question and its answer
  // make the answer the active item.
  const active = findActiveItem({ thread, card, cardSlot: 1, pending: null });
  assert.deepEqual(active, { kind: "answer", filter: thread[2].filter });
  const row = buildChipRow({ active, intent: chat, card, context, partner: "Joyce", actions });
  assert.deepEqual(labels(row), ["Open in Entries", "Back to the unsaved entry"]);
  assert.equal(row.items[0].primary, true);
  assert.equal(row.items[1].primary, false);
  assert.equal(row.prompt, "");
  assert.equal(row.items[1].onClick(), "backToCard");
  // None of the card's own chips leak into the answer's row.
  for (const label of ["Split with Joyce", "Add a note", "Different card", "Edit in form"]) {
    assert.ok(!labels(row).includes(label), label);
  }

  // A status line ("Reading…") below the answer changes nothing.
  assert.equal(findActiveItem({ thread: [...thread, { id: "s1", kind: "status", text: "…" }], card, cardSlot: 1, pending: null }).kind, "answer");

  // Back to the card: once it sits below the answer it is active again, with
  // its own chips and its question line.
  const back = findActiveItem({ thread, card, cardSlot: 3, pending: null });
  assert.deepEqual(back, { kind: "card" });
  assert.deepEqual(labels(buildChipRow({ active: back, intent: chat, card, context, partner: "Joyce", actions })), ["Split with Joyce", "Add a note", "Different card"]);
});

test("the card is active until the person says something else; a note after it (Saved, Removed) keeps it active", async () => {
  const { buildChipRow, findActiveItem } = await import("../src/client/ask-chips.js");
  const ready = setCardField(createAskCard(context), { amountInput: "5", description: "Kopi" }, context);
  const saved = markCardSaved(ready, { entryId: "txn-1" });
  const savedThread = [{ id: "m1", kind: "me", text: "kopi 5" }, { id: "n1", kind: "note", text: "Saved to Entries." }];
  assert.deepEqual(findActiveItem({ thread: savedThread, card: saved, cardSlot: 1, pending: null }), { kind: "card" });
  // Add mode with nothing said yet: the card.
  assert.deepEqual(findActiveItem({ thread: [], card: ready, cardSlot: 0, pending: null }), { kind: "card" });
  // No card and no answer: nothing is active.
  assert.equal(findActiveItem({ thread: [{ id: "m1", kind: "me", text: "Am I on track?" }, { id: "n1", kind: "note", text: "…" }], card: null, cardSlot: 0, pending: null }), null);

  // A question asked after a saved card: the note answering it is newest,
  // so the saved card's chips (Undo, Open this entry) give way to the usual ones.
  const asked = [...savedThread, { id: "m2", kind: "me", text: "Am I on track?" }, { id: "n2", kind: "note", text: "…" }];
  const none = findActiveItem({ thread: asked, card: saved, cardSlot: 1, pending: null });
  assert.equal(none, null);
  assert.deepEqual(labels(buildChipRow({ active: none, intent: chat, card: saved, context, actions })), ["Scan receipt", "Paste", "Add entry", "Add expense"]);

  // The same with an unsaved card: only the way back to it.
  const unsaved = findActiveItem({ thread: asked, card: ready, cardSlot: 1, pending: null });
  assert.equal(unsaved, null);
  assert.deepEqual(labels(buildChipRow({ active: unsaved, intent: chat, card: ready, context, actions })), ["Back to the unsaved entry"]);
});

test("an open follow-up or view change outranks the card; an answer for a month with no entries offers no Open in Entries", async () => {
  const { buildChipRow, findActiveItem } = await import("../src/client/ask-chips.js");
  const card = setCardField(createAskCard(context), { amountInput: "12.50", description: "Koufu" }, context);
  const thread = [{ id: "m1", kind: "me", text: "Koufu 12.50" }, { id: "m2", kind: "me", text: "switch to Joyce" }];

  const view = { kind: "view", viewId: "person-joyce", scope: "shared" };
  assert.equal(findActiveItem({ thread, card, cardSlot: 1, pending: view }), view);
  const viewRow = buildChipRow({ active: view, intent: add, card, context, viewLabel: "Joyce · Shared", actions });
  assert.deepEqual(labels(viewRow), ["Switch to Joyce · Shared", "Back to the unsaved entry"]);

  const option = { key: "acct-uob", label: "UOB One", patch: { wallets: ["acct-uob"] } };
  const question = { kind: "question", filter: {}, questions: [{ field: "wallet", options: [option] }] };
  assert.deepEqual(labels(buildChipRow({ active: question, intent: chat, card, context, actions })), ["UOB One"]);

  const answer = { kind: "answer", filter: { month: "2031-01" } };
  assert.deepEqual(labels(buildChipRow({ active: answer, intent: chat, card, context, canOpenAnswer: false, actions })), ["Back to the unsaved entry"]);
  assert.deepEqual(labels(buildChipRow({ active: answer, intent: chat, card: null, context, canOpenAnswer: false, actions })), ["Scan receipt", "Paste", "Add entry", "Add expense"]);
});

test("the note for a question Ask cannot answer says it finds and adds entries", async () => {
  const { askCopy } = await import("../src/client/copy/ask-copy.js");
  assert.equal(askCopy.notes.askNotReady, "I can find entries and add new ones. Other questions aren't answered yet.");
});
