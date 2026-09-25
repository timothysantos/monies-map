// Entry commands (H15b): create, update (every edit path), delete, deep-link
// lookup, and transfer linking and settling. Each write keeps its original
// SQL order, idempotency check and bank-fact lock. Reads and checks run
// first; the ledger change, its audit event and the month refresh markers
// then commit as one db.batch(), and the affected months' snapshots are
// refreshed after it (see app-repository-snapshots.ts).

import {
  buildMonthlySnapshotRefreshMarkers,
  recalculateMonthlySnapshots,
  refreshMonthlySnapshotsAfterWrite
} from "./app-repository-snapshots";
import { normalizeStatementDate } from "./app-repository-helpers";
import { recordCategoryMatchSuggestion } from "./app-repository-category-match-rules";
import { buildAuditEventStatement } from "./app-repository-audit";
import { resolveAccountId, resolveCategoryId, resolvePersonId } from "./app-repository-lookups";
import { buildLinkedSplitAmountStatements, upsertLinkedSplitExpenseForEntryRecord } from "./app-repository-splits";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

async function assertUnlockedBankFactsForEntryUpdate(
  db: D1Database,
  input: {
    transactionId: string;
    current: {
      account_id: string;
      transaction_date: string;
      post_date: string | null;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      bank_certification_status: "provisional" | "statement_certified";
    };
    next: {
      accountId: string;
      date: string;
      postDate: string | null;
      description: string;
      amountMinor: number;
      entryType: "expense" | "income" | "transfer";
      transferDirection: "in" | "out" | null;
    };
  }
) {
  if (input.current.bank_certification_status !== "statement_certified") {
    return;
  }

  const bankFactsChanged = input.current.account_id !== input.next.accountId
    || input.current.transaction_date !== input.next.date
    || (input.current.post_date ?? null) !== (input.next.postDate ?? null)
    || input.current.description !== input.next.description
    || Number(input.current.amount_minor) !== Number(input.next.amountMinor)
    || input.current.entry_type !== input.next.entryType
    || (input.current.transfer_direction ?? null) !== (input.next.transferDirection ?? null);

  if (!bankFactsChanged) {
    return;
  }

  const lockedCheckpoint = await findClosedStatementCheckpointForTransaction(db, {
    accountId: input.current.account_id,
    transactionDate: input.current.transaction_date
  });

  if (!lockedCheckpoint) {
    return;
  }

  throw new Error(
    `This entry's bank facts are locked by the ${lockedCheckpoint.checkpoint_month} statement certificate. Change category, note, ownership, or splits here; use a replacement statement or adjustment for bank-fact corrections.`
  );
}

