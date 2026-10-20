// Ask's "Edit in form" for a split draft (docs/flows/ask-flow.md, "Edit in
// form"): the card from the Splits receipt button carries what it drafted to
// Splits' New split expense, and the form opens with exactly those values,
// unsaved. The hand-off travels in history state, never the URL, and the
// form keeps its own default for anything it cannot show.
import assert from "node:assert/strict";
import test from "node:test";

import { createAskCard, setCardField, setShare } from "../src/client/ask-card-model.js";
import {
  ASK_SPLIT_DRAFT_STATE_KEY,
  applyAskSplitFormDraft,
  buildAskSplitFormDraft,
  readAskSplitFormDraft
} from "../src/client/ask-split-form-handoff.js";
import { buildNewExpenseDraft } from "../src/client/splits-drafts.js";

const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const accounts = [
  { id: "acct-citi", name: "Citi Rewards", kind: "credit_card", currency: "SGD", ownerPersonId: "person-tim", isActive: true },
  { id: "acct-joyce-bank", name: "Joyce Savings", kind: "bank", currency: "SGD", ownerPersonId: "person-joyce", isActive: true },
  { id: "acct-yen", name: "Yen Wallet", kind: "cash", currency: "JPY", ownerPersonId: "person-joyce", isActive: true }
];
const categories = [{ name: "Other" }, { name: "Food & Drinks" }, { name: "Travel" }];
const context = { accounts, categories, people, viewId: "person-tim", today: "2026-04-20" };
const mixedGroup = { id: "split-group-baby-river", name: "Baby River", currency: "SGD", expenseSource: "mixed" };
const categoryOptions = ["Food & Drinks", "Other", "Travel"];

function cardWith(patch, { share = { on: true, splitGroupId: mixedGroup.id } } = {}) {
  const card = createAskCard(context, { mode: "expense", splitGroupId: mixedGroup.id });
  return setShare(setCardField(card, patch, context), share);
}

function openForm(handoff, group = mixedGroup) {
  const base = buildNewExpenseDraft({ activeGroup: group, categoryOptions, people, view: { id: "person-tim" } });
  return applyAskSplitFormDraft(base, readAskSplitFormDraft(handoff), { activeGroup: group, categoryOptions, people });
}

test("an equal split for one person's card: every value the card shows, shares 50 / 50", () => {
  const card = cardWith({ description: "Dinner at Jumbo", amountInput: "86.40", date: "2026-04-18", categoryName: "Food & Drinks", accountId: "acct-citi", ownerName: "Tim", note: "Birthday" });
  const handoff = buildAskSplitFormDraft(card, context);
  assert.deepEqual(handoff, {
    description: "Dinner at Jumbo",
    amountMinor: 8640,
    currency: "SGD",
    date: "2026-04-18",
    payerPersonName: "Tim",
    categoryName: "Food & Drinks",
    splitBasisPoints: 5000,
    paymentMethod: "card",
    note: "Birthday"
  });
  const form = openForm(handoff);
  assert.equal(form.groupId, mixedGroup.id);
  assert.equal(form.description, "Dinner at Jumbo");
  assert.equal(form.amountMinor, 8640);
  assert.equal(form.currency, "SGD");
  assert.equal(form.date, "2026-04-18");
  assert.equal(form.payerPersonName, "Tim");
  assert.equal(form.categoryName, "Food & Drinks");
  assert.equal(form.paymentMethod, "card");
  assert.equal(form.note, "Birthday");
  assert.equal(form.sharePersonName, "Tim");
  assert.equal(form.splitValueMode, "percent");
  assert.equal(form.splitBasisPoints, 5000);
  assert.equal(form.splitAmountMinor, 4320);
  // A new draft: no id, so Save creates and nothing was saved before it.
  assert.equal(form.id, undefined);
});

test("a shared card's stated percentage carries exactly, and the account's owner paid", () => {
  const card = cardWith({ description: "Groceries", amountInput: "120", date: "2026-04-19", accountId: "acct-joyce-bank", ownerName: "Shared", splitBasisPoints: 3000 });
  const handoff = buildAskSplitFormDraft(card, context);
  assert.equal(handoff.splitBasisPoints, 3000);
  assert.equal(handoff.payerPersonName, "Joyce");
  assert.equal(handoff.paymentMethod, "bank");
  const form = openForm(handoff);
  assert.equal(form.payerPersonName, "Joyce");
  assert.equal(form.splitBasisPoints, 3000);
  assert.equal(form.splitPercentInput, "30");
  assert.equal(form.splitAmountMinor, 3600);
});

