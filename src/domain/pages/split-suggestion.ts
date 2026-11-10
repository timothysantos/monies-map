import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { loadSplitGroups } from "../app-repository-splits";
import { normalizeSplitCurrency } from "../split-currency";
import {
  NON_GROUP_SPLIT_ID,
  SPLIT_SUGGESTION_POLICY,
  suggestSplitForEntry,
  type SplitSuggestionHistoryEntry,
  type SplitSuggestionTarget
} from "../split-suggestion";
import type { SplitSuggestionDto } from "../../types/dto";

// The read-only split suggestion for one entry (POST /api/splits/suggestion,
// DOMAIN.md "Split Suggestion"). Not a page DTO; Ask asks for it while a
// card is open. It reads the entry (a saved one by id, or a new card's
// fields), the two people a split is shared between, the split groups and
// the owner's expense entries of the last 12 months with their active
// split, then leaves the judgement to the pure rule (split-suggestion.ts).

export type SplitSuggestionRequest =
  | { entryId: string }
  | {
      entryType: string;
      description: string;
      categoryName?: string | null;
      ownerName?: string | null;
      accountId?: string | null;
      accountName?: string | null;
      date: string;
    };

export class SplitSuggestionEntryNotFound extends Error {}

const ENTRY_TYPES = new Set(["expense", "income", "transfer"]);

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

// The route's body, checked: { entryId } for a saved entry, else a new
// card's fields with a known entry type and an ISO date. Null when invalid.
export function readSplitSuggestionRequest(body: unknown): SplitSuggestionRequest | null {
  if (!body || typeof body !== "object") return null;
  const fields = body as Record<string, unknown>;
  if (fields.entryId !== undefined) {
    return typeof fields.entryId === "string" && fields.entryId.length > 0 && fields.entryId.length <= 200
      ? { entryId: fields.entryId }
      : null;
  }
  const description = optionalText(fields.description, 240);
  const categoryName = optionalText(fields.categoryName, 120);
  const ownerName = optionalText(fields.ownerName, 120);
  const accountId = optionalText(fields.accountId, 200);
  const accountName = optionalText(fields.accountName, 200);
  const date = typeof fields.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.date) && !Number.isNaN(Date.parse(`${fields.date}T00:00:00Z`))
    ? fields.date
    : null;
  if (
    typeof fields.entryType !== "string" || !ENTRY_TYPES.has(fields.entryType) || !date
    || [description, categoryName, ownerName, accountId, accountName].includes(undefined)
  ) {
    return null;
  }
  return { entryType: fields.entryType, description: description ?? "", categoryName, ownerName, accountId, accountName, date };
}

export async function buildSplitSuggestionDto(db: D1Database, request: SplitSuggestionRequest): Promise<SplitSuggestionDto | null> {
  const target = "entryId" in request ? await loadSavedTarget(db, request.entryId) : await loadDraftTarget(db, request);
  if (target.entryType !== "expense" || target.onSplits || !target.ownerPersonId) {
    return null;
  }
  const [sharePeople, groups, history] = await Promise.all([
    loadSharePeople(db),
    loadSplitGroups(db),
    loadOwnerHistory(db, target.ownerPersonId, target.date)
  ]);
  return suggestSplitForEntry({
    target,
    history,
    sharePeople,
    groups: [
      // Non-group expenses (the Entries page's "split-group-none") take
      // any currency.
      { id: NON_GROUP_SPLIT_ID, name: "Non-group expenses", currency: target.currency },
      ...groups.map((group) => ({ id: group.id, name: group.name, currency: group.currency }))
    ]
  });
}

async function loadSavedTarget(db: D1Database, entryId: string): Promise<SplitSuggestionTarget> {
  const row = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.entry_type,
        transactions.description,
        transactions.transaction_date,
        transactions.currency,
        categories.name AS category_name,
        COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS owner_person_id,
        EXISTS (
          SELECT 1 FROM split_expenses
          WHERE split_expenses.household_id = transactions.household_id
            AND split_expenses.linked_transaction_id = transactions.id
            AND split_expenses.deleted_at IS NULL
        ) AS on_splits
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{
      id: string;
      entry_type: string;
      description: string;
      transaction_date: string;
      currency: string;
      category_name: string | null;
      owner_person_id: string | null;
      on_splits: number;
    }>();
  if (!row) {
    throw new SplitSuggestionEntryNotFound("Entry not found.");
  }
  return {
    entryId: row.id,
    entryType: row.entry_type,
    description: row.description,
    categoryName: row.category_name,
    ownerPersonId: row.owner_person_id,
    currency: normalizeSplitCurrency(row.currency),
    date: row.transaction_date,
    onSplits: Boolean(row.on_splits)
  };
}

