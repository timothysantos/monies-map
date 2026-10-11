// The one row of chips above the Ask composer (design.md "Ask page"), and
// the question line above it. Pure apart from the handlers it is given:
// which chips show follows the page's mode and the card's state.
//
// - Chat mode, no card: Scan receipt, Paste, Add entry, Add expense.
// - Add mode: "‹ Entries" (or Splits, Ask) first, back to where the person
//   came from; then a pending question's answers, or what fits the card:
//   Scan receipt, Paste, Transfer, Income on an empty expense; Split with
//   <partner>, Add a note, Different card once it has content; Swap
//   direction for a transfer; Edit in form last, to the Entries composer or
//   the Splits expense dialog.
// - Saved: the main way on first and filled (Back to Entries or Splits),
//   Open this entry, Open on Splits when it was shared, Undo. A card the
//   Apple Pay Shortcut saved offers Open this entry, then a category
//   question when it landed in Other, and Splits.

import { isCardEmpty, SHARED_OWNER } from "./ask-card-model";
import { askCopy, formatCardDate } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";

/** @typedef {{ key: string, label: string, onClick: () => void, primary?: boolean, back?: boolean, disabled?: boolean }} AskChip */

const MAX_OPTION_CHIPS = 4;
const NOT_A_SPEND_CATEGORY = new Set(["Other", "Transfer", "Income", "Salary", "Other - Income", "Extra Income", "Savings", "Investments"]);

export function describeQuestion(question, context) {
  if (!question) {
    return "";
  }
  if (question.reason === "foreign_currency" && question.foreignAmount) {
    return askCopy.questions.foreignAmount(moneyWithCurrency(question.foreignAmount.amountMinor, question.foreignAmount.currency));
  }
  if (question.reason === "transfer_from") {
    return askCopy.questions.transferFrom;
  }
  if (["unclear", "old_date", "future_date", "invalid_amount", "unsupported_currency"].includes(question.reason) && !question.options?.length) {
    const label = {
      description: askCopy.card.descriptionLabel,
      amountMinor: askCopy.card.amountLabel,
      date: askCopy.card.rows.date,
      accountId: askCopy.card.rows.wallet
    }[question.field];
    if (label) {
      return askCopy.questions.checkField(label);
    }
  }
  return askCopy.questions[question.field] ?? "";
}

export function describeOption(option, question, context, today) {
  if (option.date) {
    return formatCardDate(option.date, today, { withYear: false });
  }
  if (option.accountId) {
    return context.accounts?.find((account) => account.id === option.accountId)?.name ?? option.accountName ?? option.accountId;
  }
  if (typeof option.amountMinor === "number") {
    return moneyWithCurrency(option.amountMinor, option.currency ?? "SGD");
  }
  if (option.personName && typeof option.splitBasisPoints === "number") {
    return askCopy.shareOption(option.personName, Math.round(option.splitBasisPoints / 100));
  }
  if (option.personName) {
    return option.personName;
  }
  return option.value ?? "";
}

// The spend categories this month's entries use most, for a saved entry
// that landed in Other.
export function suggestCategories(entries, categories, limit = 3) {
  const counts = new Map();
  for (const entry of entries ?? []) {
    if (entry.entryType === "expense" && !NOT_A_SPEND_CATEGORY.has(entry.categoryName)) {
      counts.set(entry.categoryName, (counts.get(entry.categoryName) ?? 0) + 1);
    }
  }
  const known = new Set((categories ?? []).map((category) => category.name));
  const ranked = [...counts.entries()]
    .filter(([name]) => known.has(name))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);
  for (const category of (categories ?? []).slice().sort((left, right) => left.name.localeCompare(right.name))) {
    if (ranked.length >= limit) break;
    if (!NOT_A_SPEND_CATEGORY.has(category.name) && !ranked.includes(category.name)) {
      ranked.push(category.name);
    }
  }
  return ranked.slice(0, limit);
}

function backLabel(intent) {
  return askCopy.backLabels[intent.from] ?? askCopy.backLabels.entries;
}

function savedChips({ intent, card, context, splitGroups, entries, actions }) {
  /** @type {AskChip[]} */
  const items = [];
  let prompt = "";
  if (intent.savedEntryId) {
    items.push({ key: "open-entry", label: askCopy.chips.openEntry, primary: true, onClick: actions.openEntry });
    if (card.variant === "expense" && card.fields.categoryName === "Other") {
      prompt = askCopy.questions.otherCategory;
      for (const name of suggestCategories(entries, context.categories)) {
        items.push({ key: `category-${name}`, label: name, onClick: () => actions.category(name) });
      }
      items.push({ key: "choose-category", label: askCopy.chips.chooseCategory, onClick: actions.chooseCategory });
    }
    const canShare = card.variant === "expense" && !card.saved?.splitExpenseId && (context.people ?? []).length > 1 && splitGroups.length > 0;
    if (canShare) {
      prompt ||= askCopy.questions.shareOnSplits;
      if (splitGroups.length === 1) {
        items.push({ key: "share", label: askCopy.chips.shareOnSplits, onClick: () => actions.shareSaved(splitGroups[0].id) });
      } else {
        for (const group of splitGroups.slice(0, 3)) {
          items.push({ key: `share-${group.id}`, label: askCopy.chips.addToGroup(group.name), onClick: () => actions.shareSaved(group.id) });
        }
      }
    }
    if (card.saved?.splitExpenseId) {
      items.push({ key: "open-splits", label: askCopy.chips.openOnSplits, onClick: actions.openOnSplits });
    }
    return { items, prompt };
  }
  if (intent.from === "splits") {
    items.push({ key: "back-splits", label: askCopy.chips.backTo(askCopy.backLabels.splits), primary: true, onClick: actions.backToSplits });
  } else {
    items.push({ key: "back-entries", label: askCopy.chips.backTo(askCopy.backLabels.entries), primary: true, onClick: actions.backToEntries });
  }
  items.push({ key: "open-entry", label: askCopy.chips.openEntry, onClick: actions.openEntry });
  if (card.saved?.splitExpenseId) {
    items.push({ key: "open-splits", label: askCopy.chips.openOnSplits, onClick: actions.openOnSplits });
  }
  items.push({ key: "undo", label: askCopy.chips.undo, onClick: actions.undo });
  return { items, prompt };
}

