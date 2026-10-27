// Transfer purpose commands (DOMAIN.md "Transfer Purpose";
// src/domain/transfer-purpose.ts for the reading). All-or-nothing: reads and
// checks first, then the entry change, its audit event and the month refresh
// markers commit in one db.batch(), and the month totals refresh after it.
//
// - setTransferPurposeRecord: "What is this for?" on a transfer out to
//   another person of the household, or cleared.
// - applyRememberedTransferPurposes: a new transfer out gets the purpose of
//   the newest earlier one like it, marked `remembered`. Like it means the
//   same sending account, receiving person (and receiving account when both
//   sides know it), amount to the cent and currency within 100 days, whatever
//   the bank's wording; until the receiver is known (the pair not matched
//   yet) the old rule applies: same account, amount and description, digits
//   ignored.

import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import { habitMerchantKey } from "./ask-habits";
import { buildClearPurposeStatement } from "./transfer-purpose-links";
import {
  isTransferPurposeCategoryName,
  TRANSFER_PURPOSE_COPY,
  transferPurposeRefusal
} from "./transfer-purpose";

export class TransferPurposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferPurposeError";
  }
}

type PurposeEntryRow = {
  id: string;
  description: string;
  transaction_date: string;
  entry_type: string;
  transfer_direction: string | null;
  owner_person_id: string | null;
  account_id: string;
  transfer_group_id: string | null;
  currency: string | null;
  account_kind: string | null;
  transfer_purpose_category_id: string | null;
  transfer_purpose_person_id: string | null;
  on_splits: number;
  settle_up: number;
};

// One entry with what the purpose rules need: its owner, account kind,
// currency, whether Splits holds it (an expense or a settle-up, or a
// checkpoint match), and its stored purpose.
const ENTRY_SELECT = `
  SELECT
    transactions.id,
    transactions.description,
    transactions.transaction_date,
    transactions.entry_type,
    transactions.transfer_direction,
    transactions.owner_person_id,
    transactions.account_id,
    transactions.transfer_group_id,
    transactions.currency,
    accounts.account_kind,
    transactions.transfer_purpose_category_id,
    transactions.transfer_purpose_person_id,
    EXISTS (
      SELECT 1 FROM split_expenses
      WHERE split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL
    ) AS on_splits,
    (
      EXISTS (
        SELECT 1 FROM split_settlements
        WHERE split_settlements.linked_transaction_id = transactions.id AND split_settlements.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM split_settlement_checkpoint_matches
        WHERE split_settlement_checkpoint_matches.transaction_id = transactions.id
      )
    ) AS settle_up
  FROM transactions
  INNER JOIN accounts ON accounts.id = transactions.account_id
  LEFT JOIN imports ON imports.id = transactions.import_id
  WHERE transactions.household_id = ?
    AND (transactions.import_id IS NULL OR imports.status = 'completed')
`;

async function loadPurposeEntry(db: D1Database, entryId: string) {
  return db.prepare(`${ENTRY_SELECT} AND transactions.id = ?`)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<PurposeEntryRow>();
}

async function loadCounterpart(db: D1Database, entry: PurposeEntryRow) {
  if (!entry.transfer_group_id) {
    return null;
  }
  return db.prepare(`${ENTRY_SELECT} AND transactions.transfer_group_id = ? AND transactions.id != ? ORDER BY transactions.id LIMIT 1`)
    .bind(DEFAULT_HOUSEHOLD_ID, entry.transfer_group_id, entry.id)
    .first<PurposeEntryRow>();
}

// D1 allows 100 bound values in a statement; the household takes one.
const PURPOSE_ID_CHUNK = 50;

