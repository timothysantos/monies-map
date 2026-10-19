// The Ask card's split suggestion (DOMAIN.md "Split Suggestion";
// docs/flows/ask-flow.md "Split suggestion"). Pure: which card asks the
// server (POST /api/splits/suggestion, ask-api.js requestSplitSuggestion),
// and which answers the card can act on. The question and its chips are
// in ask-chips.js; choosing or declining is in ask-card-model.js.
//
// - A draft expense with one owner, something typed in "What it was", and
//   Splits off asks with its fields. A card the Apple Pay Shortcut saved
//   asks by its entry id until it is on Splits.
// - A card that was answered ("accepted" or "declined") never asks again.
// - Only an even share is offered: the Splits switch and Add to Splits save
//   50/50 (the add-to-splits route), so a 70/30 habit is not something the
//   card can repeat.

import { SHARED_OWNER } from "./ask-card-model";
import { askCopy } from "./copy/ask-copy";

const EVEN_SHARE = 5000;

function isPerson(context, name) {
  return Boolean(name) && name !== SHARED_OWNER && (context.people ?? []).some((person) => person.name === name);
}

/**
 * The body to ask the server with, or null when there is nothing to ask.
 * @returns {null | { entryId: string } | { entryType: string, description: string, categoryName: string, ownerName: string, accountId: string, date: string }}
 */
export function splitSuggestionRequestFor(card, context) {
  if (!card || card.variant !== "expense" || card.splitSuggestionAnswer || (context.people ?? []).length < 2) {
    return null;
  }
  if (card.status === "saved") {
    // Only the Apple Pay card: a card Ask saved was already asked as a draft.
    if (card.origin !== "saved" || !card.saved?.entryId || card.saved.splitExpenseId) {
      return null;
    }
    return { entryId: card.saved.entryId };
  }
  const description = card.fields.description.trim();
  if (card.status !== "draft" || card.share.on || !description || !isPerson(context, card.fields.ownerName)) {
    return null;
  }
  return {
    entryType: card.variant,
    description,
    categoryName: card.fields.categoryName,
    ownerName: card.fields.ownerName,
    accountId: card.fields.accountId,
    date: card.fields.date
  };
}

/** The server's answer, checked; anything else is no suggestion. */
export function readSplitSuggestionResponse(body) {
  const suggestion = body?.ok === true ? body.suggestion : null;
  if (!suggestion || typeof suggestion !== "object") {
    return null;
  }
  const texts = ["groupId", "groupName", "otherPersonId", "otherPersonName"];
  const counts = ["basisPoints", "evidenceCount", "matchedCount"];
  if (texts.some((key) => typeof suggestion[key] !== "string" || !suggestion[key]) || counts.some((key) => !Number.isInteger(suggestion[key]))) {
    return null;
  }
  return {
    groupId: suggestion.groupId,
    groupName: suggestion.groupName,
    basisPoints: suggestion.basisPoints,
    otherPersonId: suggestion.otherPersonId,
    otherPersonName: suggestion.otherPersonName,
    evidenceCount: suggestion.evidenceCount,
    matchedCount: suggestion.matchedCount,
    matchedBy: suggestion.matchedBy === "category" ? "category" : "description"
  };
}

// A suggestion the card can act on: an even share, in a group its Splits
// switch offers.
export function usableSplitSuggestion(suggestion, splitGroups = []) {
  if (!suggestion || suggestion.basisPoints !== EVEN_SHARE || !splitGroups.some((group) => group.id === suggestion.groupId)) {
    return null;
  }
  return suggestion;
}

// "Half each" for an even share (the app never says 50/50); otherwise the
// payer's share, then the other person's ("70/30").
export function formatSuggestedShare(basisPoints) {
  const percent = Math.round(basisPoints / 100);
  return percent === 50 ? askCopy.chips.halfEach : `${percent}/${100 - percent}`;
}
