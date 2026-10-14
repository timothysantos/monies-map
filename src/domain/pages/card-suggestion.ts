import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { normalizeDescriptionForMatch } from "../app-repository-helpers";
import {
  CARD_HISTORY_POLICY,
  suggestCardForEntry,
  type CardHistoryCard,
  type CardHistoryEntry,
  type CardHistoryTarget,
  type CardSuggestion
} from "../card-history-suggestion";

// The read-only card suggestion for one entry (POST /api/entries/card-
// suggestion, DOMAIN.md "Card Suggestion"). Not a page DTO; Ask asks for it
// while a card is open. Its reads are fixed: the saved entry (by id only), the
// household's accounts, and ONE bounded history read (below). It writes
// nothing and the rule itself is the pure card-history-suggestion.ts.

export type CardSuggestionRequest =
  | { entryId: string }
  | { description: string; accountId: string; date: string };

export class CardSuggestionEntryNotFound extends Error {}

// The most entries the one history read returns. A year of one shop is a
// few dozen; the cap only protects a very large household.
export const CARD_HISTORY_ROW_LIMIT = 500;

// The route's body, checked: { entryId } for a saved entry, else a new
// card's shop, card and ISO date. Null when invalid.
export function readCardSuggestionRequest(body: unknown): CardSuggestionRequest | null {
  if (!body || typeof body !== "object") return null;
  const fields = body as Record<string, unknown>;
  if (fields.entryId !== undefined) {
    return typeof fields.entryId === "string" && fields.entryId.length > 0 && fields.entryId.length <= 200
      ? { entryId: fields.entryId }
      : null;
  }
  const { description, accountId, date } = fields;
  if (
    typeof description !== "string" || !description.trim() || description.length > 240
    || typeof accountId !== "string" || !accountId || accountId.length > 200
    || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  ) {
    return null;
  }
  return { description, accountId, date };
}

export async function buildCardSuggestion(db: D1Database, request: CardSuggestionRequest): Promise<CardSuggestion | null> {
  const target = "entryId" in request ? await loadSavedTarget(db, request.entryId) : request;
  if (!target) {
    return null;
  }
  const shopKey = normalizeDescriptionForMatch(target.description);
  if (!shopKey) {
    return null;
  }
  const [accounts, history] = await Promise.all([loadCards(db), loadShopHistory(db, shopKey, target.date)]);
  return suggestCardForEntry({ target, history, accounts });
}

// A saved entry the card can still be changed on: a provisional expense in
// its card's own currency. Anything else (a statement-certified entry, an
// estimate in another currency, income, a transfer) asks nothing.
async function loadSavedTarget(db: D1Database, entryId: string): Promise<CardHistoryTarget | null> {
  const row = await db
    .prepare(`
      SELECT id, description, account_id, transaction_date, entry_type, original_currency, bank_certification_status
      FROM transactions
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{
      id: string;
      description: string;
      account_id: string;
      transaction_date: string;
      entry_type: string;
      original_currency: string | null;
      bank_certification_status: string | null;
    }>();
  if (!row) {
    throw new CardSuggestionEntryNotFound("Entry not found.");
  }
  if (row.entry_type !== "expense" || row.original_currency || row.bank_certification_status !== "provisional") {
    return null;
  }
  return { entryId: row.id, description: row.description, accountId: row.account_id, date: row.transaction_date };
}

async function loadCards(db: D1Database): Promise<CardHistoryCard[]> {
  const result = await db
    .prepare("SELECT id, account_name, currency, is_active FROM accounts WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; account_name: string; currency: string; is_active: number }>();
  return result.results.map((row) => ({ id: row.id, name: row.account_name, currency: row.currency, isActive: Boolean(row.is_active) }));
}

// The one history read: this household's expense entries of the 12 months up
// to the day (an index range on household and date), whose description holds
// the shop's longest word, newest first, at most CARD_HISTORY_ROW_LIMIT. The
// rule still compares the whole normalized shop name, so the word only keeps
// the read small.
async function loadShopHistory(db: D1Database, shopKey: string, date: string): Promise<CardHistoryEntry[]> {
  const word = shopKey.split(" ").reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest), "");
  const rows = await db
    .prepare(`
      SELECT id, transaction_date, entry_type, description, account_id, original_currency
      FROM transactions
      WHERE household_id = ?
        AND transaction_date BETWEEN date(?, ?) AND ?
        AND entry_type = 'expense'
        AND original_currency IS NULL
        AND instr(lower(description), ?) > 0
      ORDER BY transaction_date DESC
      LIMIT ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, date, `-${CARD_HISTORY_POLICY.lookbackDays} days`, date, word, CARD_HISTORY_ROW_LIMIT)
    .all<{
      id: string;
      transaction_date: string;
      entry_type: string;
      description: string;
      account_id: string;
      original_currency: string | null;
    }>();
  return rows.results.map((row) => ({
    entryId: row.id,
    date: row.transaction_date,
    entryType: row.entry_type,
    description: row.description,
    accountId: row.account_id,
    originalCurrency: row.original_currency
  }));
}
