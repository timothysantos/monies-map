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
//
// The registry below is also the dashboard layout (design.md "Summary
// dashboard layout" and "Summary tiles"): each card carries its default `span`
// of the 12-column grid (4 a third, 6 a half, 8 two thirds, 12 the row), the
// narrowest width worth giving it, and its tile. A moved card keeps its span.
// One registered card has both its card form and its tile form (a small
// glance that opens the card in a sheet or dialog): `tile` says where the tile
// replaces the card (`on: "always"`, or `"phone"` for a card that is a full
// card on a desktop) and the sheet's hash (`#summary-<id>`). `tileOnly` is a
// tile whose card form is only the sheet (Coming up opens Subscriptions and
// bills on its Coming up tab). A card with no tile says `noTile: true`: the
// registry test needs one or the other.
/**
 * One row of a tile's list: a label, its value and, optionally, a tone.
 * @typedef {{ label: string, value: string, tone?: string }} SummaryTileRow
 * The small tile's content (summary-tiles-model.js): a title, a headline, one
 * status chip, and 3 or 4 `rows`, a small `chart` (series of numbers), `bars`
 * or `chips`. About 284px tall on a desktop, about 256px and two across on a
 * phone.
 * @typedef {{ span: 4, title: string, headline: string, line: string, rows?: SummaryTileRow[], chart?: number[], bars?: Array<{ label: string, share: number }>, chips?: string[] }} SummaryTile
 * @typedef {{ on: "always" | "phone", tileOnly?: boolean }} SummaryTileForm
 * @typedef {{ span: 4 | 6 | 8 | 12, minWidth: number, tile?: SummaryTileForm, noTile?: true }} SummaryCardLayout
 */
/** @type {Readonly<Record<string, SummaryCardLayout>>} */
export const SUMMARY_CARD_LAYOUT = Object.freeze({
  insights: { span: 4, minWidth: 280, noTile: true },
  plan: { span: 8, minWidth: 480, noTile: true },
  changed: { span: 4, minWidth: 280, noTile: true },
  mix: { span: 6, minWidth: 360, noTile: true },
  subs: { span: 6, minWidth: 360, tile: { on: "phone" } },
  coming: { span: 6, minWidth: 360, tile: { on: "always", tileOnly: true } },
  investments: { span: 6, minWidth: 360, tile: { on: "always" } },
  miles: { span: 6, minWidth: 360, tile: { on: "always" } },
  taxreliefs: { span: 6, minWidth: 360, tile: { on: "always" } },
  bankfees: { span: 6, minWidth: 360, tile: { on: "always", tileOnly: true } },
  accounts: { span: 6, minWidth: 360, noTile: true }
});
export const SUMMARY_CARD_IDS = Object.freeze(Object.keys(SUMMARY_CARD_LAYOUT));
/** The sheet's hash for a card's tile: ASCII letters and hyphens only. */
export const summaryTileHash = (id) => `#summary-${id}`;
/** The card whose tile a hash names, or "" (not a tile, or not a registered one). */
export function summaryTileFromHash(hash) {
  const match = /^#summary-([a-z]{1,20})$/.exec(hash ?? "");
  return match && SUMMARY_CARD_LAYOUT[match[1]]?.tile ? match[1] : "";
}
/** Whether a card draws as its tile where `isDesktop` says how wide the page is. */
export const showsAsTile = (id, isDesktop) => {
  const tile = SUMMARY_CARD_LAYOUT[id]?.tile;
  return Boolean(tile) && (tile.on === "always" || !isDesktop);
};
/** The lead (spent, earned, kept) sits beside the first card when that card is a third wide. */
export const SUMMARY_LEAD_SPAN = 8;
export const SUMMARY_GRID_COLUMNS = 12;

// Columns a card takes on a grid of `columns` (12 wide, 2 for a tablet, 1 for
// a phone): the same share of the row, and a card two thirds or wider takes
// both tablet columns.
export function summarySpanFor(span, columns) {
  if (columns >= SUMMARY_GRID_COLUMNS) return Math.min(span, columns);
  if (columns === 1) return 1;
  return span >= 8 ? columns : 1;
}

/**
 * The spans each shown card takes, first to last, in the person's order
 * (`spans` are the default spans). Rows fill left to right in order, never out
 * of it; the last card of a row that does not fill it grows to the end, so a
 * hidden card leaves no hole. The lead is the first item.
 * @param {number[]} spans
 * @param {number} columns
 */
export function packSummarySpans(spans, columns) {
  const taken = spans.map((span) => summarySpanFor(span, columns));
  let rowStart = 0;
  let used = 0;
  const closeRow = (end) => {
    if (end > rowStart) taken[end - 1] += columns - used;
  };
  taken.forEach((span, index) => {
    if (used + span > columns) {
      closeRow(index);
      rowStart = index;
      used = 0;
    }
    used += span;
  });
  closeRow(taken.length);
  return taken;
}
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