// A new card's fields. Its owner is a person's name (a Shared card names no
// one, so it gets nothing); the wallet gives the currency and, with no
// owner named, the payer, as the create route does.
async function loadDraftTarget(db: D1Database, request: Exclude<SplitSuggestionRequest, { entryId: string }>): Promise<SplitSuggestionTarget> {
  const account = request.accountId || request.accountName
    ? await db
      .prepare(`
        SELECT currency, owner_person_id
        FROM accounts
        WHERE household_id = ? AND (id = ? OR account_name = ?)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, request.accountId ?? "", request.accountName ?? "", request.accountId ?? "")
      .first<{ currency: string; owner_person_id: string | null }>()
    : null;
  const owner = request.ownerName
    ? await db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, request.ownerName)
      .first<{ id: string }>()
    : null;
  return {
    entryType: request.entryType,
    description: request.description,
    categoryName: request.categoryName ?? null,
    ownerPersonId: request.ownerName ? owner?.id ?? null : account?.owner_person_id ?? null,
    currency: normalizeSplitCurrency(account?.currency),
    date: request.date
  };
}

// The pair the split routes share an expense between: the same people, in
// the same order, as loadSplitSharePeople in app-repository-splits.ts.
export async function loadSharePeople(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id, display_name
      FROM people
      WHERE household_id = ?
      ORDER BY
        CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END,
        created_at,
        id
      LIMIT 2
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();
  return people.results.map((person) => ({ id: person.id, name: person.display_name }));
}

// The columns and joins of an owner's expense history row: the entry with
// its active split's group, payer and shares ("person:basis" pairs). Shared
// with the Usually shared sweep (usually-shared.ts), so both read history
// the same way.
export const HISTORY_ROWS_SQL = `
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.entry_type,
        transactions.description,
        categories.name AS category_name,
        COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS owner_person_id,
        split_expenses.id AS split_id,
        split_expenses.split_group_id,
        split_expenses.payer_person_id,
        (
          SELECT GROUP_CONCAT(split_expense_shares.person_id || ':' || split_expense_shares.ratio_basis_points, ',')
          FROM split_expense_shares
          WHERE split_expense_shares.split_expense_id = split_expenses.id
        ) AS shares
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN split_expenses
        ON split_expenses.household_id = transactions.household_id
        AND split_expenses.linked_transaction_id = transactions.id
        AND split_expenses.deleted_at IS NULL`;

export interface HistoryRow {
  id: string;
  transaction_date: string;
  entry_type: string;
  description: string;
  category_name: string | null;
  owner_person_id: string | null;
  split_id: string | null;
  split_group_id: string | null;
  payer_person_id: string | null;
  shares: string | null;
}

export function toHistoryEntry(row: HistoryRow): SplitSuggestionHistoryEntry {
  return {
    entryId: row.id,
    date: row.transaction_date,
    entryType: row.entry_type,
    description: row.description,
    categoryName: row.category_name,
    ownerPersonId: row.owner_person_id,
    split: row.split_id && row.payer_person_id
      ? {
          groupId: row.split_group_id,
          payerPersonId: row.payer_person_id,
          shares: (row.shares ?? "").split(",").filter(Boolean).map((pair) => {
            const separator = pair.lastIndexOf(":");
            return { personId: pair.slice(0, separator), basisPoints: Number(pair.slice(separator + 1)) };
          })
        }
      : null
  };
}

// The owner's expense entries of the lookback window.
async function loadOwnerHistory(db: D1Database, ownerPersonId: string, date: string): Promise<SplitSuggestionHistoryEntry[]> {
  const rows = await db
    .prepare(`${HISTORY_ROWS_SQL}
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'expense'
        AND transactions.transaction_date BETWEEN date(?, ?) AND ?
        AND COALESCE(transactions.owner_person_id, accounts.owner_person_id) = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, date, `-${SPLIT_SUGGESTION_POLICY.lookbackDays} days`, date, ownerPersonId)
    .all<HistoryRow>();
  return rows.results.map(toHistoryEntry);
}
