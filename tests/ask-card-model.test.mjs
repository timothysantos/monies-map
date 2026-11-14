// The Ask page's entry card state machine (src/client/ask-card-model.js):
// empty -> filled from a sentence or a receipt -> saved -> undone, the
// variants (expense, income, transfer), what blocks Save, and the draft the
// shared create path posts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  answerCardQuestion,
  applyEntryDraft,
  applyReceiptRead,
  buildCardCreateDraft,
  cardFromSavedEntry,
  createAskCard,
  getTransferEnds,
  isCardEmpty,
  markCardSaved,
  markCardSaveFailed,
  markCardSaving,
  markCardUndone,
  resolveShareGroupId,
  setCardField,
  setCardVariant,
  setShare,
  swapTransferDirection,
  validateCard
} from "../src/client/ask-card-model.js";
import { readEntryDraftResponse } from "../src/client/ask-api.js";

const context = {
  today: "2026-09-29",
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", currency: "SGD", isActive: true },
    { id: "acct-citi", name: "Citi Cash Back Card 4821", currency: "SGD", isActive: true },
    { id: "acct-old", name: "Old Card", currency: "SGD", isActive: false },
    { id: "acct-posb", name: "POSB Joint Account", currency: "SGD", isActive: true }
  ],
  categories: [
    { id: "cat-other", name: "Other" },
    { id: "cat-food", name: "Food & Drinks" },
    { id: "cat-other-income", name: "Other - Income" },
    { id: "cat-freelance", name: "Freelance Income" },
    { id: "cat-transfer", name: "Transfer" }
  ],
  defaultAccountPriorityIds: ["acct-citi"]
};

test("a new card starts empty: today, the default wallet, the viewer, Other, and Save blocked", () => {
  const card = createAskCard(context);
  assert.equal(card.status, "draft");
  assert.equal(card.variant, "expense");
  assert.deepEqual(
    { date: card.fields.date, accountId: card.fields.accountId, accountName: card.fields.accountName, ownerName: card.fields.ownerName, categoryName: card.fields.categoryName },
    { date: "2026-09-29", accountId: "acct-citi", accountName: "Citi Cash Back Card 4821", ownerName: "Ethan", categoryName: "Other" }
  );
  assert.equal(isCardEmpty(card), true);
  assert.deepEqual(card.share, { on: false, splitGroupId: "" });
  assert.deepEqual(validateCard(card), { canSave: false, missing: ["amount", "description"] });
});

test("the household view picks the first person, and an inactive default wallet is skipped", () => {
  const card = createAskCard({ ...context, viewId: "household", defaultAccountPriorityIds: ["acct-old"] });
  assert.equal(card.fields.ownerName, "Ethan");
  assert.equal(card.fields.accountId, "acct-ocbc");
});

test("expense mode from the Splits receipt button starts with the Splits switch on for that group", () => {
  const card = createAskCard(context, { mode: "expense", splitGroupId: "group-japan" });
  assert.deepEqual(card.share, { on: true, splitGroupId: "group-japan" });
});

test("turning the Splits switch off and on again keeps the group it was going to", () => {
  // QA: from the Splits receipt button, Off then On left "Choose a group"
  // and Save blocked, although the group was known.
  const groups = [{ id: "group-japan", name: "Japan trip" }, { id: "group-home", name: "Home & Bills" }];
  let card = setCardField(createAskCard(context, { mode: "expense", splitGroupId: "group-japan" }), { amountInput: "42", description: "Dinner" }, context);
  card = setShare(card, { on: false });
  assert.equal(card.share.on, false);
  assert.equal(resolveShareGroupId(card, groups), "", "off goes nowhere");
  assert.equal(buildCardCreateDraft(card, context, { splitGroups: groups }).addToSplits, false);
  card = setShare(card, { on: true });
  assert.deepEqual(card.share, { on: true, splitGroupId: "group-japan" });
  assert.equal(validateCard(card, { splitGroups: groups }).canSave, true);
  // Through income and back: the switch is off, and on again it is the same group.
  card = setShare(setCardVariant(setCardVariant(card, "income", context), "expense", context), { on: true });
  assert.deepEqual(card.share, { on: true, splitGroupId: "group-japan" });
});

