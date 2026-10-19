// The Ask card's split suggestion (docs/flows/ask-flow.md "Split
// suggestion"; DOMAIN.md "Split Suggestion"): when to ask the server, which
// answers the card can act on, the one follow-up question and its chips,
// and what choosing or declining does to the card. Nothing is written until
// Save (or, on the Apple Pay card, the existing Add to Splits route).
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSuggestedShare,
  readSplitSuggestionResponse,
  splitSuggestionRequestFor,
  usableSplitSuggestion
} from "../src/client/ask-split-suggestion.js";
import { buildAskChips } from "../src/client/ask-chips.js";
import {
  acceptSplitSuggestion,
  applyEntryDraft,
  buildCardCreateDraft,
  cardFromSavedEntry,
  createAskCard,
  declineSplitSuggestion,
  setCardField,
  setCardVariant,
  setShare
} from "../src/client/ask-card-model.js";
import { readEntryDraftResponse, requestSplitSuggestion } from "../src/client/ask-api.js";

const context = {
  today: "2026-10-12",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [{ id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true }],
  categories: [{ name: "Other" }, { name: "Groceries" }, { name: "Income" }, { name: "Transfer" }]
};
const splitGroups = [{ id: "split-group-none", name: "Non-group expenses" }, { id: "split-group-home", name: "Home" }];
const suggestion = {
  groupId: "split-group-home",
  groupName: "Home",
  basisPoints: 5000,
  otherPersonId: "person-joyce",
  otherPersonName: "Joyce",
  evidenceCount: 3,
  matchedCount: 4,
  matchedBy: "description"
};
const add = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };
const shortcut = { mode: "chat", from: "shortcut", savedEntryId: "txn-apple", splitGroupId: "" };
const actions = new Proxy({}, { get: (_, name) => () => name });
const labels = (result) => result.items.map((item) => item.label);
const filled = () => setCardField(createAskCard(context), { amountInput: "24.50", description: "Kopi Kaki", categoryName: "Groceries" }, context);
const appleEntry = {
  id: "txn-apple",
  date: "2026-10-10",
  description: "KOPI KAKI",
  amountMinor: 2450,
  accountId: "acct-uob",
  accountName: "UOB One",
  categoryName: "Groceries",
  entryType: "expense",
  ownershipType: "direct",
  ownerName: "Tim"
};

test("a filled expense card asks with its own fields; the server is never asked for what it can't judge", () => {
  assert.deepEqual(splitSuggestionRequestFor(filled(), context), {
    entryType: "expense",
    description: "Kopi Kaki",
    categoryName: "Groceries",
    ownerName: "Tim",
    accountId: "acct-uob",
    date: "2026-10-12"
  });
  // Nothing to judge yet, already on Splits, Shared, income, one person,
  // or declined: no request.
  assert.equal(splitSuggestionRequestFor(createAskCard(context), context), null);
  assert.equal(splitSuggestionRequestFor(setShare(filled(), { on: true }), context), null);
  assert.equal(splitSuggestionRequestFor(setCardField(filled(), { ownerName: "Shared" }, context), context), null);
  assert.equal(splitSuggestionRequestFor(setCardVariant(filled(), "income", context), context), null);
  assert.equal(splitSuggestionRequestFor(filled(), { ...context, people: context.people.slice(0, 1) }), null);
  assert.equal(splitSuggestionRequestFor(declineSplitSuggestion(filled()), context), null);
  assert.equal(splitSuggestionRequestFor(null, context), null);
});

test("the Apple Pay card asks by its entry id until it is on Splits; a card Ask saved does not ask", () => {
  const apple = cardFromSavedEntry(appleEntry, context);
  assert.deepEqual(splitSuggestionRequestFor(apple, context), { entryId: "txn-apple" });
  assert.equal(splitSuggestionRequestFor(cardFromSavedEntry({ ...appleEntry, linkedSplitExpenseId: "split-1" }, context), context), null);
  assert.equal(splitSuggestionRequestFor(cardFromSavedEntry({ ...appleEntry, entryType: "income" }, context), context), null);
  assert.equal(splitSuggestionRequestFor(declineSplitSuggestion(apple), context), null);
  const askSaved = { ...filled(), status: "saved", saved: { entryId: "txn-ask" } };
  assert.equal(splitSuggestionRequestFor(askSaved, context), null);
});

test("only an even share in a group the card can choose is offered (the Splits switch saves 50/50)", () => {
  assert.deepEqual(usableSplitSuggestion(suggestion, splitGroups), suggestion);
  assert.equal(usableSplitSuggestion({ ...suggestion, basisPoints: 7000 }, splitGroups), null);
  assert.equal(usableSplitSuggestion({ ...suggestion, groupId: "split-group-gone" }, splitGroups), null);
  assert.equal(usableSplitSuggestion(suggestion, []), null);
  assert.equal(usableSplitSuggestion(null, splitGroups), null);
  assert.equal(formatSuggestedShare(5000), "Half each");
  assert.equal(formatSuggestedShare(7000), "70/30");
});

test("the response is read strictly; anything else is no suggestion", () => {
  assert.deepEqual(readSplitSuggestionResponse({ ok: true, suggestion }), suggestion);
  assert.equal(readSplitSuggestionResponse({ ok: true, suggestion: null }), null);
  assert.equal(readSplitSuggestionResponse({ ok: false, error: "x" }), null);
  assert.equal(readSplitSuggestionResponse({ ok: true, suggestion: { ...suggestion, basisPoints: "5000" } }), null);
  assert.equal(readSplitSuggestionResponse({ ok: true, suggestion: { ...suggestion, groupName: "" } }), null);
  assert.equal(readSplitSuggestionResponse(null), null);
});

