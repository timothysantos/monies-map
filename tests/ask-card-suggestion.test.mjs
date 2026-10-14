// The Ask card's card suggestion (docs/flows/ask-flow.md "Card suggestion";
// DOMAIN.md "Card Suggestion"): when to ask the server, which answers the
// card can act on, the one question and its two chips, and what Yes and No do
// to the card. Nothing is changed by asking; a draft's card changes in the
// card until Save, the Apple Pay card's entry through its own command.
import assert from "node:assert/strict";
import test from "node:test";

import { cardSuggestionRequestFor, readCardSuggestionResponse, usableCardSuggestion } from "../src/client/ask-card-suggestion.js";
import { buildAskChips } from "../src/client/ask-chips.js";
import {
  acceptCardSuggestion,
  cardFromSavedEntry,
  createAskCard,
  declineCardSuggestion,
  setCardField
} from "../src/client/ask-card-model.js";
import { requestCardSuggestion } from "../src/client/ask-api.js";

const context = {
  today: "2026-10-12",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [
    { id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true },
    { id: "acct-citi", name: "Citi Rewards", currency: "SGD", isActive: true },
    { id: "acct-old", name: "Old card", currency: "SGD", isActive: false }
  ],
  categories: [{ name: "Other" }, { name: "Transport" }, { name: "Income" }, { name: "Transfer" }]
};
const suggestion = {
  accountId: "acct-citi",
  accountName: "Citi Rewards",
  currentAccountId: "acct-uob",
  currentAccountName: "UOB One",
  merchant: "Grab Ride",
  entryCount: 4,
  matchedCount: 5
};
const shortcut = { mode: "chat", from: "shortcut", savedEntryId: "txn-apple", splitGroupId: "" };
const add = { mode: "add", from: "entries", savedEntryId: "", splitGroupId: "" };
const actions = new Proxy({}, { get: (_, name) => () => name });
const labels = (result) => result.items.map((item) => item.label);
const filled = () => setCardField(createAskCard(context), { amountInput: "12.40", description: "Grab Ride", accountId: "acct-uob", categoryName: "Transport" }, context);
const appleEntry = {
  id: "txn-apple",
  date: "2026-10-10",
  description: "GRAB RIDE",
  amountMinor: 1240,
  accountId: "acct-uob",
  accountName: "UOB One",
  categoryName: "Transport",
  entryType: "expense",
  ownershipType: "direct",
  ownerName: "Tim"
};

test("a filled expense card asks with its shop, card and day; an empty, income or answered card does not", () => {
  assert.deepEqual(cardSuggestionRequestFor(filled()), { description: "Grab Ride", accountId: "acct-uob", date: "2026-10-12" });
  assert.equal(cardSuggestionRequestFor(createAskCard(context)), null, "no shop typed");
  assert.equal(cardSuggestionRequestFor(setCardField(filled(), { description: "   " }, context)), null);
  assert.equal(cardSuggestionRequestFor({ ...filled(), variant: "income" }), null);
  assert.equal(cardSuggestionRequestFor(declineCardSuggestion(filled())), null);
  assert.equal(cardSuggestionRequestFor(acceptCardSuggestion(filled(), suggestion, context)), null);
  assert.equal(cardSuggestionRequestFor(null), null);
});

test("the Apple Pay card asks by its entry id, until it is on Splits or shared; a card Ask saved does not ask", () => {
  assert.deepEqual(cardSuggestionRequestFor(cardFromSavedEntry(appleEntry, context)), { entryId: "txn-apple" });
  assert.equal(cardSuggestionRequestFor(cardFromSavedEntry({ ...appleEntry, linkedSplitExpenseId: "split-1" }, context)), null);
  assert.equal(cardSuggestionRequestFor(cardFromSavedEntry({ ...appleEntry, entryType: "income" }, context)), null);
  assert.equal(cardSuggestionRequestFor({ ...filled(), status: "saved", saved: { entryId: "txn-ask" } }), null);
});

test("the server's answer is checked; anything unreadable is no suggestion", () => {
  assert.deepEqual(readCardSuggestionResponse({ ok: true, suggestion }), suggestion);
  assert.equal(readCardSuggestionResponse({ ok: true, suggestion: null }), null);
  assert.equal(readCardSuggestionResponse({ ok: false, suggestion }), null);
  assert.equal(readCardSuggestionResponse({ ok: true, suggestion: { ...suggestion, accountName: "" } }), null);
  assert.equal(readCardSuggestionResponse({ ok: true, suggestion: { ...suggestion, entryCount: "4" } }), null);
  assert.equal(readCardSuggestionResponse(null), null);
});