test("typing an amount and what it was makes the card saveable", () => {
  let card = createAskCard(context);
  card = setCardField(card, { amountInput: "12.5" }, context);
  assert.equal(card.fields.amountMinor, 1250);
  assert.equal(validateCard(card).canSave, false);
  card = setCardField(card, { description: "Koufu lunch" }, context);
  assert.deepEqual(validateCard(card), { canSave: true, missing: [] });
  assert.equal(isCardEmpty(card), false);
  assert.equal(card.touched, true);
});

test("invalid states block Save: no amount, a bad date, no wallet, a zero amount", () => {
  const ready = setCardField(createAskCard(context), { amountInput: "8", description: "Kopi" }, context);
  assert.deepEqual(validateCard(setCardField(ready, { amountInput: "0" }, context)).missing, ["amount"]);
  assert.deepEqual(validateCard(setCardField(ready, { date: "2026-13-40" }, context)).missing, ["date"]);
  assert.deepEqual(validateCard(setCardField(ready, { accountId: "" }, context)).missing, ["accountId"]);
  assert.deepEqual(validateCard(setCardField(ready, { description: "   " }, context)).missing, ["description"]);
  assert.equal(validateCard(markCardSaving(ready)).canSave, false, "a card being saved cannot be saved twice");
});

test("a shared expense needs a split group once there is more than one to choose from", () => {
  const groups = [{ id: "split-group-none", name: "Non-group expenses" }, { id: "group-dinners", name: "Dinners out" }];
  let card = setCardField(createAskCard(context), { amountInput: "38.60", description: "Tiong Bahru Bakery" }, context);
  card = setShare(card, { on: true });
  assert.deepEqual(validateCard(card, { splitGroups: groups }).missing, ["splitGroup"]);
  card = setShare(card, { on: true, splitGroupId: "group-dinners" });
  assert.equal(validateCard(card, { splitGroups: groups }).canSave, true);
  // One group: the switch picks it.
  const single = setShare(setCardField(createAskCard(context), { amountInput: "5", description: "x" }, context), { on: true });
  assert.equal(validateCard(single, { splitGroups: [{ id: "group-home", name: "Home & Bills" }] }).canSave, true);
});

test("a sentence fills the card and marks only fields the sentence, a rule or AI supplied", () => {
  const draft = readEntryDraftResponse({
    ok: true,
    draft: {
      fields: {
        date: { value: "2026-09-28", source: "sentence" },
        description: { value: "KOUFU FOOD COURT", source: "sentence" },
        accountId: { value: "acct-citi", source: "sentence" },
        accountName: { value: "Citi Cash Back Card 4821", source: "sentence" },
        categoryName: { value: "Food & Drinks", source: "rule" },
        amountMinor: { value: 1250, source: "sentence" },
        entryType: { value: "expense", source: "default" },
        ownershipType: { value: "direct", source: "default" },
        ownerName: { value: "Ethan", source: "default" }
      },
      missing: [],
      questions: []
    },
    ai: { requested: false, available: false }
  });
  const card = applyEntryDraft(createAskCard(context), draft, context);
  assert.equal(card.origin, "message");
  assert.deepEqual(
    { date: card.fields.date, description: card.fields.description, amountMinor: card.fields.amountMinor, amountInput: card.fields.amountInput, categoryName: card.fields.categoryName, accountId: card.fields.accountId },
    { date: "2026-09-28", description: "KOUFU FOOD COURT", amountMinor: 1250, amountInput: "12.5", categoryName: "Food & Drinks", accountId: "acct-citi" }
  );
  assert.deepEqual(card.filled, { date: "sentence", description: "sentence", accountId: "sentence", categoryName: "rule", amount: "sentence" });
  assert.equal(validateCard(card).canSave, true);
});