test("the request fails soft: a network error or a refusal is no suggestion", async () => {
  let sent = null;
  const ok = await requestSplitSuggestion({ entryId: "txn-apple" }, {
    fetchImpl: async (path, init) => {
      sent = { path, init };
      return new Response(JSON.stringify({ ok: true, suggestion }), { status: 200 });
    }
  });
  assert.deepEqual(ok, suggestion);
  assert.equal(sent.path, "/api/splits/suggestion");
  assert.equal(sent.init.method, "POST");
  assert.deepEqual(JSON.parse(sent.init.body), { entryId: "txn-apple" });
  assert.equal(await requestSplitSuggestion({ entryId: "x" }, { fetchImpl: async () => new Response("{}", { status: 500 }) }), null);
  assert.equal(await requestSplitSuggestion({ entryId: "x" }, { fetchImpl: async () => { throw new TypeError("offline"); } }), null);
});

test("a draft with a suggestion asks one question: Half each in Home (filled) or Not this time", () => {
  const result = buildAskChips({ intent: add, card: filled(), context, splitGroups, partner: "Joyce", splitSuggestion: suggestion, actions });
  assert.equal(result.prompt, "You usually split this with Joyce. Add it to Home?");
  assert.deepEqual(labels(result), ["‹ Entries", "Half each in Home", "Not this time", "Edit in form"]);
  assert.equal(result.items[1].primary, true);
  assert.equal(result.items[1].onClick(), "acceptSplitSuggestion");
  assert.equal(result.items[2].onClick(), "declineSplitSuggestion");
});

test("the suggestion waits behind a reader's question, and goes once Splits is on or it was declined", () => {
  const draft = readEntryDraftResponse({
    draft: {
      fields: { description: { value: "Kopi Kaki", source: "sentence" }, amountMinor: { value: 2450, source: "sentence" } },
      questions: [{ field: "date", reason: "ambiguous", options: [{ date: "2026-10-03" }, { date: "2026-03-10" }] }]
    }
  });
  const asking = applyEntryDraft(createAskCard(context), draft, context);
  assert.equal(buildAskChips({ intent: add, card: asking, context, splitGroups, splitSuggestion: suggestion, actions }).prompt, "Which day was it?");
  const on = buildAskChips({ intent: add, card: setShare(filled(), { on: true }), context, splitGroups, partner: "Joyce", splitSuggestion: suggestion, actions });
  assert.equal(on.prompt, "");
  assert.ok(labels(on).includes("Not shared"));
  const declined = buildAskChips({ intent: add, card: declineSplitSuggestion(filled()), context, splitGroups, partner: "Joyce", splitSuggestion: suggestion, actions });
  assert.deepEqual(labels(declined), ["‹ Entries", "Split with Joyce", "Add a note", "Different card", "Edit in form"]);
});

test("choosing it turns the Splits switch on with that group; Save then adds it to Splits once", () => {
  const card = acceptSplitSuggestion(filled(), suggestion);
  assert.deepEqual(card.share, { on: true, splitGroupId: "split-group-home" });
  assert.equal(card.splitSuggestionAnswer, "accepted");
  assert.equal(card.status, "draft");
  const createDraft = buildCardCreateDraft(card, context, { splitGroups });
  assert.equal(createDraft.addToSplits, true);
  assert.equal(createDraft.splitGroupId, "split-group-home");
  assert.equal(createDraft.ownershipType, "direct");
  assert.equal(createDraft.ownerName, "Tim");
  // Declining leaves the card as it was, Splits off.
  const declined = declineSplitSuggestion(filled());
  assert.deepEqual(declined.share, { on: false, splitGroupId: "" });
  assert.equal(declined.splitSuggestionAnswer, "declined");
  assert.equal(buildCardCreateDraft(declined, context, { splitGroups }).addToSplits, false);
  // A changed field after choosing keeps the answer.
  assert.equal(setCardField(card, { note: "x" }, context).splitSuggestionAnswer, "accepted");
});

test("the Apple Pay card: the suggestion replaces the plain Splits chips; Other is asked first", () => {
  const apple = cardFromSavedEntry(appleEntry, context);
  const result = buildAskChips({ intent: shortcut, card: apple, context, splitGroups, splitSuggestion: suggestion, actions });
  assert.equal(result.prompt, "You usually split this with Joyce. Add it to Home?");
  assert.deepEqual(labels(result), ["Open this entry", "Half each in Home", "Not this time"]);
  assert.equal(result.items[0].primary, undefined);
  assert.equal(result.items[1].primary, true);
  assert.equal(result.items[1].onClick(), "acceptSplitSuggestion");

  const declined = buildAskChips({ intent: shortcut, card: declineSplitSuggestion(apple), context, splitGroups, splitSuggestion: suggestion, actions });
  assert.equal(declined.prompt, "Share it on Splits?");
  assert.deepEqual(labels(declined), ["Open this entry", "Add to Non-group expenses", "Add to Home"]);

  const inOther = cardFromSavedEntry({ ...appleEntry, categoryName: "Other" }, context);
  const other = buildAskChips({ intent: shortcut, card: inOther, context, splitGroups, splitSuggestion: suggestion, actions });
  assert.equal(other.prompt, "It landed in Other. Which category fits?");
  assert.equal(labels(other).includes("Not this time"), false);
});
