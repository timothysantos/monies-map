// The facts a receipt match reads (receipt-match.ts): the household's own
// expense entries and waiting Apple Pay taps dated around the receipt,
// bounded by date and LIMIT in SQL, the saved day rate between the receipt's
// currency and each entry currency, and the shop's habitual category.
// Read-only; three or four small queries, never a whole table.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { loadAskHabits } from "./app-repository-ask-habits";
import { ASK_CATCH_ALL_CATEGORIES, habitConfidence, habitMerchantKey, type AskCategoryHabitValue } from "./ask-habits";
import { RECEIPT_MATCH_MAX_ROWS, RECEIPT_MATCH_RATE_MAX_AGE_DAYS } from "./receipt-batch-config";
import {
  chooseReceiptMatch,
  rateKey,
  receiptMatchWindow,
  type ReceiptMatchEntryFact,
  type ReceiptMatchReceipt,
  type ReceiptMatchResult,
  type ReceiptMatchTapFact,
  type ReceiptRates
} from "./receipt-match";
import type { EntryType } from "../types/dto";

interface EntryRow {
  id: string;
  transaction_date: string;
  description: string;
  amount_minor: number;
  currency: string;
  entry_type: EntryType;
  category_name: string | null;
  account_name: string | null;
  note: string | null;
  original_amount_minor: number | null;
  original_currency: string | null;
  bank_certification_status: string | null;
}

// Only rows whose amount can fit: the same figure in the receipt's currency,
// the same kept Wallet amount, or an entry in another currency (compared at
// the saved rate in receipt-match.ts).
async function loadEntries(db: D1Database, householdId: string, window: { from: string; to: string }, receipt: { currency: string; totalMinor: number }): Promise<ReceiptMatchEntryFact[]> {
  const result = await db
    .prepare(`
      SELECT t.id, t.transaction_date, t.description, t.amount_minor, t.currency, t.entry_type,
        c.name AS category_name, a.account_name, t.note, t.original_amount_minor, t.original_currency,
        t.bank_certification_status
      FROM transactions AS t
      LEFT JOIN accounts AS a ON a.id = t.account_id
      LEFT JOIN categories AS c ON c.id = t.category_id
      LEFT JOIN imports AS i ON i.id = t.import_id
      WHERE t.household_id = ? AND t.entry_type = 'expense'
        AND t.transaction_date >= ? AND t.transaction_date <= ?
        AND (t.import_id IS NULL OR i.status = 'completed')
        AND ((upper(t.currency) = ? AND abs(t.amount_minor) = ?)
          OR (upper(t.original_currency) = ? AND abs(t.original_amount_minor) = ?)
          OR upper(t.currency) <> ?)
      ORDER BY t.transaction_date, t.id
      LIMIT ${RECEIPT_MATCH_MAX_ROWS}
    `)
    .bind(householdId, window.from, window.to, receipt.currency, receipt.totalMinor, receipt.currency, receipt.totalMinor, receipt.currency)
    .all<EntryRow>();
  return result.results.map((row) => ({
    id: row.id,
    date: row.transaction_date,
    description: row.description ?? "",
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency ?? "SGD").toUpperCase(),
    entryType: row.entry_type,
    categoryName: row.category_name ?? "Other",
    accountName: row.account_name ?? "",
    note: row.note ?? "",
    originalAmountMinor: row.original_amount_minor === null ? null : Number(row.original_amount_minor),
    originalCurrency: row.original_currency ? String(row.original_currency).toUpperCase() : null,
    certified: row.bank_certification_status === "statement_certified"
  }));
}

// Waiting taps are additive (DOMAIN.md "Waiting Tap"): none when the table
// is missing.
async function loadTaps(db: D1Database, householdId: string, window: { from: string; to: string }): Promise<ReceiptMatchTapFact[]> {
  try {
    const result = await db
      .prepare(`
        SELECT w.id, w.tap_date, w.merchant, a.account_name
        FROM waiting_taps AS w
        LEFT JOIN accounts AS a ON a.id = w.account_id
        WHERE w.household_id = ? AND w.status = 'waiting' AND w.tap_date >= ? AND w.tap_date <= ?
        ORDER BY w.tap_date, w.id
        LIMIT ${RECEIPT_MATCH_MAX_ROWS}
      `)
      .bind(householdId, window.from, window.to)
      .all<{ id: string; tap_date: string; merchant: string; account_name: string | null }>();
    return result.results.map((row) => ({ id: row.id, date: row.tap_date, merchant: row.merchant ?? "", accountName: row.account_name ?? "" }));
  } catch {
    return [];
  }
}

// The saved rates (fx_rates, a cache) from each entry currency to the
// receipt's; a rate older than RECEIPT_MATCH_RATE_MAX_AGE_DAYS is not used.
async function loadRates(db: D1Database, receiptCurrency: string, entryCurrencies: string[], now: number): Promise<ReceiptRates> {
  const bases = [...new Set(entryCurrencies.filter((currency) => currency !== receiptCurrency))];
  if (!bases.length) return {};
  try {
    const result = await db
      .prepare(`SELECT base_currency, quote_per_base, fetched_at FROM fx_rates WHERE quote_currency = ? AND base_currency IN (${bases.map(() => "?").join(", ")})`)
      .bind(receiptCurrency, ...bases)
      .all<{ base_currency: string; quote_per_base: number; fetched_at: string }>();
    const rates: ReceiptRates = {};
    for (const row of result.results) {
      const age = now - Date.parse(row.fetched_at);
      if (Number(row.quote_per_base) > 0 && age <= RECEIPT_MATCH_RATE_MAX_AGE_DAYS * 86_400_000) {
        rates[rateKey(row.base_currency, receiptCurrency)] = Number(row.quote_per_base);
      }
    }
    return rates;
  } catch {
    return {};
  }
}

async function loadHabitCategory(db: D1Database, merchant: string, today: string) {
  const key = habitMerchantKey(merchant);
  if (!key) return null;
  const { habits } = await loadAskHabits(db);
  const habit = habits.find((item) => item.kind === "category" && item.key === key);
  return habit && habitConfidence(habit, today) === "high" ? (habit.value as AskCategoryHabitValue).categoryName : null;
}

export async function findReceiptMatch(
  db: D1Database,
  receipt: ReceiptMatchReceipt,
  options: { today: string; now?: number; householdId?: string }
): Promise<ReceiptMatchResult> {
  const householdId = options.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const window = receiptMatchWindow(receipt.date);
  const currency = receipt.currency.toUpperCase();
  const [entries, taps, habitCategory] = await Promise.all([
    loadEntries(db, householdId, window, { currency, totalMinor: receipt.totalMinor }),
    loadTaps(db, householdId, window),
    loadHabitCategory(db, receipt.merchant, options.today)
  ]);
  const rates = await loadRates(db, currency, entries.map((entry) => entry.currency), options.now ?? Date.now());
  return chooseReceiptMatch({ ...receipt, currency }, { entries, taps, rates, habitCategory, catchAll: ASK_CATCH_ALL_CATEGORIES });
}
