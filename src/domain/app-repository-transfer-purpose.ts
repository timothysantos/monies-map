// Transfer purpose commands (DOMAIN.md "Transfer Purpose";
// src/domain/transfer-purpose.ts for the reading). All-or-nothing: reads and
// checks first, then the entry change, its audit event and the month refresh
// markers commit in one db.batch(), and the month totals refresh after it.
//
// - setTransferPurposeRecord: "What is this for?" on a transfer out to
//   another person of the household, or cleared.
// - applyRememberedTransferPurposes: a new transfer out gets the purpose of
//   the newest earlier one like it (same account, amount and description,
//   digits ignored, within 100 days), marked `remembered`.

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

// The learning rule (pure): the newest earlier transfer out of the same
// account, with the same amount and the same description once digits are
// ignored, decides. When it has a purpose the new one gets it; when it has
// none (never set, or undone) nothing is applied, so an Undo stops the next
// month too.
export function rememberedTransferPurpose<T extends {
  id: string;
  accountId: string;
  amountMinor: number;
  date: string;
  description: string;
  purposeCategoryId: string | null;
  purposePersonId: string | null;
}>(subject: Omit<T, "purposeCategoryId" | "purposePersonId">, history: T[]): { categoryId: string; personId: string; fromEntryId: string } | null {
  const key = habitMerchantKey(subject.description);
  if (!key) {
    return null;
  }
  const earliest = shiftDays(subject.date, -TRANSFER_PURPOSE_MEMORY_DAYS);
  const previous = history
    .filter((entry) => entry.id !== subject.id
      && entry.accountId === subject.accountId
      && entry.amountMinor === subject.amountMinor
      && entry.date <= subject.date
      && entry.date >= earliest
      && habitMerchantKey(entry.description) === key)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const newest = previous.find((entry) => entry.date < subject.date) ?? null;
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

// After entries are saved (an import commit, a manual add): each new
// transfer out without a purpose gets the remembered one, when the rules
// still allow it. One batch for all of them; nothing when none apply.
export async function applyRememberedTransferPurposes(db: D1Database, entryIds: string[]): Promise<string[]> {
  const ids = [...new Set(entryIds.filter(Boolean))];
  if (!ids.length) {
    return [];
  }
  const subjects = (await db
    .prepare(`
      SELECT id, account_id, amount_minor, transaction_date, description, owner_person_id
      FROM transactions
      WHERE household_id = ?
        AND entry_type = 'transfer'
        AND transfer_direction = 'out'
        AND transfer_purpose_category_id IS NULL
        AND id IN (${ids.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
    .all<{ id: string; account_id: string; amount_minor: number; transaction_date: string; description: string; owner_person_id: string | null }>()).results;
  if (!subjects.length) {
    return [];
  }
  const dates = subjects.map((subject) => subject.transaction_date).sort();
  const history = (await db
    .prepare(`
      SELECT id, account_id, amount_minor, transaction_date, description, transfer_purpose_category_id, transfer_purpose_person_id
      FROM transactions
      WHERE household_id = ?
        AND entry_type = 'transfer'
        AND transfer_direction = 'out'
        AND transaction_date >= ?
        AND transaction_date <= ?
        AND account_id IN (${[...new Set(subjects.map((subject) => subject.account_id))].map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, shiftDays(dates[0], -TRANSFER_PURPOSE_MEMORY_DAYS), dates[dates.length - 1], ...new Set(subjects.map((subject) => subject.account_id)))
    .all<{ id: string; account_id: string; amount_minor: number; transaction_date: string; description: string; transfer_purpose_category_id: string | null; transfer_purpose_person_id: string | null }>()).results
    .map((row) => ({
      id: row.id,
      accountId: row.account_id,
      amountMinor: row.amount_minor,
      date: row.transaction_date,
      description: row.description,
      purposeCategoryId: row.transfer_purpose_category_id,
      purposePersonId: row.transfer_purpose_person_id
    }));

  const statements: D1PreparedStatement[] = [];
  const applied: string[] = [];
  const months = new Set<string>();
  for (const subject of subjects) {
    const remembered = rememberedTransferPurpose({
      id: subject.id,
      accountId: subject.account_id,
      amountMinor: subject.amount_minor,
      date: subject.transaction_date,
      description: subject.description
    }, history);
    if (!remembered) {
      continue;
    }
    // The same checks as setting it by hand; a refused one is skipped.
    const entry = await loadPurposeEntry(db, subject.id);
    if (!entry) {
      continue;
    }
    const counterpart = await loadCounterpart(db, entry);
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

// The same, for the transfers out an import just committed.
export async function applyRememberedTransferPurposesForImport(db: D1Database, importId: string): Promise<string[]> {
  const rows = await db
    .prepare("SELECT id FROM transactions WHERE household_id = ? AND import_id = ? AND entry_type = 'transfer' AND transfer_direction = 'out' AND transfer_purpose_category_id IS NULL")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ id: string }>();
  return applyRememberedTransferPurposes(db, rows.results.map((row) => row.id));
}
