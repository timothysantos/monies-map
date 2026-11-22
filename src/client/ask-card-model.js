// The Ask page's entry card (DOMAIN.md "Entry Card"): one new entry being put
// together before it is saved through the normal create path. Pure: no
// React, fetch or DOM. The Ask panel keeps one card in state and moves it
// through these functions:
//
//   createAskCard -> setCardField / setCardVariant / applyEntryDraft /
//   applyReceiptRead / answerCardQuestion / acceptSplitSuggestion /
//   declineSplitSuggestion -> validateCard ->
//   markCardSaving -> markCardSaved (or markCardSaveFailed) -> markCardUndone
//
// Each card has a stable client id (`clientId`), kept with it in the Ask
// conversation store and sent as the create route's externalReference, so
// saving a card again after a reload during its save returns the entry
// already made instead of adding a second one. A new card, and the card
// Undo gives back, get a new id.
//
// A card is a "draft" until it is saved. `filled` records which fields a
// typed sentence or a receipt supplied (the page marks those rows with a
// dot), `questions` the follow-ups those readers asked, and `saved` the
// created entry once the create route accepted it.
//
// Ask saves direct entries only (one owner) or shared ones with a split
// share; sharing with the other person on Splits is the `share` switch.
// What the card shows is what is saved (Ask audit B3): an expense is on
// Splits exactly when the switch is on, owner Shared always turns it on,
// and switching it off gives the entry one owner again. An expense on
// Splits is saved as one shared entry with its split, in its group, in one
// command (B1); the card lists each person's share before Save
// (cardShares).

import { formatEditableMinorInput, parseDraftMoneyInput } from "./formatters";
import { noteWithReceiptItems, receiptItemsFromRead, withItemShares } from "./ask-receipt-items-card";
import { ENTRY_NOTE_MAX } from "./input-limits";

export const CARD_VARIANTS = Object.freeze(["expense", "income", "transfer"]);
const DEFAULT_EXPENSE_CATEGORY = "Other";
const INCOME_CATEGORY_PREFERENCE = ["Other - Income", "Income"];
const TRANSFER_CATEGORY = "Transfer";
const SHARED_OWNER = "Shared";

function findAccount(accounts, accountId) {
  return accountId ? accounts.find((account) => account.id === accountId) ?? null : null;
}

function activeAccounts(accounts) {
  return accounts.filter((account) => account.isActive !== false);
}

function pickDefaultAccount(context) {
  const active = activeAccounts(context.accounts ?? []);
  for (const accountId of context.defaultAccountPriorityIds ?? []) {
    const account = active.find((item) => item.id === accountId);
    if (account) {
      return account;
    }
  }
  return active[0] ?? context.accounts?.[0] ?? null;
}

function pickDefaultOwner(context) {
  const people = context.people ?? [];
  if (context.viewId && context.viewId !== "household") {
    const viewer = people.find((person) => person.id === context.viewId);
    if (viewer) {
      return viewer.name;
    }
  }
  return people[0]?.name ?? "";
}

function hasCategory(context, name) {
  return (context.categories ?? []).some((category) => category.name === name);
}

export function defaultCategoryForVariant(variant, context) {
  if (variant === "transfer") {
    return TRANSFER_CATEGORY;
  }
  if (variant === "income") {
    return INCOME_CATEGORY_PREFERENCE.find((name) => hasCategory(context, name)) ?? DEFAULT_EXPENSE_CATEGORY;
  }
  return hasCategory(context, DEFAULT_EXPENSE_CATEGORY) || !context.categories?.length
    ? DEFAULT_EXPENSE_CATEGORY
    : context.categories[0].name;
}

function isDefaultCategory(name) {
  return !name || name === DEFAULT_EXPENSE_CATEGORY || INCOME_CATEGORY_PREFERENCE.includes(name) || name === TRANSFER_CATEGORY;
}

