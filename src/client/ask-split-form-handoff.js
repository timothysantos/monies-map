// Ask's "Edit in form" for a split draft (docs/flows/ask-flow.md, "Edit in
// form"; docs/flows/splits-flow.md): the card from the Splits receipt button
// carries what it drafted to Splits' New split expense, which opens with
// those values filled in and unsaved. Pure: no React, fetch or DOM.
//
//   Ask: buildAskSplitFormDraft(card, context) -> history state
//        { askSplitDraft } (never the URL: no amount or text in a link)
//   Splits: readAskSplitFormDraft(location.state.askSplitDraft) ->
//        applyAskSplitFormDraft(new form draft, hand-off, options)
//
// Each value is the one the card shows, read as the card's Save would read
// it: who paid is the card's person (for a shared card, the wallet's owner,
// as Add to Splits does), the shares are 50 / 50 unless the card is shared
// with a stated share for the first person (the other has the rest), the
// currency is the wallet's and the way it was paid follows the wallet's
// kind. Anything the form cannot show keeps the form's own default.

import { buildSplitShareState } from "./split-share-state";

export const ASK_SPLIT_DRAFT_STATE_KEY = "askSplitDraft";

const SHARED_OWNER = "Shared";
const EVEN_SHARE = 5000;
const PAYMENT_BY_ACCOUNT_KIND = { credit_card: "card", bank: "bank", cash: "cash", loan: "other", investment: "other" };
const PAYMENT_METHODS = ["cash", "card", "bank", "other"];

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isShare(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000;
}

/**
 * The hand-off for a draft expense card, or null when the card is not one
 * (a transfer, income or a saved card opens the form as before).
 */
export function buildAskSplitFormDraft(card, context) {
  if (!card || card.status !== "draft" || card.variant !== "expense") {
    return null;
  }
  const { fields } = card;
  const people = context.people ?? [];
  const account = (context.accounts ?? []).find((item) => item.id === fields.accountId) ?? null;
  const isShared = fields.ownerName === SHARED_OWNER;
  const payerPersonName = isShared
    ? people.find((person) => person.id === account?.ownerPersonId)?.name ?? ""
    : people.some((person) => person.name === fields.ownerName) ? fields.ownerName : "";
  return {
    description: String(fields.description ?? "").trim(),
    amountMinor: fields.amountMinor > 0 ? Math.round(fields.amountMinor) : 0,
    currency: String(account?.currency ?? "").toUpperCase(),
    date: isIsoDate(fields.date) ? fields.date : "",
    payerPersonName,
    categoryName: fields.categoryName ?? "",
    splitBasisPoints: isShared && isShare(fields.splitBasisPoints) ? fields.splitBasisPoints : EVEN_SHARE,
    paymentMethod: PAYMENT_BY_ACCOUNT_KIND[account?.kind] ?? "",
    note: String(fields.note ?? "")
  };
}

/** The hand-off read back from history state; null unless it is whole. */
export function readAskSplitFormDraft(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const text = ["description", "currency", "date", "payerPersonName", "categoryName", "paymentMethod", "note"];
  if (text.some((key) => typeof value[key] !== "string")) {
    return null;
  }
  if (!(Number.isInteger(value.amountMinor) && value.amountMinor >= 0) || !isShare(value.splitBasisPoints)) {
    return null;
  }
  return {
    description: value.description,
    amountMinor: value.amountMinor,
    currency: value.currency,
    date: value.date,
    payerPersonName: value.payerPersonName,
    categoryName: value.categoryName,
    splitBasisPoints: value.splitBasisPoints,
    paymentMethod: value.paymentMethod,
    note: value.note
  };
}

// The ways a group allows, as the expense card offers them.
function allowedPaymentMethods(group) {
  if (group?.expenseSource === "cash") return ["cash"];
  if (group?.expenseSource === "ledger") return ["card", "bank"];
  return PAYMENT_METHODS;
}

/**
 * New split expense's draft with the hand-off's values laid on it. Still a
 * new draft (no id): nothing is saved until the form's Save, which checks
 * it exactly as a form filled by hand.
 */
export function applyAskSplitFormDraft(baseDraft, handoff, { activeGroup = null, categoryOptions = [], people = [] } = {}) {
  if (!baseDraft || !handoff) {
    return baseDraft;
  }
  const next = { ...baseDraft };
  if (handoff.description) next.description = handoff.description;
  if (handoff.amountMinor > 0) next.amountMinor = handoff.amountMinor;
  if (/^[A-Z]{3}$/.test(handoff.currency)) next.currency = handoff.currency;
  if (isIsoDate(handoff.date)) next.date = handoff.date;
  if (people.some((person) => person.name === handoff.payerPersonName)) next.payerPersonName = handoff.payerPersonName;
  if (categoryOptions.includes(handoff.categoryName)) next.categoryName = handoff.categoryName;
  if (allowedPaymentMethods(activeGroup).includes(handoff.paymentMethod)) next.paymentMethod = handoff.paymentMethod;
  if (handoff.note) next.note = handoff.note;
  return {
    ...next,
    ...buildSplitShareState({ totalAmountMinor: next.amountMinor, splitBasisPoints: handoff.splitBasisPoints, splitValueMode: "percent" })
  };
}
