// The Ask card's card suggestion (DOMAIN.md "Card Suggestion";
// docs/flows/ask-flow.md "Card suggestion"). Pure: which card asks the server
// (POST /api/entries/card-suggestion, ask-api.js requestCardSuggestion), and
// which answers the card can act on. The question and its chips are in
// ask-chips.js; answering is in ask-card-model.js and the panel. Nothing
// here changes a card: only the person's "Yes" does.
//
// - A draft expense with a shop typed in "What it was" and a card chosen asks
//   with those fields. A card the Apple Pay Shortcut saved asks by its entry
//   id, until it is on Splits (a split entry's card is not changed from here).
// - A card that was answered ("accepted" or "declined") never asks again.

import { SHARED_OWNER } from "./ask-card-model";

/**
 * The body to ask the server with, or null when there is nothing to ask.
 * @returns {null | { entryId: string } | { description: string, accountId: string, date: string }}
 */
export function cardSuggestionRequestFor(card) {
  if (!card || card.variant !== "expense" || card.cardSuggestionAnswer) {
    return null;
  }
  if (card.status === "saved") {
    // Only the Apple Pay card: a card Ask saved was already asked as a draft.
    if (card.origin !== "saved" || !card.saved?.entryId || card.saved.splitExpenseId || card.fields.ownerName === SHARED_OWNER) {
      return null;
    }
    return { entryId: card.saved.entryId };
  }
  const description = card.fields.description.trim();
  if (card.status !== "draft" || !description || !card.fields.accountId || !card.fields.date) {
    return null;
  }
  return { description, accountId: card.fields.accountId, date: card.fields.date };
}

/** The server's answer, checked; anything else is no suggestion. */
export function readCardSuggestionResponse(body) {
  const suggestion = body?.ok === true ? body.suggestion : null;
  if (!suggestion || typeof suggestion !== "object") {
    return null;
  }
  const texts = ["accountId", "accountName", "currentAccountId", "currentAccountName", "merchant"];
  if (texts.some((key) => typeof suggestion[key] !== "string" || !suggestion[key]) || !Number.isInteger(suggestion.entryCount) || !Number.isInteger(suggestion.matchedCount)) {
    return null;
  }
  return {
    accountId: suggestion.accountId,
    accountName: suggestion.accountName,
    currentAccountId: suggestion.currentAccountId,
    currentAccountName: suggestion.currentAccountName,
    merchant: suggestion.merchant,
    entryCount: suggestion.entryCount,
    matchedCount: suggestion.matchedCount
  };
}

// A suggestion the card can act on: the card it was asked about is still
// the card chosen, and the suggested one is a card the page knows.
export function usableCardSuggestion(suggestion, card, context) {
  if (!suggestion || !card || suggestion.currentAccountId !== card.fields.accountId || suggestion.accountId === card.fields.accountId) {
    return null;
  }
  return (context.accounts ?? []).some((account) => account.id === suggestion.accountId && account.isActive !== false) ? suggestion : null;
}