test("editing a filled field by hand takes its dot away and answers its question", () => {
  const draft = readEntryDraftResponse({
    draft: {
      fields: { description: { value: "Grab", source: "sentence" }, amountMinor: { value: 1800, source: "sentence" }, categoryName: { value: "Other", source: "default" }, entryType: { value: "expense", source: "default" }, ownershipType: { value: "direct", source: "default" } },
      questions: [{ field: "accountId", reason: "ambiguous", options: [{ accountId: "acct-citi", accountName: "Citi" }, { accountId: "acct-ocbc", accountName: "OCBC" }] }]
    }
  });
  let card = applyEntryDraft(createAskCard(context), draft, context);
  assert.equal(card.questions.length, 1);
  card = setCardField(card, { amountInput: "19" }, context);
  assert.equal(card.filled.amount, undefined);
  assert.equal(card.filled.description, "sentence");
  card = answerCardQuestion(card, card.questions[0], card.questions[0].options[1], context);
  assert.equal(card.fields.accountId, "acct-ocbc");
  assert.equal(card.fields.accountName, "OCBC 360 Account");
  assert.deepEqual(card.questions, []);
});

test("a follow-up sentence changes the amount but keeps the description and category already there", () => {
  let card = setCardField(createAskCard(context), { description: "Koufu lunch", amountInput: "12.50", categoryName: "Food & Drinks" }, context);
  const followUp = readEntryDraftResponse({
    draft: {
      fields: {
        description: { value: "make it", source: "sentence" },
        amountMinor: { value: 1500, source: "sentence" },
        categoryName: { value: "Other", source: "default" },
        entryType: { value: "expense", source: "default" },
        ownershipType: { value: "direct", source: "default" },
        ownerName: { value: "Serene", source: "default" }
      }
    }
  });
  card = applyEntryDraft(card, followUp, context);
  assert.equal(card.fields.description, "Koufu lunch");
  assert.equal(card.fields.categoryName, "Food & Drinks");
  assert.equal(card.fields.amountMinor, 1500);
  assert.equal(card.fields.ownerName, "Ethan", "a default in a follow-up never overrides");
});

test("an income sentence switches the card to the income variant with money-in category", () => {
  const draft = readEntryDraftResponse({
    draft: {
      fields: {
        description: { value: "Freelance payment", source: "sentence" },
        amountMinor: { value: 65000, source: "sentence" },
        accountId: { value: "acct-ocbc", source: "sentence" },
        categoryName: { value: "Freelance Income", source: "rule" },
        entryType: { value: "income", source: "sentence" },
        ownershipType: { value: "direct", source: "default" }
      }
    }
  });
  const card = applyEntryDraft(createAskCard(context), draft, context);
  assert.equal(card.variant, "income");
  assert.equal(card.fields.categoryName, "Freelance Income");
  assert.equal(card.filled.variant, "sentence");
  const posted = buildCardCreateDraft(card, context);
  assert.equal(posted.entryType, "income");
  assert.equal(posted.transferDirection, undefined);
  assert.equal(posted.addToSplits, false);
});

test("a transfer sentence shows From -> To, posts the From side, and swaps round", () => {
  const draft = readEntryDraftResponse({
    draft: {
      fields: {
        amountMinor: { value: 150000, source: "sentence" },
        accountId: { value: "acct-ocbc", source: "sentence" },
        entryType: { value: "transfer", source: "sentence" },
        transferDirection: { value: "out", source: "sentence" },
        categoryName: { value: "Transfer", source: "default" },
        ownershipType: { value: "direct", source: "default" }
      },
      transferAccount: { value: { accountId: "acct-posb", accountName: "POSB Joint Account" }, source: "sentence" }
    }
  });
  let card = applyEntryDraft(createAskCard(context), draft, context);
  assert.equal(card.variant, "transfer");
  assert.deepEqual(getTransferEnds(card), {
    from: { accountId: "acct-ocbc", accountName: "OCBC 360 Account" },
    to: { accountId: "acct-posb", accountName: "POSB Joint Account" }
  });
  assert.deepEqual(validateCard(card), { canSave: true, missing: [] }, "a transfer needs no description of its own");
  const posted = buildCardCreateDraft(card, context);
  assert.deepEqual(
    { entryType: posted.entryType, transferDirection: posted.transferDirection, accountId: posted.accountId, categoryName: posted.categoryName, description: posted.description, amountMinor: posted.amountMinor },
    { entryType: "transfer", transferDirection: "out", accountId: "acct-ocbc", categoryName: "Transfer", description: "Transfer to POSB Joint Account", amountMinor: 150000 }
  );
  card = swapTransferDirection(card);
  assert.equal(getTransferEnds(card).from.accountId, "acct-posb");
  assert.equal(getTransferEnds(card).to.accountId, "acct-ocbc");
  // The same wallet on both ends is not a transfer.
  assert.deepEqual(validateCard(setCardField(card, { transferAccountId: "acct-posb" }, context)).missing, ["transferAccountId"]);
});

