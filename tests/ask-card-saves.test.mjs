// Ask audit 2 on the entry card (src/client/ask-card-model.js): what the
// card shows is what Save writes. Pure; no fetch, no DOM.
//
// - B3: owner Shared turns Splits on; Splits off gives the card one owner;
//   a Shared card with Splits off cannot save.
// - B4: each person's share is on the card before Save, a share stated in
//   money to the cent.
// - B7: the card-currency amount for a figure paid in yen keeps the yen.
// - B8: a payment word with no wallet leaves the wallet to choose.
// - B13: only the person's own category counts as a habit.
import assert from "node:assert/strict";
import test from "node:test";

import {
  answerCardQuestion,
  applyEntryDraft,
  buildCardCreateDraft,
  cardShares,
  createAskCard,
  markCardSaved,
  markCardSaving,
  setCardField,
  setShare,
  validateCard
} from "../src/client/ask-card-model.js";
import { readEntryDraftResponse } from "../src/client/ask-api.js";

const context = {
  today: "2026-09-29",
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", currency: "SGD", isActive: true },
    { id: "acct-citi", name: "Citi Cash Back Card 4821", currency: "SGD", isActive: true }
  ],
  categories: [
    { id: "cat-other", name: "Other" },
    { id: "cat-food", name: "Food & Drinks" },
    { id: "cat-groceries", name: "Groceries" }
  ],
  defaultAccountPriorityIds: ["acct-citi"]
};

const AI_SOURCES = new Set(["ownershipType", "splitBasisPoints", "splitAmountMinor"]);
const draftReply = (fields, extra = {}) => readEntryDraftResponse({
  ok: true,
  draft: {
    fields: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value, source: AI_SOURCES.has(name) ? "ai" : "sentence" }])),
    missing: [],
    questions: [],
    ...extra
  }
});

test("B3: owner Shared turns Splits on, and Splits off gives it one owner again; a Shared card with Splits off cannot save", () => {
  const shared = setCardField(setCardField(createAskCard(context), { amountInput: "9.90", description: "Lunch" }, context), { ownerName: "Shared" }, context);
  assert.equal(shared.share.on, true, "the card shows it goes on Splits");
  const drafted = applyEntryDraft(createAskCard(context), draftReply({ description: "Lunch", amountMinor: 990, entryType: "expense", ownershipType: "shared", splitBasisPoints: 5000 }), context);
  assert.deepEqual([drafted.fields.ownerName, drafted.share.on], ["Shared", true]);
  const off = setShare(drafted, { on: false }, context);
  assert.deepEqual([off.fields.ownerName, off.share.on], ["Ethan", false]);
  const posted = buildCardCreateDraft(off, context);
  assert.deepEqual([posted.ownershipType, posted.ownerName, posted.addToSplits, posted.splits.length], ["direct", "Ethan", false, 0]);
  // Negative: a Shared card forced off (a card kept from before) cannot save.
  const stale = { ...drafted, share: { on: false, splitGroupId: "" } };
  assert.deepEqual(validateCard(stale), { canSave: false, missing: ["ownerName"] });
});

test("B4: the card lists each person's share before Save, a stated share exactly; a new amount drops it", () => {
  const card = applyEntryDraft(createAskCard(context), draftReply({ description: "Dinner at Jumbo", amountMinor: 8_000, entryType: "expense", ownershipType: "shared", splitBasisPoints: 6250, splitAmountMinor: 5_000 }), context);
  assert.deepEqual(cardShares(card, context), [{ personName: "Ethan", amountMinor: 5_000 }, { personName: "Serene", amountMinor: 3_000 }]);
  const posted = buildCardCreateDraft(card, context);
  assert.equal(posted.splitAmountMinor, 5_000);
  assert.deepEqual(posted.splits.map((split) => split.amountMinor), [5_000, 3_000]);
  // 1,234.56 with Ethan's 1,000.00: kept to the cent, not 999.99.
  const big = applyEntryDraft(createAskCard(context), draftReply({ description: "Hotel", amountMinor: 123_456, entryType: "expense", ownershipType: "shared", splitBasisPoints: 8100, splitAmountMinor: 100_000 }), context);
  assert.deepEqual(cardShares(big, context).map((share) => share.amountMinor), [100_000, 23_456]);
  // The amount changes: the stated share no longer holds, the basis does.
  const changed = setCardField(card, { amountInput: "90" }, context);
  assert.equal(changed.fields.splitAmountMinor, null);
  assert.deepEqual(cardShares(changed, context).map((share) => share.amountMinor), [5_625, 3_375]);
  assert.equal("splitAmountMinor" in buildCardCreateDraft(changed, context), false);
  // No amount yet: no share rows.
  assert.deepEqual(cardShares(setCardField(changed, { amountInput: "" }, context), context), []);
});

