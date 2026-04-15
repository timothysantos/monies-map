import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  buildImportRowHash,
  compareDescriptionSimilarity,
  computeCheckpointLedgerBalanceMinor,
  daysBetween,
  getMonthEndDate,
  normalizeAccountOpeningBalanceMinor,
  normalizeImportRow,
  normalizeStatementBalanceInputMinor,
  normalizeStatementDate
} from "./app-repository-helpers";
import { loadCategories } from "./app-repository-categories";
import { loadAccounts } from "./app-repository-settings";
import type {
  AccountDto,
  ImportPreviewDto,
  ImportPreviewRowDto,
  StatementCheckpointDraftDto
} from "../types/dto";

export async function buildImportPreview(
  db: D1Database,
  input: {
    sourceLabel: string;
    rows: Record<string, string>[];
    defaultAccountName?: string;
    ownershipType: "direct" | "shared";
    ownerName?: string;
    splitBasisPoints?: number;
    statementCheckpoints?: StatementCheckpointDraftDto[];
  }
): Promise<ImportPreviewDto> {
  const accounts = await loadAccounts(db);
  const categories = await loadCategories(db);
  const existingHashes = await db
    .prepare(`
      SELECT normalized_hash
      FROM import_rows
      INNER JOIN imports ON imports.id = import_rows.import_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
        AND import_rows.normalized_hash IS NOT NULL
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ normalized_hash: string }>();
  const existingTransactions = await db
    .prepare(`
      SELECT
        imports.id AS import_id,
        transactions.account_id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.transfer_direction,
        accounts.account_name
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      import_id: string;
      account_id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      account_name: string;
    }>();
  const accountsByName = new Map(accounts.map((account) => [account.name, account]));
  const accountNames = new Set(accounts.map((account) => account.name));
  const categoryNames = new Set(categories.map((category) => category.name));
  const existingHashSet = new Set(existingHashes.results.map((row) => row.normalized_hash));
  const unknownAccounts = new Set<string>();
  const unknownCategories = new Set<string>();
  const previewRows: ImportPreviewRowDto[] = [];
  const validationErrors: string[] = [];
  let duplicateCandidateCount = 0;
  const duplicateCandidates = [];

  for (const [index, rawRow] of input.rows.entries()) {
    const normalized = normalizeImportRow(rawRow);
    if (normalized.errors.length) {
      validationErrors.push(`Row ${index + 1}: ${normalized.errors.join(", ")}`);
      continue;
    }
    const inferredAccountName = normalized.accountName ?? input.defaultAccountName;
    let inferredCategoryName = normalized.categoryName ?? "Other";

    if (normalized.entryType === "transfer") {
      inferredCategoryName = "Transfer";
    }

    if (inferredAccountName && !accountNames.has(inferredAccountName)) {
      unknownAccounts.add(inferredAccountName);
    }

    if (inferredCategoryName && !categoryNames.has(inferredCategoryName)) {
      unknownCategories.add(inferredCategoryName);
      inferredCategoryName = "Other";
    }

    const inferredAccount = inferredAccountName ? accountsByName.get(inferredAccountName) : undefined;
    const inferredOwnerName = input.ownershipType === "direct"
      ? getDirectOwnerNameForAccount(inferredAccount, input.ownerName)
      : undefined;

    const previewRow: ImportPreviewRowDto = {
      rowId: `preview-${index + 1}`,
      rowIndex: index + 1,
      date: normalized.date!,
      description: normalized.description,
      amountMinor: normalized.amountMinor!,
      entryType: normalized.entryType,
      transferDirection: normalized.transferDirection,
      accountId: inferredAccount?.id,
      accountName: inferredAccountName,
      categoryName: inferredCategoryName,
      ownershipType: input.ownershipType,
      ownerName: inferredOwnerName,
      splitBasisPoints: input.ownershipType === "shared" ? Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000)) : 10000,
      note: normalized.note,
      rawRow
    };
    const isExactDuplicate = existingHashSet.has(buildImportRowHash(previewRow));
    const nearMatches = existingTransactions.results
      .filter((candidate) => {
        const sameAmount = Number(candidate.amount_minor) === Number(previewRow.amountMinor);
        if (!sameAmount) {
          return false;
        }

        const sameAccount = !previewRow.accountName || candidate.account_name === previewRow.accountName;
        if (!sameAccount) {
          return false;
        }

        const dayDistance = Math.abs(daysBetween(previewRow.date, candidate.transaction_date));
        const descriptionSimilarity = compareDescriptionSimilarity(previewRow.description, candidate.description);
        return isExactDuplicate || (dayDistance <= 3 && descriptionSimilarity >= 0.55);
      })
      .slice(0, 3);

    previewRow.duplicateMatches = nearMatches.map((match) => ({
      existingImportId: match.import_id,
      date: match.transaction_date,
      description: match.description,
      amountMinor: Number(match.amount_minor),
      accountName: match.account_name,
      matchKind: isExactDuplicate ? "exact" : "near"
    }));
    previewRows.push(previewRow);

    if (isExactDuplicate || nearMatches.length) {
      duplicateCandidateCount += 1;
    }

    for (const match of previewRow.duplicateMatches ?? []) {
      if (duplicateCandidates.length >= 8) {
        break;
      }

      duplicateCandidates.push(match);
    }
  }

  if (validationErrors.length) {
    throw new Error(`Import validation failed. ${validationErrors.join(" | ")}`);
  }

  const overlapImports = await findOverlappingImports(db, previewRows);
  const statementReconciliations = buildImportPreviewStatementReconciliations({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    statementCheckpoints: input.statementCheckpoints ?? []
  });

  return {
    sourceLabel: input.sourceLabel,
    parserKey: "generic_csv",
    importedRows: previewRows.length,
    previewRows,
    unknownAccounts: Array.from(unknownAccounts).sort(),
    unknownCategories: Array.from(unknownCategories).sort(),
    duplicateCandidateCount,
    overlappingImportCount: overlapImports.length,
    overlapImports,
    startDate: previewRows.length ? previewRows.map((row) => row.date).sort()[0] : undefined,
    endDate: previewRows.length ? previewRows.map((row) => row.date).sort().at(-1) : undefined,
    accountNames: Array.from(new Set(previewRows.map((row) => row.accountName).filter(Boolean))).sort(),
    duplicateCandidates,
    statementReconciliations
  };
}

