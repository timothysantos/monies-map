import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  buildImportRowHash,
  compareDescriptionSimilarity,
  computeCheckpointLedgerBalanceMinor,
  daysBetween,
  getMonthEndDate,
  getSignedLedgerAmountMinor,
  normalizeAccountOpeningBalanceMinor,
  normalizeImportRow,
  normalizeStatementBalanceInputMinor,
  normalizeStatementDate
} from "./app-repository-helpers";
import { loadCategories } from "./app-repository-categories";
import { loadCategoryMatchRules, matchCategoryRule } from "./app-repository-category-match-rules";
import { loadAccounts } from "./app-repository-settings";
import type {
  AccountDto,
  ImportOverlapDto,
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
    sourceType?: "csv" | "pdf" | "manual";
    statementCheckpoints?: StatementCheckpointDraftDto[];
  }
): Promise<ImportPreviewDto> {
  const accounts = await loadAccounts(db);
  const categories = await loadCategories(db);
  const categoryMatchRules = await loadCategoryMatchRules(db);
  const existingTransactions = await db
    .prepare(`
      SELECT
        imports.id AS import_id,
        COALESCE(imports.source_type, 'manual') AS source_type,
        transactions.id AS transaction_id,
        transactions.account_id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.bank_certification_status,
        accounts.account_name,
        COALESCE(statement_import_rows.normalized_hash, import_rows.normalized_hash) AS normalized_hash
      FROM transactions
      LEFT JOIN imports ON imports.id = transactions.import_id
      LEFT JOIN import_rows ON import_rows.id = transactions.import_row_id
      LEFT JOIN import_rows AS statement_import_rows ON statement_import_rows.id = transactions.statement_certified_import_row_id
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      import_id: string | null;
      source_type: "csv" | "pdf" | "manual";
      transaction_id: string;
      account_id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      bank_certification_status: "provisional" | "statement_certified";
      account_name: string;
      normalized_hash: string | null;
    }>();
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const accountsByName = groupAccountsByName(accounts);
  const accountNames = new Set(accounts.map((account) => account.name));
  const categoryNames = new Set(categories.map((category) => category.name));
  const unknownAccounts = new Set<string>();
  const unknownCategories = new Set<string>();
  const previewRows: ImportPreviewRowDto[] = [];
  const validationErrors: string[] = [];
  for (const [index, rawRow] of input.rows.entries()) {
    const normalized = normalizeImportRow(rawRow);
    if (normalized.errors.length) {
      validationErrors.push(`Row ${index + 1}: ${normalized.errors.join(", ")}`);
      continue;
    }
    const normalizedDescription = normalized.description!;
    const inferredAccountName = normalized.accountName ?? input.defaultAccountName;
    let inferredEntryType = normalized.entryType;
    let inferredTransferDirection = normalized.transferDirection;
    let inferredCategoryName = normalized.categoryName ?? "Other";

    // User-maintained match rules are the correction layer above parser guesses.
    // This lets a rule like "NETS Debit-Consumer -> Food & Drinks" fix an import
    // row even when a bank-specific parser made a broader first guess.
    const matchedCategoryName = matchCategoryRule(normalizedDescription, categoryMatchRules);
    if (matchedCategoryName) {
      inferredCategoryName = matchedCategoryName;
    }

    if (inferredCategoryName === "Transfer") {
      inferredEntryType = "transfer";
      inferredTransferDirection = normalized.transferDirection ?? (normalized.entryType === "income" ? "in" : "out");
    }

    if (inferredEntryType === "transfer") {
      inferredCategoryName = "Transfer";
    }

    if (inferredAccountName && !accountNames.has(inferredAccountName)) {
      unknownAccounts.add(inferredAccountName);
    }

    if (inferredCategoryName && !categoryNames.has(inferredCategoryName)) {
      unknownCategories.add(inferredCategoryName);
      inferredCategoryName = "Other";
    }

    const inferredAccount = resolvePreviewAccount(accountsById, accountsByName, normalized.accountId, inferredAccountName);
    const statementAccountName = rawRow.statementAccountName || rawRow.statementAccount || rawRow.account;
    const inferredOwnerName = input.ownershipType === "direct"
      ? getDirectOwnerNameForAccount(inferredAccount, input.ownerName)
      : undefined;

    const previewRow: ImportPreviewRowDto = {
      rowId: `preview-${index + 1}`,
      rowIndex: index + 1,
      date: normalized.date!,
      description: normalizedDescription,
      amountMinor: normalized.amountMinor!,
      entryType: inferredEntryType,
      transferDirection: inferredTransferDirection,
      accountId: inferredAccount?.id,
      accountName: inferredAccount?.name ?? inferredAccountName,
      statementAccountName,
      categoryName: inferredCategoryName,
      ownershipType: input.ownershipType,
      ownerName: inferredOwnerName,
      splitBasisPoints: input.ownershipType === "shared" ? Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000)) : 10000,
      note: normalized.note,
      rawRow
    };
    const requestedCommitStatus = getRequestedCommitStatus(rawRow);
    const previewRowHash = buildImportRowHash(previewRow);
    const nearMatches = existingTransactions.results
      .map((candidate) => {
        const sameAmount = Number(candidate.amount_minor) === Number(previewRow.amountMinor);
        if (!sameAmount) {
          return undefined;
        }

        const sameAccount = previewRow.accountId
          ? candidate.account_id === previewRow.accountId
          : !previewRow.accountName || candidate.account_name === previewRow.accountName;
        if (!sameAccount) {
          return undefined;
        }

        const dayDistance = Math.abs(daysBetween(previewRow.date, candidate.transaction_date));
        const descriptionSimilarity = compareDescriptionSimilarity(previewRow.description, candidate.description);
        const isExactDuplicate = candidate.normalized_hash === previewRowHash;
        if (!isExactDuplicate && (dayDistance > 3 || descriptionSimilarity < 0.55)) {
          return undefined;
        }

        return {
          candidate,
          dayDistance,
          descriptionSimilarity,
          matchKind: getDuplicateMatchKind(isExactDuplicate, dayDistance, descriptionSimilarity)
        };
      })
      .filter((match): match is {
        candidate: typeof existingTransactions.results[number];
        dayDistance: number;
        descriptionSimilarity: number;
        matchKind: "exact" | "probable" | "near";
      } => Boolean(match))
      .sort((left, right) => (
        getDuplicateMatchRank(left.matchKind) - getDuplicateMatchRank(right.matchKind)
        || left.dayDistance - right.dayDistance
        || right.descriptionSimilarity - left.descriptionSimilarity
      ))
      .slice(0, 3);

    previewRow.duplicateMatches = nearMatches.map(({ candidate, matchKind }) => ({
      ...(candidate.import_id ? { existingImportId: candidate.import_id } : {}),
      existingTransactionId: candidate.transaction_id,
      existingAccountId: candidate.account_id,
      existingSourceType: candidate.source_type,
      existingBankCertificationStatus: candidate.bank_certification_status,
      date: candidate.transaction_date,
      description: candidate.description,
      amountMinor: Number(candidate.amount_minor),
      accountName: candidate.account_name,
      matchKind
    }));
    const strongestMatch = previewRow.duplicateMatches[0]?.matchKind;
    previewRow.commitStatus = requestedCommitStatus ?? getDefaultCommitStatus(strongestMatch);
    previewRow.commitStatusReason = getCommitStatusReason(previewRow.commitStatus, strongestMatch);
    applyStatementAuthorityToPreviewRow(previewRow, input.sourceType);
    previewRows.push(previewRow);

  }

  if (validationErrors.length) {
    throw new Error(`Import validation failed. ${validationErrors.join(" | ")}`);
  }

  const overlapImports = await findOverlappingImports(db, previewRows);
  autoIncludeDuplicateMatchesExplainedByStatementBalance({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  const visibleDuplicateRows = previewRows.filter((row) => row.duplicateMatches?.length);
  const duplicateCandidates = visibleDuplicateRows.flatMap((row) => row.duplicateMatches ?? []).slice(0, 8);
  const statementReconciliations = buildImportPreviewStatementReconciliations({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    sourceType: input.sourceType,
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  const exceptionSummary = buildImportPreviewExceptionSummary({
    unknownAccountCount: unknownAccounts.size,
    unknownCategoryCount: unknownCategories.size,
    duplicateCandidateCount: visibleDuplicateRows.length,
    overlappingImportCount: overlapImports.length,
    previewRows,
    statementReconciliations
  });

  return {
    sourceLabel: input.sourceLabel,
    parserKey: "generic_csv",
    importedRows: previewRows.length,
    previewRows,
    unknownAccounts: Array.from(unknownAccounts).sort(),
    unknownCategories: Array.from(unknownCategories).sort(),
    duplicateCandidateCount: visibleDuplicateRows.length,
    overlappingImportCount: overlapImports.length,
    overlapImports,
    startDate: previewRows.length ? previewRows.map((row) => row.date).sort()[0] : undefined,
    endDate: previewRows.length ? previewRows.map((row) => row.date).sort().at(-1) : undefined,
    accountNames: Array.from(new Set(previewRows.map((row) => row.accountName).filter((accountName): accountName is string => Boolean(accountName)))).sort(),
    duplicateCandidates,
    statementReconciliations,
    exceptionSummary
  };
}

function buildImportPreviewExceptionSummary(input: {
  unknownAccountCount: number;
  unknownCategoryCount: number;
  duplicateCandidateCount: number;
  overlappingImportCount: number;
  previewRows: ImportPreviewRowDto[];
  statementReconciliations: ImportPreviewDto["statementReconciliations"];
}): ImportPreviewDto["exceptionSummary"] {
  const needsReviewCount = input.previewRows.filter((row) => row.commitStatus === "needs_review").length;
  const statementMismatchCount = input.statementReconciliations.filter((item) => item.status === "mismatch").length;
  const identityUnconfirmedCount = input.statementReconciliations.filter((item) => item.status === "identity_unconfirmed").length;

  return [
    { kind: "unknown_account" as const, count: input.unknownAccountCount, tone: "blocking" as const },
    { kind: "unknown_category" as const, count: input.unknownCategoryCount, tone: "blocking" as const },
    { kind: "statement_mismatch" as const, count: statementMismatchCount, tone: "blocking" as const },
    { kind: "account_identity" as const, count: identityUnconfirmedCount, tone: "blocking" as const },
    { kind: "review_rows" as const, count: needsReviewCount, tone: "review" as const },
    { kind: "ledger_match" as const, count: input.duplicateCandidateCount, tone: "review" as const },
    { kind: "prior_import_context" as const, count: input.overlappingImportCount, tone: "context" as const }
  ].filter((item) => item.count > 0);
}

function applyStatementAuthorityToPreviewRow(
  previewRow: ImportPreviewRowDto,
  sourceType?: "csv" | "pdf" | "manual"
) {
  if (sourceType !== "pdf") {
    return;
  }

  const strongestMatch = previewRow.duplicateMatches?.[0];
  if (!strongestMatch?.existingTransactionId) {
    return;
  }

  const isAlreadyStatementCertified = strongestMatch.existingSourceType === "pdf"
    || strongestMatch.existingBankCertificationStatus === "statement_certified";

  if (isAlreadyStatementCertified) {
    previewRow.commitStatus = "skipped";
    previewRow.commitStatusReason = "Official statement row is already certified in the ledger.";
    previewRow.duplicateMatches = undefined;
    return;
  }

  previewRow.commitStatus = "included";
  previewRow.commitStatusReason = "Official statement will certify the existing mid-cycle ledger row while preserving user edits.";
  previewRow.statementCertificationTargetTransactionId = strongestMatch.existingTransactionId;
  previewRow.duplicateMatches = undefined;
}

function getDirectOwnerNameForAccount(account?: AccountDto, fallbackOwnerName?: string) {
  if (account && !account.isJoint && account.ownerLabel && account.ownerLabel !== "Shared") {
    return account.ownerLabel;
  }

  return fallbackOwnerName;
}

function groupAccountsByName(accounts: AccountDto[]) {
  const accountsByName = new Map<string, AccountDto[]>();
  for (const account of accounts) {
    const current = accountsByName.get(account.name) ?? [];
    current.push(account);
    accountsByName.set(account.name, current);
  }
  return accountsByName;
}

function resolvePreviewAccount(
  accountsById: Map<string, AccountDto>,
  accountsByName: Map<string, AccountDto[]>,
  accountId?: string,
  accountName?: string
) {
  if (accountId) {
    return accountsById.get(accountId);
  }

  if (!accountName) {
    return undefined;
  }

  const nameMatches = accountsByName.get(accountName) ?? [];
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

function buildPreviewLedgerRows(previewRows: ImportPreviewRowDto[]) {
  return previewRows
    .filter((row) => (
      row.accountId
      && row.commitStatus !== "skipped"
      && row.commitStatus !== "needs_review"
    ))
    .map((row) => ({
      account_id: row.accountId!,
      transaction_date: row.date,
      entry_type: row.entryType,
      transfer_direction: row.transferDirection ?? null,
      amount_minor: row.amountMinor
    }));
}

function buildProjectedLedgerRows(
  existingRows: {
    transaction_id?: string;
    account_id: string;
    transaction_date: string;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[],
  previewRows: ImportPreviewRowDto[]
) {
  const certificationTargetIds = new Set(
    previewRows
      .map((row) => row.statementCertificationTargetTransactionId)
      .filter((id): id is string => Boolean(id))
  );
  return [
    ...existingRows.filter((row) => !row.transaction_id || !certificationTargetIds.has(row.transaction_id)),
    ...buildPreviewLedgerRows(previewRows)
  ];
}

function getStatementConfirmableDuplicateRowsForAccount(previewRows: ImportPreviewRowDto[], accountId: string, statementEndDate: string) {
  return previewRows.filter((row) => (
    row.accountId === accountId
    && row.date <= statementEndDate
    && Boolean(row.duplicateMatches?.length)
    && (
      row.commitStatus === "needs_review"
      || (row.commitStatus === "skipped" && !getRequestedCommitStatus(row.rawRow))
    )
  ));
}

function sumSignedPreviewRows(previewRows: ImportPreviewRowDto[]) {
  return previewRows.reduce((total, row) => (
    total + getSignedLedgerAmountMinor({
      entry_type: row.entryType,
      transfer_direction: row.transferDirection ?? null,
      amount_minor: row.amountMinor
    })
  ), 0);
}

function autoIncludeDuplicateMatchesExplainedByStatementBalance(input: {
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
    return;
  }

  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const accountsByName = groupAccountsByName(input.accounts);

  for (const checkpoint of input.statementCheckpoints) {
    const account = resolvePreviewAccount(accountsById, accountsByName, checkpoint.accountId, checkpoint.accountName);
    if (!account) {
      continue;
    }

    const statementStartDate = normalizeStatementDate(checkpoint.statementStartDate) ?? undefined;
    const statementEndDate = normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth);
    const statementBalanceMinor = normalizeStatementBalanceInputMinor(Math.round(Number(checkpoint.statementBalanceMinor ?? 0)), account.kind);
    const projectedLedgerBalanceMinor = computeCheckpointLedgerBalanceMinor({
      openingBalanceMinor: normalizeAccountOpeningBalanceMinor(Number(account.openingBalanceMinor ?? 0), account.kind),
      checkpoint: {
        account_id: account.id,
        checkpoint_month: checkpoint.checkpointMonth,
        statement_start_date: statementStartDate ?? null,
        statement_end_date: statementEndDate
      },
      rows: buildProjectedLedgerRows(input.existingRows, input.previewRows)
    });
    const deltaMinor = projectedLedgerBalanceMinor - statementBalanceMinor;
    const confirmableDuplicateRows = getStatementConfirmableDuplicateRowsForAccount(input.previewRows, account.id, statementEndDate);
    const confirmableDuplicateTotalMinor = sumSignedPreviewRows(confirmableDuplicateRows);

    // Duplicate matches are intentionally cautious because bank posting dates
    // can differ across mid-cycle exports and final statements. If adding the
    // app-skipped or still-unresolved duplicate rows removes the exact
    // account-level statement delta, the statement has confirmed those rows
    // belong in this import. User-excluded rows keep their explicit decision.
    if (deltaMinor !== 0 && confirmableDuplicateRows.length > 0 && deltaMinor + confirmableDuplicateTotalMinor === 0) {
      for (const row of confirmableDuplicateRows) {
        row.commitStatus = "included";
        row.commitStatusReason = "Statement certification check confirmed this row belongs in the import.";
        row.duplicateMatches = undefined;
      }
    }
  }
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
  sourceType?: "csv" | "pdf" | "manual";
  statementCheckpoints: StatementCheckpointDraftDto[];
}) {
  if (!input.statementCheckpoints.length) {
    return [];
  }

  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const accountsByName = groupAccountsByName(input.accounts);
  const ledgerRows = buildProjectedLedgerRows(input.existingRows, input.previewRows);

  return input.statementCheckpoints.map((checkpoint) => {
    const account = resolvePreviewAccount(accountsById, accountsByName, checkpoint.accountId, checkpoint.accountName);
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
    const hasIdentityConfidence = hasStatementAccountIdentityConfidence({
      sourceType: input.sourceType,
      checkpoint,
      account
    });
    return {
      accountName: account.name,
      accountId: account.id,
      accountKind: account.kind,
      checkpointMonth: checkpoint.checkpointMonth,
      statementStartDate,
      statementEndDate,
      statementBalanceMinor,
      projectedLedgerBalanceMinor,
      deltaMinor,
      status: deltaMinor === 0
        ? hasIdentityConfidence ? "matched" as const : "identity_unconfirmed" as const
        : "mismatch" as const
    };
  });
}

function hasStatementAccountIdentityConfidence(input: {
  sourceType?: "csv" | "pdf" | "manual";
  checkpoint: StatementCheckpointDraftDto;
  account: AccountDto;
}) {
  if (input.sourceType !== "pdf") {
    return true;
  }

  if (
    (input.account.checkpointHistory?.length ?? 0) > 0
    || input.account.latestTransactionDate
    || Number(input.account.openingBalanceMinor ?? 0) !== 0
  ) {
    return true;
  }

  const detectedName = normalizeAccountIdentityName(input.checkpoint.detectedAccountName ?? input.checkpoint.accountName);
  const accountName = normalizeAccountIdentityName(input.account.name);
  if (!detectedName || !accountName) {
    return false;
  }

  return detectedName === accountName
    || detectedName.includes(accountName)
    || accountName.includes(detectedName);
}

function normalizeAccountIdentityName(value?: string) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function getRequestedCommitStatus(rawRow: Record<string, string>) {
  const value = rawRow.commitStatus ?? rawRow.previewCommitStatus;
  return value === "included" || value === "skipped" || value === "needs_review" ? value : undefined;
}

function getDuplicateMatchKind(isExactDuplicate: boolean, dayDistance: number, descriptionSimilarity: number) {
  if (isExactDuplicate) {
    return "exact" as const;
  }

  if (dayDistance <= 3 && descriptionSimilarity >= 0.85) {
    return "probable" as const;
  }

  return "near" as const;
}

function getDuplicateMatchRank(matchKind: "exact" | "probable" | "near") {
  if (matchKind === "exact") {
    return 0;
  }

  if (matchKind === "probable") {
    return 1;
  }

  return 2;
}

function getDefaultCommitStatus(matchKind?: "exact" | "probable" | "near") {
  if (matchKind === "exact" || matchKind === "probable") {
    return "skipped" as const;
  }

  if (matchKind === "near") {
    return "needs_review" as const;
  }

  return "included" as const;
}

function getCommitStatusReason(commitStatus: "included" | "skipped" | "needs_review", matchKind?: "exact" | "probable" | "near") {
  if (commitStatus === "skipped" && matchKind === "exact") {
    return "Exact duplicate already exists in the ledger.";
  }

  if (commitStatus === "skipped" && matchKind === "probable") {
    return "Probable duplicate already exists in the ledger.";
  }

  if (commitStatus === "needs_review") {
    return "Possible duplicate needs a user decision before commit.";
  }

  return undefined;
}

async function findOverlappingImports(db: D1Database, rows: ImportPreviewRowDto[]) {
  if (!rows.length) {
    return [];
  }

  const dates = rows.map((row) => row.date).sort();
  const accountIds = Array.from(new Set(rows.map((row) => row.accountId).filter(Boolean)));
  if (!accountIds.length) {
    return [];
  }

  const placeholders = accountIds.map(() => "?").join(", ");
  const overlapRows = await db
    .prepare(`
      SELECT
        imports.id,
        imports.source_label,
        imports.source_type,
        imports.imported_at,
        imports.status,
        accounts.account_name,
        CASE
          WHEN accounts.is_joint = 1 THEN 'Shared'
          ELSE people.display_name
        END AS owner_name,
        transactions.id AS transaction_id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.transfer_direction
      FROM imports
      INNER JOIN transactions ON transactions.import_id = imports.id
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE imports.household_id = ?
        AND imports.status = 'completed'
        AND accounts.id IN (${placeholders})
        AND transactions.transaction_date BETWEEN ? AND ?
      ORDER BY imports.imported_at DESC, transactions.transaction_date ASC, transactions.id ASC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...accountIds, dates[0], dates[dates.length - 1])
    .all<{
      id: string;
      source_label: string;
      source_type: "csv" | "pdf" | "manual";
      imported_at: string;
      status: "draft" | "completed" | "rolled_back";
      account_name: string;
      owner_name: string | null;
      transaction_id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
    }>();

  const importsById = new Map<string, ImportOverlapDto>();
  for (const row of overlapRows.results) {
    const overlap = importsById.get(row.id) ?? {
      id: row.id,
      sourceLabel: row.source_label,
      sourceType: row.source_type,
      importedAt: row.imported_at,
      status: row.status,
      transactionCount: 0,
      startDate: undefined,
      endDate: undefined,
      accountNames: [],
      overlapEntries: []
    };
    const accountLabel = `${row.account_name} - ${row.owner_name ?? "Shared"}`;
    const accountNames = new Set(overlap.accountNames);
    accountNames.add(accountLabel);
    overlap.accountNames = Array.from(accountNames).sort();
    overlap.transactionCount += 1;
    overlap.startDate = overlap.startDate && overlap.startDate < row.transaction_date ? overlap.startDate : row.transaction_date;
    overlap.endDate = overlap.endDate && overlap.endDate > row.transaction_date ? overlap.endDate : row.transaction_date;
    overlap.overlapEntries?.push({
      id: row.transaction_id,
      date: row.transaction_date,
      description: row.description,
      amountMinor: Number(row.amount_minor),
      accountName: accountLabel,
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined
    });
    importsById.set(row.id, overlap);
  }

  return Array.from(importsById.values());
}