test("B7: the card-currency amount for a figure paid in yen keeps the yen with it through Save", () => {
  const asked = applyEntryDraft(createAskCard(context), draftReply({ description: "Ramen", entryType: "expense", date: "2026-09-28" }, {
    foreignAmount: { amountMinor: 240_000, currency: "JPY", source: "sentence" },
    questions: [{ field: "amountMinor", reason: "foreign_currency", options: [], foreignAmount: { amountMinor: 240_000, currency: "JPY" } }]
  }), context);
  assert.equal(asked.questions[0].reason, "foreign_currency");
  // Answered by the rules' next draft or by the model's patch.
  const byDraft = applyEntryDraft(asked, draftReply({ amountMinor: 2_180 }), context);
  const byPatch = setCardField(asked, { amountMinor: 2_180 }, context);
  for (const card of [byDraft, byPatch]) {
    const posted = buildCardCreateDraft(card, context);
    assert.deepEqual([posted.amountMinor, posted.originalAmountMinor, posted.originalCurrency], [2_180, 240_000, "JPY"]);
    assert.equal(card.questions.some((question) => question.reason === "foreign_currency"), false);
  }
  // A typo fixed keeps what was paid; another wallet drops it.
  const fixed = setCardField(byPatch, { amountInput: "21.90" }, context);
  assert.deepEqual([buildCardCreateDraft(fixed, context).amountMinor, buildCardCreateDraft(fixed, context).originalAmountMinor], [2_190, 240_000]);
  assert.equal(buildCardCreateDraft(setCardField(fixed, { accountId: "acct-ocbc" }, context), context).originalAmountMinor, undefined);
  // Negative: a plain amount with no yen asked about saves no original.
  assert.equal(buildCardCreateDraft(setCardField(createAskCard(context), { amountInput: "5", description: "Kopi" }, context), context).originalAmountMinor, undefined);
});

test("B8: 'kopi 2.40 cash' with no cash wallet leaves the wallet to choose, never the default card", () => {
  const card = applyEntryDraft(createAskCard(context), draftReply({ description: "Kopi", amountMinor: 240, entryType: "expense" }, {
    missing: ["accountId"],
    questions: [{ field: "accountId", reason: "missing", options: [{ accountId: "acct-ocbc", accountName: "OCBC 360 Account" }] }]
  }), context);
  assert.deepEqual([card.fields.accountId, card.fields.accountName], ["", ""]);
  assert.deepEqual(card.questions.map((question) => question.field), ["accountId"]);
  assert.deepEqual(validateCard(card), { canSave: false, missing: ["accountId"] });
  const chosen = answerCardQuestion(card, card.questions[0], card.questions[0].options[0], context);
  assert.deepEqual([chosen.fields.accountId, validateCard(chosen).canSave], ["acct-ocbc", true]);
  // Negative: a draft with no wallet question keeps the default wallet.
  const plain = applyEntryDraft(createAskCard(context), draftReply({ description: "Kopi", amountMinor: 240, entryType: "expense" }), context);
  assert.equal(plain.fields.accountId, "acct-citi");
});

test("B13: only the person's own category counts as a habit; Undo gets what the save counted", () => {
  const filed = (source) => applyEntryDraft(createAskCard(context), readEntryDraftResponse({
    ok: true,
    draft: { fields: { description: { value: "Koufu lunch", source: "sentence" }, amountMinor: { value: 600, source: "sentence" }, categoryName: { value: "Food & Drinks", source }, entryType: { value: "expense", source: "sentence" } }, missing: [], questions: [] }
  }), context);
  // The rules or the model filed it: not the person's choice.
  assert.deepEqual(buildCardCreateDraft(filed("rule"), context).habits, { category: false, split: false });
  assert.deepEqual(buildCardCreateDraft(filed("ai"), context).habits, { category: false, split: false });
  // Named in their words, or picked on the card: theirs.
  assert.deepEqual(buildCardCreateDraft(filed("sentence"), context).habits, { category: true, split: false });
  const picked = setCardField(filed("rule"), { categoryName: "Groceries" }, context);
  assert.deepEqual(buildCardCreateDraft(picked, context).habits, { category: true, split: false });
  const saved = markCardSaved(markCardSaving(picked), { entryId: "txn-9", habits: { category: true, split: false } });
  assert.deepEqual(saved.saved.habits, { category: true, split: false });
});