test("a suggestion is only usable while the card it was asked about is still chosen, and the card is one the page knows", () => {
  assert.equal(usableCardSuggestion(suggestion, filled(), context), suggestion);
  assert.equal(usableCardSuggestion(suggestion, setCardField(filled(), { accountId: "acct-citi" }, context), context), null, "already on that card");
  assert.equal(usableCardSuggestion({ ...suggestion, currentAccountId: "acct-other" }, filled(), context), null, "asked about another card");
  assert.equal(usableCardSuggestion({ ...suggestion, accountId: "acct-old" }, filled(), context), null, "inactive card");
  assert.equal(usableCardSuggestion({ ...suggestion, accountId: "acct-unknown" }, filled(), context), null);
  assert.equal(usableCardSuggestion(null, filled(), context), null);
});

test("on a draft the question and its two chips come before the split question", () => {
  const result = buildAskChips({ intent: add, card: filled(), context, cardSuggestion: suggestion, actions });
  assert.equal(result.prompt, "Past Grab Ride entries were on Citi Rewards. Was this on that card too?");
  const chips = result.items.filter((item) => item.key.startsWith("suggested-card"));
  assert.deepEqual(chips.map((item) => item.label), ["Yes, Citi Rewards", "No, keep UOB One"]);
  assert.equal(chips[0].primary, true);
  assert.deepEqual(chips.map((item) => item.onClick()), ["acceptCardSuggestion", "declineCardSuggestion"]);
  // Answered: the usual chips return and the question is gone.
  const declined = buildAskChips({ intent: add, card: declineCardSuggestion(filled()), context, cardSuggestion: suggestion, actions });
  assert.equal(declined.prompt, "");
  assert.equal(labels(declined).some((label) => label.startsWith("Yes, ")), false);
  // A reader's own question is answered first.
  const questioned = { ...filled(), questions: [{ field: "date", reason: "ambiguous", options: [{ date: "2026-10-11" }] }] };
  assert.equal(buildAskChips({ intent: add, card: questioned, context, cardSuggestion: suggestion, actions }).prompt, "Which day was it?");
});

test("a long shop name is cut short in the question", () => {
  const long = { ...suggestion, merchant: "The Very Long Named Neighbourhood Provision Shop Bukit Timah" };
  const result = buildAskChips({ intent: add, card: filled(), context, cardSuggestion: long, actions });
  assert.equal(result.prompt, "Past The Very Long Named Neighbourho… entries were on Citi Rewards. Was this on that card too?");
});

test("the Apple Pay card asks about the card first, even when it landed in Other", () => {
  const inOther = cardFromSavedEntry({ ...appleEntry, categoryName: "Other" }, context);
  const result = buildAskChips({ intent: shortcut, card: inOther, context, cardSuggestion: suggestion, actions });
  assert.equal(result.prompt, "Past Grab Ride entries were on Citi Rewards. Was this on that card too?");
  assert.deepEqual(labels(result), ["Open this entry", "Yes, Citi Rewards", "No, keep UOB One"]);
  assert.equal(result.items[0].primary, undefined);

  const answered = buildAskChips({ intent: shortcut, card: declineCardSuggestion(inOther), context, cardSuggestion: suggestion, actions });
  assert.equal(answered.prompt, "It landed in Other. Which category fits?");
});

test("Yes on a draft picks the card and names it; No keeps the card; neither saves anything", () => {
  const accepted = acceptCardSuggestion(filled(), suggestion, context);
  assert.deepEqual([accepted.fields.accountId, accepted.fields.accountName, accepted.cardSuggestionAnswer, accepted.status], ["acct-citi", "Citi Rewards", "accepted", "draft"]);
  assert.equal(accepted.fields.description, "Grab Ride");
  const declined = declineCardSuggestion(filled());
  assert.deepEqual([declined.fields.accountId, declined.cardSuggestionAnswer], ["acct-uob", "declined"]);
  // A saved card is only changed through its own command.
  const saved = cardFromSavedEntry(appleEntry, context);
  assert.equal(acceptCardSuggestion(saved, suggestion, context), saved);
});

test("asking fails soft: an error, a refusal or an offline page is no suggestion", async () => {
  assert.equal(await requestCardSuggestion({ entryId: "x" }, { fetchImpl: async () => new Response("{}", { status: 500 }) }), null);
  assert.equal(await requestCardSuggestion({ entryId: "x" }, { fetchImpl: async () => { throw new TypeError("offline"); } }), null);
  const seen = [];
  const answer = await requestCardSuggestion({ entryId: "txn-apple" }, {
    fetchImpl: async (path, init) => {
      seen.push([path, init.method, init.body]);
      return new Response(JSON.stringify({ ok: true, suggestion }), { status: 200 });
    }
  });
  assert.deepEqual(answer, suggestion);
  assert.deepEqual(seen, [["/api/entries/card-suggestion", "POST", JSON.stringify({ entryId: "txn-apple" })]]);
});