async function findClosedStatementCheckpointForTransaction(
  db: D1Database,
  input: {
    accountId: string;
    transactionDate: string;
  }
) {
  return db
    .prepare(`
      SELECT checkpoint_month, statement_start_date, statement_end_date
      FROM account_balance_checkpoints
      WHERE household_id = ?
        AND account_id = ?
        AND COALESCE(statement_start_date, checkpoint_month || '-01') <= ?
        AND COALESCE(statement_end_date, date(checkpoint_month || '-01', '+1 month', '-1 day')) >= ?
      ORDER BY statement_end_date DESC, checkpoint_month DESC
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.transactionDate, input.transactionDate)
    .first<{ checkpoint_month: string; statement_start_date: string | null; statement_end_date: string | null }>();
}

// Unlinks both halves of a transfer pair and removes the pair's group.
function buildTransferGroupDissolveStatements(db: D1Database, transferGroupId: string) {
  return [
    db
      .prepare("UPDATE transactions SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND transfer_group_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transferGroupId),
    db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, transferGroupId)
  ];
}

export async function updateEntryRecord(
  db: D1Database,
  input: {
    entryId: string;
    date: string;
    description: string;
    accountId?: string;
    accountName?: string;
    categoryName: string;
    amountMinor?: number;
    entryType?: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    offsetsCategory?: boolean;
    note?: string;
    splitBasisPoints?: number;
    postDate?: string | null;
  }
) {
  const account = input.accountId
    ? await db
      .prepare("SELECT id, account_name, owner_person_id FROM accounts WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
      .first<{ id: string; account_name: string; owner_person_id: string | null }>()
    : await db
      .prepare("SELECT id, account_name, owner_person_id FROM accounts WHERE household_id = ? AND account_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.accountName ?? "")
      .first<{ id: string; account_name: string; owner_person_id: string | null }>();

  if (!account) {
    throw new Error(`Unknown account: ${input.accountName ?? input.accountId ?? "Unassigned"}`);
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  let ownerPersonId = account.owner_person_id;
  if (input.ownerName) {
    const owner = await db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.ownerName)
      .first<{ id: string }>();

    if (!owner) {
      throw new Error(`Unknown owner: ${input.ownerName}`);
    }

    ownerPersonId = owner.id;
  }

  const transaction = await db
    .prepare(`
      SELECT
        transactions.amount_minor,
        transactions.currency,
        transactions.account_id,
        transactions.transaction_date,
        transactions.post_date,
        transactions.transfer_group_id,
        transactions.transfer_direction,
        transactions.entry_type,
        transactions.description,
        transactions.bank_certification_status,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.id = ? AND transactions.household_id = ?
    `)
    .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
    .first<{
      amount_minor: number;
      currency: string;
      account_id: string;
      transaction_date: string;
      post_date: string | null;
      transfer_group_id: string | null;
      transfer_direction: "in" | "out" | null;
      entry_type: "expense" | "income" | "transfer";
      description: string;
      bank_certification_status: "provisional" | "statement_certified";
      category_name: string | null;
    }>();

  if (!transaction) {
    throw new Error(`Unknown entry: ${input.entryId}`);
  }

  const resolvedAmountMinor = typeof input.amountMinor === "number" && input.amountMinor > 0
    ? input.amountMinor
    : Number(transaction.amount_minor);
  const resolvedEntryType = input.entryType ?? transaction.entry_type;
  const resolvedTransferDirection = resolvedEntryType === "transfer"
    ? (input.transferDirection ?? transaction.transfer_direction ?? "out")
    : null;
  const resolvedPostDate = input.postDate === undefined ? transaction.post_date : input.postDate;

  await assertUnlockedBankFactsForEntryUpdate(db, {
    transactionId: input.entryId,
    current: transaction,
    next: {
      accountId: account.id,
      date: input.date,
      postDate: resolvedPostDate ?? null,
      description: input.description,
      amountMinor: resolvedAmountMinor,
      entryType: resolvedEntryType,
      transferDirection: resolvedTransferDirection
    }
  });

  // A linked split expense mirrors the ledger amount, so an amount change
  // moves the split total and shares in the same batch as the entry.
  const linkedSplitStatements = resolvedEntryType === "expense" && resolvedAmountMinor !== Number(transaction.amount_minor)
    ? await buildLinkedSplitAmountStatements(db, {
        entryId: input.entryId,
        entryCurrency: transaction.currency,
        amountMinor: resolvedAmountMinor
      })
    : [];

  const previousMonth = transaction.transaction_date.slice(0, 7);
  const nextMonth = input.date.slice(0, 7);
  const previousClearedDate = transaction.post_date ?? transaction.transaction_date;
  const nextClearedDate = resolvedPostDate ?? input.date;
  const monthsToRecalculate = new Set([
    previousMonth,
    nextMonth,
    previousClearedDate.slice(0, 7),
    nextClearedDate.slice(0, 7)
  ]);

  const statements = [
    db
    .prepare(`
      UPDATE transactions
      SET
        transaction_date = ?,
        description = ?,
        account_id = ?,
        amount_minor = ?,
        entry_type = ?,
        transfer_direction = ?,
        post_date = ?,
        transfer_group_id = ?,
        category_id = ?,
        owner_person_id = ?,
        offsets_category = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.date,
      input.description,
      account.id,
      resolvedAmountMinor,
      resolvedEntryType,
      resolvedTransferDirection,
      resolvedPostDate ?? null,
      resolvedEntryType === "transfer" ? transaction.transfer_group_id : null,
      category.id,
      ownerPersonId,
      input.offsetsCategory ? 1 : 0,
      input.note ?? null,
      input.entryId,
      DEFAULT_HOUSEHOLD_ID
    )
  ];

  if (resolvedEntryType !== "transfer" && transaction.transfer_group_id) {
    statements.push(...buildTransferGroupDissolveStatements(db, transaction.transfer_group_id));
  }

  statements.push(
    ...linkedSplitStatements,
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_updated",
      detail: `Updated entry ${input.description} on ${input.date} in ${account.account_name}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, monthsToRecalculate)
  );
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, monthsToRecalculate);

  if (transaction.category_name && transaction.category_name !== input.categoryName) {
    await recordCategoryMatchSuggestion(db, {
      description: input.description || transaction.description,
      categoryName: input.categoryName
    });
  }

  if (input.ownershipType === "shared" && resolvedEntryType === "expense") {
    await upsertLinkedSplitExpenseForEntryRecord(db, {
      entryId: input.entryId,
      splitBasisPoints: input.splitBasisPoints
    });
  }

  return { entryId: input.entryId, updated: true };
}

export async function updateEntryNoteRecord(
  db: D1Database,
  input: {
    entryId: string;
    note?: string;
  }
) {
  const transaction = await db
    .prepare("SELECT id FROM transactions WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{ id: string }>();
  if (!transaction) {
    throw new Error("Entry not found.");
  }

  await db.batch([
    db
      .prepare("UPDATE transactions SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(input.note ?? null, DEFAULT_HOUSEHOLD_ID, input.entryId),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_note_updated",
      detail: "Updated entry note from linked split note sync."
    })
  ]);

  return { entryId: input.entryId, updated: true };
}

export async function updateEntryCategoryRecord(
  db: D1Database,
  input: {
    entryId: string;
    categoryName: string;
  }
) {
  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  const transaction = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.description,
        transactions.transaction_date,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{
      id: string;
      description: string;
      transaction_date: string;
      category_name: string | null;
    }>();

  if (!transaction) {
    throw new Error("Entry not found.");
  }

  const months = [transaction.transaction_date.slice(0, 7)];
  await db.batch([
    db
      .prepare("UPDATE transactions SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(category.id, DEFAULT_HOUSEHOLD_ID, input.entryId),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_category_updated",
      detail: `Updated entry category from linked split category sync to ${input.categoryName}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  if (transaction.category_name && transaction.category_name !== input.categoryName) {
    await recordCategoryMatchSuggestion(db, {
      description: transaction.description,
      categoryName: input.categoryName
    });
  }

  return { entryId: input.entryId, updated: true };
}

