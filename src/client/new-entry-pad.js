// How a new entry leads to the Just paid pad (docs/flows/cash-entry-flow.md
// "Amount first"; design.md "Cash pad"). The switches live in
// quick-pad-config.ts (NEW_ENTRY_PAD); the decisions here are pure so the
// unit tests can read every case. Lazy with Ask.

import { NEW_ENTRY_PAD } from "../domain/quick-pad-config";
import { isCardEmpty } from "./ask-card-model";

/** @typedef {{ openPadOnNewEntry: boolean, amountOpensPad: boolean, justPaidFirst: boolean, emptyEntryLow: boolean }} NewEntryPadConfig */

// The switches, with a test override outside production builds:
// window.__MONIES_MAP_NEW_ENTRY_PAD__ = { openPadOnNewEntry: false, ... }.
/** @returns {NewEntryPadConfig} */
export function newEntryPadConfig() {
  const override = import.meta.env?.MODE !== "production" && typeof window !== "undefined"
    // @ts-ignore: a test-only global
    ? window.__MONIES_MAP_NEW_ENTRY_PAD__
    : null;
  return { ...NEW_ENTRY_PAD, ...(override && typeof override === "object" ? override : {}) };
}

// How Ask knows the plain + from Entries brought it: the place the + kept
// rides on the history entry as `askOrigin` with `from: "entries"`
// (App.jsx openAskFromPage, ask-origin.js), and only the phone's Entries +
// hands one from Entries. A link to a new entry, a shared receipt, pasted
// text, Ask's own Add entry and an edit all reach Ask without it, so the
// first screen carries nothing new. Ask then marks the entry with
// PAD_SHOWN_STATE, so a reload or a way back does not open the pad again.
export const PAD_SHOWN_STATE = "newEntryPadShown";

/**
 * Whether Ask opens the pad as the new entry appears: a phone, the plain +
 * from Entries not yet used, a new entry nobody has started, and the switch
 * on.
 * @param {{ intent: { mode: string, from: string, savedEntryId?: string }, state: any, card: any, isPhone: boolean, config: NewEntryPadConfig }} input
 */
export function shouldOpenPadOnArrival({ intent, state, card, isPhone, config }) {
  return Boolean(
    config.openPadOnNewEntry
    && isPhone
    && isEmptyNewExpense(card)
    && intent.mode === "add"
    && intent.from === "entries"
    && !intent.savedEntryId
    && state?.askOrigin?.from === "entries"
    && state?.[PAD_SHOWN_STATE] !== true
  );
}

/**
 * Whether the card's amount opens the pad instead of being typed in place:
 * a phone, a new entry (not the Splits receipt button's expense, whose
 * Splits switch matters before the amount), a draft expense nobody has
 * started (no words, no amount, not from a message, receipt or saved
 * entry), and the switch on.
 * @param {{ intent: { mode: string }, card: any, isPhone: boolean, config: NewEntryPadConfig }} input
 */
export function amountOpensPad({ intent, card, isPhone, config }) {
  return Boolean(config.amountOpensPad && isPhone && intent.mode === "add" && isEmptyNewExpense(card));
}

/**
 * Whether the empty new entry sits low, just above the chips, with its
 * detail rows folded. The same entries as above, and only while nothing on
 * it was changed and no row's picker is open: a date or wallet chip changed,
 * or a chip opening its row, brings the rows back.
 * @param {{ intent: { mode: string }, card: any, isPhone: boolean, rowsInUse?: boolean, config: NewEntryPadConfig }} input
 */
export function emptyEntrySitsLow({ intent, card, isPhone, rowsInUse = false, config }) {
  return Boolean(config.emptyEntryLow && isPhone && intent.mode === "add" && !rowsInUse && !card?.touched && isEmptyNewExpense(card));
}

/**
 * Whether Just paid leads the chips (first, filled) on an empty new entry.
 * @param {{ intent: { mode: string }, config: NewEntryPadConfig }} input
 */
export function justPaidLeads({ intent, config }) {
  return Boolean(config.justPaidFirst && intent.mode === "add");
}

function isEmptyNewExpense(card) {
  return Boolean(card && card.status === "draft" && card.variant === "expense" && isCardEmpty(card));
}
