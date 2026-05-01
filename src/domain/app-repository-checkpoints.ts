import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { recordAuditEvent } from "./app-repository-audit";
import {
  compareDescriptionSimilarity,
  daysBetween,
  escapeCsvCell,
  findStatementCompareDuplicateGroups,
  formatMoneyCsvMinor,
  formatMoneyMinor,
  getMonthBounds,
  getMonthEndDate,
  getSignedLedgerAmountMinor,
  normalizeAccountOpeningBalanceMinor,
  normalizeImportRow,
  normalizeStatementBalanceInputMinor,
  normalizeStoredStatementBalanceMinor,
  normalizeStatementDate
} from "./app-repository-helpers";
import type { StatementCompareDto, StatementCompareRowDto } from "../types/dto";

export async function saveAccountCheckpointRecord(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
    statementStartDate?: string | null;
    statementEndDate?: string | null;
    statementBalanceMinor: number;
    note?: string;
  }
) {
  const account = await db
    .prepare(`
      SELECT id, account_kind
      FROM accounts
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId)
    .first<{ id: string; account_kind: string }>();

  const existingCheckpoint = await db
    .prepare(`
      SELECT statement_balance_minor
      FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{ statement_balance_minor: number }>();

  if (!account) {
    throw new Error(`Unknown account: ${input.accountId}`);
  }

  const checkpointId = `checkpoint-${input.accountId}-${input.checkpointMonth}`;
  const statementStartDate = normalizeStatementDate(input.statementStartDate);
  const statementEndDate = normalizeStatementDate(input.statementEndDate);
  const statementBalanceMinor = normalizeStatementBalanceInputMinor(
    Math.round(input.statementBalanceMinor),
    account.account_kind
  );
  await db
    .prepare(`
      INSERT INTO account_balance_checkpoints (
        id, household_id, account_id, checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, checkpoint_month) DO UPDATE SET
        statement_start_date = excluded.statement_start_date,
        statement_end_date = excluded.statement_end_date,
        statement_balance_minor = excluded.statement_balance_minor,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(
      checkpointId,
      DEFAULT_HOUSEHOLD_ID,
      input.accountId,
      input.checkpointMonth,
      statementStartDate,
      statementEndDate,
      statementBalanceMinor,
      input.note?.trim() || null
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "checkpoint_saved",
    detail: existingCheckpoint
      ? `Updated ${input.checkpointMonth} statement checkpoint ${formatMoneyMinor(existingCheckpoint.statement_balance_minor)} -> ${formatMoneyMinor(statementBalanceMinor)}.`
      : `Saved ${input.checkpointMonth} statement checkpoint at ${formatMoneyMinor(statementBalanceMinor)}.`
  });

  return { accountId: input.accountId, checkpointMonth: input.checkpointMonth, saved: true };
}

export async function deleteAccountCheckpointRecord(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
  }
) {
  const existingCheckpoint = await db
    .prepare(`
      SELECT statement_balance_minor
      FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{ statement_balance_minor: number }>();

  if (!existingCheckpoint) {
    throw new Error(`Unknown checkpoint: ${input.accountId} ${input.checkpointMonth}`);
  }

  await db
    .prepare(`
      DELETE FROM account_balance_checkpoints
      WHERE household_id = ? AND account_id = ? AND checkpoint_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .run();

  await recordAuditEvent(db, {
    entityType: "account",
    entityId: input.accountId,
    action: "checkpoint_deleted",
    detail: `Deleted ${input.checkpointMonth} statement checkpoint at ${formatMoneyMinor(existingCheckpoint.statement_balance_minor)}.`
  });

  return { accountId: input.accountId, checkpointMonth: input.checkpointMonth, deleted: true };
}

export async function buildAccountCheckpointLedgerCsv(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
  }
) {
  const checkpoint = await db
    .prepare(`
      SELECT
        checkpoints.checkpoint_month,
        checkpoints.statement_start_date,
        checkpoints.statement_end_date,
        checkpoints.statement_balance_minor,
        accounts.account_name,
        accounts.account_kind,
        accounts.opening_balance_minor,
        institutions.name AS institution_name,
        people.display_name AS owner_name
      FROM account_balance_checkpoints AS checkpoints
      INNER JOIN accounts ON accounts.id = checkpoints.account_id
      INNER JOIN institutions ON institutions.id = accounts.institution_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE checkpoints.household_id = ?
        AND checkpoints.account_id = ?
        AND checkpoints.checkpoint_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
      account_name: string;
      account_kind: string;
      opening_balance_minor: number;
      institution_name: string;
      owner_name: string | null;
    }>();

  if (!checkpoint) {
    throw new Error(`Unknown checkpoint: ${input.accountId} ${input.checkpointMonth}`);
  }

  const statementStartDate = checkpoint.statement_start_date ?? getMonthBounds(checkpoint.checkpoint_month)[0];
  const statementEndDate = checkpoint.statement_end_date ?? getMonthEndDate(checkpoint.checkpoint_month);
  const baselineRows = statementStartDate
    ? await db
      .prepare(`
        SELECT
          transactions.amount_minor,
          transactions.entry_type,
          transactions.transfer_direction
        FROM transactions
        LEFT JOIN imports ON imports.id = transactions.import_id
        WHERE transactions.household_id = ?
          AND transactions.account_id = ?
          AND COALESCE(transactions.post_date, transactions.transaction_date) < ?
          AND (transactions.import_id IS NULL OR imports.status = 'completed')
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, statementStartDate)
      .all<{
        amount_minor: number;
        entry_type: "expense" | "income" | "transfer";
        transfer_direction: "in" | "out" | null;
      }>()
    : { results: [] };
  const baselineBalanceMinor = normalizeAccountOpeningBalanceMinor(
    Number(checkpoint.opening_balance_minor ?? 0),
    checkpoint.account_kind
  ) + baselineRows.results.reduce(
    (total, row) => total + getSignedLedgerAmountMinor(row),
    0
  );
  const rows = await db
    .prepare(`
      SELECT
        transactions.id,
        COALESCE(transactions.post_date, transactions.transaction_date) AS cleared_date,
        transactions.description,
        transactions.amount_minor,
        transactions.currency,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.ownership_type,
        transactions.note,
        categories.name AS category_name,
        owner.display_name AS owner_name,
        imports.id AS import_id,
        imports.source_label,
        imports.imported_at
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN people AS owner ON owner.id = transactions.owner_person_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.account_id = ?
        AND COALESCE(transactions.post_date, transactions.transaction_date) <= ?
        AND (? IS NULL OR COALESCE(transactions.post_date, transactions.transaction_date) >= ?)
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY COALESCE(transactions.post_date, transactions.transaction_date), transactions.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, statementEndDate, statementStartDate, statementStartDate)
    .all<{
      id: string;
      cleared_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      ownership_type: "direct" | "shared";
      note: string | null;
      category_name: string | null;
      owner_name: string | null;
      import_id: string | null;
      source_label: string | null;
      imported_at: string | null;
    }>();

  const computedBalanceMinor = baselineBalanceMinor + rows.results.reduce(
    (total, row) => total + getSignedLedgerAmountMinor(row),
    0
  );
  const statementBalanceMinor = normalizeStoredStatementBalanceMinor(
    Number(checkpoint.statement_balance_minor ?? 0),
    checkpoint.account_kind,
    computedBalanceMinor
  );

  const csvRows = [
    [
      "checkpoint_month",
      "statement_start_date",
      "statement_end_date",
      "statement_balance",
      "account",
      "institution",
      "account_owner",
      "date",
      "type",
      "transfer_direction",
      "description",
      "category",
      "ownership",
      "entry_owner",
      "amount",
      "signed_amount",
      "currency",
      "note",
      "import",
      "imported_at",
      "transaction_id"
    ],
    [
      checkpoint.checkpoint_month,
      checkpoint.statement_start_date ?? "",
      statementEndDate,
      formatMoneyCsvMinor(statementBalanceMinor),
      checkpoint.account_name,
      checkpoint.institution_name,
      checkpoint.owner_name ?? "",
      "",
      statementStartDate ? "statement_start_balance" : "opening_balance",
      "",
      statementStartDate ? "Ledger balance before statement start" : "Opening balance",
      "",
      "",
      "",
      formatMoneyCsvMinor(baselineBalanceMinor),
      formatMoneyCsvMinor(baselineBalanceMinor),
      "SGD",
      statementStartDate
        ? "Baseline includes opening balance and completed ledger rows before statement_start_date"
        : "Included before ledger rows",
      "",
      "",
      ""
    ],
    ...rows.results.map((row) => {
      const signedAmount = row.entry_type === "income" || (row.entry_type === "transfer" && row.transfer_direction === "in")
        ? Number(row.amount_minor)
        : -Number(row.amount_minor);
      return [
        checkpoint.checkpoint_month,
        checkpoint.statement_start_date ?? "",
        statementEndDate,
        formatMoneyCsvMinor(statementBalanceMinor),
        checkpoint.account_name,
        checkpoint.institution_name,
        checkpoint.owner_name ?? "",
        row.cleared_date,
        row.entry_type,
        row.transfer_direction ?? "",
        row.description,
        row.category_name ?? "",
        row.ownership_type,
        row.owner_name ?? "",
        formatMoneyCsvMinor(row.amount_minor),
        formatMoneyCsvMinor(signedAmount),
        row.currency,
        row.note ?? "",
        row.source_label ?? row.import_id ?? "",
        row.imported_at ?? "",
        row.id
      ];
    })
  ];

  const filenameAccount = checkpoint.account_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  return {
    filename: `${filenameAccount}-${checkpoint.checkpoint_month}-checkpoint-ledger.csv`,
    csv: csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")
  };
}

export async function compareAccountCheckpointStatementRows(
  db: D1Database,
  input: {
    accountId: string;
    checkpointMonth: string;
    rows: Record<string, string>[];
    uploadedStatementStartDate?: string;
    uploadedStatementEndDate?: string;
  }
): Promise<StatementCompareDto> {
  const checkpoint = await db
    .prepare(`
      SELECT
        checkpoints.checkpoint_month,
        checkpoints.statement_start_date,
        checkpoints.statement_end_date,
        accounts.account_name
      FROM account_balance_checkpoints AS checkpoints
      INNER JOIN accounts ON accounts.id = checkpoints.account_id
      WHERE checkpoints.household_id = ?
        AND checkpoints.account_id = ?
        AND checkpoints.checkpoint_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, input.checkpointMonth)
    .first<{
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      account_name: string;
    }>();

  if (!checkpoint) {
    throw new Error(`Unknown checkpoint: ${input.accountId} ${input.checkpointMonth}`);
  }

  const uploadedStatementStartDate = normalizeStatementDate(input.uploadedStatementStartDate);
  const uploadedStatementEndDate = normalizeStatementDate(input.uploadedStatementEndDate);
  const statementStartDate = checkpoint.statement_start_date
    ?? uploadedStatementStartDate
    ?? getMonthBounds(checkpoint.checkpoint_month)[0];
  const statementEndDate = checkpoint.statement_end_date
    ?? uploadedStatementEndDate
    ?? getMonthEndDate(checkpoint.checkpoint_month);
  const statementRows = input.rows
    .map((rawRow, index) => {
      const normalized = normalizeImportRow(rawRow);
      if (normalized.errors.length || !normalized.date || !normalized.amountMinor) {
        return null;
      }

      if (normalized.date < statementStartDate || normalized.date > statementEndDate) {
        return null;
      }

      const signedAmountMinor = getSignedLedgerAmountMinor({
        entry_type: normalized.entryType,
        transfer_direction: normalized.transferDirection ?? null,
        amount_minor: normalized.amountMinor
      });

      return {
        id: `statement-${index + 1}`,
        date: normalized.date,
        description: normalized.description,
        amountMinor: normalized.amountMinor,
        signedAmountMinor,
        entryType: normalized.entryType,
        transferDirection: normalized.transferDirection,
        categoryName: normalized.categoryName,
        note: normalized.note
      };
    })
    .filter((row): row is StatementCompareRowDto => Boolean(row));

  const ledgerResult = await db
    .prepare(`
      SELECT
        transactions.id,
        COALESCE(transactions.post_date, transactions.transaction_date) AS cleared_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.note,
        categories.name AS category_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.account_id = ?
        AND COALESCE(transactions.post_date, transactions.transaction_date) <= ?
        AND COALESCE(transactions.post_date, transactions.transaction_date) >= ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY COALESCE(transactions.post_date, transactions.transaction_date), transactions.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.accountId, statementEndDate, statementStartDate)
    .all<{
      id: string;
      cleared_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      note: string | null;
      category_name: string | null;
    }>();

  const ledgerRows = ledgerResult.results.map((row): StatementCompareRowDto => {
    const amountMinor = Number(row.amount_minor);
    return {
      id: row.id,
      date: row.cleared_date,
      description: row.description,
      amountMinor,
      signedAmountMinor: getSignedLedgerAmountMinor(row),
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined,
      categoryName: row.category_name ?? undefined,
      note: row.note ?? undefined
    };
  });

  const matchedLedgerIds = new Set<string>();
  const matchedStatementIds = new Set<string>();

  for (const statementRow of statementRows) {
    const match = ledgerRows.find((ledgerRow) => (
      !matchedLedgerIds.has(ledgerRow.id)
      && ledgerRow.signedAmountMinor === statementRow.signedAmountMinor
      && ledgerRow.date === statementRow.date
      && compareDescriptionSimilarity(ledgerRow.description, statementRow.description) >= 0.45
    ));

    if (match) {
      matchedLedgerIds.add(match.id);
      matchedStatementIds.add(statementRow.id);
    }
  }

  for (const statementRow of statementRows) {
    if (matchedStatementIds.has(statementRow.id)) {
      continue;
    }

    const match = ledgerRows.find((ledgerRow) => (
      !matchedLedgerIds.has(ledgerRow.id)
      && ledgerRow.signedAmountMinor === statementRow.signedAmountMinor
      && Math.abs(daysBetween(ledgerRow.date, statementRow.date)) <= 3
      && compareDescriptionSimilarity(ledgerRow.description, statementRow.description) >= 0.65
    ));

    if (match) {
      matchedLedgerIds.add(match.id);
      matchedStatementIds.add(statementRow.id);
    }
  }

  const unmatchedStatementRows = statementRows.filter((row) => !matchedStatementIds.has(row.id));
  const unmatchedLedgerRows = ledgerRows.filter((row) => !matchedLedgerIds.has(row.id));
  const possibleMatches = unmatchedStatementRows
    .flatMap((statementRow) => unmatchedLedgerRows
      .filter((ledgerRow) => Math.abs(ledgerRow.signedAmountMinor) === Math.abs(statementRow.signedAmountMinor))
      .map((ledgerRow) => ({
        statementRow,
        ledgerRow,
        dateDeltaDays: Math.abs(daysBetween(ledgerRow.date, statementRow.date)),
        descriptionScore: compareDescriptionSimilarity(ledgerRow.description, statementRow.description),
        amountDirectionMismatch: ledgerRow.signedAmountMinor !== statementRow.signedAmountMinor
      }))
    )
    .filter((candidate) => candidate.dateDeltaDays <= 7 || candidate.descriptionScore >= 0.5)
    .sort((left, right) => (
      left.dateDeltaDays - right.dateDeltaDays
      || right.descriptionScore - left.descriptionScore
      || left.statementRow.date.localeCompare(right.statementRow.date)
    ))
    .slice(0, 12);
  const duplicateStatementGroups = findStatementCompareDuplicateGroups(statementRows);
  const duplicateLedgerGroups = findStatementCompareDuplicateGroups(ledgerRows);

  return {
    accountName: checkpoint.account_name,
    checkpointMonth: checkpoint.checkpoint_month,
    statementStartDate,
    statementEndDate,
    uploadedStatementStartDate: uploadedStatementStartDate ?? undefined,
    uploadedStatementEndDate: uploadedStatementEndDate ?? undefined,
    statementRowCount: statementRows.length,
    ledgerRowCount: ledgerRows.length,
    matchedRowCount: matchedStatementIds.size,
    unmatchedStatementRows,
    unmatchedLedgerRows,
    possibleMatches,
    duplicateStatementGroups,
    duplicateLedgerGroups
  };
}