test("one stated share leaves the other person the rest", () => {
  const card = cardWith({ description: "Taxi", amountInput: "33.33", date: "2026-04-17", accountId: "acct-citi", ownerName: "Shared", splitBasisPoints: 2500 });
  const form = openForm(buildAskSplitFormDraft(card, context));
  // Tim's share is the stated one; Joyce has the remainder.
  assert.equal(form.sharePersonName, "Tim");
  assert.equal(form.splitBasisPoints, 2500);
  assert.equal(form.splitAmountMinor, 833);
  assert.equal(form.amountMinor - form.splitAmountMinor, 2500);
});

test("a card in another currency opens the form in that currency with the same amount", () => {
  const card = cardWith({ description: "Ramen", amountInput: "2400", date: "2026-04-16", accountId: "acct-yen", ownerName: "Joyce" });
  const handoff = buildAskSplitFormDraft(card, context);
  assert.equal(handoff.currency, "JPY");
  assert.equal(handoff.paymentMethod, "cash");
  const form = openForm(handoff);
  assert.equal(form.currency, "JPY");
  assert.equal(form.amountMinor, 240000);
  assert.equal(form.payerPersonName, "Joyce");
});

test("a missing amount opens empty, as a form started by hand", () => {
  const card = cardWith({ description: "Lunch", date: "2026-04-15", accountId: "acct-citi", ownerName: "Tim" });
  const handoff = buildAskSplitFormDraft(card, context);
  assert.equal(handoff.amountMinor, 0);
  const form = openForm(handoff);
  assert.equal(form.amountMinor, 0);
  assert.equal(form.description, "Lunch");
});

test("negative: what the form cannot show keeps the form's default", () => {
  const ledgerGroup = { id: "split-group-ledger", name: "Cards", currency: "SGD", expenseSource: "ledger" };
  const base = buildNewExpenseDraft({ activeGroup: ledgerGroup, categoryOptions, people, view: { id: "person-tim" } });
  const form = applyAskSplitFormDraft(base, readAskSplitFormDraft({
    description: "Something",
    amountMinor: 500,
    currency: "SGD",
    date: "2026-04-15",
    payerPersonName: "Someone else",
    categoryName: "A retired category",
    splitBasisPoints: 5000,
    // Cash cannot be paid in a bank or card group.
    paymentMethod: "cash",
    note: ""
  }), { activeGroup: ledgerGroup, categoryOptions, people });
  assert.equal(form.payerPersonName, base.payerPersonName);
  assert.equal(form.categoryName, base.categoryName);
  assert.equal(form.paymentMethod, base.paymentMethod);
  assert.equal(form.description, "Something");
});

test("negative: a broken or foreign hand-off is ignored, and a transfer card hands nothing", () => {
  assert.equal(readAskSplitFormDraft(null), null);
  assert.equal(readAskSplitFormDraft("Dinner"), null);
  assert.equal(readAskSplitFormDraft({ description: 5 }), null);
  assert.equal(readAskSplitFormDraft({ description: "x", amountMinor: -10, currency: "SGD", date: "2026-04-15", payerPersonName: "", categoryName: "", splitBasisPoints: 5000, paymentMethod: "", note: "" }), null);
  assert.equal(readAskSplitFormDraft({ description: "x", amountMinor: 10, currency: "SGD", date: "2026-04-15", payerPersonName: "", categoryName: "", splitBasisPoints: 12000, paymentMethod: "", note: "" }), null);
  const base = buildNewExpenseDraft({ activeGroup: mixedGroup, categoryOptions, people, view: { id: "person-tim" } });
  assert.deepEqual(applyAskSplitFormDraft(base, null, { activeGroup: mixedGroup, categoryOptions, people }), base);

  const transfer = { ...cardWith({ description: "Move", amountInput: "10", accountId: "acct-citi" }), variant: "transfer" };
  assert.equal(buildAskSplitFormDraft(transfer, context), null);
  assert.equal(ASK_SPLIT_DRAFT_STATE_KEY, "askSplitDraft");
});