function getDirectOwnerNameForAccount(account?: AccountDto, fallbackOwnerName?: string) {
  if (account && !account.isJoint && account.ownerLabel && account.ownerLabel !== "Shared") {
    return account.ownerLabel;
  }

  return fallbackOwnerName;
}

function buildImportPreviewStatementReconciliations(input: {
  accounts: AccountDto[];
  existingRows: {
    account_id: string;
    transaction_date: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[];
  previewRows: ImportPreviewRowDto[];
  statementCheckpoints: StatementCheckpointDraftDto[];
}) {
  if (!input.statementCheckpoints.length) {
    return [];
  }

  const accountsByName = new Map(input.accounts.map((account) => [account.name, account]));
  const previewLedgerRows = input.previewRows
    .filter((row) => row.accountId)
    .map((row) => ({
      account_id: row.accountId!,
      transaction_date: row.date,
      entry_type: row.entryType,
      transfer_direction: row.transferDirection ?? null,
      amount_minor: row.amountMinor
    }));
  const ledgerRows = [...input.existingRows, ...previewLedgerRows];

  return input.statementCheckpoints.map((checkpoint) => {
    const account = accountsByName.get(checkpoint.accountName);
    const statementStartDate = normalizeStatementDate(checkpoint.statementStartDate) ?? undefined;
    const statementEndDate = normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth);
    const statementBalanceMinor = account
      ? normalizeStatementBalanceInputMinor(Math.round(Number(checkpoint.statementBalanceMinor ?? 0)), account.kind)
      : Math.round(Number(checkpoint.statementBalanceMinor ?? 0));

    if (!account) {
      return {
        accountName: checkpoint.accountName,
        checkpointMonth: checkpoint.checkpointMonth,
        statementStartDate,
        statementEndDate,
        statementBalanceMinor,
        status: "unknown_account" as const
      };
    }

    const projectedLedgerBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(account.openingBalanceMinor ?? 0), account.kind),
      checkpoint: {
        account_id: account.id,
        checkpoint_month: checkpoint.checkpointMonth,
        statement_start_date: statementStartDate ?? null,
        statement_end_date: statementEndDate
      },
      rows: ledgerRows
    });
    const deltaMinor = projectedLedgerBalanceMinor - statementBalanceMinor;

    return {
      accountName: account.name,
      accountKind: account.kind,
      checkpointMonth: checkpoint.checkpointMonth,
      statementStartDate,
      statementEndDate,
      statementBalanceMinor,
      projectedLedgerBalanceMinor,
      deltaMinor,
      status: deltaMinor === 0 ? "matched" as const : "mismatch" as const
    };
  });
}

async function findOverlappingImports(db: D1Database, rows: ImportPreviewRowDto[]) {
  if (!rows.length) {
    return [];
  }

  const dates = rows.map((row) => row.date).sort();
  const accountNames = Array.from(new Set(rows.map((row) => row.accountName).filter(Boolean)));
  if (!accountNames.length) {
    return [];
  }

  const placeholders = accountNames.map(() => "?").join(", ");
  const overlapRows = await db
    .prepare(`
      WITH overlapping_imports AS (
        SELECT
          imports.id,
          accounts.account_name,
          transactions.id AS transaction_id,
          transactions.transaction_date
        FROM imports
        INNER JOIN transactions ON transactions.import_id = imports.id
        INNER JOIN accounts ON accounts.id = transactions.account_id
        WHERE imports.household_id = ?
          AND imports.status = 'completed'
          AND accounts.account_name IN (${placeholders})
          AND transactions.transaction_date BETWEEN ? AND ?
      )
      SELECT
        imports.id,
        imports.source_label,
        imports.source_type,
        imports.imported_at,
        imports.status,
        COUNT(DISTINCT overlapping_imports.transaction_id) AS transaction_count,
        MIN(overlapping_imports.transaction_date) AS start_date,
        MAX(overlapping_imports.transaction_date) AS end_date,
        GROUP_CONCAT(DISTINCT overlapping_imports.account_name) AS account_names
      FROM imports
      INNER JOIN overlapping_imports ON overlapping_imports.id = imports.id
      GROUP BY imports.id, imports.source_label, imports.source_type, imports.imported_at, imports.status
      ORDER BY imports.imported_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...accountNames, dates[0], dates[dates.length - 1])
    .all<{
      id: string;
      source_label: string;
      source_type: "csv" | "pdf" | "manual";
      imported_at: string;
      status: "draft" | "completed" | "rolled_back";
      transaction_count: number;
      start_date: string | null;
      end_date: string | null;
      account_names: string | null;
    }>();

  return overlapRows.results.map((row) => ({
    id: row.id,
    sourceLabel: row.source_label,
    sourceType: row.source_type,
    importedAt: row.imported_at,
    status: row.status,
    transactionCount: Number(row.transaction_count ?? 0),
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    accountNames: row.account_names?.split(",").sort() ?? []
  }));
}
