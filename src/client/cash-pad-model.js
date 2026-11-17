// The quick pad's view model (design.md "Cash pad"), pure: the quiet line,
// "Paid with", the Again chips, the waiting taps, the chips after Save, the
// rows that need a few words, the waiting list's labels and the Save body.
// The pad component only draws what this returns.

import { formatCashAmount, formatCashFigure, padTextToMinor } from "../domain/cash-entry";
import { cashPadCopy } from "./copy/cash-pad-copy";

const NOT_A_CHIP = new Set(["Other", "Other - Income", "Transfer", "Income", "Salary", "Extra Income", "Savings", "Investments"]);
export const CASH_CATEGORY_CHIPS = 3;

/**
 * The quiet line under the title: "Tim's cash · IDR · Today · Tim", or the
 * card's name when it was paid by card: "UOB One · IDR · Today · Tim".
 * @param {{ walletName?: string | null, currency: string, date: string, today: string, personName: string }} input
 */
export function describeCashLine({ walletName, currency, date, today, personName }) {
  const day = date === today ? cashPadCopy.today : cashPadCopy.yesterday;
  return [walletName || cashPadCopy.chooseWallet, currency, day, personName].filter(Boolean);
}

/**
 * "Paid with": Cash first, then the person's own cards as the server
 * ordered them (most recently used first). Names only.
 * @param {Array<{ id: string, name: string }>} cards
 */
export function payWayChoices(cards = []) {
  return [{ value: "cash", label: cashPadCopy.cash }, ...cards.map((card) => ({ value: card.id, label: card.name }))];
}

/** "Periplus Bali, 14:02": a tap Apple Pay sent without its amount. */
export function tapButtonLabel(tap) {
  return cashPadCopy.taps.button(tap.merchant, tap.time);
}

/**
 * One payment that needs a few words: "Rp 85,000 · 14:02 · UOB One";
 * while money is hidden, no figure: "14:02 · UOB One".
 */
export function quickRowLabel(entry, areTotalsVisible, today) {
  const when = entry.time || (entry.date === today ? cashPadCopy.today : entry.date);
  return [areTotalsVisible ? formatCashAmount(entry.amountMinor, entry.currency) : "", when, entry.accountName].filter(Boolean).join(" · ");
}

/** "Coffee 35,000"; names only while money is hidden. */
export function againChipLabel(chip, areTotalsVisible) {
  return areTotalsVisible ? `${chip.description} ${formatCashFigure(chip.amountMinor, chip.currency)}` : chip.description;
}

/** "Coffee, Rp 35,000"; the name only while money is hidden. */
export function savedWhat({ description, amountMinor, currency }, areTotalsVisible) {
  return areTotalsVisible ? `${description}, ${formatCashAmount(amountMinor, currency)}` : description;
}

/**
 * The category chips after Save, in the Category Guess order: the guess for
 * the description first, then the person's most used cash categories, each
 * once, never the category it already has or a catch-all, and only the
 * household's own categories.
 */
export function cashCategoryChips({ current, guess = null, usual = [], categoryNames = [] }) {
  const known = new Set(categoryNames);
  const chips = [];
  for (const name of [guess, ...usual]) {
    if (!name || NOT_A_CHIP.has(name) || name === current || !known.has(name) || chips.includes(name)) continue;
    chips.push(name);
    if (chips.length >= CASH_CATEGORY_CHIPS) break;
  }
  return chips;
}

/**
 * The Save body. `again` (an Again chip the person tapped) fills the
 * description, category and note; the amount is what is on the pad.
 * `cardId`: paid by one of the person's cards. `tapId`: the amount for a
 * waiting Apple Pay tap (its shop and card come from the tap).
 * `newPayment`: saved although a tap on that card waits.
 */
export function buildCashBody({ requestId, personId, padText, currency, date, accountId = "", again = null, cardId = "", tapId = "", newPayment = false }) {
  const amountMinor = padTextToMinor(padText, currency);
  if (!amountMinor) return null;
  if (tapId) {
    return { requestId, personId, amountMinor, currency, date, tapId };
  }
  return {
    requestId,
    personId,
    amountMinor,
    currency,
    date,
    ...(cardId ? { way: "card", accountId: cardId } : accountId ? { accountId } : {}),
    ...(cardId && newPayment ? { newPayment: true } : {}),
    ...(again?.description ? { description: again.description } : {}),
    ...(again?.categoryName && again.categoryName !== "Other" ? { categoryName: again.categoryName } : {}),
    ...(again?.note ? { note: again.note } : {})
  };
}

/** "Rp 35,000" on a pad that typed "35000" (whole units, grouped). */
export function padAmountText(padText, currency) {
  const minor = padTextToMinor(padText, currency);
  return minor ? formatCashAmount(minor, currency) : formatCashAmount(0, currency);
}
