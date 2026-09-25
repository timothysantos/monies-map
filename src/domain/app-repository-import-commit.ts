// Import commit and rollback (H15d): writing an import batch (rows,
// statement checkpoints, reconciliation certificates and superseded-row
// snapshots) and rolling it back, restoring certified and superseded statement
// rows and linked splits and transfers. SQL order and idempotency are
// unchanged.
//
// Both commands are all-or-nothing: every read and check runs first, then
// the whole write (with its audit event and month refresh markers) commits
// as one db.batch(), which D1 runs as a single transaction. Only an import
// too large for one batch is staged (see commitImportStatements).

import {
  buildMonthlySnapshotRefreshMarkers,
  refreshMonthlySnapshotsAfterWrite
} from "./app-repository-snapshots";
import {
  buildImportRowHash,
  computeCheckpointLedgerBalanceMinor,
  extractTransactionDateHint,
  getSignedLedgerAmountMinor,
  getMonthEndDate,
  daysBetween,
  normalizeDateString,
  normalizeDescriptionForMatch,
  normalizeStatementBalanceInputMinor,
  normalizeStatementDate
} from "./app-repository-helpers";
import { buildAuditEventStatement } from "./app-repository-audit";
import { assertImportDescriptionQuality } from "./import-description-quality";
import type {
  ImportPreviewRowDto,
  ImportPreviewStatementReconciliationDto,
  StatementCheckpointDraftDto
} from "../types/dto";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

// D1 applies its per-query limits (100 bound parameters, 100 KB of SQL,
// 30 s) to each statement in a batch and documents no statement-count limit,
// but Workers cap queries per invocation (1,000 on the paid plan). Commits up
// to this many statements run as one batch, which stays under that cap even
// if every statement in a batch counted separately.
const IMPORT_COMMIT_SINGLE_BATCH_STATEMENT_LIMIT = 500;
// Larger commits stage their new rows in chunks of this size, the size the
// April 2026 chunked commits proved on Cloudflare.
const IMPORT_COMMIT_STAGING_CHUNK_SIZE = 90;

type ImportCommitStatement = {
  statement: D1PreparedStatement;
  // "draft" creates the draft import (replacing an earlier attempt);
  // "staged" inserts a row that belongs only to the new import (an import row
  // or a new ledger entry), which ledger reads ignore while the import is a
  // draft; "final" is every change a reader can see. Only a staged commit
  // (commitImportStatements) runs the phases as separate batches.
  phase: "draft" | "staged" | "final";
};

// Ledger rows as the certificate check reads them, keyed by id so the
// commit's own pending changes can be applied before anything is written.
type CertificateLedgerRow = {
  id: string;
  import_id: string | null;
  bank_certification_status: string;
  account_id: string;
  cleared_date: string;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  amount_minor: number;
};

function collectStatementSupersededLedgerRows(statementReconciliations: ImportPreviewStatementReconciliationDto[]) {
  const rowsById = new Map<string, {
    transactionId: string;
    importId: string;
    date: string;
    postedDate?: string;
  }>();

  for (const reconciliation of statementReconciliations) {
    if (reconciliation.status !== "matched") {
      continue;
    }

    for (const row of reconciliation.supersededLedgerRows ?? []) {
      if (!row.transactionId || !row.importId || !row.date) {
        continue;
      }
      rowsById.set(row.transactionId, {
        transactionId: row.transactionId,
        importId: row.importId,
        date: row.date,
        ...(row.postedDate ? { postedDate: row.postedDate } : {})
      });
    }
  }

  return Array.from(rowsById.values());
}

type SupersededLedgerRowSnapshot = {
  transaction: {
    id: string;
    import_id: string | null;
    import_row_id: string | null;
    account_id: string;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount_minor: number;
    currency: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    category_id: string | null;
    owner_person_id: string | null;
    offsets_category: number;
    note: string | null;
    transfer_group_id: string | null;
  };
  splitExpenseLinks: Array<{
    id: string;
  }>;
  splitSettlementLinks: Array<{
    id: string;
  }>;
};

type CertifiedLedgerRowSnapshot = {
  transaction: {
    id: string;
    import_id: string | null;
    import_row_id: string | null;
    account_id: string;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount_minor: number;
    currency: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
  };
};