// The same reads for many entries at once (one query per 50 ids).
async function loadPurposeEntries(db: D1Database, entryIds: string[]) {
  const found = new Map<string, PurposeEntryRow>();
  for (let start = 0; start < entryIds.length; start += PURPOSE_ID_CHUNK) {
    const chunk = entryIds.slice(start, start + PURPOSE_ID_CHUNK);
    const result = await db.prepare(`${ENTRY_SELECT} AND transactions.id IN (${chunk.map(() => "?").join(", ")})`)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<PurposeEntryRow>();
    for (const row of result.results) {
      found.set(row.id, row);
    }
  }
  return found;
}

// The other side of each entry's pair (what `loadCounterpart` answers one at
// a time), keyed by the entry's id.
async function loadCounterparts(db: D1Database, entries: PurposeEntryRow[]) {
  const groupIds = [...new Set(entries.map((entry) => entry.transfer_group_id).filter((id): id is string => Boolean(id)))];
  const byGroup = new Map<string, PurposeEntryRow[]>();
  for (let start = 0; start < groupIds.length; start += PURPOSE_ID_CHUNK) {
    const chunk = groupIds.slice(start, start + PURPOSE_ID_CHUNK);
    const result = await db.prepare(`${ENTRY_SELECT} AND transactions.transfer_group_id IN (${chunk.map(() => "?").join(", ")}) ORDER BY transactions.id`)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<PurposeEntryRow>();
    for (const row of result.results) {
      byGroup.set(row.transfer_group_id as string, [...(byGroup.get(row.transfer_group_id as string) ?? []), row]);
    }
  }
  const counterparts = new Map<string, PurposeEntryRow>();
  for (const entry of entries) {
    const other = entry.transfer_group_id ? byGroup.get(entry.transfer_group_id)?.find((row) => row.id !== entry.id) : undefined;
    if (other) {
      counterparts.set(entry.id, other);
    }
  }
  return counterparts;
}

function subjectOf(entry: PurposeEntryRow, counterpart: PurposeEntryRow | null) {
  return {
    entryType: entry.entry_type,
    transferDirection: entry.transfer_direction,
    ownerPersonId: entry.owner_person_id,
    accountKind: entry.account_kind,
    currency: entry.currency,
    linkedToSplits: Boolean(entry.on_splits),
    usedAsSettleUp: Boolean(entry.settle_up),
    counterpart: counterpart ? {
      ownerPersonId: counterpart.owner_person_id,
      accountKind: counterpart.account_kind,
      currency: counterpart.currency,
      usedAsSettleUp: Boolean(counterpart.settle_up)
    } : null
  };
}

const monthsOf = (...entries: Array<PurposeEntryRow | null>) => new Set(
  entries.filter((entry): entry is PurposeEntryRow => Boolean(entry)).map((entry) => entry.transaction_date.slice(0, 7))
);