export function buildAskChips({ intent, card, context, splitGroups = [], entries = [], today, partner = "", actions }) {
  const isAddMode = intent.mode !== "chat";
  if (!card) {
    if (intent.savedEntryId) {
      return { items: /** @type {AskChip[]} */ ([{ key: "back-entries", label: askCopy.chips.backTo(askCopy.backLabels.entries), primary: true, onClick: actions.backToEntries }]), prompt: "" };
    }
    return {
      items: /** @type {AskChip[]} */ ([
        { key: "scan", label: askCopy.chips.scanReceipt, onClick: actions.scanReceipt },
        { key: "paste", label: askCopy.chips.paste, onClick: actions.paste },
        { key: "add-entry", label: askCopy.chips.addEntry, onClick: actions.addEntry },
        { key: "add-expense", label: askCopy.chips.addExpense, onClick: actions.addExpense }
      ]),
      prompt: ""
    };
  }
  if (card.status === "saved") {
    return savedChips({ intent, card, context, splitGroups, entries, actions });
  }

  /** @type {AskChip[]} */
  const items = [];
  if (isAddMode) {
    items.push({ key: "back", label: askCopy.chips.back(backLabel(intent)), back: true, onClick: actions.back });
  }
  const question = card.questions?.[0] ?? null;
  let prompt = "";
  if (question) {
    prompt = describeQuestion(question, context);
    for (const [index, option] of (question.options ?? []).slice(0, MAX_OPTION_CHIPS).entries()) {
      const label = describeOption(option, question, context, today);
      if (label) {
        items.push({ key: `answer-${index}`, label, onClick: () => actions.answer(question, option) });
      }
    }
  } else if (card.variant === "transfer") {
    items.push({ key: "swap", label: askCopy.chips.swapDirection, onClick: actions.swap });
    items.push({ key: "note", label: askCopy.chips.addNote, onClick: actions.addNote });
  } else if (card.variant === "income") {
    items.push({ key: "note", label: askCopy.chips.addNote, onClick: actions.addNote });
    items.push({ key: "wallet", label: askCopy.chips.differentWallet, onClick: actions.differentWallet });
  } else if (isCardEmpty(card)) {
    items.push({ key: "scan", label: askCopy.chips.scanReceipt, onClick: actions.scanReceipt });
    items.push({ key: "paste", label: askCopy.chips.paste, onClick: actions.paste });
    items.push({ key: "transfer", label: askCopy.chips.transfer, onClick: () => actions.variant("transfer") });
    items.push({ key: "income", label: askCopy.chips.income, onClick: () => actions.variant("income") });
  } else {
    if ((context.people ?? []).length > 1 && card.fields.ownerName !== SHARED_OWNER) {
      items.push(card.share.on
        ? { key: "share-off", label: askCopy.chips.notShared, onClick: actions.shareOff }
        : { key: "share-on", label: partner ? askCopy.chips.splitWith(partner) : askCopy.chips.shareOnSplits, onClick: actions.shareOn });
    }
    items.push({ key: "note", label: askCopy.chips.addNote, onClick: actions.addNote });
    items.push({ key: "card", label: askCopy.chips.differentCard, onClick: actions.differentWallet });
  }
  if (isAddMode) {
    items.push({ key: "edit-in-form", label: askCopy.chips.editInForm, onClick: actions.editInForm });
  }
  return { items, prompt };
}

// The chip row while an answer, a follow-up question or a view change is
// the newest thing in the conversation (docs/flows/ask-flow.md "Search and
// filter"):
// - a follow-up question: its options only, with the question above;
// - a view change: Switch to <view> first and filled, then the usual chips;
// - an answer: Open in Entries first and filled, then the usual chips.
export function buildFilterChips({ focus, base, viewLabel = "", actions }) {
  const rest = base.items.map((item) => ({ ...item, primary: false }));
  if (focus.kind === "question") {
    const question = focus.questions[0];
    return {
      prompt: question.reason === "unknown" ? askCopy.filter.unknownCategoryQuestion(question.word) : askCopy.filter.questions[question.field] ?? "",
      items: /** @type {AskChip[]} */ (question.options.map((option) => ({
        key: `filter-${question.field}-${option.key}`,
        label: option.label,
        onClick: () => actions.chooseFilterOption(option)
      })))
    };
  }
  if (focus.kind === "view") {
    return {
      prompt: askCopy.filter.switchPrompt,
      items: /** @type {AskChip[]} */ ([{ key: "switch-view", label: askCopy.filter.switchTo(viewLabel), primary: true, onClick: actions.switchView }, ...rest])
    };
  }
  return {
    prompt: base.prompt,
    items: /** @type {AskChip[]} */ ([{ key: "open-in-entries", label: askCopy.chips.openInEntries, primary: true, onClick: actions.openInEntries }, ...rest])
  };
}