async function buildSupersededLedgerRowSnapshots(
  db: D1Database,
  supersededLedgerRows: Array<{
    transactionId: string;
    importId: string;
    date: string;
    postedDate?: string;
    description: string;
    amountMinor: number;
    signedAmountMinor: number;
    accountName: string;
  }>
) {
  if (!supersededLedgerRows.length) {
    return [];
  }

  const transactionIds = [...new Set(supersededLedgerRows.map((row) => row.transactionId))];
  const importIds = [...new Set(supersededLedgerRows.map((row) => row.importId))];
  const placeholders = transactionIds.map(() => "?").join(", ");
  const importPlaceholders = importIds.map(() => "?").join(", ");
  const [transactions, splitExpenses, splitSettlements, importRows, accountRows, categoryRows] = await Promise.all([
    db
      .prepare(`
        SELECT
          id,
          import_id,
          import_row_id,
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
          note,
          transfer_group_id
        FROM transactions
        WHERE household_id = ?
          AND id IN (${placeholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...transactionIds)
      .all<SupersededLedgerRowSnapshot["transaction"]>(),
    db
      .prepare(`
        SELECT id, linked_transaction_id
        FROM split_expenses
        WHERE household_id = ?
          AND linked_transaction_id IN (${placeholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...transactionIds)
      .all<{ id: string; linked_transaction_id: string | null }>(),
    db
      .prepare(`
        SELECT id, linked_transaction_id
        FROM split_settlements
        WHERE household_id = ?
          AND linked_transaction_id IN (${placeholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...transactionIds)
      .all<{ id: string; linked_transaction_id: string | null }>(),
    db
      .prepare(`
        SELECT
          id,
          import_id,
          assigned_account_id,
          raw_row_json
        FROM import_rows
        WHERE import_id IN (${importPlaceholders})
      `)
      .bind(...importIds)
      .all<{
        id: string;
        import_id: string;
        assigned_account_id: string | null;
        raw_row_json: string;
      }>(),
    db
      .prepare(`
        SELECT id, account_name, owner_person_id
        FROM accounts
        WHERE household_id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string; account_name: string; owner_person_id: string | null }>(),
    db
      .prepare(`
        SELECT id, name
        FROM categories
        WHERE household_id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string; name: string }>()
  ]);

  const accountById = new Map(accountRows.results.map((account) => [account.id, account]));
  const categoryIdByName = new Map(categoryRows.results.map((category) => [category.name, category.id]));
  const importRowsByImportId = new Map<string, Array<{
    id: string;
    import_id: string;
    assigned_account_id: string | null;
    raw_row_json: string;
  }>>();
  for (const row of importRows.results) {
    const current = importRowsByImportId.get(row.import_id) ?? [];
    current.push(row);
    importRowsByImportId.set(row.import_id, current);
  }

  const transactionSnapshotById = new Map<string, SupersededLedgerRowSnapshot>();
  for (const transaction of transactions.results) {
    transactionSnapshotById.set(transaction.id, {
      transaction,
      splitExpenseLinks: [],
      splitSettlementLinks: []
    });
  }

  const splitExpenseLinksByTransactionId = new Map<string, SupersededLedgerRowSnapshot["splitExpenseLinks"]>();
  for (const row of splitExpenses.results) {
    if (!row.linked_transaction_id) {
      continue;
    }
    const current = splitExpenseLinksByTransactionId.get(row.linked_transaction_id) ?? [];
    current.push({ id: row.id });
    splitExpenseLinksByTransactionId.set(row.linked_transaction_id, current);
  }

  const splitSettlementLinksByTransactionId = new Map<string, SupersededLedgerRowSnapshot["splitSettlementLinks"]>();
  for (const row of splitSettlements.results) {
    if (!row.linked_transaction_id) {
      continue;
    }
    const current = splitSettlementLinksByTransactionId.get(row.linked_transaction_id) ?? [];
    current.push({ id: row.id });
    splitSettlementLinksByTransactionId.set(row.linked_transaction_id, current);
  }

  const snapshots = supersededLedgerRows
    .map((row) => {
      const directSnapshot = transactionSnapshotById.get(row.transactionId);
      if (directSnapshot) {
        return {
          ...directSnapshot,
          splitExpenseLinks: splitExpenseLinksByTransactionId.get(row.transactionId) ?? [],
          splitSettlementLinks: splitSettlementLinksByTransactionId.get(row.transactionId) ?? []
        };
      }

      const candidates = importRowsByImportId.get(row.importId) ?? [];
      const candidate = candidates.find((item) => {
        try {
          const rawRow = JSON.parse(item.raw_row_json) as Record<string, unknown>;
          const rawDescription = typeof rawRow.description === "string" ? rawRow.description : "";
          const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
          const rawDate = normalizeDateString(
            typeof rawRow.date === "string"
              ? rawRow.date
              : typeof rawRow.transactionDate === "string"
                ? rawRow.transactionDate
                : ""
          );
          return Boolean(
            rawDescription
            && rawAmountMinor != null
            && rawDate
            && normalizeDescriptionForMatch(rawDescription) === normalizeDescriptionForMatch(row.description)
            && rawAmountMinor === row.signedAmountMinor
            && rawDate === row.date
          );
        } catch {
          return false;
        }
      });

      if (!candidate) {
        return null;
      }

      let rawRow: Record<string, unknown> = {};
      try {
        rawRow = JSON.parse(candidate.raw_row_json) as Record<string, unknown>;
      } catch {
        rawRow = {};
      }

      const rawDescription = typeof rawRow.description === "string" ? rawRow.description : row.description;
      const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
      const normalizedDate = normalizeDateString(
        typeof rawRow.date === "string"
          ? rawRow.date
          : typeof rawRow.transactionDate === "string"
            ? rawRow.transactionDate
            : row.date
      ) ?? row.date;
      const rawEntryType = typeof rawRow.type === "string" ? rawRow.type.toLowerCase() : undefined;
      const rawTransferDirection = typeof rawRow.transferDirection === "string"
        ? rawRow.transferDirection.toLowerCase()
        : typeof rawRow.transfer_direction === "string"
          ? rawRow.transfer_direction.toLowerCase()
          : undefined;
      const account = candidate.assigned_account_id ? accountById.get(candidate.assigned_account_id) : undefined;
      const categoryName = typeof rawRow.category === "string"
        ? rawRow.category
        : typeof rawRow.categoryName === "string"
          ? rawRow.categoryName
          : undefined;

      return {
        transaction: {
          id: row.transactionId,
          import_id: candidate.import_id,
          import_row_id: candidate.id,
          account_id: candidate.assigned_account_id ?? account?.id ?? accountById.values().next().value?.id ?? "",
          transaction_date: normalizedDate,
          post_date: normalizedDate,
          description: rawDescription,
          amount_minor: rawAmountMinor == null ? Math.abs(row.signedAmountMinor) : Math.abs(rawAmountMinor),
          currency: "SGD",
          entry_type: (rawEntryType === "income" || rawEntryType === "transfer" ? rawEntryType : "expense") as "expense" | "income" | "transfer",
          transfer_direction: rawTransferDirection === "in" || rawTransferDirection === "out" ? rawTransferDirection : null,
          category_id: categoryName ? (categoryIdByName.get(categoryName) ?? null) : null,
          owner_person_id: account?.owner_person_id ?? null,
          offsets_category: 0,
          note: typeof rawRow.note === "string" ? rawRow.note : null,
          transfer_group_id: null
        },
        splitExpenseLinks: [],
        splitSettlementLinks: []
      };
    })
    .filter((item): item is SupersededLedgerRowSnapshot => Boolean(item))
    .map((snapshot) => ({
      ...snapshot,
      splitExpenseLinks: splitExpenseLinksByTransactionId.get(snapshot.transaction.id) ?? [],
      splitSettlementLinks: splitSettlementLinksByTransactionId.get(snapshot.transaction.id) ?? []
    }));
  return snapshots;
}

export async function commitImportBatch(
  db: D1Database,
  input: {
    sourceLabel: string;
    sourceType?: "csv" | "pdf" | "manual";
    parserKey?: string;
    rows: ImportPreviewRowDto[];
    statementControlRows?: ImportPreviewRowDto[];
    statementReconciliations?: ImportPreviewStatementReconciliationDto[];
    statementCheckpoints?: StatementCheckpointDraftDto[];
    note?: string;
  }
) {
  const importId = await buildImportCommitId(input);
  const monthsToRecalculate = new Set<string>();
  const isOfficialStatementImport = input.sourceType === "pdf";

  const existingImport = await db
    .prepare("SELECT status FROM imports WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .first<{ status: string }>();

  if (existingImport?.status === "completed") {
    return { importId, created: false, importedRows: input.rows.length };
  }

  const commitStatements: ImportCommitStatement[] = [];
  const draft = (statement: D1PreparedStatement) => commitStatements.push({ statement, phase: "draft" });
  const stage = (statement: D1PreparedStatement) => commitStatements.push({ statement, phase: "staged" });
  const write = (statement: D1PreparedStatement) => commitStatements.push({ statement, phase: "final" });

  // A draft (an interrupted staged commit) or a rolled-back attempt of the
  // same file is replaced by this commit.
  const replacesEarlierAttempt = existingImport?.status === "draft" || existingImport?.status === "rolled_back";
  if (replacesEarlierAttempt) {
    for (const statement of await buildImportBatchCleanupStatements(db, importId)) {
      draft(statement);
    }
    draft(db
      .prepare("DELETE FROM imports WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, importId));
  }

  draft(db
    .prepare(`
      INSERT INTO imports (
        id, household_id, source_type, source_label, parser_key, imported_at, status, note
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft', ?)
    `)
    .bind(importId, DEFAULT_HOUSEHOLD_ID, input.sourceType ?? "csv", input.sourceLabel, input.parserKey ?? "generic_csv", input.note ?? null));

  const [accountRows, categoryRows, personRows] = await Promise.all([
    db
      .prepare("SELECT id, account_name, account_kind, owner_person_id, opening_balance_minor FROM accounts WHERE household_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string; account_name: string; account_kind: string; owner_person_id: string | null; opening_balance_minor: number }>(),
    db
      .prepare("SELECT id, name FROM categories WHERE household_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string; name: string }>(),
    db
      .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string; display_name: string }>()
  ]);
  const accountsById = new Map(accountRows.results.map((account) => [account.id, account]));
  const accountRowsByName = new Map<string, typeof accountRows.results>();
  for (const account of accountRows.results) {
    const current = accountRowsByName.get(account.account_name) ?? [];
    current.push(account);
    accountRowsByName.set(account.account_name, current);
  }
  const categoryIdsByName = new Map(categoryRows.results.map((category) => [category.name, category.id]));
  const personIdsByName = new Map(personRows.results.map((person) => [person.display_name, person.id]));
  const supersededLedgerRows = collectStatementSupersededLedgerRows(input.statementReconciliations ?? []);
  const certifiedLedgerRowsByAccountId = new Map<string, CertifiedLedgerRowSnapshot[]>();
  // What this commit will do to the ledger, so the statement certificate can
  // be computed before anything is written.
  const pendingLedger = {
    deletedIds: new Set<string>(),
    upserts: new Map<string, Omit<CertificateLedgerRow, "import_id" | "bank_certification_status">>()
  };
  const savesCertificates = isOfficialStatementImport && Boolean(input.statementCheckpoints?.length);
  // Snapshots of the rows a statement supersedes, taken before the commit
  // deletes them so a rollback can restore them as they were.
  const supersededSnapshotsByReconciliation = new Map<ImportPreviewStatementReconciliationDto, SupersededLedgerRowSnapshot[]>();
  if (savesCertificates) {
    for (const reconciliation of input.statementReconciliations ?? []) {
      if (reconciliation.supersededLedgerRows?.length) {
        supersededSnapshotsByReconciliation.set(reconciliation, await buildSupersededLedgerRowSnapshots(db, reconciliation.supersededLedgerRows));
      }
    }
  }
  // An earlier attempt's rows are removed by this commit, so they are not
  // part of the ledger the certificate checks.
  const certificateLedgerRows = savesCertificates
    ? (await loadCertificateLedgerRows(db)).filter((row) => !replacesEarlierAttempt || row.import_id !== importId)
    : [];
  const certificateLedgerRowsById = new Map(certificateLedgerRows.map((row) => [row.id, row]));

  for (const row of supersededLedgerRows) {
    write(db
      .prepare("UPDATE split_expenses SET linked_transaction_id = NULL WHERE household_id = ? AND linked_transaction_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, row.transactionId));
    write(db
      .prepare("UPDATE split_settlements SET linked_transaction_id = NULL WHERE household_id = ? AND linked_transaction_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, row.transactionId));
    write(db
      .prepare(`
        DELETE FROM transactions
        WHERE household_id = ?
          AND id = ?
          AND import_id = ?
          AND bank_certification_status = 'provisional'
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, row.transactionId, row.importId));
    const ledgerRow = certificateLedgerRowsById.get(row.transactionId);
    if (ledgerRow?.import_id === row.importId && ledgerRow.bank_certification_status === "provisional") {
      pendingLedger.deletedIds.add(row.transactionId);
    }
    monthsToRecalculate.add(row.date.slice(0, 7));
    if (row.postedDate) {
      monthsToRecalculate.add(row.postedDate.slice(0, 7));
    }
  }

  for (const row of input.rows) {
    assertImportDescriptionQuality(row.description, row.rowIndex);

    const rowId = `import-row-${crypto.randomUUID()}`;
    const transactionId = `txn-${crypto.randomUUID()}`;
    const account = resolveImportAccount(accountsById, accountRowsByName, row.accountId, row.accountName);
    const accountId = account?.id ?? null;

    if (!account || !accountId) {
      throw new Error(`Unknown account: ${row.accountName ?? "Unassigned"}`);
    }

    const categoryName = row.entryType === "transfer" ? "Transfer" : row.categoryName;
    const categoryId = categoryName ? categoryIdsByName.get(categoryName) : null;
    if (!categoryId) {
      throw new Error(`Unknown category: ${categoryName ?? "Unassigned"}`);
    }

    const directOwnerId = row.ownerName
      ? personIdsByName.get(row.ownerName)
      : account.owner_person_id;
    if (row.ownerName && !directOwnerId) {
      throw new Error(`Unknown owner: ${row.ownerName ?? "Unassigned"}`);
    }

    const reconciliationTarget = row.reconciliationTargetTransactionId
      ? await db
        .prepare(`
          SELECT id, transaction_date, import_id, post_date
          FROM transactions
          WHERE household_id = ?
            AND id = ?
            AND account_id = ?
            AND bank_certification_status = 'provisional'
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, row.reconciliationTargetTransactionId, accountId)
        .first<{ id: string; transaction_date: string; import_id: string | null; post_date: string | null }>()
      : null;

    if (row.reconciliationTargetTransactionId && !reconciliationTarget) {
      throw new Error("Reconciliation target is no longer available. Refresh the import preview and try again.");
    }

    stage(db
      .prepare(`
        INSERT INTO import_rows (
          id, import_id, row_index, assigned_account_id, raw_row_json, normalized_hash, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'imported')
      `)
      .bind(
        rowId,
        importId,
        row.rowIndex,
        accountId,
        JSON.stringify(row.rawRow),
        buildImportRowHash(row)
      ));

    if (reconciliationTarget && !isOfficialStatementImport) {
      if (reconciliationTarget.import_id) {
        throw new Error("Current-activity reconciliation target is no longer manual. Refresh the import preview and try again.");
      }

      // Promotion fills the bank-cleared lane only. The ledger event date
      // stays pinned to the original manual or split-entered intent date.
      const promotedPostDate = row.date;

      write(db
        .prepare(`
          UPDATE transactions
          SET import_id = ?,
            import_row_id = ?,
            post_date = ?,
            description = ?,
            amount_minor = ?,
            entry_type = ?,
            transfer_direction = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ?
            AND id = ?
            AND account_id = ?
            AND import_id IS NULL
            AND bank_certification_status = 'provisional'
        `)
        .bind(
          importId,
          rowId,
          promotedPostDate,
          row.description,
          row.amountMinor,
          row.entryType,
          row.transferDirection ?? null,
          DEFAULT_HOUSEHOLD_ID,
          reconciliationTarget.id,
          accountId
        ));
      monthsToRecalculate.add(reconciliationTarget.transaction_date.slice(0, 7));
      continue;
    }

    if (reconciliationTarget) {
      // Official statements own bank facts. Preserve user annotations by not
      // touching category, note, ownership, splits, or transfer links here.
      const promotedPostDate = row.date;
      const promotedEventDate = resolveImportPreviewEventDate(row);
      const certifiedRowSnapshot = await db
        .prepare(`
          SELECT
            id,
            import_id,
            import_row_id,
            account_id,
            transaction_date,
            post_date,
            description,
            amount_minor,
            currency,
            entry_type,
            transfer_direction
          FROM transactions
          WHERE household_id = ?
            AND id = ?
            AND account_id = ?
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, reconciliationTarget.id, accountId)
        .first<CertifiedLedgerRowSnapshot["transaction"]>();

      if (certifiedRowSnapshot) {
        const currentSnapshots = certifiedLedgerRowsByAccountId.get(accountId) ?? [];
        currentSnapshots.push({ transaction: certifiedRowSnapshot });
        certifiedLedgerRowsByAccountId.set(accountId, currentSnapshots);
      }

      write(db
        .prepare(`
          UPDATE transactions
          SET transaction_date = ?,
            post_date = ?,
            description = ?,
            amount_minor = ?,
            entry_type = ?,
            transfer_direction = ?,
            bank_certification_status = 'statement_certified',
            statement_certified_import_id = ?,
            statement_certified_import_row_id = ?,
            statement_certified_at = CURRENT_TIMESTAMP,
            statement_certified_previous_import_id = import_id,
            statement_certified_previous_import_row_id = import_row_id,
            statement_certified_previous_transaction_date = transaction_date,
            statement_certified_previous_post_date = post_date,
            statement_certified_previous_description = description,
            statement_certified_previous_amount_minor = amount_minor,
            statement_certified_previous_entry_type = entry_type,
            statement_certified_previous_transfer_direction = transfer_direction,
            updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ?
            AND id = ?
            AND account_id = ?
            AND bank_certification_status = 'provisional'
        `)
        .bind(
          promotedEventDate,
          promotedPostDate,
          row.description,
          row.amountMinor,
          row.entryType,
          row.transferDirection ?? null,
          importId,
          rowId,
          DEFAULT_HOUSEHOLD_ID,
          reconciliationTarget.id,
          accountId
        ));
      pendingLedger.upserts.set(reconciliationTarget.id, {
        id: reconciliationTarget.id,
        account_id: accountId,
        cleared_date: promotedPostDate,
        entry_type: row.entryType,
        transfer_direction: row.transferDirection ?? null,
        amount_minor: row.amountMinor
      });
      monthsToRecalculate.add(reconciliationTarget.transaction_date.slice(0, 7));
      monthsToRecalculate.add(promotedEventDate.slice(0, 7));
      continue;
    }

    // Imported rows can carry both lanes: a true event date hint plus the
    // bank's posted date. When no hint exists, both lanes collapse to the
    // same day.
    const importedEventDate = resolveImportPreviewEventDate(row);
    const storedPostDate = row.date;

    stage(db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, import_id, import_row_id, account_id, transaction_date,
          post_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, owner_person_id, offsets_category, note,
          bank_certification_status, statement_certified_import_id, statement_certified_import_row_id, statement_certified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SGD', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `)
      .bind(
        transactionId,
        DEFAULT_HOUSEHOLD_ID,
        importId,
        rowId,
        accountId,
        importedEventDate,
        storedPostDate,
        row.description,
        row.amountMinor,
        row.entryType,
        row.transferDirection ?? null,
        categoryId,
        directOwnerId ?? null,
        row.note ?? null,
        isOfficialStatementImport ? "statement_certified" : "provisional",
        isOfficialStatementImport ? importId : null,
        isOfficialStatementImport ? rowId : null,
        isOfficialStatementImport ? new Date().toISOString() : null
      ));
    pendingLedger.upserts.set(transactionId, {
      id: transactionId,
      account_id: accountId,
      cleared_date: storedPostDate,
      entry_type: row.entryType,
      transfer_direction: row.transferDirection ?? null,
      amount_minor: row.amountMinor
    });

    monthsToRecalculate.add(row.date.slice(0, 7));
  }

  for (const checkpoint of input.statementCheckpoints ?? []) {
    const account = resolveImportCheckpointAccount(accountsById, accountRowsByName, checkpoint, input.statementControlRows ?? input.rows);
    if (!account) {
      throw new Error(`Unknown checkpoint account: ${checkpoint.accountName}`);
    }
    if (!checkpoint.checkpointMonth || !Number.isFinite(checkpoint.statementBalanceMinor)) {
      throw new Error(`Invalid statement checkpoint for ${checkpoint.accountName}`);
    }

    write(db
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
        `checkpoint-${crypto.randomUUID()}`,
        DEFAULT_HOUSEHOLD_ID,
        account.id,
        checkpoint.checkpointMonth,
        normalizeStatementDate(checkpoint.statementStartDate),
        normalizeStatementDate(checkpoint.statementEndDate),
        normalizeStatementBalanceInputMinor(
          Math.round(checkpoint.statementBalanceMinor),
          account.account_kind
        ),
        checkpoint.note ?? null
      ));
  }

  if (savesCertificates && input.statementCheckpoints) {
    const ledgerRowsAfterCommit = [
      ...certificateLedgerRows.filter((row) => !pendingLedger.deletedIds.has(row.id) && !pendingLedger.upserts.has(row.id)),
      ...pendingLedger.upserts.values()
    ];
    for (const statement of buildStatementReconciliationCertificateStatements(db, {
      importId,
      checkpoints: input.statementCheckpoints,
      committedRows: input.rows,
      statementControlRows: input.statementControlRows ?? input.rows,
      statementReconciliations: input.statementReconciliations ?? [],
      accountsById,
      accountRowsByName,
      certifiedLedgerRowsByAccountId,
      supersededSnapshotsByReconciliation,
      ledgerRows: ledgerRowsAfterCommit
    })) {
      write(statement);
    }
    for (const statement of buildStatementChainBreakClearStatements(db, {
      checkpoints: input.statementCheckpoints,
      statementControlRows: input.statementControlRows ?? input.rows,
      accountsById,
      accountRowsByName
    })) {
      write(statement);
    }
  }

  write(db
    .prepare("UPDATE imports SET status = 'completed' WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId));
  write(buildAuditEventStatement(db, {
    entityType: "import",
    entityId: importId,
    action: "import_committed",
    detail: `Committed import ${input.sourceLabel} with ${input.rows.length} row${input.rows.length === 1 ? "" : "s"}.`
  }));
  for (const statement of buildMonthlySnapshotRefreshMarkers(db, monthsToRecalculate)) {
    write(statement);
  }

  await commitImportStatements(db, importId, commitStatements);
  await refreshMonthlySnapshotsAfterWrite(db, monthsToRecalculate);

  return { importId, created: true, importedRows: input.rows.length };
}

// Runs a commit's statements. Normally that is one batch, so a failure at
// any statement leaves nothing behind. A commit too large for one batch
// first writes the draft import and its own new rows (invisible to ledger
// reads while the import is a draft) in chunks, then makes every visible
// change (edits to existing entries, checkpoints, certificates, the completed
// status, audit and refresh markers) in one final batch. If a step fails, the
// staged rows and the draft are discarded; if even that cannot run, the
// leftover draft stays hidden and the next commit of the same file replaces it.
async function commitImportStatements(db: D1Database, importId: string, commitStatements: ImportCommitStatement[]) {
  if (commitStatements.length <= IMPORT_COMMIT_SINGLE_BATCH_STATEMENT_LIMIT) {
    await db.batch(commitStatements.map((item) => item.statement));
    return;
  }

  const inPhase = (phase: ImportCommitStatement["phase"]) => commitStatements
    .filter((item) => item.phase === phase)
    .map((item) => item.statement);
  const staged = inPhase("staged");
  const chunks = [inPhase("draft")];
  for (let index = 0; index < staged.length; index += IMPORT_COMMIT_STAGING_CHUNK_SIZE) {
    chunks.push(staged.slice(index, index + IMPORT_COMMIT_STAGING_CHUNK_SIZE));
  }
  try {
    for (const chunk of chunks) {
      await db.batch(chunk);
    }
    await db.batch(inPhase("final"));
  } catch (error) {
    await discardStagedImport(db, importId).catch((cleanupError) => {
      console.error("Discarding a staged import failed; the draft stays hidden until the next commit", cleanupError);
    });
    throw error;
  }
}

async function discardStagedImport(db: D1Database, importId: string) {
  await db.batch([
    db
      .prepare("DELETE FROM transactions WHERE household_id = ? AND import_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, importId),
    db
      .prepare("DELETE FROM import_rows WHERE import_id = ?")
      .bind(importId),
    db
      .prepare("DELETE FROM imports WHERE household_id = ? AND id = ? AND status = 'draft'")
      .bind(DEFAULT_HOUSEHOLD_ID, importId)
  ]);
}

async function buildImportCommitId(input: {
  sourceLabel: string;
  sourceType?: "csv" | "pdf" | "manual";
  parserKey?: string;
  rows: ImportPreviewRowDto[];
  statementControlRows?: ImportPreviewRowDto[];
  statementReconciliations?: ImportPreviewStatementReconciliationDto[];
  statementCheckpoints?: StatementCheckpointDraftDto[];
  note?: string;
}) {
  const signature = JSON.stringify({
    sourceLabel: input.sourceLabel,
    sourceType: input.sourceType ?? "csv",
    parserKey: input.parserKey ?? "generic_csv",
    note: input.note ?? null,
    rows: input.rows.map((row) => buildImportRowHash(row)),
    statementControlRows: input.statementControlRows?.map((row) => buildImportRowHash(row)) ?? [],
    statementReconciliations: input.statementReconciliations ?? [],
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `import-${hash.slice(0, 24)}`;
}

function resolveImportPreviewEventDate(row: ImportPreviewRowDto) {
  const candidates = [
    extractTransactionDateHint(row.note ?? undefined),
    extractTransactionDateHint(row.rawRow?.note),
    extractTransactionDateHint(row.rawRow?.notes),
    extractTransactionDateHint(row.rawRow?.remarks),
    row.rawRow?.transactionDate,
    row.rawRow?.["transaction date"]
  ]
    .map((value) => typeof value === "string" ? normalizeDateString(value) ?? normalizeStatementDate(value) : undefined)
    .filter((value): value is string => Boolean(value) && value !== row.date);

  return candidates[0] ?? row.date;
}

async function loadCertificateLedgerRows(db: D1Database) {
  const ledgerRows = await db
    .prepare(`
      SELECT
        id,
        import_id,
        bank_certification_status,
        account_id,
        COALESCE(post_date, transaction_date) AS cleared_date,
        entry_type,
        transfer_direction,
        amount_minor
      FROM transactions
      WHERE household_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<CertificateLedgerRow>();
  return ledgerRows.results;
}

// The certificate rows for a statement import. `ledgerRows` is the ledger as
// it will be once the commit lands (read before it, with the commit's own
// changes applied), so the certificate can go in the commit's batch.
function buildStatementReconciliationCertificateStatements(
  db: D1Database,
  input: {
    importId: string;
    checkpoints: StatementCheckpointDraftDto[];
    committedRows: ImportPreviewRowDto[];
    statementControlRows: ImportPreviewRowDto[];
    statementReconciliations: ImportPreviewStatementReconciliationDto[];
    accountsById: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor: number }>;
    accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor: number }[]>;
    certifiedLedgerRowsByAccountId: Map<string, CertifiedLedgerRowSnapshot[]>;
    supersededSnapshotsByReconciliation: Map<ImportPreviewStatementReconciliationDto, SupersededLedgerRowSnapshot[]>;
    ledgerRows: Array<Pick<CertificateLedgerRow, "account_id" | "cleared_date" | "entry_type" | "transfer_direction" | "amount_minor">>;
  }
) {
  const statements: D1PreparedStatement[] = [];
  for (const checkpoint of input.checkpoints) {
    const account = resolveImportCheckpointAccount(input.accountsById, input.accountRowsByName, checkpoint, input.statementControlRows);
    if (!account) {
      throw new Error(`Unknown checkpoint account: ${checkpoint.accountName}`);
    }

    const statementStartDate = normalizeStatementDate(checkpoint.statementStartDate);
    const statementEndDate = normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth);
    const statementBalanceMinor = normalizeStatementBalanceInputMinor(
      Math.round(checkpoint.statementBalanceMinor),
      account.account_kind
    );
    const controlRows = input.statementControlRows.filter((row) => {
      const rowAccount = resolveImportAccount(input.accountsById, input.accountRowsByName, row.accountId, row.accountName);
      return rowAccount?.id === account.id
        && (!statementStartDate || row.date >= statementStartDate)
        && row.date <= statementEndDate;
    });
    const committedRows = input.committedRows.filter((row) => {
      const rowAccount = resolveImportAccount(input.accountsById, input.accountRowsByName, row.accountId, row.accountName);
      return rowAccount?.id === account.id
        && (!statementStartDate || row.date >= statementStartDate)
        && row.date <= statementEndDate;
    });
    const totals = controlRows.reduce((summary, row) => {
      const signedMinor = getSignedLedgerAmountMinor({
        entry_type: row.entryType,
        transfer_direction: row.transferDirection ?? null,
        amount_minor: row.amountMinor
      });
      if (signedMinor < 0) {
        summary.debitTotalMinor += Math.abs(signedMinor);
      } else {
        summary.creditTotalMinor += signedMinor;
      }
      summary.netTotalMinor += signedMinor;
      return summary;
    }, { debitTotalMinor: 0, creditTotalMinor: 0, netTotalMinor: 0 });

    const previewReconciliation = input.statementReconciliations.find((item) => (
      item.checkpointMonth === checkpoint.checkpointMonth
      && (
        (item.accountId && item.accountId === account.id)
        || (!item.accountId && item.accountName === account.account_name)
      )
    ));
    const supersededLedgerRowsJson = previewReconciliation?.supersededLedgerRows?.length
      ? JSON.stringify(input.supersededSnapshotsByReconciliation.get(previewReconciliation) ?? [])
      : null;
    const certifiedLedgerRowsJson = input.certifiedLedgerRowsByAccountId.get(account.id)?.length
      ? JSON.stringify(input.certifiedLedgerRowsByAccountId.get(account.id))
      : null;
    const computedProjectedLedgerBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: Number(account.opening_balance_minor ?? 0),
      checkpoint: {
        account_id: account.id,
        checkpoint_month: checkpoint.checkpointMonth,
        statement_start_date: statementStartDate,
        statement_end_date: statementEndDate
      },
      rows: input.ledgerRows
    });
    const projectedLedgerBalanceMinor = typeof previewReconciliation?.projectedLedgerBalanceMinor === "number"
      ? previewReconciliation.projectedLedgerBalanceMinor
      : computedProjectedLedgerBalanceMinor;
    const deltaMinor = typeof previewReconciliation?.deltaMinor === "number"
      ? previewReconciliation.deltaMinor
      : projectedLedgerBalanceMinor - statementBalanceMinor;
    const needsReviewRowCount = controlRows.filter((row) => row.commitStatus === "needs_review").length;
    const reconciliationExceptionCount = previewReconciliation?.status && previewReconciliation.status !== "matched" ? 1 : 0;
    const exceptionCount = needsReviewRowCount + reconciliationExceptionCount;

    statements.push(
      db
        .prepare(`
          INSERT INTO statement_reconciliation_certificates (
            id, household_id, import_id, account_id, checkpoint_month,
            statement_start_date, statement_end_date, statement_row_count,
            imported_row_count, certified_existing_row_count, already_covered_row_count,
            needs_review_row_count, debit_total_minor, credit_total_minor,
            net_total_minor, statement_balance_minor, projected_ledger_balance_minor,
            delta_minor, exception_count, status, superseded_ledger_rows_json,
            certified_ledger_rows_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          `statement-cert-${crypto.randomUUID()}`,
          DEFAULT_HOUSEHOLD_ID,
          input.importId,
          account.id,
          checkpoint.checkpointMonth,
          statementStartDate,
          statementEndDate,
          controlRows.length,
          committedRows.filter((row) => !row.reconciliationTargetTransactionId).length,
          committedRows.filter((row) => row.reconciliationTargetTransactionId).length,
          controlRows.filter((row) => row.commitStatus === "skipped").length,
          needsReviewRowCount,
          totals.debitTotalMinor,
          totals.creditTotalMinor,
          totals.netTotalMinor,
          statementBalanceMinor,
          projectedLedgerBalanceMinor,
          deltaMinor,
          exceptionCount,
          exceptionCount === 0 ? "certified" : "exception",
          supersededLedgerRowsJson,
          certifiedLedgerRowsJson
        )
    );
  }

  return statements;
}

function resolveImportAccount(
  accountsById: Map<string, { id: string; account_name: string; account_kind: string; owner_person_id?: string | null; opening_balance_minor?: number }>,
  accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; owner_person_id?: string | null; opening_balance_minor?: number }[]>,
  accountId?: string,
  accountName?: string
) {
  if (accountId) {
    return accountsById.get(accountId);
  }

  if (!accountName) {
    return undefined;
  }

  const nameMatches = accountRowsByName.get(accountName) ?? [];
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

function resolveImportCheckpointAccount(
  accountsById: Map<string, { id: string; account_name: string; account_kind: string; owner_person_id?: string | null; opening_balance_minor?: number }>,
  accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; owner_person_id?: string | null; opening_balance_minor?: number }[]>,
  checkpoint: StatementCheckpointDraftDto,
  statementControlRows: ImportPreviewRowDto[] = []
) {
  const directAccount = resolveImportAccount(accountsById, accountRowsByName, checkpoint.accountId, checkpoint.accountName);
  if (directAccount) {
    return directAccount;
  }

  const detectedAccountName = checkpoint.detectedAccountName ?? checkpoint.accountName;
  const rowAccounts = new Map<string, { id: string; account_name: string; account_kind: string; owner_person_id?: string | null; opening_balance_minor?: number }>();
  for (const row of statementControlRows) {
    const rowStatementAccountName = getImportPreviewStatementAccountName(row);
    if (rowStatementAccountName !== detectedAccountName) {
      continue;
    }

    const rowAccount = resolveImportAccount(accountsById, accountRowsByName, row.accountId, row.accountName);
    if (rowAccount) {
      rowAccounts.set(rowAccount.id, rowAccount);
    }
  }

  return rowAccounts.size === 1 ? Array.from(rowAccounts.values())[0] : undefined;
}

function getImportPreviewStatementAccountName(row: ImportPreviewRowDto) {
  return row.statementAccountName
    ?? row.rawRow?.statementAccountName
    ?? row.rawRow?.statementAccount
    ?? row.rawRow?.account
    ?? row.accountName;
}

export async function rollbackImportBatch(
  db: D1Database,
  input: {
    importId: string;
  }
) {
  const importRecord = await db
    .prepare(`
      SELECT source_type, status
      FROM imports
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .first<{ source_type: "csv" | "pdf" | "manual"; status: string }>();

  if (!importRecord) {
    throw new Error("Import batch not found.");
  }

  if (importRecord.status === "rolled_back") {
    throw new Error("This import has already been rolled back, so it cannot be rolled back again.");
  }

  const laterStatementRows = await db
    .prepare(`
      SELECT COUNT(*) AS row_count
      FROM statement_reconciliation_certificates current_certificate
      WHERE current_certificate.household_id = ?
        AND current_certificate.import_id = ?
        AND EXISTS (
          SELECT 1
          FROM statement_reconciliation_certificates later_certificate
          WHERE later_certificate.household_id = current_certificate.household_id
            AND later_certificate.account_id = current_certificate.account_id
            AND later_certificate.checkpoint_month > current_certificate.checkpoint_month
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .first<{ row_count: number }>();

  if (importRecord.source_type === "pdf" && Number(laterStatementRows?.row_count ?? 0) > 0) {
    throw new Error("This PDF statement import has a later statement for the same account. Roll back newer statements first, or use a replacement statement or manual adjustment.");
  }

  // Every read happens here, before the single batch below.
  const certifiedRestore = await buildStatementCertifiedRowRestore(db, input.importId);
  const supersededRestore = await buildSupersededStatementRowRestore(db, input.importId);
  // The months of the entries this rollback removes change too.
  const removedEntryMonths = await db
    .prepare(`
      SELECT DISTINCT
        substr(transaction_date, 1, 7) AS event_month,
        substr(COALESCE(post_date, transaction_date), 1, 7) AS cleared_month
      FROM transactions
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.importId)
    .all<{ event_month: string; cleared_month: string }>();
  const transactionMonths = new Set([
    ...certifiedRestore.months,
    ...supersededRestore.months,
    ...removedEntryMonths.results.flatMap((row) => [row.event_month, row.cleared_month])
  ]);
  const chainBreakStatements = importRecord.source_type === "pdf"
    ? await buildStatementChainBreakStatementsForRollback(db, input.importId)
    : [];

  await db.batch([
    ...certifiedRestore.statements,
    ...supersededRestore.statements,
    ...chainBreakStatements,
    ...await buildImportBatchCleanupStatements(db, input.importId),
    db
      .prepare("UPDATE imports SET status = 'rolled_back' WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.importId),
    buildAuditEventStatement(db, {
      entityType: "import",
      entityId: input.importId,
      action: "import_rolled_back",
      detail: `Rolled back import ${input.importId}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, transactionMonths)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, transactionMonths);

  return { importId: input.importId, rolledBack: true };
}

// Puts entries certified by this import back to their pre-certification bank
// facts. Returns the statements and the months they touch.
async function buildStatementCertifiedRowRestore(db: D1Database, importId: string) {
  const certifiedRows = await db
    .prepare(`
      SELECT
        id,
        account_id,
        import_id,
        import_row_id,
        transaction_date,
        post_date,
        description,
        amount_minor,
        entry_type,
        transfer_direction,
        statement_certified_previous_import_id,
        statement_certified_previous_import_row_id,
        statement_certified_previous_transaction_date,
        statement_certified_previous_post_date,
        statement_certified_previous_description,
        statement_certified_previous_amount_minor,
        statement_certified_previous_entry_type,
        statement_certified_previous_transfer_direction,
        (
          SELECT certified_ledger_rows_json
          FROM statement_reconciliation_certificates
          WHERE statement_reconciliation_certificates.household_id = transactions.household_id
            AND statement_reconciliation_certificates.import_id = transactions.statement_certified_import_id
            AND statement_reconciliation_certificates.account_id = transactions.account_id
          ORDER BY statement_reconciliation_certificates.created_at DESC
          LIMIT 1
        ) AS certified_ledger_rows_json
      FROM transactions
      WHERE household_id = ?
        AND statement_certified_import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      id: string;
      account_id: string;
      import_id: string | null;
      import_row_id: string | null;
      transaction_date: string;
      post_date: string | null;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      statement_certified_previous_import_id: string | null;
      statement_certified_previous_import_row_id: string | null;
      statement_certified_previous_transaction_date: string | null;
      statement_certified_previous_post_date: string | null;
      statement_certified_previous_description: string | null;
      statement_certified_previous_amount_minor: number | null;
      statement_certified_previous_entry_type: "expense" | "income" | "transfer" | null;
      statement_certified_previous_transfer_direction: "in" | "out" | null;
      certified_ledger_rows_json: string | null;
    }>();

  const monthsToRecalculate = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  if (!certifiedRows.results.length) {
    return { statements, months: monthsToRecalculate };
  }

  const candidateRowsByAccount = new Map<string, Array<{
    import_row_id: string;
    import_id: string;
    raw_row_json: string;
    imported_at: string;
  }>>();
  const accountIds = Array.from(new Set(certifiedRows.results.map((row) => row.account_id)));
  for (const accountId of accountIds) {
    const candidates = await db
      .prepare(`
        SELECT
          import_rows.id AS import_row_id,
          import_rows.import_id AS import_id,
          import_rows.raw_row_json AS raw_row_json,
          imports.imported_at AS imported_at
        FROM import_rows
        INNER JOIN imports ON imports.id = import_rows.import_id
        WHERE import_rows.assigned_account_id = ?
          AND imports.household_id = ?
          AND imports.id != ?
          AND imports.status = 'completed'
      `)
      .bind(accountId, DEFAULT_HOUSEHOLD_ID, importId)
      .all<{
        import_row_id: string;
        import_id: string;
        raw_row_json: string;
        imported_at: string;
      }>();
    candidateRowsByAccount.set(accountId, candidates.results);
  }

  for (const row of certifiedRows.results) {
    monthsToRecalculate.add(row.transaction_date.slice(0, 7));
    if (row.certified_ledger_rows_json) {
      try {
        const snapshots = JSON.parse(row.certified_ledger_rows_json) as CertifiedLedgerRowSnapshot[];
        const certifiedSnapshot = snapshots.find((snapshot) => snapshot.transaction.id === row.id);
        if (certifiedSnapshot) {
          monthsToRecalculate.add(certifiedSnapshot.transaction.transaction_date.slice(0, 7));
          if (certifiedSnapshot.transaction.post_date) {
            monthsToRecalculate.add(certifiedSnapshot.transaction.post_date.slice(0, 7));
          }

          statements.push(db
            .prepare(`
              UPDATE transactions
              SET transaction_date = ?,
                post_date = ?,
                description = ?,
                amount_minor = ?,
                entry_type = ?,
                transfer_direction = ?,
                import_id = ?,
                import_row_id = ?,
                bank_certification_status = 'provisional',
                statement_certified_import_id = NULL,
                statement_certified_import_row_id = NULL,
                statement_certified_at = NULL,
                statement_certified_previous_import_id = NULL,
                statement_certified_previous_import_row_id = NULL,
                statement_certified_previous_transaction_date = NULL,
                statement_certified_previous_post_date = NULL,
                statement_certified_previous_description = NULL,
                statement_certified_previous_amount_minor = NULL,
                statement_certified_previous_entry_type = NULL,
                statement_certified_previous_transfer_direction = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE household_id = ?
                AND id = ?
                AND statement_certified_import_id = ?
            `)
            .bind(
              certifiedSnapshot.transaction.transaction_date,
              certifiedSnapshot.transaction.post_date,
              certifiedSnapshot.transaction.description,
              certifiedSnapshot.transaction.amount_minor,
              certifiedSnapshot.transaction.entry_type,
              certifiedSnapshot.transaction.transfer_direction,
              certifiedSnapshot.transaction.import_id,
              certifiedSnapshot.transaction.import_row_id,
              DEFAULT_HOUSEHOLD_ID,
              row.id,
              importId
            ));
          continue;
        }
      } catch {
        // Fall through to the legacy restore logic when the snapshot cannot be parsed.
      }
    }

    const restored = await resolveRolledBackStatementRowState(row, candidateRowsByAccount.get(row.account_id) ?? []);
    if (!restored) {
      continue;
    }

    monthsToRecalculate.add(restored.transactionDate.slice(0, 7));

    statements.push(db
      .prepare(`
        UPDATE transactions
        SET transaction_date = ?,
          post_date = ?,
          import_id = ?,
          import_row_id = ?,
          bank_certification_status = 'provisional',
          statement_certified_import_id = NULL,
          statement_certified_import_row_id = NULL,
          statement_certified_at = NULL,
          statement_certified_previous_import_id = NULL,
          statement_certified_previous_import_row_id = NULL,
          statement_certified_previous_transaction_date = NULL,
          statement_certified_previous_post_date = NULL,
          statement_certified_previous_description = NULL,
          statement_certified_previous_amount_minor = NULL,
          statement_certified_previous_entry_type = NULL,
          statement_certified_previous_transfer_direction = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ?
        AND id = ?
        AND statement_certified_import_id = ?
      `)
      .bind(
        restored.transactionDate,
        restored.postDate,
        restored.importId,
        restored.importRowId,
        DEFAULT_HOUSEHOLD_ID,
        row.id,
        importId
      ));
  }

  return { statements, months: monthsToRecalculate };
}

// Re-creates the entries this statement import superseded, with their split
// links. Returns the statements and the months they touch.
async function buildSupersededStatementRowRestore(db: D1Database, importId: string) {
  const certificates = await db
    .prepare(`
      SELECT
        checkpoint_month,
        superseded_ledger_rows_json
      FROM statement_reconciliation_certificates
      WHERE household_id = ?
        AND import_id = ?
        AND superseded_ledger_rows_json IS NOT NULL
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      checkpoint_month: string;
      superseded_ledger_rows_json: string | null;
    }>();

  const monthsToRecalculate = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  // A row listed by two certificates is re-created once.
  const restoredTransactionIds = new Set<string>();
  for (const certificate of certificates.results) {
    if (!certificate.superseded_ledger_rows_json) {
      continue;
    }

    let snapshots: SupersededLedgerRowSnapshot[];
    try {
      snapshots = JSON.parse(certificate.superseded_ledger_rows_json) as SupersededLedgerRowSnapshot[];
    } catch {
      continue;
    }

    for (const snapshot of snapshots) {
      monthsToRecalculate.add(snapshot.transaction.transaction_date.slice(0, 7));
      if (snapshot.transaction.post_date) {
        monthsToRecalculate.add(snapshot.transaction.post_date.slice(0, 7));
      }

      const existingTransaction = await db
        .prepare(`
          SELECT id
          FROM transactions
          WHERE household_id = ?
            AND id = ?
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, snapshot.transaction.id)
        .first<{ id: string }>();

      if (!existingTransaction && !restoredTransactionIds.has(snapshot.transaction.id)) {
        restoredTransactionIds.add(snapshot.transaction.id);
        statements.push(db
          .prepare(`
            INSERT INTO transactions (
              id, household_id, import_id, import_row_id, account_id, transfer_group_id,
              transaction_date, post_date, description, amount_minor, currency,
              entry_type, transfer_direction, category_id, owner_person_id,
              offsets_category, note, bank_certification_status, statement_certified_import_id,
              statement_certified_import_row_id, statement_certified_at,
              statement_certified_previous_import_id, statement_certified_previous_import_row_id,
              statement_certified_previous_transaction_date, statement_certified_previous_post_date,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', NULL, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `)
          .bind(
            snapshot.transaction.id,
            DEFAULT_HOUSEHOLD_ID,
            snapshot.transaction.import_id,
            snapshot.transaction.import_row_id,
            snapshot.transaction.account_id,
            snapshot.transaction.transfer_group_id,
            snapshot.transaction.transaction_date,
            snapshot.transaction.post_date,
            snapshot.transaction.description,
            snapshot.transaction.amount_minor,
            snapshot.transaction.currency,
            snapshot.transaction.entry_type,
            snapshot.transaction.transfer_direction,
            snapshot.transaction.category_id,
            snapshot.transaction.owner_person_id,
            snapshot.transaction.offsets_category,
            snapshot.transaction.note
          ));
      }

      if (snapshot.splitExpenseLinks.length) {
        for (const splitExpenseLink of snapshot.splitExpenseLinks) {
          statements.push(db
            .prepare(`
              UPDATE split_expenses
              SET linked_transaction_id = ?
              WHERE household_id = ? AND id = ?
            `)
            .bind(snapshot.transaction.id, DEFAULT_HOUSEHOLD_ID, splitExpenseLink.id));
        }
      }

      if (snapshot.splitSettlementLinks.length) {
        for (const splitSettlementLink of snapshot.splitSettlementLinks) {
          statements.push(db
            .prepare(`
              UPDATE split_settlements
              SET linked_transaction_id = ?
              WHERE household_id = ? AND id = ?
            `)
            .bind(snapshot.transaction.id, DEFAULT_HOUSEHOLD_ID, splitSettlementLink.id));
        }
      }
    }
  }

  return { statements, months: monthsToRecalculate };
}

async function resolveRolledBackStatementRowState(
  row: {
    id: string;
    account_id: string;
    import_id: string | null;
    import_row_id: string | null;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount_minor: number;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    statement_certified_previous_import_id: string | null;
    statement_certified_previous_import_row_id: string | null;
    statement_certified_previous_transaction_date: string | null;
    statement_certified_previous_post_date: string | null;
    statement_certified_previous_description: string | null;
    statement_certified_previous_amount_minor: number | null;
    statement_certified_previous_entry_type: "expense" | "income" | "transfer" | null;
    statement_certified_previous_transfer_direction: "in" | "out" | null;
  },
  candidates: Array<{
    import_row_id: string;
    import_id: string;
    raw_row_json: string;
    imported_at: string;
  }>
) {
  if (row.statement_certified_previous_import_row_id) {
    const exactPreviousImportRow = candidates.find((candidate) => candidate.import_row_id === row.statement_certified_previous_import_row_id);
    if (exactPreviousImportRow) {
      try {
        const rawRow = JSON.parse(exactPreviousImportRow.raw_row_json) as Record<string, unknown>;
        const rawDescription = typeof rawRow.description === "string" ? rawRow.description : row.description;
        const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
        const rawEntryType = typeof rawRow.type === "string" ? rawRow.type.toLowerCase() : undefined;
        const rawTransferDirection = typeof rawRow.transferDirection === "string"
          ? rawRow.transferDirection.toLowerCase()
          : typeof rawRow.transfer_direction === "string"
            ? rawRow.transfer_direction.toLowerCase()
            : undefined;
        const rawDate = normalizeDateString(
          typeof rawRow.date === "string"
            ? rawRow.date
            : typeof rawRow.transactionDate === "string"
              ? rawRow.transactionDate
              : typeof rawRow["transaction date"] === "string"
                ? rawRow["transaction date"]
                : ""
        );

        return {
          transactionDate: row.statement_certified_previous_transaction_date ?? rawDate ?? row.transaction_date,
          postDate: row.statement_certified_previous_post_date ?? rawDate ?? row.post_date ?? row.transaction_date,
          description: rawDescription,
          amountMinor: rawAmountMinor == null ? row.amount_minor : Math.abs(rawAmountMinor),
          entryType: (rawEntryType === "income" || rawEntryType === "transfer" ? rawEntryType : row.entry_type) as "expense" | "income" | "transfer",
          transferDirection: rawTransferDirection === "in" || rawTransferDirection === "out" ? rawTransferDirection : row.transfer_direction,
          importId: row.statement_certified_previous_import_id ?? exactPreviousImportRow.import_id,
          importRowId: row.statement_certified_previous_import_row_id ?? exactPreviousImportRow.import_row_id
        };
      } catch {
        // Fall through to the broader matching logic below.
      }
    }
  }

  if (
    row.statement_certified_previous_transaction_date
    || row.statement_certified_previous_import_id
    || row.statement_certified_previous_import_row_id
    || row.statement_certified_previous_post_date
  ) {
    const previousRowCandidate = row.statement_certified_previous_import_row_id
      ? candidates.find((candidate) => candidate.import_row_id === row.statement_certified_previous_import_row_id)
      : row.statement_certified_previous_import_id
        ? candidates.find((candidate) => {
          try {
            const rawRow = JSON.parse(candidate.raw_row_json) as Record<string, unknown>;
            const rawDescription = typeof rawRow.description === "string" ? rawRow.description : "";
            const rawDate = normalizeDateString(
              typeof rawRow.date === "string"
                ? rawRow.date
                : typeof rawRow.transactionDate === "string"
                  ? rawRow.transactionDate
                  : typeof rawRow["transaction date"] === "string"
                    ? rawRow["transaction date"]
                    : ""
            );
            return candidate.import_id === row.statement_certified_previous_import_id
              && Boolean(rawDescription)
              && rawDate === row.statement_certified_previous_transaction_date
              && normalizeDescriptionForMatch(rawDescription) === normalizeDescriptionForMatch(row.description);
          } catch {
            return false;
          }
        })
        : undefined;

    if (previousRowCandidate) {
      try {
        const rawRow = JSON.parse(previousRowCandidate.raw_row_json) as Record<string, unknown>;
        const rawDescription = typeof rawRow.description === "string" ? rawRow.description : row.description;
        const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
        const rawEntryType = typeof rawRow.type === "string" ? rawRow.type.toLowerCase() : undefined;
        const rawTransferDirection = typeof rawRow.transferDirection === "string"
          ? rawRow.transferDirection.toLowerCase()
          : typeof rawRow.transfer_direction === "string"
            ? rawRow.transfer_direction.toLowerCase()
            : undefined;
        const rawDate = normalizeDateString(
          typeof rawRow.date === "string"
            ? rawRow.date
            : typeof rawRow.transactionDate === "string"
              ? rawRow.transactionDate
              : typeof rawRow["transaction date"] === "string"
                ? rawRow["transaction date"]
                : ""
        );

        return {
          transactionDate: row.statement_certified_previous_transaction_date ?? rawDate ?? row.transaction_date,
          postDate: row.statement_certified_previous_post_date ?? rawDate ?? row.post_date ?? row.transaction_date,
          description: rawDescription,
          amountMinor: rawAmountMinor == null ? row.amount_minor : Math.abs(rawAmountMinor),
          entryType: (rawEntryType === "income" || rawEntryType === "transfer" ? rawEntryType : row.entry_type) as "expense" | "income" | "transfer",
          transferDirection: rawTransferDirection === "in" || rawTransferDirection === "out" ? rawTransferDirection : row.transfer_direction,
          importId: row.statement_certified_previous_import_id ?? previousRowCandidate.import_id,
          importRowId: row.statement_certified_previous_import_row_id ?? previousRowCandidate.import_row_id
        };
      } catch {
        // Fall through to the legacy previous-column fallback.
      }
    }

    return {
      transactionDate: row.statement_certified_previous_transaction_date ?? row.transaction_date,
      postDate: row.statement_certified_previous_post_date ?? row.post_date ?? row.transaction_date,
      description: row.statement_certified_previous_description ?? row.description,
        amountMinor: row.statement_certified_previous_amount_minor ?? row.amount_minor,
        entryType: row.statement_certified_previous_entry_type ?? row.entry_type,
        transferDirection: row.statement_certified_previous_transfer_direction ?? row.transfer_direction,
        importId: row.statement_certified_previous_import_id,
        importRowId: row.statement_certified_previous_import_row_id
      };
  }

  const matchingCandidates = candidates
    .map((candidate) => {
      try {
        const rawRow = JSON.parse(candidate.raw_row_json) as Record<string, unknown>;
        const rawDescription = typeof rawRow.description === "string" ? rawRow.description : "";
        const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
        const rawEntryType = typeof rawRow.type === "string" ? rawRow.type.toLowerCase() : undefined;
        const rawTransferDirection = typeof rawRow.transferDirection === "string"
          ? rawRow.transferDirection.toLowerCase()
          : typeof rawRow.transfer_direction === "string"
            ? rawRow.transfer_direction.toLowerCase()
            : undefined;
        const rawDate = normalizeDateString(
          typeof rawRow.date === "string"
            ? rawRow.date
            : typeof rawRow.transactionDate === "string"
              ? rawRow.transactionDate
              : typeof rawRow["transaction date"] === "string"
                ? rawRow["transaction date"]
                : ""
        );

        if (!rawDescription || rawAmountMinor == null || !rawDate) {
          return null;
        }

        if (normalizeDescriptionForMatch(rawDescription) !== normalizeDescriptionForMatch(row.description)) {
          return null;
        }

        if (rawAmountMinor !== row.amount_minor) {
          return null;
        }

        if (rawEntryType && rawEntryType !== row.entry_type) {
          return null;
        }

        if (rawTransferDirection && row.transfer_direction && rawTransferDirection !== row.transfer_direction) {
          return null;
        }

        return {
          candidate,
          rawDate,
          dayDistance: Math.abs(daysBetween(rawDate, row.transaction_date))
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is { candidate: { import_row_id: string; import_id: string; raw_row_json: string; imported_at: string }; rawDate: string; dayDistance: number } => Boolean(item))
    .sort((left, right) => (
      left.dayDistance - right.dayDistance
      || right.candidate.imported_at.localeCompare(left.candidate.imported_at)
    ));

  const bestCandidate = matchingCandidates[0];
  if (!bestCandidate) {
    return null;
  }

  const tiedCandidates = matchingCandidates.filter((item) => item.dayDistance === bestCandidate.dayDistance);
  if (tiedCandidates.length > 1) {
    return null;
  }

  return {
    transactionDate: bestCandidate.rawDate,
    postDate: bestCandidate.rawDate,
    description: (() => {
      try {
        const rawRow = JSON.parse(bestCandidate.candidate.raw_row_json) as Record<string, unknown>;
        return typeof rawRow.description === "string" ? rawRow.description : row.description;
      } catch {
        return row.description;
      }
    })(),
    amountMinor: (() => {
      try {
        const rawRow = JSON.parse(bestCandidate.candidate.raw_row_json) as Record<string, unknown>;
        const rawAmountMinor = readSignedMinorFromRawImportRow(rawRow);
        return rawAmountMinor == null ? row.amount_minor : Math.abs(rawAmountMinor);
      } catch {
        return row.amount_minor;
      }
    })(),
    entryType: (() => {
      try {
        const rawRow = JSON.parse(bestCandidate.candidate.raw_row_json) as Record<string, unknown>;
        const rawEntryType = typeof rawRow.type === "string" ? rawRow.type.toLowerCase() : undefined;
        return (rawEntryType === "income" || rawEntryType === "transfer" ? rawEntryType : row.entry_type) as "expense" | "income" | "transfer";
      } catch {
        return row.entry_type;
      }
    })(),
    transferDirection: (() => {
      try {
        const rawRow = JSON.parse(bestCandidate.candidate.raw_row_json) as Record<string, unknown>;
        const rawTransferDirection = typeof rawRow.transferDirection === "string"
          ? rawRow.transferDirection.toLowerCase()
          : typeof rawRow.transfer_direction === "string"
            ? rawRow.transfer_direction.toLowerCase()
            : undefined;
        return rawTransferDirection === "in" || rawTransferDirection === "out" ? rawTransferDirection : row.transfer_direction;
      } catch {
        return row.transfer_direction;
      }
    })(),
    importId: bestCandidate.candidate.import_id,
    importRowId: bestCandidate.candidate.import_row_id
  };
}

function readSignedMinorFromRawImportRow(rawRow: Record<string, unknown>) {
  const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const parseAmount = (value: unknown) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.round(value * 100) : null;
    }
    if (!isString(value)) {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  };

  const amount = parseAmount(rawRow.amount ?? rawRow.expense ?? rawRow.income);
  if (amount == null) {
    return null;
  }

  const rawType = isString(rawRow.type) ? rawRow.type.toLowerCase() : "";
  const hasIncomeField = isString(rawRow.income);
  const hasExpenseField = isString(rawRow.expense);

  if (rawType === "income" || hasIncomeField) {
    return Math.abs(amount);
  }

  if (rawType === "expense" || hasExpenseField) {
    return -Math.abs(amount);
  }

  return amount;
}

// Records the statement-chain gaps a PDF rollback opens (a later month that
// now lacks its earlier statement).
async function buildStatementChainBreakStatementsForRollback(db: D1Database, importId: string) {
  const certificates = await db
    .prepare(`
      SELECT account_id, checkpoint_month
      FROM statement_reconciliation_certificates
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      account_id: string;
      checkpoint_month: string;
    }>();

  if (!certificates.results.length) {
    return [];
  }

  const blockers: D1PreparedStatement[] = [];
  for (const certificate of certificates.results) {
    const earlierCheckpoint = await db
      .prepare(`
        SELECT 1
        FROM account_balance_checkpoints
        WHERE household_id = ?
          AND account_id = ?
          AND checkpoint_month < ?
        LIMIT 1
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, certificate.account_id, certificate.checkpoint_month)
      .first<{ 1: number }>();

    if (!earlierCheckpoint) {
      continue;
    }

    blockers.push(
      db
        .prepare(`
          INSERT INTO statement_chain_breaks (
            id, household_id, account_id, missing_checkpoint_month
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(household_id, account_id, missing_checkpoint_month) DO NOTHING
        `)
        .bind(
          `statement-chain-break-${crypto.randomUUID()}`,
          DEFAULT_HOUSEHOLD_ID,
          certificate.account_id,
          certificate.checkpoint_month
        )
    );
  }

  return blockers;
}

function buildStatementChainBreakClearStatements(
  db: D1Database,
  input: {
    checkpoints: StatementCheckpointDraftDto[];
    statementControlRows: ImportPreviewRowDto[];
    accountsById: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor?: number }>;
    accountRowsByName: Map<string, { id: string; account_name: string; account_kind: string; opening_balance_minor?: number }[]>;
  }
) {
  const statements: D1PreparedStatement[] = [];
  for (const checkpoint of input.checkpoints) {
    const account = resolveImportCheckpointAccount(
      input.accountsById,
      input.accountRowsByName,
      checkpoint,
      input.statementControlRows
    );
    if (!account) {
      continue;
    }

    statements.push(
      db
        .prepare(`
          DELETE FROM statement_chain_breaks
          WHERE household_id = ?
            AND account_id = ?
            AND missing_checkpoint_month = ?
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, account.id, checkpoint.checkpointMonth)
    );
  }

  return statements;
}

// Removes an import's own rows and statement metadata: its checkpoints and
// certificates, its certification of existing entries, split links to its
// entries, its entries and its import rows. Reads the certificates now.
async function buildImportBatchCleanupStatements(db: D1Database, importId: string) {
  return [
    ...await buildStatementImportMetadataCleanupStatements(db, importId),
    buildStatementCertificationResetStatement(db, importId),
    db
      .prepare(`
        UPDATE split_expenses
        SET linked_transaction_id = NULL
        WHERE household_id = ?
          AND linked_transaction_id IN (
            SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
          )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, importId),
    db
      .prepare(`
        UPDATE split_settlements
        SET linked_transaction_id = NULL
        WHERE household_id = ?
          AND linked_transaction_id IN (
            SELECT id FROM transactions WHERE household_id = ? AND import_id = ?
          )
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, importId),
    db
      .prepare("DELETE FROM transactions WHERE household_id = ? AND import_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, importId),
    db
      .prepare(`
        DELETE FROM import_rows
        WHERE import_id IN (
          SELECT id FROM imports WHERE household_id = ? AND id = ?
        )
        `)
      .bind(DEFAULT_HOUSEHOLD_ID, importId)
  ];
}

function buildStatementCertificationResetStatement(db: D1Database, importId: string) {
  return db
    .prepare(`
      UPDATE transactions
      SET bank_certification_status = 'provisional',
        statement_certified_import_id = NULL,
        statement_certified_import_row_id = NULL,
        statement_certified_at = NULL,
        statement_certified_previous_import_id = NULL,
        statement_certified_previous_import_row_id = NULL,
        statement_certified_previous_transaction_date = NULL,
        statement_certified_previous_post_date = NULL,
        statement_certified_previous_description = NULL,
        statement_certified_previous_amount_minor = NULL,
        statement_certified_previous_entry_type = NULL,
        statement_certified_previous_transfer_direction = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ?
        AND statement_certified_import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId);
}

async function buildStatementImportMetadataCleanupStatements(db: D1Database, importId: string) {
  const certificates = await db
    .prepare(`
      SELECT
        account_id,
        checkpoint_month,
        statement_start_date,
        statement_end_date,
        statement_balance_minor
      FROM statement_reconciliation_certificates
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{
      account_id: string;
      checkpoint_month: string;
      statement_start_date: string | null;
      statement_end_date: string | null;
      statement_balance_minor: number;
    }>();

  const statements = certificates.results.map((certificate) => db
    .prepare(`
      DELETE FROM account_balance_checkpoints
      WHERE household_id = ?
        AND account_id = ?
        AND checkpoint_month = ?
        AND COALESCE(statement_start_date, '') = COALESCE(?, '')
        AND COALESCE(statement_end_date, '') = COALESCE(?, '')
        AND statement_balance_minor = ?
    `)
    .bind(
      DEFAULT_HOUSEHOLD_ID,
      certificate.account_id,
      certificate.checkpoint_month,
      certificate.statement_start_date,
      certificate.statement_end_date,
      certificate.statement_balance_minor
    ));

  statements.push(db
    .prepare("DELETE FROM statement_reconciliation_certificates WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId));
  return statements;
}