test("switching variants swaps only default categories and turns the Splits switch off", () => {
  let card = setShare(createAskCard(context, { mode: "expense", splitGroupId: "g1" }), { on: true, splitGroupId: "g1" });
  card = setCardVariant(card, "income", context);
  assert.equal(card.fields.categoryName, "Other - Income");
  assert.deepEqual(card.share, { on: false, splitGroupId: "g1" });
  card = setCardVariant(card, "transfer", context);
  assert.equal(card.fields.categoryName, "Transfer");
  assert.equal(card.fields.transferDirection, "out");
  card = setCardVariant(card, "expense", context);
  assert.equal(card.fields.categoryName, "Other");
  assert.equal(card.fields.transferDirection, undefined);
  const chosen = setCardVariant(setCardField(createAskCard(context), { categoryName: "Food & Drinks" }, context), "income", context);
  assert.equal(chosen.fields.categoryName, "Food & Drinks", "a picked category stays");
});

test("a receipt fills merchant, date and total; a card ending picks the one matching wallet", () => {
  const card = applyReceiptRead(createAskCard({ ...context, defaultAccountPriorityIds: [] }), {
    source: "ai",
    merchant: { value: "TIONG BAHRU BAKERY", confidence: "high" },
    date: { value: "2026-09-29", confidence: "high" },
    total: { amountMinor: 3860, currency: "SGD", confidence: "high" },
    cardLast4: "4821",
    lineItems: [],
    questions: []
  }, context);
  assert.equal(card.origin, "receipt");
  assert.deepEqual(
    { description: card.fields.description, date: card.fields.date, amountMinor: card.fields.amountMinor, accountId: card.fields.accountId },
    { description: "TIONG BAHRU BAKERY", date: "2026-09-29", amountMinor: 3860, accountId: "acct-citi" }
  );
  assert.deepEqual(card.filled, { description: "receipt", date: "receipt", accountId: "receipt", amount: "receipt" });
  assert.equal(validateCard(card).canSave, true);
});

test("a receipt total in another currency waits for the person instead of being converted", () => {
  const card = applyReceiptRead(createAskCard(context), {
    merchant: { value: "Warung Bali", confidence: "high" },
    date: { value: "2026-09-20", confidence: "low" },
    total: { amountMinor: 15900000, currency: "IDR", confidence: "high" },
    cardLast4: null,
    questions: [{ field: "date", reason: "ambiguous", candidates: ["2026-09-20", "2026-08-09"] }]
  }, context);
  assert.equal(card.fields.amountMinor, 0);
  assert.equal(validateCard(card).canSave, false);
  assert.deepEqual(card.questions.map((question) => [question.field, question.reason]), [["amountMinor", "foreign_currency"], ["date", "ambiguous"]]);
  const answered = answerCardQuestion(card, card.questions[1], card.questions[1].options[1], context);
  assert.equal(answered.fields.date, "2026-08-09");
});

