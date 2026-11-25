// Receipt match (DOMAIN.md "Receipt Match"): before Ask drafts a new entry
// from a receipt, the app looks for the entry that is probably this same
// purchase already in the ledger (an Apple Pay entry or its foreign-currency
// estimate, an entry a bank alert finished, an imported or statement row), or
// an Apple Pay tap still waiting for its amount. Deterministic and pure: the
// facts come from receipt-match-projection.ts (household rows only, bounded
// by date in SQL), no AI is called and nothing is written. The result is a
// change card (AskChange) that saves only through ASK_CHANGE_PATHS, a
// question with one chip per candidate, or nothing (draft a new entry).
//
// An entry is the same purchase when all hold:
// - its day is from RECEIPT_MATCH_DAYS_BEFORE before to RECEIPT_MATCH_DAYS_AFTER
//   after the receipt's date;
// - its amount is the receipt's total (same currency), or its kept Wallet
//   amount is (an Apple Pay estimate), or, in another currency, it is within
//   the Foreign Currency Estimate tolerance of the total at the saved rate;
// - its shop name agrees with the receipt's (merchantsAgree, a payment app
//   prefix such as "AMAZE*" dropped first). A blank name never agrees.
// A statement-certified entry is matched too: its bank facts never change,
// only its category and note.

import type { AskChange, AskChangeEntry, AskChangeRow, AskChangeStep } from "./ask-turn-actions";
import { formatForeignAmount } from "./foreign-currency";
import { formatEntryTime } from "../lib/entry-time";
import { merchantsAgree } from "./waiting-taps";
import {
  RECEIPT_MATCH_DAYS_AFTER,
  RECEIPT_MATCH_DAYS_BEFORE,
  RECEIPT_MATCH_ESTIMATE_MIN_MINOR,
  RECEIPT_MATCH_ESTIMATE_OVER,
  RECEIPT_MATCH_ESTIMATE_UNDER,
  RECEIPT_MATCH_MAX_CHOICES,
  RECEIPT_NOTE_MAX_CHARS
} from "./receipt-batch-config";
import type { EntryType } from "../types/dto";

// What the page sends: only fields the receipt reader validated.
export interface ReceiptMatchReceipt {
  merchant: string;
  date: string;
  totalMinor: number;
  currency: string;
  // Lines for the matched entry's note (the receipt's items, from the read
  // or the person's taps); "" when there are none.
  noteLines?: string[];
}

export interface ReceiptMatchEntryFact {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  entryType: EntryType;
  categoryName: string;
  accountName: string;
  note: string;
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  certified: boolean;
}

export interface ReceiptMatchTapFact {
  id: string;
  date: string;
  // "" for a bare tap (DOMAIN.md "Bare Tap"): no shop came through.
  merchant: string;
  accountName: string;
  // The household clock time it arrived, "HH:MM" ("" when unknown).
  time?: string;
}

// How many units of the receipt's currency one unit of the entry's buys
// (1 SGD = 14,025 IDR), from the saved rates; absent when none is saved.
export type ReceiptRates = Record<string, number>;

export interface ReceiptMatchOption {
  // The entry's id, or the waiting tap's id for kind "tap".
  id: string;
  kind: "entry" | "tap";
  // What a chip shows: the shop, the day and the amount as recorded.
  description: string;
  date: string;
  amountMinor: number | null;
  currency: string;
  certified: boolean;
  // The change Save makes; null when nothing would change (already there).
  change: AskChange | null;
}

export type ReceiptMatchResult =
  | { kind: "none" }
  | { kind: "one"; option: ReceiptMatchOption }
  | { kind: "several"; options: ReceiptMatchOption[] };

