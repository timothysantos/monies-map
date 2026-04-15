import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  buildAccountHealth,
  computeCheckpointLedgerBalanceMinor,
  formatMoneyMinor,
  normalizeAccountOpeningBalanceMinor,
  normalizeStatementBalanceMinor,
  slugify
} from "./app-repository-helpers";
import { recordAuditEvent } from "./app-repository-audit";
import type { AccountDto, HouseholdDto } from "../types/dto";

export async function loadHousehold(db: D1Database): Promise<HouseholdDto> {
  const row = await db
    .prepare("SELECT id, name, currency FROM households WHERE id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; name: string; currency: string }>();

  const people = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();

  return {
    id: row?.id ?? DEFAULT_HOUSEHOLD_ID,
    name: row?.name ?? "Household",
    currency: row?.currency ?? "SGD",
    people: people.results.map((person) => ({ id: person.id, name: person.display_name }))
  };
}

export async function loadAccounts(db: D1Database): Promise<AccountDto[]> {
  const result = await db
    .prepare(`
      SELECT
        accounts.id,
        accounts.institution_id,
        institutions.name AS institution_name,
        accounts.owner_person_id,
        people.display_name AS owner_name,
        accounts.account_name,
        accounts.account_kind,
        accounts.currency,
        accounts.opening_balance_minor,
        accounts.is_joint,
        accounts.is_active
      FROM accounts
      INNER JOIN institutions ON institutions.id = accounts.institution_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE accounts.household_id = ?
      ORDER BY lower(institutions.name), lower(accounts.account_name)
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      institution_id: string;
      institution_name: string;
      owner_person_id: string | null;
      owner_name: string | null;
      account_name: string;
      account_kind: "bank" | "credit_card" | "cash" | "investment";
      currency: string;
      opening_balance_minor: number;
      is_joint: number;
      is_active: number;
    }>();

  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.account_id,
        transactions.transaction_date,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.transfer_group_id,
        imports.imported_at
      FROM transactions
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      transaction_date: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      transfer_group_id: string | null;
      imported_at: string | null;
    }>();

  const latestCheckpointRows = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
        statement_start_date,
        statement_end_date,
        statement_balance_minor
      FROM account_balance_checkpoints
      WHERE household_id = ?
        AND checkpoint_month = (
          SELECT MAX(inner_checkpoint.checkpoint_month)
          FROM account_balance_checkpoints AS inner_checkpoint
          WHERE inner_checkpoint.household_id = account_balance_checkpoints.household_id
            AND inner_checkpoint.account_id = account_balance_checkpoints.account_id
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
    }>();

  const checkpointHistoryRows = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
        statement_start_date,
        statement_end_date,
        statement_balance_minor,
        note
      FROM account_balance_checkpoints
      WHERE household_id = ?
      ORDER BY checkpoint_month DESC, created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
      note: string | null;
    }>();

  const checkpointByAccountId = new Map(
    latestCheckpointRows.results.map((row) => [row.account_id, row])
  );

  const transferGroupSizes = new Map<string, number>();
  for (const row of transactionRows.results) {
    if (!row.transfer_group_id) {
      continue;
    }

    transferGroupSizes.set(row.transfer_group_id, (transferGroupSizes.get(row.transfer_group_id) ?? 0) + 1);
  }

  const balanceByAccountId = new Map<string, number>();
  const latestTransactionDateByAccountId = new Map<string, string>();
  const latestImportAtByAccountId = new Map<string, string>();
  const unresolvedTransferCountByAccountId = new Map<string, number>();
  const checkpointLedgerNetByAccountId = new Map<string, number>();
  const checkpointHistoryByAccountId = new Map<string, AccountDto["checkpointHistory"]>();
  const openingBalanceByAccountId = new Map(
    result.results.map((account) => [
      account.id,
      normalizeAccountOpeningBalanceMinor(Number(account.opening_balance_minor ?? 0), account.account_kind)
    ])
  );
  const accountKindByAccountId = new Map(
    result.results.map((account) => [account.id, account.account_kind])
  );

  for (const row of transactionRows.results) {
    const signedAmount = row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
      ? Number(row.amount_minor)
      : -Number(row.amount_minor);
    balanceByAccountId.set(row.account_id, (balanceByAccountId.get(row.account_id) ?? 0) + signedAmount);

    const currentLatestDate = latestTransactionDateByAccountId.get(row.account_id);
    if (!currentLatestDate || row.transaction_date > currentLatestDate) {
      latestTransactionDateByAccountId.set(row.account_id, row.transaction_date);
    }

    if (row.imported_at) {
      const currentLatestImport = latestImportAtByAccountId.get(row.account_id);
      if (!currentLatestImport || row.imported_at > currentLatestImport) {
        latestImportAtByAccountId.set(row.account_id, row.imported_at);
      }
    }

    if (row.entry_type === "transfer" && (!row.transfer_group_id || (transferGroupSizes.get(row.transfer_group_id) ?? 0) < 2)) {
      unresolvedTransferCountByAccountId.set(
        row.account_id,
        (unresolvedTransferCountByAccountId.get(row.account_id) ?? 0) + 1
      );
    }
  }

  for (const checkpoint of latestCheckpointRows.results) {
    checkpointLedgerNetByAccountId.set(
      checkpoint.account_id,
      computeCheckpointLedgerBalanceMinor({
        openingBalanceMinor: openingBalanceByAccountId.get(checkpoint.account_id) ?? 0,
        checkpoint,
        rows: transactionRows.results
      })
    );
  }

  for (const checkpoint of checkpointHistoryRows.results) {
    const computedBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: openingBalanceByAccountId.get(checkpoint.account_id) ?? 0,
      checkpoint,
      rows: transactionRows.results
    });
    const statementBalanceMinor = normalizeStatementBalanceMinor(
      Number(checkpoint.statement_balance_minor ?? 0),
      accountKindByAccountId.get(checkpoint.account_id)
    );
    const currentHistory = checkpointHistoryByAccountId.get(checkpoint.account_id) ?? [];
    currentHistory.push({
      month: checkpoint.checkpoint_month,
      statementStartDate: checkpoint.statement_start_date ?? undefined,
      statementEndDate: checkpoint.statement_end_date ?? undefined,
      statementBalanceMinor,
      computedBalanceMinor,
      deltaMinor: computedBalanceMinor - statementBalanceMinor,
      note: checkpoint.note ?? undefined
    });
    checkpointHistoryByAccountId.set(checkpoint.account_id, currentHistory);
  }

  return result.results.map((row) => ({
    ...buildAccountHealth({
      accountId: row.id,
      openingBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(row.opening_balance_minor ?? 0), row.account_kind),
      latestTransactionDate: latestTransactionDateByAccountId.get(row.id),
      latestImportAt: latestImportAtByAccountId.get(row.id),
      unresolvedTransferCount: unresolvedTransferCountByAccountId.get(row.id) ?? 0,
      currentLedgerBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(row.opening_balance_minor ?? 0), row.account_kind) + (balanceByAccountId.get(row.id) ?? 0),
      checkpoint: checkpointByAccountId.get(row.id),
      accountKind: row.account_kind,
      checkpointLedgerNetMinor: checkpointLedgerNetByAccountId.get(row.id),
      checkpointHistory: checkpointHistoryByAccountId.get(row.id) ?? []
    }),
    id: row.id,
    institutionId: row.institution_id,
    ownerPersonId: row.owner_person_id ?? undefined,
    name: row.account_name,
    institution: row.institution_name,
    kind: row.account_kind,
    ownerLabel: row.owner_name ?? "Shared",
    currency: row.currency,
    isJoint: Boolean(row.is_joint),
    isActive: Boolean(row.is_active),
    openingBalanceMinor: Number(row.opening_balance_minor ?? 0)
  }));
}

async function findOrCreateInstitution(db: D1Database, name: string) {
  const trimmed = name.trim();
  const existing = await db
    .prepare(`
      SELECT id
      FROM institutions
      WHERE household_id = ? AND lower(name) = lower(?)
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, trimmed)
    .first<{ id: string }>();

  if (existing) {
    return existing.id;
  }

  const id = `inst-${slugify(trimmed)}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(`
      INSERT INTO institutions (id, household_id, name)
      VALUES (?, ?, ?)
    `)
    .bind(id, DEFAULT_HOUSEHOLD_ID, trimmed)
    .run();

  return id;
}

export async function createAccountRecord(
  db: D1Database,
  input: {
    name: string;
    institution: string;
    kind: string;
    currency: string;
    openingBalanceMinor?: number;
    ownerPersonId?: string | null;
    isJoint?: boolean;
  }
) {
  const institutionId = await findOrCreateInstitution(db, input.institution);
  const accountId = `account-${slugify(input.name)}-${crypto.randomUUID().slice(0, 8)}`;
  const ownerPersonId = input.ownerPersonId?.trim() ? input.ownerPersonId : null;
  const isJoint = input.isJoint ?? !ownerPersonId;

  await db
    .prepare(`
      INSERT INTO accounts (
        id, household_id, institution_id, owner_person_id,
        account_name, account_kind, currency, opening_balance_minor, is_joint, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `)
    .bind(
      accountId,
      DEFAULT_HOUSEHOLD_ID,
      institutionId,
      ownerPersonId,
      input.name.trim(),
      input.kind,
      input.currency.trim() || "SGD",
      Math.round(input.openingBalanceMinor ?? 0),
      isJoint ? 1 : 0
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: accountId,
    action: "account_created",
    detail: `Created account ${input.name.trim()} with opening balance ${formatMoneyMinor(input.openingBalanceMinor ?? 0)}.`
  });

  return { accountId, created: true };
}

export async function updateAccountRecord(
  db: D1Database,
  input: {
    accountId: string;
    name: string;
    institution: string;
    kind: string;
    currency: string;
    openingBalanceMinor?: number;
    ownerPersonId?: string | null;
    isJoint?: boolean;
  }
) {
  const existing = await db
    .prepare(`
      SELECT id, account_name, opening_balance_minor
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
    .first<{ id: string; account_name: string; opening_balance_minor: number }>();

  if (!existing) {
    throw new Error(`Unknown account: ${input.accountId}`);
  }

  const institutionId = await findOrCreateInstitution(db, input.institution);
  const ownerPersonId = input.ownerPersonId?.trim() ? input.ownerPersonId : null;
  const isJoint = input.isJoint ?? !ownerPersonId;

  await db
    .prepare(`
      UPDATE accounts
      SET institution_id = ?, owner_person_id = ?, account_name = ?, account_kind = ?, currency = ?, opening_balance_minor = ?, is_joint = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(
      institutionId,
      ownerPersonId,
      input.name.trim(),
      input.kind,
      input.currency.trim() || "SGD",
      Math.round(input.openingBalanceMinor ?? 0),
      isJoint ? 1 : 0,
      DEFAULT_HOUSEHOLD_ID,
      input.accountId
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "account_updated",
    detail: `Updated ${existing.account_name} -> ${input.name.trim()}; opening balance ${formatMoneyMinor(existing.opening_balance_minor)} -> ${formatMoneyMinor(input.openingBalanceMinor ?? 0)}.`
  });

  return { accountId: input.accountId, updated: true };
}

export async function updatePersonRecord(
  db: D1Database,
  input: {
    personId: string;
    name: string;
  }
) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Person name is required.");
  }

  const existing = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.personId)
    .first<{ id: string; display_name: string }>();

  if (!existing) {
    throw new Error(`Unknown person: ${input.personId}`);
  }

  await db
    .prepare(`
      UPDATE people
      SET display_name = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(trimmedName, DEFAULT_HOUSEHOLD_ID, input.personId)
    .run();

  await recordAuditEvent(db, {
    entityType: "person",
    entityId: input.personId,
    action: "person_updated",
    detail: `Updated person ${existing.display_name} -> ${trimmedName}.`
  });

  return { personId: input.personId, updated: true };
}

export async function archiveAccountRecord(
  db: D1Database,
  input: {
    accountId: string;
  }
) {
  const existing = await db
    .prepare("SELECT account_name FROM accounts WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
    .first<{ account_name: string }>();

  await db
    .prepare(`
      UPDATE accounts
      SET is_active = 0
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "account_archived",
    detail: `Archived account ${existing?.account_name ?? input.accountId}.`
  });

  return { accountId: input.accountId, archived: true };
}

export async function loadUnresolvedTransfers(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.transfer_direction,
        accounts.account_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      LEFT JOIN (
        SELECT transfer_group_id, COUNT(*) AS pair_count
        FROM transactions
        WHERE household_id = ? AND transfer_group_id IS NOT NULL
        GROUP BY transfer_group_id
      ) AS grouped ON grouped.transfer_group_id = transactions.transfer_group_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type = 'transfer'
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
        AND (
          transactions.transfer_group_id IS NULL
          OR COALESCE(grouped.pair_count, 0) < 2
        )
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
      LIMIT 8
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      transfer_direction: "in" | "out" | null;
      account_name: string;
    }>();

  return result.results.map((row) => ({
    entryId: row.id,
    date: row.transaction_date,
    description: row.description,
    accountName: row.account_name,
    amountMinor: Number(row.amount_minor),
    transferDirection: row.transfer_direction ?? undefined
  }));
}

export async function loadAuditEvents(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT id, entity_type, entity_id, action, detail, created_at
      FROM audit_events
      WHERE household_id = ?
      ORDER BY created_at DESC
      LIMIT 12
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; entity_type: string; entity_id: string; action: string; detail: string; created_at: string }>();

  return result.results.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at
  }));
}