test("save: saving -> saved keeps the entry ids; a failure goes back to a draft with its error", () => {
  const ready = setCardField(createAskCard(context), { amountInput: "4.20", description: "Kopi" }, context);
  const saving = markCardSaving(ready);
  assert.equal(saving.status, "saving");
  const failed = markCardSaveFailed(saving, "Missing entry create fields");
  assert.equal(failed.status, "draft");
  assert.equal(failed.saveError, "Missing entry create fields");
  const saved = markCardSaved(saving, { entryId: "txn-1", splitExpenseId: "split-1", splitExpenseMonth: "2026-09", splitGroupId: "group-dinners", time: "14:32" });
  assert.equal(saved.status, "saved");
  // Saved by Ask: provisional until a statement certifies it (the saved
  // card's bank state chip reads "Ask · provisional").
  assert.deepEqual(saved.saved, {
    entryId: "txn-1", addedBy: "ask", bankCertificationStatus: "manual_provisional", time: "14:32",
    splitExpenseId: "split-1", splitExpenseMonth: "2026-09", splitGroupId: "group-dinners", splitAddError: ""
  });
  // No time came back (an entry for another day): the saved card has none.
  assert.equal(markCardSaved(saving, { entryId: "txn-2" }).saved.time, null);
  assert.equal(validateCard(saved).canSave, false);
  assert.equal(setCardField(saved, { amountInput: "99" }, context), saved, "a saved card does not change");
  const undone = markCardUndone(saved);
  assert.equal(undone.status, "draft");
  assert.equal(undone.saved, null);
  assert.equal(undone.fields.amountMinor, 420);
});

test("the create draft is the composer's: direct owner, the share switch as Add to Splits", () => {
  let card = setCardField(createAskCard(context), { amountInput: "38.60", description: "Tiong Bahru Bakery", note: "flat whites" }, context);
  card = setShare(card, { on: true, splitGroupId: "group-dinners" });
  const posted = buildCardCreateDraft(card, context, { splitGroups: [{ id: "split-group-none", name: "Non-group" }, { id: "group-dinners", name: "Dinners out" }] });
  assert.deepEqual(posted, {
    date: "2026-09-29",
    postDate: null,
    description: "Tiong Bahru Bakery",
    accountId: "acct-citi",
    accountName: "Citi Cash Back Card 4821",
    categoryName: "Other",
    amountMinor: 3860,
    totalAmountMinor: 3860,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType: "direct",
    ownerName: "Ethan",
    note: "flat whites",
    splits: [],
    addToSplits: true,
    splitGroupId: "group-dinners",
    // The card's stable client id, so a repeat save makes one entry.
    externalReference: `ask:${card.clientId}`
  });
});

test("a shared owner posts a shared entry with the split share", () => {
  const card = setCardField(createAskCard(context), { amountInput: "100", description: "Groceries", ownerName: "Shared", splitBasisPoints: 6000 }, context);
  const posted = buildCardCreateDraft(card, context);
  assert.equal(posted.ownershipType, "shared");
  assert.equal(posted.ownerName, undefined);
  assert.deepEqual(posted.splits.map((split) => [split.personName, split.ratioBasisPoints, split.amountMinor]), [["Ethan", 6000, 6000], ["Serene", 4000, 4000]]);
});

test("a saved entry from the Apple Pay Shortcut becomes a saved card", () => {
  const card = cardFromSavedEntry({
    id: "txn-apple",
    date: "2026-09-27",
    description: "STARBUCKS",
    accountId: "acct-citi",
    accountName: "Citi Cash Back Card 4821",
    categoryName: "Other",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Ethan",
    amountMinor: 690,
    bankCertificationStatus: "manual_provisional",
    bankCertificationLabel: "Manual provisional",
    addedBy: "apple_pay_shortcut",
    splits: []
  }, context);
  assert.equal(card.status, "saved");
  assert.equal(card.saved.entryId, "txn-apple");
  // The source and bank state come with it, for the saved card's chip.
  assert.equal(card.saved.addedBy, "apple_pay_shortcut");
  assert.equal(card.saved.bankCertificationStatus, "manual_provisional");
  assert.equal(card.saved.splitExpenseId, null);
  assert.equal(card.fields.amountMinor, 690);
  assert.equal(card.fields.categoryName, "Other");
});