// A random id; the create route accepts 8-64 letters, digits and dashes.
function newCardClientId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// mode "expense" (from the Splits receipt button) starts with the Splits
// switch on for that group; "add" (from the Entries + button or Ask) off.
export function createAskCard(context, { mode = "add", splitGroupId = "" } = {}) {
  const account = pickDefaultAccount(context);
  return {
    clientId: newCardClientId(),
    status: "draft",
    variant: "expense",
    fields: {
      date: context.today ?? "",
      description: "",
      amountInput: "",
      amountMinor: 0,
      accountId: account?.id ?? "",
      accountName: account?.name ?? "",
      categoryName: defaultCategoryForVariant("expense", context),
      ownerName: pickDefaultOwner(context),
      splitBasisPoints: 5000,
      // The first person's exact share when it was stated in money, else null.
      splitAmountMinor: null,
      transferDirection: undefined,
      transferAccountId: "",
      transferAccountName: "",
      postDate: "",
      note: ""
    },
    filled: {},
    origin: null,
    touched: false,
    share: {
      on: mode === "expense",
      splitGroupId: mode === "expense" ? splitGroupId : ""
    },
    questions: [],
    // "accepted" or "declined" once the split suggestion was answered.
    splitSuggestionAnswer: "",
    // "accepted" or "declined" once the card suggestion was answered.
    cardSuggestionAnswer: "",
    // A transfer's other side the person chose (ask-transfer-match.js): an
    // entry id, "none" for no other side yet, "" for the best match.
    transferMatchId: "",
    saveError: "",
    saved: null
  };
}

function withAccountName(fields, context, key = "accountId", nameKey = "accountName") {
  const account = findAccount(context.accounts ?? [], fields[key]);
  return account ? { ...fields, [nameKey]: account.name } : fields;
}

// A field the person edits by hand stops being "filled in": its dot goes.
export function setCardField(card, patch, context) {
  if (card.status !== "draft") {
    return card;
  }
  let fields = { ...card.fields, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "amountInput")) {
    fields.amountMinor = Math.max(0, Math.abs(parseDraftMoneyInput(patch.amountInput)));
  } else if (Object.prototype.hasOwnProperty.call(patch, "amountMinor")) {
    fields.amountMinor = Math.max(0, Math.round(Number(patch.amountMinor) || 0));
    fields.amountInput = fields.amountMinor ? formatEditableMinorInput(fields.amountMinor) : "";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "accountId")) {
    fields = withAccountName(fields, context);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "transferAccountId")) {
    fields = withAccountName(fields, context, "transferAccountId", "transferAccountName");
  }
  const filled = { ...card.filled };
  for (const key of Object.keys(patch)) {
    delete filled[fieldKeyOf(key)];
  }
  const answered = new Set(Object.keys(patch).map(fieldKeyOf));
  const changesAmount = ["amountInput", "amountMinor"].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  // A stated share in money holds only for the amount it was stated on.
  if ((changesAmount || Object.prototype.hasOwnProperty.call(patch, "splitBasisPoints")) && !Object.prototype.hasOwnProperty.call(patch, "splitAmountMinor")) {
    fields.splitAmountMinor = null;
  }
  // The amount in the card's currency for a figure paid in another one
  // ("That was JPY 2,400. What did it cost…?"): what was paid is kept with
  // it, as on an estimate (Ask audit B7). It stays while the amount is
  // corrected; a different wallet drops it.
  const foreignQuestion = card.questions.find((question) => question.reason === "foreign_currency" && question.foreignAmount);
  const paidElsewhere = card.foreign?.answered ? card.foreign : null;
  const answeredForeign = changesAmount && fields.amountMinor > 0 && !Object.prototype.hasOwnProperty.call(patch, "accountId")
    ? (foreignQuestion
      ? { amountMinor: foreignQuestion.foreignAmount.amountMinor, currency: foreignQuestion.foreignAmount.currency, estimateMinor: fields.amountMinor, note: "", answered: true }
      : paidElsewhere ? { ...paidElsewhere, estimateMinor: fields.amountMinor } : null)
    : null;
  // A new amount or wallet is no longer the estimate of what was paid.
  const staleEstimate = !answeredForeign && card.foreign && ["amountInput", "amountMinor", "accountId"].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (staleEstimate) {
    fields = dropEstimateNote(fields, card.foreign);
  }
  // A share the person sets by hand wins over the receipt's items.
  const ownShare = ["splitBasisPoints", "splitAmountMinor"].some((key) => Object.prototype.hasOwnProperty.call(patch, key)) && card.receiptItems?.touched;
  return withItemShares({
    ...card,
    ...(ownShare ? { receiptItems: { ...card.receiptItems, touched: false } } : {}),
    ...(staleEstimate ? { foreign: null } : {}),
    ...(answeredForeign ? { foreign: answeredForeign } : {}),
    // Owner Shared is on Splits: the switch shows it (Ask audit B3).
    ...(patch.ownerName === SHARED_OWNER && card.variant === "expense" ? { share: { on: true, splitGroupId: card.share.splitGroupId ?? "" } } : {}),
    fields,
    filled,
    touched: true,
    saveError: "",
    questions: card.questions.filter((question) => !answered.has(question.field) && !(answeredForeign && question === foreignQuestion))
  }, context);
}