// Set or clear what a transfer out pays for. The receiver is the linked
// other side's owner; an unlinked transfer keeps the receiver it already has
// (set like last month) and only its category can change.
export async function setTransferPurposeRecord(
  db: D1Database,
  input: { entryId: string; categoryName: string | null }
): Promise<{ entryId: string; categoryName: string | null; updated: boolean }> {
  const entry = await loadPurposeEntry(db, input.entryId);
  if (!entry) {
    throw new TransferPurposeError("Entry not found.");
  }
  const counterpart = await loadCounterpart(db, entry);
  const months = monthsOf(entry, counterpart);

  if (!input.categoryName) {
    if (!entry.transfer_purpose_category_id) {
      return { entryId: entry.id, categoryName: null, updated: false };
    }
    await db.batch([
      buildClearPurposeStatement(db, entry.id),
      buildAuditEventStatement(db, {
        entityType: "transaction",
        entityId: entry.id,
        action: "transfer_purpose_cleared",
        detail: `Cleared what ${entry.description} on ${entry.transaction_date} is for.`
      }),
      ...buildMonthlySnapshotRefreshMarkers(db, months)
    ]);
    await refreshMonthlySnapshotsAfterWrite(db, months);
    return { entryId: entry.id, categoryName: null, updated: true };
  }

  const category = await db
    .prepare("SELECT id, name FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string; name: string }>();
  if (!category) {
    throw new TransferPurposeError(TRANSFER_PURPOSE_COPY.unknownCategory);
  }
  if (!isTransferPurposeCategoryName(category.name)) {
    throw new TransferPurposeError(TRANSFER_PURPOSE_COPY.notSpending(category.name));
  }
  const receiverPersonId = counterpart ? counterpart.owner_person_id : entry.transfer_purpose_person_id;
  const refusal = transferPurposeRefusal(subjectOf(entry, counterpart), receiverPersonId);
  if (refusal) {
    throw new TransferPurposeError(refusal);
  }
  if (entry.transfer_purpose_category_id === category.id && entry.transfer_purpose_person_id === receiverPersonId) {
    return { entryId: entry.id, categoryName: category.name, updated: false };
  }

  await db.batch([
    db
      .prepare(`
        UPDATE transactions
        SET
          transfer_purpose_category_id = ?,
          transfer_purpose_person_id = ?,
          transfer_purpose_source = 'person',
          updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(category.id, receiverPersonId, DEFAULT_HOUSEHOLD_ID, entry.id),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: entry.id,
      action: "transfer_purpose_set",
      detail: `${entry.description} on ${entry.transaction_date} pays for ${category.name}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return { entryId: entry.id, categoryName: category.name, updated: true };
}

export const TRANSFER_PURPOSE_MEMORY_DAYS = 100;

// The learning rule (pure). A repeat transfer is the same sending account,
// the same receiving person (and receiving account when both sides know it),
// the same amount to the cent and the same currency within 100 days; the
// bank's wording is ignored. Walking those earlier transfers newest first,
// the first one with a purpose decides (so the newest wins when purposes
// disagree) and the first one the person cleared by hand ("Just a transfer",
// Undo) stops the chain, so an undone month stops the next one. A transfer
// that was merely never tagged is skipped.
//
// Until the receiver is known (the pair is not matched yet) the old rule
// applies: the newest earlier transfer out of the same account with the same
// amount and the same description once digits are ignored decides, and one
// with no purpose means nothing is applied.
export interface TransferPurposeSubjectKey {
  id: string;
  accountId: string;
  amountMinor: number;
  currency?: string | null;
  date: string;
  description: string;
  receiverPersonId?: string | null;
  receiverAccountId?: string | null;
}

export interface TransferPurposeHistoryRow {
  id: string;
  accountId: string;
  amountMinor: number;
  currency?: string | null;
  date: string;
  description: string;
  purposeCategoryId: string | null;
  purposePersonId: string | null;
  receiverPersonId?: string | null;
  receiverAccountId?: string | null;
  clearedByHand?: boolean;
}

export function rememberedTransferPurpose(
  subject: TransferPurposeSubjectKey,
  history: TransferPurposeHistoryRow[]
): { categoryId: string; personId: string; fromEntryId: string } | null {
  const earliest = shiftDays(subject.date, -TRANSFER_PURPOSE_MEMORY_DAYS);
  const newestFirst = (rows: TransferPurposeHistoryRow[]) => rows
    .filter((entry) => entry.id !== subject.id
      && entry.accountId === subject.accountId
      && entry.amountMinor === subject.amountMinor
      && entry.date < subject.date
      && entry.date >= earliest)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));

  if (subject.receiverPersonId) {
    const currency = subject.currency ?? "SGD";
    const chain = newestFirst(history).filter((entry) => (entry.currency ?? "SGD") === currency
      && (entry.receiverPersonId ?? entry.purposePersonId) === subject.receiverPersonId
      && (!subject.receiverAccountId || !entry.receiverAccountId || entry.receiverAccountId === subject.receiverAccountId));
    for (const entry of chain) {
      if (entry.purposeCategoryId && entry.purposePersonId) {
        return { categoryId: entry.purposeCategoryId, personId: subject.receiverPersonId, fromEntryId: entry.id };
      }
      if (entry.clearedByHand) {
        return null;
      }
    }
    return null;
  }

  const key = habitMerchantKey(subject.description);
  if (!key) {
    return null;
  }
  const newest = newestFirst(history.filter((entry) => habitMerchantKey(entry.description) === key))[0] ?? null;
  if (!newest?.purposeCategoryId || !newest.purposePersonId) {
    return null;
  }
  return { categoryId: newest.purposeCategoryId, personId: newest.purposePersonId, fromEntryId: newest.id };
}

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// After entries are saved (an import commit, a manual add, the Apple Pay
// Shortcut) and after a pair is first matched: each transfer out without a
// purpose gets the remembered one, when the rules still allow it. A transfer
// the person cleared by hand is never given one again. One batch for all of
// them; nothing when none apply. Applied at those moments only, never when
// an entry opens: existing rows are not changed behind the person's back.
//
// `chronological` is for linking many pairs at once (the bulk link of clear
// pairs): the transfers are taken oldest first and each one that gets a
// purpose counts as history for the ones after it, exactly as if the pairs had
// been linked one at a time in date order. Without it every transfer is judged
// on the history as it was before this call (an import commit).
export async function applyRememberedTransferPurposes(
  db: D1Database,
  entryIds: string[],
  options: { chronological?: boolean } = {}
): Promise<string[]> {
  const ids = [...new Set(entryIds.filter(Boolean))];
  if (!ids.length) {
    return [];
  }
  const subjects: Array<{ id: string; account_id: string; amount_minor: number; currency: string | null; transaction_date: string; description: string; owner_person_id: string | null }> = [];
  for (let start = 0; start < ids.length; start += PURPOSE_ID_CHUNK) {
    const chunk = ids.slice(start, start + PURPOSE_ID_CHUNK);
    subjects.push(...(await db
      .prepare(`
        SELECT id, account_id, amount_minor, currency, transaction_date, description, owner_person_id
        FROM transactions
        WHERE household_id = ?
          AND entry_type = 'transfer'
          AND transfer_direction = 'out'
          AND transfer_purpose_category_id IS NULL
          AND id IN (${chunk.map(() => "?").join(", ")})
          AND NOT EXISTS (
            SELECT 1 FROM audit_events
            WHERE audit_events.entity_type = 'transaction' AND audit_events.entity_id = transactions.id
              AND audit_events.action = 'transfer_purpose_cleared'
          )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<(typeof subjects)[number]>()).results);
  }
  if (!subjects.length) {
    return [];
  }
  const dates = subjects.map((subject) => subject.transaction_date).sort();
  const accountIds = [...new Set(subjects.map((subject) => subject.account_id))];
  // Earlier transfers out of the same accounts with, for each, the other
  // side of its pair (when matched) and whether the person cleared its
  // purpose by hand.
  const historyById = new Map((await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.account_id,
        transactions.amount_minor,
        transactions.currency,
        transactions.transaction_date,
        transactions.description,
        transactions.transfer_purpose_category_id,
        transactions.transfer_purpose_person_id,
        other.account_id AS receiver_account_id,
        other.owner_person_id AS receiver_person_id,
        EXISTS (
          SELECT 1 FROM audit_events
          WHERE audit_events.entity_type = 'transaction' AND audit_events.entity_id = transactions.id
            AND audit_events.action = 'transfer_purpose_cleared'
        ) AS cleared_by_hand
      FROM transactions
      LEFT JOIN transactions AS other
        ON other.transfer_group_id = transactions.transfer_group_id AND other.id != transactions.id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'transfer'
        AND transactions.transfer_direction = 'out'
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date <= ?
        AND transactions.account_id IN (${accountIds.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, shiftDays(dates[0], -TRANSFER_PURPOSE_MEMORY_DAYS), dates[dates.length - 1], ...accountIds)
    .all<{
      id: string; account_id: string; amount_minor: number; currency: string | null; transaction_date: string; description: string;
      transfer_purpose_category_id: string | null; transfer_purpose_person_id: string | null;
      receiver_account_id: string | null; receiver_person_id: string | null; cleared_by_hand: number;
    }>()).results
    .map((row): [string, TransferPurposeHistoryRow] => [row.id, {
      id: row.id,
      accountId: row.account_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      date: row.transaction_date,
      description: row.description,
      purposeCategoryId: row.transfer_purpose_category_id,
      purposePersonId: row.transfer_purpose_person_id,
      receiverPersonId: row.receiver_person_id,
      receiverAccountId: row.receiver_account_id,
      clearedByHand: Boolean(row.cleared_by_hand)
    }]));
  const history = [...historyById.values()];

  if (options.chronological) {
    subjects.sort((left, right) => left.transaction_date.localeCompare(right.transaction_date) || left.id.localeCompare(right.id));
  }
  const entries = await loadPurposeEntries(db, subjects.map((subject) => subject.id));
  const counterparts = await loadCounterparts(db, [...entries.values()]);
  const statements: D1PreparedStatement[] = [];
  const applied: string[] = [];
  const months = new Set<string>();
  for (const subject of subjects) {
    // The same checks as setting it by hand; a refused one is skipped.
    const entry = entries.get(subject.id);
    if (!entry) {
      continue;
    }
    const counterpart = counterparts.get(entry.id) ?? null;
    const remembered = rememberedTransferPurpose({
      id: subject.id,
      accountId: subject.account_id,
      amountMinor: subject.amount_minor,
      currency: subject.currency,
      date: subject.transaction_date,
      description: subject.description,
      receiverPersonId: counterpart?.owner_person_id ?? null,
      receiverAccountId: counterpart?.account_id ?? null
    }, history);
    if (!remembered) {
      continue;
    }
    const receiverPersonId = counterpart ? counterpart.owner_person_id : remembered.personId;
    if (transferPurposeRefusal(subjectOf(entry, counterpart), receiverPersonId)) {
      continue;
    }
    statements.push(
      db
        .prepare(`
          UPDATE transactions
          SET
            transfer_purpose_category_id = ?,
            transfer_purpose_person_id = ?,
            transfer_purpose_source = 'remembered',
            updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ? AND id = ? AND transfer_purpose_category_id IS NULL
        `)
        .bind(remembered.categoryId, receiverPersonId, DEFAULT_HOUSEHOLD_ID, subject.id),
      buildAuditEventStatement(db, {
        entityType: "transaction",
        entityId: subject.id,
        action: "transfer_purpose_remembered",
        detail: `${subject.description} on ${subject.transaction_date} pays for the same as ${remembered.fromEntryId}.`
      })
    );
    applied.push(subject.id);
    const learned = options.chronological ? historyById.get(subject.id) : undefined;
    if (learned) {
      learned.purposeCategoryId = remembered.categoryId;
      learned.purposePersonId = receiverPersonId;
    }
    for (const month of monthsOf(entry, counterpart)) {
      months.add(month);
    }
  }
  if (!statements.length) {
    return [];
  }
  statements.push(...buildMonthlySnapshotRefreshMarkers(db, months));
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return applied;
}

// The same, for the transfers out an import just committed and the earlier
// transfers out its rows were matched with.
export async function applyRememberedTransferPurposesForImport(db: D1Database, importId: string): Promise<string[]> {
  const rows = await db
    .prepare(`
      SELECT id FROM transactions
      WHERE household_id = ? AND entry_type = 'transfer' AND transfer_direction = 'out' AND transfer_purpose_category_id IS NULL
        AND (
          import_id = ?
          OR transfer_group_id IN (
            SELECT transfer_group_id FROM transactions WHERE household_id = ? AND import_id = ? AND transfer_group_id IS NOT NULL
          )
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId, DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ id: string }>();
  return applyRememberedTransferPurposes(db, rows.results.map((row) => row.id));
}
