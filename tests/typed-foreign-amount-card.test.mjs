// A typed "coffee 35000 IDR cash" on the Ask card (src/client/ask-card-model.js):
// the server answers with an estimate in the wallet's currency (SGD 2.80) and
// the figure as typed; the card shows the estimate, keeps what was paid for
// the save, and drops it the moment the amount or wallet is changed by hand.
// With no rate the amount stays empty and the card asks in place, no chip.
import assert from "node:assert/strict";
import test from "node:test";

import { applyEntryDraft, buildCardCreateDraft, createAskCard, setCardField, validateCard } from "../src/client/ask-card-model.js";
import { readEntryDraftResponse } from "../src/client/ask-api.js";

const context = {
  today: "2026-09-29",
  viewId: "person-ethan",
  people: [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }],
  accounts: [
    { id: "acct-ocbc", name: "OCBC 360 Account", currency: "SGD", isActive: true },
    { id: "acct-cash", name: "Ethan's cash", currency: "SGD", isActive: true }
  ],
  categories: [{ id: "cat-other", name: "Other" }, { id: "cat-food", name: "Food & Drinks" }]
};

const NOTE = "Paid IDR 35,000 cash. Saved as about SGD 2.80 at 1 SGD = 12,500 IDR (17 Nov 2026).";

function typedDraft(withEstimate) {
  return readEntryDraftResponse({
    ok: true,
    draft: {
      fields: {
        date: { value: "2026-09-29", source: "default" },
        description: { value: "Coffee", source: "sentence" },
        accountId: { value: "acct-cash", source: "sentence" },
        accountName: { value: "Ethan's cash", source: "sentence" },
        categoryName: { value: "Food & Drinks", source: "rule" },
        ...(withEstimate ? { amountMinor: { value: 280, source: "rule" } } : {}),
        entryType: { value: "expense", source: "default" },
        ownershipType: { value: "direct", source: "default" },
        ownerName: { value: "Ethan", source: "default" }
      },
      foreignAmount: {
        amountMinor: 3_500_000,
        currency: "IDR",
        source: "sentence",
        ...(withEstimate ? { estimate: { amountMinor: 280, accountCurrency: "SGD", note: NOTE } } : {})
      },
      missing: withEstimate ? [] : ["amountMinor"],
      questions: withEstimate ? [] : [{ field: "amountMinor", reason: "foreign_currency", options: [], foreignAmount: { amountMinor: 3_500_000, currency: "IDR" } }]
    }
  });
}

test("a typed foreign amount fills the estimate, posts what was paid with it, and keeps its note", () => {
  const card = applyEntryDraft(createAskCard(context), typedDraft(true), context);
  assert.equal(card.fields.amountMinor, 280);
  assert.equal(card.fields.note, NOTE);
  const posted = buildCardCreateDraft(card, context);
  assert.equal(posted.amountMinor, 280);
  assert.equal(posted.originalAmountMinor, 3_500_000);
  assert.equal(posted.originalCurrency, "IDR");
  assert.equal(posted.note, NOTE);
});

test("negative: changing the amount or the wallet drops the estimate, its note and the original", () => {
  const card = applyEntryDraft(createAskCard(context), typedDraft(true), context);
  for (const patch of [{ amountInput: "3.10" }, { accountId: "acct-ocbc" }]) {
    const posted = buildCardCreateDraft(setCardField(card, patch, context), context);
    assert.equal(posted.originalAmountMinor, undefined);
    assert.equal(posted.originalCurrency, undefined);
    assert.equal(posted.note, "");
  }
});

test("negative: no rate leaves the amount empty and asks in place with no chip", () => {
  const card = applyEntryDraft(createAskCard(context), typedDraft(false), context);
  assert.equal(card.fields.amountMinor, 0);
  assert.equal(validateCard(card).canSave, false);
  assert.deepEqual(card.questions.map((question) => [question.reason, question.options.length, question.foreignAmount.currency]), [["foreign_currency", 0, "IDR"]]);
  assert.equal(buildCardCreateDraft(card, context).originalAmountMinor, undefined);
});

test("a plain follow-up amount replaces an earlier estimate and its original", () => {
  const first = applyEntryDraft(createAskCard(context), typedDraft(true), context);
  const followUp = readEntryDraftResponse({ ok: true, draft: { fields: { amountMinor: { value: 400, source: "sentence" } }, missing: [], questions: [] } });
  const posted = buildCardCreateDraft(applyEntryDraft(first, followUp, context), context);
  assert.equal(posted.amountMinor, 400);
  assert.equal(posted.originalAmountMinor, undefined);
  assert.equal(posted.note, "");
});