export function rateKey(entryCurrency: string, receiptCurrency: string) {
  return `${entryCurrency.toUpperCase()}:${receiptCurrency.toUpperCase()}`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The first and last day an entry for this receipt can be dated. */
export function receiptMatchWindow(date: string) {
  return { from: addDays(date, -RECEIPT_MATCH_DAYS_BEFORE), to: addDays(date, RECEIPT_MATCH_DAYS_AFTER) };
}

function inWindow(receiptDate: string, entryDate: string) {
  const offset = daysBetween(receiptDate, entryDate);
  return offset >= -RECEIPT_MATCH_DAYS_BEFORE && offset <= RECEIPT_MATCH_DAYS_AFTER;
}

// "AMAZE* LAWSON SHIBUYA" names the shop after the payment app's prefix.
function withoutPaymentPrefix(text: string) {
  return text.replace(/^\s*[A-Za-z0-9.]{2,12}\s*\*\s*/, "");
}

export function shopsAgree(receiptMerchant: string, entryText: string) {
  const left = receiptMerchant.trim();
  const right = entryText.trim();
  if (!left || !right) return false;
  return merchantsAgree(left, right) || merchantsAgree(left, withoutPaymentPrefix(right));
}

// 0: the same figure in the same currency or the kept Wallet amount; 1:
// within the estimate tolerance at the saved rate; null: not this purchase.
function amountFit(receipt: ReceiptMatchReceipt, entry: ReceiptMatchEntryFact, rates: ReceiptRates): { rank: number; gap: number } | null {
  const receiptCurrency = receipt.currency.toUpperCase();
  const amount = Math.abs(entry.amountMinor);
  if (entry.currency.toUpperCase() === receiptCurrency) {
    return amount === receipt.totalMinor ? { rank: 0, gap: 0 } : null;
  }
  if (entry.originalCurrency && entry.originalCurrency.toUpperCase() === receiptCurrency && entry.originalAmountMinor !== null) {
    return Math.abs(entry.originalAmountMinor) === receipt.totalMinor ? { rank: 0, gap: 0 } : null;
  }
  const quotePerBase = rates[rateKey(entry.currency, receiptCurrency)];
  if (!(quotePerBase > 0)) return null;
  const estimate = Math.round(receipt.totalMinor / quotePerBase);
  const over = Math.max(RECEIPT_MATCH_ESTIMATE_MIN_MINOR, Math.round(estimate * RECEIPT_MATCH_ESTIMATE_OVER));
  const under = Math.max(RECEIPT_MATCH_ESTIMATE_MIN_MINOR, Math.round(estimate * RECEIPT_MATCH_ESTIMATE_UNDER));
  return amount >= estimate - under && amount <= estimate + over ? { rank: 1, gap: Math.abs(amount - estimate) } : null;
}

// The receipt's lines for the note: what was paid in the receipt's own
// currency when the entry does not keep it, then any item lines.
export function receiptNoteLines(receipt: ReceiptMatchReceipt, entry: Pick<ReceiptMatchEntryFact, "currency" | "originalCurrency">) {
  const lines: string[] = [];
  const foreign = receipt.currency.toUpperCase() !== entry.currency.toUpperCase();
  const kept = Boolean(entry.originalCurrency && entry.originalCurrency.toUpperCase() === receipt.currency.toUpperCase());
  if (foreign && !kept) {
    lines.push(RECEIPT_MATCH_COPY.paidLine(formatForeignAmount(receipt.totalMinor, receipt.currency.toUpperCase())));
  }
  for (const line of receipt.noteLines ?? []) {
    const text = String(line).replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  }
  return lines;
}

// The entry's note with the receipt's lines after it, once: lines the note
// already has are not added again. Bounded by RECEIPT_NOTE_MAX_CHARS.
export function noteWithReceipt(before: string, lines: string[]) {
  const existing = new Set(before.split("\n").map((line) => line.trim()));
  const added = lines.filter((line) => !existing.has(line));
  if (!added.length) return before;
  let text = added.join("\n");
  if (text.length > RECEIPT_NOTE_MAX_CHARS) {
    text = `${text.slice(0, RECEIPT_NOTE_MAX_CHARS - 1).trimEnd()}…`;
  }
  return before.trim() ? `${before.trimEnd()}\n${text}` : text;
}

function entryRow(entry: ReceiptMatchEntryFact): AskChangeEntry {
  return {
    entryId: entry.id,
    date: entry.date,
    description: entry.description,
    amountMinor: Math.abs(entry.amountMinor),
    currency: entry.currency,
    categoryName: entry.categoryName,
    accountName: entry.accountName,
    entryType: entry.entryType
  };
}

/**
 * What Save does to a matched entry: the receipt's lines into its note, and
 * the shop's habitual category when it sits in a catch-all one. Bank facts
 * (amount, date, description, wallet) are never touched, so a
 * statement-certified entry can take it too. null when nothing would change.
 */
export function buildEntryReceiptChange(
  receipt: ReceiptMatchReceipt,
  entry: ReceiptMatchEntryFact,
  options: { habitCategory?: string | null; catchAll?: ReadonlySet<string> } = {}
): AskChange | null {
  const rows: AskChangeRow[] = [];
  const save: AskChangeStep[] = [];
  const undo: AskChangeStep[] = [];
  const category = options.habitCategory && options.catchAll?.has(entry.categoryName) && options.habitCategory !== entry.categoryName && entry.entryType === "expense"
    ? options.habitCategory
    : null;
  if (category) {
    rows.push({ field: "category", before: entry.categoryName, after: category });
    save.push({ path: "/api/entries/update-category", body: { changes: [{ entryId: entry.id, fromCategoryName: entry.categoryName, categoryName: category }] } });
    undo.push({ path: "/api/entries/update-category", body: { changes: [{ entryId: entry.id, fromCategoryName: category, categoryName: entry.categoryName }] } });
  }
  const note = noteWithReceipt(entry.note, receiptNoteLines(receipt, entry));
  if (note !== entry.note) {
    rows.push({ field: "note", before: entry.note, after: note });
    save.push({ path: "/api/entries/update-note", body: { entryId: entry.id, note } });
    undo.push({ path: "/api/entries/update-note", body: { entryId: entry.id, note: entry.note } });
  }
  if (!rows.length) return null;
  return {
    type: "receipt_match",
    title: entry.description,
    rows,
    entries: [entryRow(entry)],
    count: 1,
    confirmCount: null,
    save,
    undo: undo.reverse(),
    rule: null,
    month: entry.date.slice(0, 7),
    refresh: category ? ["entries", "month", "summary"] : ["entries"]
  };
}

// "12.50", "3240": the receipt's total as the waiting-tap command reads it.
function majorText(minor: number) {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** A waiting Apple Pay tap finished with the receipt's total (/api/waiting-taps/complete). */
export function buildTapReceiptChange(receipt: ReceiptMatchReceipt, tap: ReceiptMatchTapFact): AskChange {
  const currency = receipt.currency.toUpperCase();
  // A bare tap takes the receipt's shop as well as its total.
  const bare = !tap.merchant.trim();
  return {
    type: "receipt_tap",
    title: bare ? receipt.merchant : tap.merchant,
    rows: [{ field: "amount", before: "", after: "", afterMinor: receipt.totalMinor, currency }],
    entries: [],
    count: 1,
    confirmCount: null,
    save: [{
      path: "/api/waiting-taps/complete",
      body: { tapId: tap.id, amount: majorText(receipt.totalMinor), currency, ...(bare ? { merchant: receipt.merchant } : {}) }
    }],
    undo: null,
    rule: null,
    month: tap.date.slice(0, 7),
    refresh: ["entries", "month", "summary"]
  };
}

/**
 * The entries (else the waiting taps) that are probably this receipt's
 * purchase, surest first: the same figure before an estimate, then the
 * nearest day, then the nearest amount. One is "one"; two or more are
 * "several" (at most RECEIPT_MATCH_MAX_CHOICES), asked as chips.
 */
export function chooseReceiptMatch(
  receipt: ReceiptMatchReceipt,
  facts: { entries: ReceiptMatchEntryFact[]; taps: ReceiptMatchTapFact[]; rates: ReceiptRates; habitCategory?: string | null; catchAll?: ReadonlySet<string> }
): ReceiptMatchResult {
  if (!receipt.merchant.trim() || !(receipt.totalMinor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.date) || !/^[A-Z]{3}$/i.test(receipt.currency)) {
    return { kind: "none" };
  }
  const fits = facts.entries
    .filter((entry) => entry.entryType === "expense" && inWindow(receipt.date, entry.date) && shopsAgree(receipt.merchant, entry.description))
    .map((entry) => ({ entry, fit: amountFit(receipt, entry, facts.rates) }))
    .filter((item): item is { entry: ReceiptMatchEntryFact; fit: { rank: number; gap: number } } => item.fit !== null)
    .sort((left, right) => left.fit.rank - right.fit.rank
      || Math.abs(daysBetween(receipt.date, left.entry.date)) - Math.abs(daysBetween(receipt.date, right.entry.date))
      || left.fit.gap - right.fit.gap
      || left.entry.id.localeCompare(right.entry.id));
  const entryOptions: ReceiptMatchOption[] = fits.map(({ entry }) => ({
    id: entry.id,
    kind: "entry",
    description: entry.description,
    date: entry.date,
    amountMinor: Math.abs(entry.amountMinor),
    currency: entry.currency,
    certified: entry.certified,
    change: buildEntryReceiptChange(receipt, entry, { habitCategory: facts.habitCategory, catchAll: facts.catchAll })
  }));
  const options = entryOptions.length
    ? entryOptions
    : facts.taps
      .filter((tap) => inWindow(receipt.date, tap.date) && shopsAgree(receipt.merchant, tap.merchant))
      .sort((left, right) => Math.abs(daysBetween(receipt.date, left.date)) - Math.abs(daysBetween(receipt.date, right.date)) || left.id.localeCompare(right.id))
      .map((tap): ReceiptMatchOption => ({
        id: tap.id,
        kind: "tap",
        description: tap.merchant,
        date: tap.date,
        amountMinor: null,
        currency: receipt.currency.toUpperCase(),
        certified: false,
        change: buildTapReceiptChange(receipt, tap)
      }));
  if (!options.length) {
    // Bare taps (no shop to compare): only on the receipt's own day, and
    // always asked with a chip each, even when one fits. A receipt names
    // no card or person, so the chip names the card and time to choose by.
    const bare = facts.taps
      .filter((tap) => !tap.merchant.trim() && tap.date === receipt.date)
      .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? "") || left.id.localeCompare(right.id))
      .map((tap): ReceiptMatchOption => ({
        id: tap.id,
        kind: "tap",
        description: RECEIPT_MATCH_COPY.bareTap(tap.accountName, tap.time ?? ""),
        date: tap.date,
        amountMinor: null,
        currency: receipt.currency.toUpperCase(),
        certified: false,
        change: buildTapReceiptChange(receipt, tap)
      }));
    return bare.length ? { kind: "several", options: bare.slice(0, RECEIPT_MATCH_MAX_CHOICES) } : { kind: "none" };
  }
  if (options.length === 1) return { kind: "one", option: options[0] };
  return { kind: "several", options: options.slice(0, RECEIPT_MATCH_MAX_CHOICES) };
}

// The words the server writes into a note (plain words; the page has its own).
export const RECEIPT_MATCH_COPY = {
  paidLine: (amount: string) => `Receipt: paid ${amount}.`,
  // A bare tap's chip: "Payment on Citi Rewards at 6:54 pm".
  bareTap: (accountName: string, time: string) => `Payment on ${accountName || "a card"}${formatEntryTime(time) ? ` at ${formatEntryTime(time)}` : ""}`
};