// The estimate's note is the card's note until the person changes it.
function dropEstimateNote(fields, foreign) {
  return foreign?.note && fields.note === foreign.note ? { ...fields, note: "" } : fields;
}

// amountInput and amountMinor are one field on screen; so are the account
// id and its name.
function fieldKeyOf(key) {
  if (key === "amountInput" || key === "amountMinor") return "amount";
  if (key === "accountName") return "accountId";
  if (key === "transferAccountName") return "transferAccountId";
  return key;
}

export function setCardVariant(card, variant, context) {
  if (card.status !== "draft" || !CARD_VARIANTS.includes(variant) || card.variant === variant) {
    return card;
  }
  const fields = { ...card.fields };
  // A category picked for the old type rarely fits the new one; the
  // defaults for each type replace only a default.
  if (variant === "transfer" || card.variant === "transfer" || isDefaultCategory(fields.categoryName)) {
    fields.categoryName = defaultCategoryForVariant(variant, context);
  }
  fields.transferDirection = variant === "transfer" ? (fields.transferDirection ?? "out") : undefined;
  if (variant !== "transfer") {
    fields.transferAccountId = "";
    fields.transferAccountName = "";
  }
  return {
    ...card,
    variant,
    fields,
    touched: true,
    saveError: "",
    // Splits shares an expense only.
    share: variant === "expense" ? card.share : { on: false, splitGroupId: "" }
  };
}

// From -> To for a transfer: the posted row is the From wallet's side
// (direction "out") or the To wallet's side ("in"). Swapping turns it round.
export function getTransferEnds(card) {
  const own = { accountId: card.fields.accountId, accountName: card.fields.accountName };
  const other = { accountId: card.fields.transferAccountId, accountName: card.fields.transferAccountName };
  return card.fields.transferDirection === "in"
    ? { from: other, to: own }
    : { from: own, to: other };
}

export function swapTransferDirection(card) {
  if (card.status !== "draft" || card.variant !== "transfer") {
    return card;
  }
  return {
    ...card,
    touched: true,
    fields: {
      ...card.fields,
      accountId: card.fields.transferAccountId || card.fields.accountId,
      accountName: card.fields.transferAccountName || card.fields.accountName,
      transferAccountId: card.fields.transferAccountId ? card.fields.accountId : "",
      transferAccountName: card.fields.transferAccountId ? card.fields.accountName : ""
    }
  };
}

export function chooseTransferMatch(card, transferMatchId) {
  return card?.status === "draft" && card.variant === "transfer" ? { ...card, transferMatchId } : card;
}

// Switching Splits off on a Shared card gives it one owner again: the
// person whose view is open, else whoever owns the wallet (Ask audit B3),
// so the card never says Shared while nothing goes on Splits.
export function setShare(card, { on, splitGroupId }, context = {}) {
  if (card.status !== "draft" || card.variant !== "expense") {
    return card;
  }
  const leavesShared = !on && card.fields.ownerName === SHARED_OWNER;
  // Back on Splits, the shares come from the receipt's items again if they were set.
  return withItemShares({
    ...card,
    touched: true,
    ...(leavesShared ? { fields: { ...card.fields, ownerName: soleOwnerFor(card, context) } } : {}),
    share: {
      on: Boolean(on),
      splitGroupId: on ? (splitGroupId ?? card.share.splitGroupId ?? "") : ""
    }
  }, context);
}

function soleOwnerFor(card, context) {
  const people = context.people ?? [];
  const account = findAccount(context.accounts ?? [], card.fields.accountId);
  const walletOwner = account?.ownerPersonId && !account.isJoint ? people.find((person) => person.id === account.ownerPersonId)?.name : "";
  const viewer = context.viewId && context.viewId !== "household" ? people.find((person) => person.id === context.viewId)?.name : "";
  return viewer || walletOwner || pickDefaultOwner(context) || "";
}

// The split suggestion's two answers (ask-split-suggestion.js). Choosing it
// turns the Splits switch on with the suggested group, exactly as the
// switch and its group row would; nothing is written until Save. Either
// answer is kept on the card, so the question is never asked again for it.
export function acceptSplitSuggestion(card, suggestion) {
  if (card.status !== "draft" || !suggestion?.groupId) {
    return card;
  }
  return { ...setShare(card, { on: true, splitGroupId: suggestion.groupId }), splitSuggestionAnswer: "accepted" };
}