export async function updateEntryPostDateRecord(
  db: D1Database,
  input: {
    entryId: string;
    postDate: string;
  }
) {
  const transaction = await db
    .prepare(`
      SELECT
        transactions.account_id,
        transactions.transaction_date,
        transactions.post_date,
        transactions.description,
        transactions.bank_certification_status
      FROM transactions
      WHERE transactions.id = ? AND transactions.household_id = ?
    `)
    .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
    .first<{
      account_id: string;
      transaction_date: string;
      post_date: string | null;
      description: string;
      bank_certification_status: "provisional" | "statement_certified";
    }>();

  if (!transaction) {
    throw new Error(`Unknown entry: ${input.entryId}`);
  }

  if (transaction.bank_certification_status === "statement_certified") {
    throw new Error("This entry is already statement-certified. Posted date changes need a replacement statement or adjustment.");
  }

  const normalizedPostDate = normalizeStatementDate(input.postDate);
  if (!normalizedPostDate) {
    throw new Error("Posted date must use YYYY-MM-DD.");
  }

  const months = [transaction.transaction_date.slice(0, 7)];
  await db.batch([
    db
      .prepare(`
        UPDATE transactions
        SET
          post_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(normalizedPostDate, input.entryId, DEFAULT_HOUSEHOLD_ID),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_post_date_updated",
      detail: `Updated posted date for ${transaction.description} from ${transaction.post_date ?? "unset"} to ${normalizedPostDate}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return { entryId: input.entryId, postDate: normalizedPostDate, updated: true };
}

export async function updateEntryClassificationRecord(
  db: D1Database,
  input: {
    entryId: string;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    categoryName: string;
  }
) {
  const transaction = await db
    .prepare(`
      SELECT
        transactions.account_id,
        transactions.amount_minor,
        transactions.transfer_group_id,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.post_date,
        transactions.description,
        transactions.transaction_date,
        transactions.bank_certification_status,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.id = ? AND transactions.household_id = ?
    `)
    .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
    .first<{
      account_id: string;
      amount_minor: number;
      transfer_group_id: string | null;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      post_date: string | null;
      description: string;
      transaction_date: string;
      bank_certification_status: "provisional" | "statement_certified";
      category_name: string | null;
    }>();

  if (!transaction) {
    throw new Error(`Unknown entry: ${input.entryId}`);
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  const nextTransferDirection = input.entryType === "transfer" ? (input.transferDirection ?? "out") : null;
  const nextTransferGroupId = input.entryType === "transfer" ? transaction.transfer_group_id : null;

  await assertUnlockedBankFactsForEntryUpdate(db, {
    transactionId: input.entryId,
    current: transaction,
    next: {
      accountId: transaction.account_id,
      date: transaction.transaction_date,
      postDate: transaction.post_date ?? null,
      description: transaction.description,
      amountMinor: Number(transaction.amount_minor),
      entryType: input.entryType,
      transferDirection: nextTransferDirection
    }
  });

  const statements = [
    db
      .prepare(`
        UPDATE transactions
        SET
          entry_type = ?,
          transfer_direction = ?,
          transfer_group_id = ?,
          category_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.entryType, nextTransferDirection, nextTransferGroupId, category.id, input.entryId, DEFAULT_HOUSEHOLD_ID)
  ];

  if (input.entryType !== "transfer" && transaction.transfer_group_id) {
    statements.push(...buildTransferGroupDissolveStatements(db, transaction.transfer_group_id));
  }

  const months = [transaction.transaction_date.slice(0, 7)];
  statements.push(
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_classification_updated",
      detail: `Updated entry classification for ${transaction.description} on ${transaction.transaction_date}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  );
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  if (transaction.category_name && transaction.category_name !== input.categoryName) {
    await recordCategoryMatchSuggestion(db, {
      description: transaction.description,
      categoryName: input.categoryName
    });
  }

  return { entryId: input.entryId, updated: true };
}

export async function createEntryRecord(
  db: D1Database,
  input: {
    date: string;
    postDate?: string | null;
    description: string;
    accountId?: string;
    accountName?: string;
    categoryName: string;
    amountMinor: number;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    offsetsCategory?: boolean;
    note?: string;
    splitBasisPoints?: number;
    externalReference?: string;
  }
) {
  if (typeof input.amountMinor !== "number" || input.amountMinor <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const accountId = input.accountId ?? await resolveAccountId(db, input.accountName);
  if (!accountId) {
    throw new Error(`Unknown account: ${input.accountName ?? "Unassigned"}`);
  }
  const account = await db
    .prepare(`
      SELECT account_name, owner_person_id, currency
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, accountId)
    .first<{ account_name: string; owner_person_id: string | null; currency: string }>();
  if (!account) {
    throw new Error(`Unknown account: ${input.accountName ?? accountId}`);
  }
  const accountName = account.account_name;
  const currency = account.currency.toUpperCase();
  const categoryName = input.entryType === "transfer" ? "Transfer" : input.categoryName;
  const categoryId = await resolveCategoryId(db, categoryName);
  const ownerPersonId = input.ownerName
    ? await resolvePersonId(db, input.ownerName)
    : account.owner_person_id ?? null;
  const transferDirection = input.entryType === "transfer" ? (input.transferDirection ?? "out") : null;
  const externalReference = input.externalReference?.trim() || null;

  if (externalReference) {
    const existing = await loadEntryByExternalReference(db, externalReference);
    if (existing) {
      assertIdempotentEntryMatches(existing, {
        accountId,
        date: input.date,
        postDate: input.postDate ?? null,
        description: input.description,
        amountMinor: input.amountMinor,
        currency,
        entryType: input.entryType,
        transferDirection,
        categoryId,
        ownerPersonId,
        offsetsCategory: input.offsetsCategory ? 1 : 0,
        note: input.note ?? null
      });
      // A replay writes nothing, so it recalculates the months directly.
      await recalculateEntryMonths(db, input.date, input.postDate);
      return {
        entryId: existing.id,
        created: false,
        accountId,
        accountName,
        currency
      };
    }
  }
  const entryId = `txn-${crypto.randomUUID()}`;
  const monthsToRecalculate = new Set([
    input.date.slice(0, 7),
    (input.postDate ?? input.date).slice(0, 7)
  ]);

  try {
    await db.batch([
      db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, transaction_date, post_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, owner_person_id, offsets_category, note, external_reference
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        entryId,
        DEFAULT_HOUSEHOLD_ID,
        accountId,
        input.date,
        input.postDate ?? null,
        input.description,
        input.amountMinor,
        currency,
        input.entryType,
        transferDirection,
        categoryId,
        ownerPersonId,
        input.offsetsCategory ? 1 : 0,
        input.note ?? null,
        externalReference
      ),
      buildAuditEventStatement(db, {
        entityType: "transaction",
        entityId: entryId,
        action: "entry_created",
        detail: `Created ${input.entryType} entry ${input.description} on ${input.date} in ${accountName}.`
      }),
      ...buildMonthlySnapshotRefreshMarkers(db, monthsToRecalculate)
    ]);
  } catch (error) {
    const existing = externalReference
      ? await loadEntryByExternalReference(db, externalReference)
      : null;
    if (!existing) {
      throw error;
    }
    assertIdempotentEntryMatches(existing, {
      accountId,
      date: input.date,
      postDate: input.postDate ?? null,
      description: input.description,
      amountMinor: input.amountMinor,
      currency,
      entryType: input.entryType,
      transferDirection,
      categoryId,
      ownerPersonId,
      offsetsCategory: input.offsetsCategory ? 1 : 0,
      note: input.note ?? null
    });
    await recalculateEntryMonths(db, input.date, input.postDate);
    return {
      entryId: existing.id,
      created: false,
      accountId,
      accountName,
      currency
    };
  }

  await refreshMonthlySnapshotsAfterWrite(db, monthsToRecalculate);

  if (input.ownershipType === "shared" && input.entryType === "expense") {
    await upsertLinkedSplitExpenseForEntryRecord(db, {
      entryId,
      splitBasisPoints: input.splitBasisPoints
    });
  }

  return { entryId, created: true, accountId, accountName, currency };
}

async function recalculateEntryMonths(db: D1Database, date: string, postDate?: string | null) {
  for (const month of new Set([date.slice(0, 7), (postDate ?? date).slice(0, 7)])) {
    await recalculateMonthlySnapshots(db, month);
  }
}

interface IdempotentEntryRow {
  id: string;
  account_id: string;
  transaction_date: string;
  post_date: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  entry_type: string;
  transfer_direction: string | null;
  category_id: string | null;
  owner_person_id: string | null;
  offsets_category: number;
  note: string | null;
}

interface IdempotentEntryExpected {
  accountId: string;
  date: string;
  postDate: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  entryType: "expense" | "income" | "transfer";
  transferDirection: "in" | "out" | null;
  categoryId: string | null;
  ownerPersonId: string | null;
  offsetsCategory: number;
  note: string | null;
}

async function loadEntryByExternalReference(db: D1Database, externalReference: string) {
  return db
    .prepare(`
      SELECT
        id,
        account_id,
        transaction_date,
        post_date,
        description,
        amount_minor,
        currency,
        entry_type,
        transfer_direction,
        category_id,
        owner_person_id,
        offsets_category,
        note
      FROM transactions
      WHERE household_id = ? AND external_reference = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, externalReference)
    .first<IdempotentEntryRow>();
}

function assertIdempotentEntryMatches(
  existing: IdempotentEntryRow,
  expected: IdempotentEntryExpected
) {
  const matches = existing.account_id === expected.accountId
    && existing.transaction_date === expected.date
    && (existing.post_date ?? null) === (expected.postDate ?? null)
    && existing.description === expected.description
    && Number(existing.amount_minor) === expected.amountMinor
    && existing.currency === expected.currency
    && existing.entry_type === expected.entryType
    && existing.transfer_direction === expected.transferDirection
    && existing.category_id === expected.categoryId
    && existing.owner_person_id === expected.ownerPersonId
    && Number(existing.offsets_category) === expected.offsetsCategory
    && existing.note === expected.note;
  if (!matches) {
    throw new Error("Shortcut request ID was already used for a different entry.");
  }
}

export async function deleteEntryRecord(
  db: D1Database,
  input: {
    entryId: string;
  }
) {
  const transaction = await db
    .prepare(`
      SELECT
        id,
        transaction_date,
        description,
        transfer_group_id
      FROM transactions
      WHERE household_id = ?
        AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{
      id: string;
      transaction_date: string;
      description: string;
      transfer_group_id: string | null;
    }>();

  if (!transaction) {
    throw new Error("Entry not found.");
  }

  const months = [transaction.transaction_date.slice(0, 7)];
  await db.batch([
    ...(transaction.transfer_group_id ? buildTransferGroupDissolveStatements(db, transaction.transfer_group_id) : []),
    db
      .prepare("DELETE FROM monthly_plan_entry_links WHERE transaction_id = ?")
      .bind(input.entryId),
    db
      .prepare("UPDATE split_expenses SET linked_transaction_id = NULL WHERE linked_transaction_id = ?")
      .bind(input.entryId),
    db
      .prepare("UPDATE split_settlements SET linked_transaction_id = NULL WHERE linked_transaction_id = ?")
      .bind(input.entryId),
    db
      .prepare("DELETE FROM transactions WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.entryId),
    buildAuditEventStatement(db, {
      entityType: "transaction",
      entityId: input.entryId,
      action: "entry_deleted",
      detail: `Deleted entry ${transaction.description} on ${transaction.transaction_date}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return {
    entryId: input.entryId,
    deleted: true
  };
}

export async function linkTransferPair(
  db: D1Database,
  input: {
    fromEntryId: string;
    toEntryId: string;
  }
) {
  if (input.fromEntryId === input.toEntryId) {
    throw new Error("Transfer pair requires two different entries");
  }

  const [fromEntry, toEntry] = await Promise.all([
    db
      .prepare(`
        SELECT id, household_id, amount_minor, transfer_group_id, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.fromEntryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; amount_minor: number; transfer_group_id: string | null; transaction_date: string }>(),
    db
      .prepare(`
        SELECT id, household_id, amount_minor, transfer_group_id, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.toEntryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; amount_minor: number; transfer_group_id: string | null; transaction_date: string }>()
  ]);

  if (!fromEntry || !toEntry) {
    throw new Error("Transfer entries not found");
  }

  if (fromEntry.amount_minor !== toEntry.amount_minor) {
    throw new Error("Transfer matches require an exact amount match");
  }

  const transferCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, "Transfer")
    .first<{ id: string }>();

  if (!transferCategory) {
    throw new Error("Transfer category not found");
  }

  const staleGroupIds = [fromEntry.transfer_group_id, toEntry.transfer_group_id].filter((id): id is string => Boolean(id));
  const statements: D1PreparedStatement[] = [];
  for (const groupId of staleGroupIds) {
    statements.push(
      db
        .prepare("UPDATE transactions SET transfer_group_id = NULL WHERE household_id = ? AND transfer_group_id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, groupId),
      db
        .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, groupId)
    );
  }

  const groupId = `tg-${crypto.randomUUID()}`;
  const months = new Set([fromEntry.transaction_date.slice(0, 7), toEntry.transaction_date.slice(0, 7)]);
  statements.push(
    db
      .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
      .bind(groupId, DEFAULT_HOUSEHOLD_ID, "Linked from entries editor", 1),
    db
      .prepare(`
        UPDATE transactions
        SET
          transfer_group_id = ?,
          entry_type = 'transfer',
          transfer_direction = 'out',
          category_id = ?,
          offsets_category = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(groupId, transferCategory.id, input.fromEntryId, DEFAULT_HOUSEHOLD_ID),
    db
      .prepare(`
        UPDATE transactions
        SET
          transfer_group_id = ?,
          entry_type = 'transfer',
          transfer_direction = 'in',
          category_id = ?,
          offsets_category = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(groupId, transferCategory.id, input.toEntryId, DEFAULT_HOUSEHOLD_ID),
    buildAuditEventStatement(db, {
      entityType: "transfer_group",
      entityId: groupId,
      action: "transfer_linked",
      detail: `Linked transfer pair ${input.fromEntryId} -> ${input.toEntryId}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  );
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return { groupId, linked: true };
}

export async function settleTransferPair(
  db: D1Database,
  input: {
    entryId: string;
    counterpartEntryId?: string;
    currentCategoryName: string;
    counterpartCategoryName?: string;
  }
) {
  const [currentEntry, counterpartFromInput] = await Promise.all([
    db
      .prepare(`
        SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
        FROM transactions
        WHERE id = ? AND household_id = ?
      `)
      .bind(input.entryId, DEFAULT_HOUSEHOLD_ID)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>(),
    input.counterpartEntryId
      ? db
          .prepare(`
            SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
            FROM transactions
            WHERE id = ? AND household_id = ?
          `)
          .bind(input.counterpartEntryId, DEFAULT_HOUSEHOLD_ID)
          .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>()
      : Promise.resolve(null)
  ]);

  if (!currentEntry) {
    throw new Error("Transfer entry not found");
  }

  let counterpartEntry = counterpartFromInput;
  if (!counterpartEntry && currentEntry.transfer_group_id) {
    counterpartEntry = await db
      .prepare(`
        SELECT id, household_id, transfer_group_id, transfer_direction, transaction_date
        FROM transactions
        WHERE household_id = ? AND transfer_group_id = ? AND id != ?
        LIMIT 1
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, currentEntry.transfer_group_id, currentEntry.id)
      .first<{ id: string; household_id: string; transfer_group_id: string | null; transfer_direction: "in" | "out" | null; transaction_date: string }>();
  }

  const currentCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.currentCategoryName)
    .first<{ id: string }>();

  if (!currentCategory) {
    throw new Error(`Unknown category: ${input.currentCategoryName}`);
  }

  let counterpartCategoryId: string | null = null;
  if (counterpartEntry) {
    const counterpartCategory = await db
      .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.counterpartCategoryName ?? "Other")
      .first<{ id: string }>();

    if (!counterpartCategory) {
      throw new Error(`Unknown counterpart category: ${input.counterpartCategoryName ?? "Other"}`);
    }

    counterpartCategoryId = counterpartCategory.id;
  }

  const statements = [
    db
      .prepare(`
        UPDATE transactions
        SET
          entry_type = ?,
          transfer_direction = NULL,
          transfer_group_id = NULL,
          category_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        currentEntry.transfer_direction === "in" ? "income" : "expense",
        currentCategory.id,
        currentEntry.id,
        DEFAULT_HOUSEHOLD_ID
      )
  ];

  if (counterpartEntry && counterpartCategoryId) {
    statements.push(db
      .prepare(`
        UPDATE transactions
        SET
          entry_type = ?,
          transfer_direction = NULL,
          transfer_group_id = NULL,
          category_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        counterpartEntry.transfer_direction === "in" ? "income" : "expense",
        counterpartCategoryId,
        counterpartEntry.id,
        DEFAULT_HOUSEHOLD_ID
      ));
  }

  const groupIds = new Set([currentEntry.transfer_group_id, counterpartEntry?.transfer_group_id].filter(Boolean));
  for (const groupId of groupIds) {
    statements.push(db
      .prepare("DELETE FROM transfer_groups WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, groupId));
  }

  const months = new Set(
    [currentEntry.transaction_date.slice(0, 7), counterpartEntry?.transaction_date?.slice(0, 7)]
      .filter((month): month is string => Boolean(month))
  );
  statements.push(
    buildAuditEventStatement(db, {
      entityType: "transfer_group",
      entityId: currentEntry.transfer_group_id ?? currentEntry.id,
      action: "transfer_settled",
      detail: `Broke transfer pair and converted ${currentEntry.id}${counterpartEntry ? ` and ${counterpartEntry.id}` : ""} into regular categories.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  );
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return { settled: true };
}
