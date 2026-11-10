import { useSyncExternalStore } from "react";

import { watchAppShell } from "./app-shell-watch";
import { createPreferenceStore } from "./viewer-preference-store";

// The order of Summary's cards under the top summary, and which are hidden
// (design.md "Arrange Summary"): each person's own display choice, kept per
// login like Plan or Simple (viewer-preference-store.js; POST
// /api/viewer-preferences/summary-cards, the app shell's `summaryCards`) and
// on the device without one. The top summary always stays first and is not
// one of them; Money insights can be moved but never hidden (owner decision
// D5), so a To do is never out of sight.
//
// Stored as one short string: "insights,mix,subs,plan,-accounts" (a leading
// "-" hides a card). Reading is forgiving: an unknown id is dropped, a card
// it does not name (one added later) goes back to its usual place, and the
// usual order is null (Reset).
export const SUMMARY_CARD_IDS = Object.freeze(["insights", "changed", "subs", "investments", "taxreliefs", "mix", "plan", "accounts", "miles"]);
export const SUMMARY_CARDS_STORAGE_KEY = "monies-map:summary-cards";
export const SUMMARY_CARDS_PATH = "/api/viewer-preferences/summary-cards";
const NEVER_HIDDEN = new Set(["insights"]);
const PATTERN = /^-?[a-z]{1,20}(?:,-?[a-z]{1,20}){0,11}$/;

export const isSummaryCardsValue = (value) => typeof value === "string" && value.length <= 120 && PATTERN.test(value);

/** The cards in their order, each { id, hidden }. */
export function readSummaryCards(value) {
  const listed = [];
  if (isSummaryCardsValue(value)) {
    for (const part of value.split(",")) {
      const hidden = part.startsWith("-");
      const id = hidden ? part.slice(1) : part;
      if (SUMMARY_CARD_IDS.includes(id) && !listed.some((card) => card.id === id)) {
        listed.push({ id, hidden: hidden && !NEVER_HIDDEN.has(id) });
      }
    }
  }
  // A card the stored order does not name goes back after the card that comes
  // before it in the usual order (or first).
  for (const [index, id] of SUMMARY_CARD_IDS.entries()) {
    if (listed.some((card) => card.id === id)) continue;
    const before = SUMMARY_CARD_IDS.slice(0, index).reverse().find((previous) => listed.some((card) => card.id === previous));
    const at = before ? listed.findIndex((card) => card.id === before) + 1 : 0;
    listed.splice(at, 0, { id, hidden: false });
  }
  return listed;
}

/** The stored string, or null for the usual order with nothing hidden. */
export function writeSummaryCards(cards) {
  const value = cards.map((card) => `${card.hidden && !NEVER_HIDDEN.has(card.id) ? "-" : ""}${card.id}`).join(",");
  return value === SUMMARY_CARD_IDS.join(",") ? null : value;
}

export const canHideSummaryCard = (id) => !NEVER_HIDDEN.has(id);

export function moveSummaryCard(cards, index, step) {
  const target = index + step;
  if (target < 0 || target >= cards.length) return cards;
  const next = [...cards];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function createSummaryCardsStore(options = {}) {
  return createPreferenceStore({ field: "summaryCards", storageKey: SUMMARY_CARDS_STORAGE_KEY, path: SUMMARY_CARDS_PATH, isValid: isSummaryCardsValue, ...options });
}

export const summaryCardsStore = createSummaryCardsStore();
watchAppShell((shell) => summaryCardsStore.applyShell(shell));

/**
 * [cards, save]: the cards in order, and the editor's Done (null resets).
 * @returns {[Array<{ id: string, hidden: boolean }>, (cards: Array<{ id: string, hidden: boolean }> | null) => void]}
 */
export function useSummaryCards() {
  const stored = useSyncExternalStore(summaryCardsStore.subscribe, summaryCardsStore.get, summaryCardsStore.get);
  return [readSummaryCards(stored), (cards) => { void summaryCardsStore.choose(cards ? writeSummaryCards(cards) : null); }];
}