export function declineSplitSuggestion(card) {
  return card ? { ...card, splitSuggestionAnswer: "declined" } : card;
}

// "Yes, <card>" on a draft: the card's card becomes the suggested one, as
// the "Different card" picker would; nothing is written until Save. Either
// answer is kept on the card, so the question is never asked again for it.
export function acceptCardSuggestion(card, suggestion, context) {
  if (card.status !== "draft" || !suggestion?.accountId) {
    return card;
  }
  return { ...setCardField(card, { accountId: suggestion.accountId }, context), cardSuggestionAnswer: "accepted" };
}

export function declineCardSuggestion(card) {
  return card ? { ...card, cardSuggestionAnswer: "declined" } : card;
}

// The wallet list for a card, in the order a payment is most likely made
// from (Ask audit A19): the owner's own cards and cash first, then joint
// ones, then the other person's, investment accounts last. Within each
// group the household's own order is kept. A Shared card has no owner: its
// joint wallets come first.
export function orderWalletsForCard(accounts, { ownerName = "", people = [] } = {}) {
  const ownerId = people.find((person) => person.name === ownerName)?.id ?? "";
  const rank = (account) => {
    if (account.kind === "investment") return 3;
    if (ownerId && account.ownerPersonId === ownerId && !account.isJoint) return 0;
    if (account.isJoint || !account.ownerPersonId) return ownerId ? 1 : 0;
    return 2;
  };
  return accounts
    .map((account, index) => ({ account, index, rank: rank(account) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.account);
}

// The groups a shared expense can go to; with one group the switch picks it.
export function resolveShareGroupId(card, splitGroups = []) {
  if (!card.share.on) {
    return "";
  }
  if (card.share.splitGroupId && splitGroups.some((group) => group.id === card.share.splitGroupId)) {
    return card.share.splitGroupId;
  }
  return splitGroups.length === 1 ? splitGroups[0].id : "";
}

const SOURCE_FIELDS = {
  date: "date",
  description: "description",
  accountId: "accountId",
  categoryName: "categoryName",
  amountMinor: "amount",
  ownerName: "ownerName",
  ownershipType: "ownerName",
  splitBasisPoints: "splitBasisPoints",
  entryType: "variant",
  transferDirection: "transferDirection"
};

// Applies an entry draft read from a typed sentence (ask-api.js
// readEntryDraftResponse). Every value it sends is applied; only values
// that came from the sentence, a category rule or AI are marked filled.
// A follow-up sentence ("make it $15") never replaces a description the
// card already has, nor the category that description chose.
export function applyEntryDraft(card, draft, context) {
  if (card.status !== "draft" || !draft) {
    return card;
  }
  const isFollowUp = Boolean(card.origin) || Boolean(card.fields.description);
  const keepDescription = isFollowUp && Boolean(card.fields.description);
  const valueOf = (name) => draft.fields?.[name]?.value;
  const sourceOf = (name) => draft.fields?.[name]?.source;
  const has = (name) => draft.fields?.[name] !== undefined && valueOf(name) !== undefined && valueOf(name) !== null && valueOf(name) !== "";
  const counts = (name) => has(name) && (!isFollowUp || sourceOf(name) !== "default");

  let next = card;
  const entryType = valueOf("entryType");
  if (counts("entryType") && CARD_VARIANTS.includes(entryType)) {
    next = setCardVariant(next, entryType, context);
  }
  const fields = { ...next.fields };
  const filled = { ...next.filled };
  const mark = (name, key = SOURCE_FIELDS[name]) => {
    const source = sourceOf(name);
    if (source && source !== "default") {
      filled[key] = source;
    }
  };

  if (counts("date")) {
    fields.date = valueOf("date");
    mark("date");
  }
  if (counts("description") && !keepDescription) {
    fields.description = String(valueOf("description"));
    mark("description");
  }
  if (counts("accountId")) {
    fields.accountId = valueOf("accountId");
    const account = findAccount(context.accounts ?? [], fields.accountId);
    fields.accountName = account?.name ?? valueOf("accountName") ?? "";
    mark("accountId");
  }
  if (counts("categoryName") && !keepDescription && next.variant !== "transfer") {
    fields.categoryName = valueOf("categoryName");
    mark("categoryName");
  }
  let foreign = next.foreign ?? null;
  if (counts("amountMinor")) {
    fields.amountMinor = Math.max(0, Math.round(Number(valueOf("amountMinor")) || 0));
    fields.amountInput = fields.amountMinor ? formatEditableMinorInput(fields.amountMinor) : "";
    mark("amountMinor");
    // An amount worked out from a figure in another currency (IDR 35,000 at
    // the day's rate): the original is kept, with its note, and shown as
    // an estimate; a plain amount replaces any earlier estimate.
    Object.assign(fields, dropEstimateNote(fields, foreign));
    const estimate = draft.foreignAmount?.estimate;
    // The card-currency amount for a figure the card asked about ("That
    // was JPY 2,400…"): what was paid stays with it (Ask audit B7).
    const askedForeign = !draft.foreignAmount
      ? next.questions.find((question) => question.reason === "foreign_currency" && question.foreignAmount)?.foreignAmount ?? (next.foreign?.answered ? next.foreign : null)
      : null;
    foreign = estimate && estimate.amountMinor === fields.amountMinor
      ? { amountMinor: draft.foreignAmount.amountMinor, currency: draft.foreignAmount.currency, estimateMinor: estimate.amountMinor, note: estimate.note }
      : askedForeign
        ? { amountMinor: askedForeign.amountMinor, currency: askedForeign.currency, estimateMinor: fields.amountMinor, note: "", answered: true }
        : null;
    if (foreign) {
      fields.note = [fields.note, foreign.note].filter(Boolean).join("\n");
    }
  }
  if (counts("ownershipType") && valueOf("ownershipType") === "shared") {
    fields.ownerName = SHARED_OWNER;
    mark("ownershipType");
  } else if (counts("ownerName")) {
    fields.ownerName = valueOf("ownerName");
    mark("ownerName");
  }
  if (counts("splitBasisPoints")) {
    fields.splitBasisPoints = Number(valueOf("splitBasisPoints"));
    fields.splitAmountMinor = has("splitAmountMinor") ? Math.round(Number(valueOf("splitAmountMinor"))) : null;
    mark("splitBasisPoints");
  } else if (counts("amountMinor")) {
    fields.splitAmountMinor = null;
  }
  // A payment word the household has no wallet for ("kopi 2.40 cash" with
  // no cash wallet): the wallet is asked in place, never a card filled in
  // silently (Ask audit B8).
  const walletAsked = (draft.questions ?? []).some((question) => question.field === "accountId");
  // Whose cash it was, when the wallet is asked for a cash payment: after
  // the save, "Remember this for cash" (ask-chips.js) can keep the wallet
  // picked as that person's cash wallet.
  const cashFor = (draft.questions ?? []).find((question) => question.field === "accountId" && question.paymentWay?.kind === "cash")?.paymentWay.personId ?? "";
  if (!counts("accountId") && walletAsked && !isFollowUp) {
    fields.accountId = "";
    fields.accountName = "";
    delete filled.accountId;
  }
  if (next.variant === "transfer") {
    if (counts("transferDirection")) {
      fields.transferDirection = valueOf("transferDirection");
    }
    const other = draft.transferAccount?.value;
    if (other?.accountId) {
      fields.transferAccountId = other.accountId;
      fields.transferAccountName = findAccount(context.accounts ?? [], other.accountId)?.name ?? other.accountName ?? "";
      if (draft.transferAccount.source && draft.transferAccount.source !== "default") {
        filled.transferAccountId = draft.transferAccount.source;
      }
    }
  }
  if (draft.fields?.entryType?.source && draft.fields.entryType.source !== "default") {
    filled.variant = draft.fields.entryType.source;
  }

  // Owner Shared is on Splits: the switch shows it (Ask audit B3).
  const share = fields.ownerName === SHARED_OWNER && next.variant === "expense" && !next.share.on
    ? { on: true, splitGroupId: next.share.splitGroupId ?? "" }
    : next.share;
  return {
    ...next,
    foreign,
    fields,
    filled,
    share,
    origin: next.origin ?? "message",
    touched: true,
    saveError: "",
    cashFor: cashFor || (isFollowUp ? next.cashFor ?? "" : ""),
    // A follow-up ("it was yesterday") says nothing about the amount or what
    // it was; the card already has them, so "How much was it?" is not asked.
    questions: (draft.questions ?? [])
      .filter((question) => !(question.reason === "missing" && hasValue(fields, question.field)))
      .map((question) => ({ ...question, source: "message" }))
  };
}

function hasValue(fields, field) {
  return field === "amountMinor" ? Number(fields.amountMinor) > 0 : Boolean(fields[field]);
}

function matchAccountByLast4(accounts, last4) {
  if (!last4) {
    return null;
  }
  const matches = activeAccounts(accounts).filter((account) => (
    account.last4 === last4 || new RegExp(`(^|\\D)${last4}(\\D|$)`).test(account.name ?? "")
  ));
  return matches.length === 1 ? matches[0] : null;
}

// Applies what a receipt says (ask-api.js readReceiptReadResponse, or the
// in-browser OCR fallback). Only a single active account whose card ending
// matches is chosen; a total in another currency than that account's waits
// for the person (a question), it is never converted here.
export function applyReceiptRead(card, receipt, context) {
  if (card.status !== "draft" || !receipt) {
    return card;
  }
  let next = card.variant === "expense" ? card : setCardVariant(card, "expense", context);
  const fields = { ...next.fields };
  const filled = { ...next.filled };
  const questions = [];

  if (receipt.merchant?.value) {
    fields.description = receipt.merchant.value;
    filled.description = "receipt";
  }
  if (receipt.date?.value) {
    fields.date = receipt.date.value;
    filled.date = "receipt";
  }
  const account = matchAccountByLast4(context.accounts ?? [], receipt.cardLast4);
  if (account) {
    fields.accountId = account.id;
    fields.accountName = account.name;
    filled.accountId = "receipt";
  }
  const total = receipt.total ?? {};
  if (typeof total.amountMinor === "number" && total.amountMinor > 0) {
    const accountCurrency = (findAccount(context.accounts ?? [], fields.accountId)?.currency ?? "SGD").toUpperCase();
    if (!total.currency || total.currency.toUpperCase() === accountCurrency) {
      fields.amountMinor = total.amountMinor;
      fields.amountInput = formatEditableMinorInput(total.amountMinor);
      filled.amount = "receipt";
    } else {
      questions.push({ field: "amountMinor", reason: "foreign_currency", options: [], foreignAmount: { amountMinor: total.amountMinor, currency: total.currency }, source: "receipt" });
    }
  }
  for (const question of receipt.questions ?? []) {
    const field = { merchant: "description", total: "amountMinor", date: "date", currency: "amountMinor" }[question.field] ?? question.field;
    if (questions.some((item) => item.field === field)) {
      continue;
    }
    questions.push({
      field,
      reason: question.reason,
      options: (question.candidates ?? []).map((candidate) => (field === "date" ? { date: candidate } : { value: candidate })),
      source: "receipt"
    });
  }

  return {
    ...next,
    fields,
    filled,
    origin: "receipt",
    touched: true,
    saveError: "",
    questions,
    // The receipt's items when they add up to its total (ask-receipt-items-card.js).
    ...receiptItemsFromRead(receipt)
  };
}

// One tap on a question chip: the option's values become the card's.
export function answerCardQuestion(card, question, option, context) {
  if (card.status !== "draft" || !question || !option) {
    return card;
  }
  const patch = {};
  if (option.date) patch.date = option.date;
  if (option.accountId) patch.accountId = option.accountId;
  if (typeof option.amountMinor === "number") patch.amountMinor = option.amountMinor;
  if (option.personName) patch.ownerName = option.personName;
  if (typeof option.splitBasisPoints === "number") {
    patch.ownerName = SHARED_OWNER;
    patch.splitBasisPoints = option.splitBasisPoints;
  }
  if (question.field === "transferAccountId" && option.accountId) {
    delete patch.accountId;
    patch.transferAccountId = option.accountId;
  }
  if (!Object.keys(patch).length) {
    return card;
  }
  const next = setCardField(card, patch, context);
  return { ...next, questions: next.questions.filter((item) => item !== question && item.field !== question.field) };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

// What still blocks Save, in the order the card shows the fields.
export function validateCard(card, { splitGroups = [] } = {}) {
  const { fields } = card;
  const missing = [];
  if (!(fields.amountMinor > 0)) missing.push("amount");
  if (card.variant !== "transfer" && !fields.description.trim()) missing.push("description");
  if (!isIsoDate(fields.date)) missing.push("date");
  if (!fields.accountId) missing.push("accountId");
  if (card.variant === "transfer" && fields.transferAccountId && fields.transferAccountId === fields.accountId) missing.push("transferAccountId");
  if (card.variant !== "transfer" && !fields.categoryName) missing.push("categoryName");
  // A Shared expense with Splits off would save a split the card does not
  // show: it needs one owner first (setShare gives it one).
  if (!fields.ownerName || (card.variant === "expense" && fields.ownerName === SHARED_OWNER && !card.share.on)) missing.push("ownerName");
  if (card.variant === "expense" && card.share.on && splitGroups.length && !resolveShareGroupId(card, splitGroups)) missing.push("splitGroup");
  return { canSave: card.status === "draft" && missing.length === 0, missing };
}

// A transfer's row needs a description; one is written from its wallets
// unless the person typed their own.
export function describeTransfer(card) {
  const { from, to } = getTransferEnds(card);
  if (card.fields.transferDirection === "in") {
    return from.accountName ? `Transfer from ${from.accountName}` : "Transfer in";
  }
  return to.accountName ? `Transfer to ${to.accountName}` : "Transfer out";
}

// The draft the shared create path (entry-actions.js createEntryFromDraft)
// posts: exactly the composer's fields.
export function buildCardCreateDraft(card, context, { splitGroups = [] } = {}) {
  const { fields } = card;
  // An expense is on Splits exactly when the switch is on: saved as one
  // Shared entry with its split, in its group, in one command. The payer is
  // the owner the card names, else (owner Shared) the wallet's owner.
  const onSplits = card.variant === "expense" && card.share.on;
  const isShared = onSplits || (card.variant !== "expense" && fields.ownerName === SHARED_OWNER);
  const people = context.people ?? [];
  const description = fields.description.trim() || (card.variant === "transfer" ? describeTransfer(card) : "");
  const splitGroupId = resolveShareGroupId(card, splitGroups);
  const shares = onSplits ? cardShares(card, context) : [];
  const splits = isShared
    ? people.slice(0, 2).map((person, index) => {
        const ratio = index === 0 ? fields.splitBasisPoints : 10000 - fields.splitBasisPoints;
        return { personId: person.id, personName: person.name, ratioBasisPoints: ratio, amountMinor: shares[index]?.amountMinor ?? Math.floor((fields.amountMinor * ratio) / 10000) };
      })
    : [];
  const exactShare = onSplits && Number.isInteger(fields.splitAmountMinor) && fields.splitAmountMinor <= fields.amountMinor ? fields.splitAmountMinor : null;
  return {
    date: fields.date,
    postDate: fields.postDate || null,
    description,
    accountId: fields.accountId,
    accountName: fields.accountName,
    categoryName: card.variant === "transfer" ? TRANSFER_CATEGORY : fields.categoryName,
    amountMinor: fields.amountMinor,
    totalAmountMinor: fields.amountMinor,
    entryType: card.variant,
    transferDirection: card.variant === "transfer" ? (fields.transferDirection ?? "out") : undefined,
    ownershipType: isShared ? "shared" : "direct",
    ownerName: fields.ownerName && fields.ownerName !== SHARED_OWNER ? fields.ownerName : undefined,
    // The person's note, then the receipt's items (with whose each is when
    // the entry goes on Splits by items), bounded by the note limit.
    note: noteWithReceiptItems(card, context, { maxChars: ENTRY_NOTE_MAX }),
    // The estimate keeps what was paid: only while the amount is still it.
    ...(card.foreign && card.foreign.estimateMinor === fields.amountMinor
      ? { originalAmountMinor: card.foreign.amountMinor, originalCurrency: card.foreign.currency }
      : {}),
    splits,
    ...(exactShare !== null ? { splitAmountMinor: exactShare } : {}),
    addToSplits: onSplits && Boolean(splitGroupId || !splitGroups.length),
    splitGroupId,
    // Only the person's own choices count as habits (Ask audit B13): a
    // category they picked or named, and the split they saved.
    habits: { category: categoryIsTheirs(card), split: onSplits },
    externalReference: card.clientId ? `ask:${card.clientId}` : undefined
  };
}

// Whether the card's category is the person's own: picked on the card (a
// picked row has no source) or named in their words. One the household's
// rules, a habit, AI or a receipt filled in is not.
function categoryIsTheirs(card) {
  const source = card.filled?.categoryName;
  return card.variant === "expense" && (!source || source === "sentence") && !isDefaultCategory(card.fields.categoryName);
}

// Each person's share on Splits as the card will save it, in household
// order: a share stated in money exactly, else the first person's basis
// points, the second has the rest (the server's rule, to the cent). The
// payer is the card's owner, or the wallet's owner on a Shared card.
export function cardShares(card, context) {
  const people = (context.people ?? []).slice(0, 2);
  const total = Math.max(0, Number(card.fields.amountMinor) || 0);
  if (people.length < 2 || !(total > 0)) {
    return [];
  }
  const basis = Math.max(0, Math.min(10000, Number(card.fields.splitBasisPoints) || 0));
  const exact = Number.isInteger(card.fields.splitAmountMinor) && card.fields.splitAmountMinor <= total ? card.fields.splitAmountMinor : null;
  const first = exact ?? Math.floor((total * basis) / 10000);
  return [
    { personName: people[0].name, amountMinor: first },
    { personName: people[1].name, amountMinor: total - first }
  ];
}

// A card kept from before client ids gets one here, before it is sent.
export function markCardSaving(card) {
  return card.status === "draft" ? { ...card, clientId: card.clientId || newCardClientId(), status: "saving", saveError: "" } : card;
}

export function markCardSaveFailed(card, error) {
  return { ...card, status: "draft", saveError: error || "The entry could not be saved." };
}

export function markCardSaved(card, result) {
  return {
    ...card,
    status: "saved",
    saveError: "",
    questions: [],
    saved: {
      entryId: result.entryId,
      // Saved by Ask, so a provisional entry until a statement certifies it.
      addedBy: "ask",
      bankCertificationStatus: "manual_provisional",
      // The local clock time the server saved (today's entries only).
      time: result.time ?? null,
      splitExpenseId: result.splitExpenseId ?? null,
      splitExpenseMonth: result.splitExpenseMonth ?? null,
      splitGroupId: result.splitGroupId ?? card.share.splitGroupId ?? "",
      splitAddError: result.splitAddError ?? "",
      // What the save counted as habits, for Undo to take back.
      habits: result.habits ?? null
    }
  };
}

// Undo removed the entry: the card is a draft again with the same values,
// so the person can change it and save once more, as a new entry (a new id).
// The card comes back after Undo with what it had (`undoneFields` and
// `undoneShare` are the same objects as its own, until anything changes).
export function markCardUndone(card) {
  return { ...card, clientId: newCardClientId(), status: "draft", saved: null, saveError: "", undoneFields: card.fields, undoneShare: card.share };
}

// True while a card brought back by Undo is unchanged: the person undid it
// on purpose, so the composer offers Send rather than Save and Discard
// comes first (Ask audit A11). Every change makes new fields or share.
export function isUnchangedSinceUndo(card) {
  return Boolean(card?.status === "draft" && card.undoneFields && card.undoneFields === card.fields && card.undoneShare === card.share);
}

// A saved entry (the Apple Pay Shortcut opens Ask on one) as a card that is
// already saved.
export function cardFromSavedEntry(entry, context) {
  const variant = CARD_VARIANTS.includes(entry.entryType) ? entry.entryType : "expense";
  const card = createAskCard(context);
  const amountMinor = entry.totalAmountMinor ?? entry.amountMinor ?? 0;
  return {
    ...card,
    variant,
    status: "saved",
    origin: "saved",
    fields: {
      ...card.fields,
      date: entry.date,
      description: entry.description ?? "",
      amountMinor,
      amountInput: formatEditableMinorInput(amountMinor),
      accountId: entry.accountId ?? "",
      accountName: entry.accountName ?? "",
      categoryName: entry.categoryName ?? card.fields.categoryName,
      ownerName: entry.ownershipType === "shared" ? SHARED_OWNER : entry.ownerName ?? card.fields.ownerName,
      transferDirection: entry.transferDirection,
      transferAccountName: entry.linkedTransfer?.accountName ?? "",
      postDate: entry.postDate ?? "",
      note: entry.note ?? ""
    },
    share: { on: Boolean(entry.linkedSplitExpenseId), splitGroupId: "" },
    saved: {
      entryId: entry.id,
      addedBy: entry.addedBy ?? null,
      bankCertificationStatus: entry.bankCertificationStatus ?? null,
      bankCertificationLabel: entry.bankCertificationLabel ?? "",
      time: entry.time ?? null,
      splitExpenseId: entry.linkedSplitExpenseId ?? null,
      splitExpenseMonth: entry.linkedSplitExpenseId ? entry.date.slice(0, 7) : null,
      splitGroupId: "",
      splitGroupName: entry.linkedSplitGroupName ?? "",
      splitAddError: ""
    }
  };
}

// A card nobody has started on yet shows the coaxing line.
export function isCardEmpty(card) {
  return !card.origin && !card.fields.description && !(card.fields.amountMinor > 0);
}

export { SHARED_OWNER };
