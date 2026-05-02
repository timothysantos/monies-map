import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  buildImportRowHash,
  compareDescriptionSimilarity,
  countSharedTokens,
  computeCheckpointLedgerBalanceMinor,
  daysBetween,
  extractTransactionDateHint,
  getMonthEndDate,
  getSignedLedgerAmountMinor,
  normalizeAccountOpeningBalanceMinor,
  normalizeDescriptionForMatch,
  normalizeDateString,
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

const LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR = 500;
const LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE = 2;
const STANDARD_DUPLICATE_MAX_DAY_DISTANCE = 7;

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
        transactions.post_date,
        transactions.description,
        transactions.note,
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
      post_date: string | null;
      description: string;
      note: string | null;
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
    const requestedReconciliationTargetTransactionId = getRequestedReconciliationTargetTransactionId(rawRow);
    const previewRowDateContext = getPreviewRowDateContext(previewRow);
    const exactDuplicateMatch = findExactDuplicateSuppressionMatch({
      previewRow,
      previewRowDateContext,
      existingRows: existingTransactions.results
    });
    const reconciliationMatches = exactDuplicateMatch
      ? []
      : findReconciliationMatches({
        previewRow,
        previewRowDateContext,
        existingRows: existingTransactions.results,
        incomingSourceType: input.sourceType
      });

    // Exact duplicate suppression is the raw identity lane. It must run before
    // promotion and reconciliation guards so overlapping bank files can auto-skip
    // rows that are already in the ledger, even when those rows are otherwise
    // isolated from reconciliation.
    if (exactDuplicateMatch) {
      previewRow.reconciliationMatch = exactDuplicateMatch;
      previewRow.reconciliationMatchCount = 1;
    } else {
      previewRow.reconciliationMatches = reconciliationMatches;
    }

    const strongestMatch = previewRow.reconciliationMatches?.[0]?.matchKind ?? previewRow.reconciliationMatch?.matchKind;
    previewRow.commitStatus = requestedCommitStatus ?? getDefaultCommitStatus(strongestMatch);
    previewRow.commitStatusExplicit = Boolean(requestedCommitStatus);
    previewRow.commitStatusReason = getCommitStatusReason(previewRow.commitStatus, strongestMatch);
    applyExactDuplicateSuppressionReason(previewRow, input.sourceType);
    applySourceAuthorityToPreviewRow(previewRow, input.sourceType);
    applyRequestedReconciliationTargetToPreviewRow(
      previewRow,
      input.sourceType,
      requestedReconciliationTargetTransactionId
    );
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
  autoIncludeCurrentPeriodStatementRowsReplacingPriorCertifiedMatches({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    sourceType: input.sourceType,
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  prioritizeCertifiedRowsExplainingStatementMismatch({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  const visibleReconciliationRows = previewRows.filter((row) => row.reconciliationMatches?.length);
  const reconciliationCandidates = visibleReconciliationRows.flatMap((row) => row.reconciliationMatches ?? []).slice(0, 8);
  const statementReconciliations = buildImportPreviewStatementReconciliations({
    accounts,
    existingRows: existingTransactions.results,
    previewRows,
    sourceType: input.sourceType,
    statementCheckpoints: input.statementCheckpoints ?? []
  });
  markResolvedCertifiedRowsForMatchedStatements(previewRows, statementReconciliations);
  markCertifiedConflictRows(previewRows, statementReconciliations);
  const exceptionSummary = buildImportPreviewExceptionSummary({
    unknownAccountCount: unknownAccounts.size,
    unknownCategoryCount: unknownCategories.size,
    reconciliationCandidateCount: visibleReconciliationRows.length,
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
    reconciliationCandidateCount: visibleReconciliationRows.length,
    overlappingImportCount: overlapImports.length,
    overlapImports,
    startDate: previewRows.length ? previewRows.map((row) => row.date).sort()[0] : undefined,
    endDate: previewRows.length ? previewRows.map((row) => row.date).sort().at(-1) : undefined,
    accountNames: Array.from(new Set(previewRows.map((row) => row.accountName).filter((accountName): accountName is string => Boolean(accountName)))).sort(),
    reconciliationCandidates,
    statementReconciliations,
    exceptionSummary
  };
}

function buildImportPreviewExceptionSummary(input: {
  unknownAccountCount: number;
  unknownCategoryCount: number;
  reconciliationCandidateCount: number;
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
    { kind: "entry_reconciliation" as const, count: input.reconciliationCandidateCount, tone: "review" as const },
    { kind: "prior_import_context" as const, count: input.overlappingImportCount, tone: "context" as const }
  ].filter((item) => item.count > 0);
}

function getPreviewRowDateCandidates(previewRow: ImportPreviewRowDto) {
  return Array.from(new Set(
    [
      previewRow.date,
      extractTransactionDateHint(previewRow.note),
      extractTransactionDateHint(previewRow.rawRow?.note),
      extractTransactionDateHint(previewRow.rawRow?.notes),
      extractTransactionDateHint(previewRow.rawRow?.remarks),
      previewRow.rawRow?.transactionDate,
      previewRow.rawRow?.["transaction date"]
    ]
      .map((value) => typeof value === "string" ? normalizeDateString(value) ?? normalizeStatementDate(value) : undefined)
      .filter((value): value is string => Boolean(value))
  ));
}

function getPreviewRowDateContext(previewRow: ImportPreviewRowDto) {
  const originalDateCandidates = getPreviewRowDateCandidates(previewRow).filter((date) => date !== previewRow.date);
  const eventDateHint = originalDateCandidates[0];
  return {
    postedDate: previewRow.date,
    eventDate: eventDateHint ?? previewRow.date,
    hasEventDateHint: Boolean(eventDateHint)
  };
}

function getExistingTransactionDateContext(candidate: {
  transaction_date: string;
  post_date: string | null;
  note: string | null;
}) {
  const noteEventDateHint = extractTransactionDateHint(candidate.note ?? undefined);
  const postedDate = candidate.post_date ?? candidate.transaction_date;
  return {
    postedDate,
    eventDate: candidate.transaction_date,
    hasEventDateHint: candidate.post_date == null
      || candidate.transaction_date !== postedDate
      || Boolean(noteEventDateHint)
  };
}

function getDuplicateCandidateDayDistance(input: {
  previewRow: {
    postedDate: string;
    eventDate: string;
    hasEventDateHint: boolean;
  };
  candidate: {
    postedDate: string;
    eventDate: string;
    hasEventDateHint: boolean;
  };
}) {
  if (input.previewRow.hasEventDateHint && input.candidate.hasEventDateHint) {
    return Math.abs(daysBetween(input.previewRow.eventDate, input.candidate.eventDate));
  }

  return Math.abs(daysBetween(input.previewRow.postedDate, input.candidate.postedDate));
}

function findExactDuplicateSuppressionMatch(input: {
  previewRow: ImportPreviewRowDto;
  previewRowDateContext: ReturnType<typeof getPreviewRowDateContext>;
  existingRows: Array<{
    import_id: string | null;
    source_type: "csv" | "pdf" | "manual";
    transaction_id: string;
    account_id: string;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount_minor: number;
    bank_certification_status: "provisional" | "statement_certified";
    account_name: string;
    normalized_hash: string | null;
  }>;
}) {
  const previewRowHash = buildImportRowHash(input.previewRow);

  const exactMatches = input.existingRows
    .map((candidate) => {
      if (!isSameAmountAndAccountCandidate(input.previewRow, candidate)) {
        return undefined;
      }

      const candidateDateContext = getExistingTransactionDateContext(candidate);
      const dayDistance = getDuplicateCandidateDayDistance({
        previewRow: input.previewRowDateContext,
        candidate: candidateDateContext
      });
      const hasMatchingHash = Boolean(candidate.normalized_hash) && candidate.normalized_hash === previewRowHash;
      const hasPerfectDescriptionMatch = dayDistance === 0
        && normalizeDescriptionForMatch(candidate.description) === normalizeDescriptionForMatch(input.previewRow.description);
      const hasCompactDescriptionMatch = dayDistance === 0
        && compareDescriptionSimilarity(candidate.description, input.previewRow.description) >= 0.9;

      if (!hasMatchingHash && !hasPerfectDescriptionMatch && !hasCompactDescriptionMatch) {
        return undefined;
      }

      return {
        candidate,
        dayDistance,
        usedHashMatch: hasMatchingHash
      };
    })
    .filter((match): match is {
      candidate: typeof input.existingRows[number];
      dayDistance: number;
      usedHashMatch: boolean;
    } => Boolean(match))
    .sort((left, right) => (
      Number(right.usedHashMatch) - Number(left.usedHashMatch)
      || left.dayDistance - right.dayDistance
    ));

  return exactMatches[0] ? mapCandidateToReconciliationMatch(exactMatches[0].candidate, "exact") : undefined;
}

function findReconciliationMatches(input: {
  previewRow: ImportPreviewRowDto;
  previewRowDateContext: ReturnType<typeof getPreviewRowDateContext>;
  existingRows: Array<{
    import_id: string | null;
    source_type: "csv" | "pdf" | "manual";
    transaction_id: string;
    account_id: string;
    transaction_date: string;
    post_date: string | null;
    description: string;
    note: string | null;
    amount_minor: number;
    bank_certification_status: "provisional" | "statement_certified";
    account_name: string;
  }>;
  incomingSourceType?: "csv" | "pdf" | "manual";
}) {
  return input.existingRows
    .map((candidate) => {
      if (!isReconciliationCandidateEligibleForSource(candidate, input.incomingSourceType)) {
        return undefined;
      }

      if (!isSameAmountAndAccountCandidate(input.previewRow, candidate)) {
        return undefined;
      }

      const candidateDateContext = getExistingTransactionDateContext(candidate);
      const dayDistance = getDuplicateCandidateDayDistance({
        previewRow: input.previewRowDateContext,
        candidate: candidateDateContext
      });
      const maxDayDistance = getDuplicateCandidateMaxDayDistance(input.previewRow.amountMinor);

      // The velocity rule rejects low-value matches that are too far apart in
      // time. This prevents commuter false positives where weekly BUS/MRT or
      // coffee charges share the same amount and similar merchant text but
      // are actually separate real-world events.
      if (dayDistance > maxDayDistance) {
        return undefined;
      }

      const sharedTokenCount = countSharedTokens(input.previewRow.description, candidate.description);
      const tokenSimilarity = getTokenSimilarity(input.previewRow.description, candidate.description);
      const descriptionSimilarity = boostDescriptionSimilarityForManualPromotionCandidate({
        baseSimilarity: compareDescriptionSimilarity(input.previewRow.description, candidate.description),
        candidateSourceType: candidate.source_type,
        candidateBankCertificationStatus: candidate.bank_certification_status,
        dayDistance,
        sharedTokenCount
      });
      const matchKind = getDuplicateMatchKind({
        dayDistance,
        descriptionSimilarity,
        tokenSimilarity
      });
      if (!matchKind) {
        return undefined;
      }

      return {
        candidate,
        dayDistance,
        descriptionSimilarity,
        matchKind
      };
    })
    .filter((match): match is {
      candidate: typeof input.existingRows[number];
      dayDistance: number;
      descriptionSimilarity: number;
      matchKind: "exact" | "probable" | "near";
    } => Boolean(match))
    .sort((left, right) => (
      getDuplicateMatchRank(left.matchKind) - getDuplicateMatchRank(right.matchKind)
      || left.dayDistance - right.dayDistance
      || right.descriptionSimilarity - left.descriptionSimilarity
    ))
    .slice(0, 3)
    .map(({ candidate, matchKind }) => mapCandidateToReconciliationMatch(candidate, matchKind));
}

function isSameAmountAndAccountCandidate(
  previewRow: ImportPreviewRowDto,
  candidate: {
    account_id: string;
    account_name: string;
    amount_minor: number;
  }
) {
  const sameAmount = Number(candidate.amount_minor) === Number(previewRow.amountMinor);
  if (!sameAmount) {
    return false;
  }

  return previewRow.accountId
    ? candidate.account_id === previewRow.accountId
    : !previewRow.accountName || candidate.account_name === previewRow.accountName;
}

function mapCandidateToReconciliationMatch(
  candidate: {
    import_id: string | null;
    source_type: "csv" | "pdf" | "manual";
    transaction_id: string;
    account_id: string;
    transaction_date: string;
    description: string;
    amount_minor: number;
    bank_certification_status: "provisional" | "statement_certified";
    account_name: string;
  },
  matchKind: "exact" | "probable" | "near"
) {
  return {
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
  };
}

function boostDescriptionSimilarityForManualPromotionCandidate(input: {
  baseSimilarity: number;
  candidateSourceType: "csv" | "pdf" | "manual";
  candidateBankCertificationStatus: "provisional" | "statement_certified";
  dayDistance: number;
  sharedTokenCount: number;
}) {
  if (
    input.candidateSourceType === "manual"
    && input.candidateBankCertificationStatus === "provisional"
    && input.dayDistance === 0
    && input.sharedTokenCount >= 1
  ) {
    return Math.max(input.baseSimilarity, 0.7);
  }

  return input.baseSimilarity;
}

function isReconciliationCandidateEligibleForSource(
  candidate: {
    import_id: string | null;
    source_type: "csv" | "pdf" | "manual";
    bank_certification_status: "provisional" | "statement_certified";
  },
  incomingSourceType?: "csv" | "pdf" | "manual"
) {
  // These guards belong only to the promotion/reconciliation lane. Exact
  // duplicate suppression is allowed to see the full ledger so repeated bank
  // files can auto-skip rows before any source-isolation policy applies.
  const isLockedStatementEntry = candidate.bank_certification_status === "statement_certified";
  if (isLockedStatementEntry) {
    return false;
  }

  const isRestrictedMidCycleMatch = candidate.bank_certification_status === "provisional"
    && candidate.import_id != null
    && incomingSourceType !== "pdf";

  // Only final PDF statements are allowed to reconcile against an imported
  // provisional row. Mid-cycle sources stay isolated so a new CSV/XLS charge
  // cannot latch onto an older bank-imported row that merely looks similar.
  if (isRestrictedMidCycleMatch) {
    return false;
  }

  return true;
}

function applySourceAuthorityToPreviewRow(
  previewRow: ImportPreviewRowDto,
  sourceType?: "csv" | "pdf" | "manual"
) {
  const strongestMatch = previewRow.reconciliationMatches?.[0] ?? previewRow.reconciliationMatch;
  if (!strongestMatch?.existingTransactionId) {
    return;
  }

  previewRow.reconciliationMatch = strongestMatch;
  previewRow.reconciliationMatchCount = previewRow.reconciliationMatchCount
    ?? previewRow.reconciliationMatches?.length
    ?? 1;

  if (sourceType === "csv" && canPromoteManualReconciliationMatch(previewRow, strongestMatch)) {
    previewRow.commitStatus = "included";
    previewRow.commitStatusReason = "Current-activity import will promote the existing manual ledger row while preserving user edits and split links.";
    previewRow.reconciliationTargetTransactionId = strongestMatch.existingTransactionId;
    previewRow.reconciliationMatches = undefined;
    return;
  }

  if (sourceType !== "pdf") {
    return;
  }

  const isAlreadyStatementCertified = strongestMatch.existingSourceType === "pdf"
    || strongestMatch.existingBankCertificationStatus === "statement_certified";

  if (isAlreadyStatementCertified) {
    previewRow.commitStatus = "skipped";
    previewRow.commitStatusReason = "Official statement row is already certified in the ledger.";
    previewRow.reconciliationMatches = undefined;
    return;
  }

  previewRow.commitStatus = "included";
  previewRow.commitStatusReason = "Official statement will certify the existing mid-cycle ledger row while preserving user edits.";
  previewRow.reconciliationTargetTransactionId = strongestMatch.existingTransactionId;
  previewRow.reconciliationMatches = undefined;
}

function applyExactDuplicateSuppressionReason(
  previewRow: ImportPreviewRowDto,
  sourceType?: "csv" | "pdf" | "manual"
) {
  if (
    sourceType === "pdf"
    && previewRow.commitStatus === "skipped"
    && previewRow.reconciliationMatch?.matchKind === "exact"
    && (
      previewRow.reconciliationMatch.existingSourceType === "pdf"
      || previewRow.reconciliationMatch.existingBankCertificationStatus === "statement_certified"
    )
  ) {
    previewRow.commitStatusReason = "Official statement row is already certified in the ledger.";
  }
}

function canPromoteManualReconciliationMatch(
  previewRow: ImportPreviewRowDto,
  strongestMatch: NonNullable<ImportPreviewRowDto["reconciliationMatch"]>
) {
  return strongestMatch.existingSourceType === "manual"
    && strongestMatch.existingBankCertificationStatus === "provisional"
    && (previewRow.reconciliationMatchCount ?? 0) === 1
    && strongestMatch.matchKind !== "near";
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
      cleared_date: row.date,
      entry_type: row.entryType,
      transfer_direction: row.transferDirection ?? null,
      amount_minor: row.amountMinor
    }));
}

function buildProjectedLedgerRows(
  existingRows: {
    transaction_id?: string;
    account_id: string;
    cleared_date?: string;
    transaction_date: string;
    post_date?: string | null;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[],
  previewRows: ImportPreviewRowDto[]
) {
  const certificationTargetIds = new Set(
    previewRows
      .map((row) => row.reconciliationTargetTransactionId)
      .filter((id): id is string => Boolean(id))
  );
  return [
    ...existingRows
      .filter((row) => !row.transaction_id || !certificationTargetIds.has(row.transaction_id))
      .map((row) => ({
        ...row,
        cleared_date: row.cleared_date ?? row.post_date ?? row.transaction_date
      })),
    ...buildPreviewLedgerRows(previewRows)
  ];
}

function getStatementConfirmableDuplicateRowsForAccount(previewRows: ImportPreviewRowDto[], accountId: string, statementEndDate: string) {
  return previewRows.filter((row) => (
    row.accountId === accountId
    && row.date <= statementEndDate
    && Boolean(row.reconciliationMatches?.length)
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
    post_date?: string | null;
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

    // Reconciliation matches are intentionally cautious because bank posting dates
    // can differ across mid-cycle exports and final statements. If adding the
    // app-skipped or still-unresolved matched rows removes the exact
    // account-level statement delta, the statement has confirmed those rows
    // belong in this import. User-excluded rows keep their explicit decision.
    if (deltaMinor !== 0 && confirmableDuplicateRows.length > 0 && deltaMinor + confirmableDuplicateTotalMinor === 0) {
      for (const row of confirmableDuplicateRows) {
        row.commitStatus = "included";
        row.commitStatusReason = "Statement certification check confirmed this row belongs in the import.";
        row.reconciliationMatches = undefined;
      }
    }
  }
}

function autoIncludeCurrentPeriodStatementRowsReplacingPriorCertifiedMatches(input: {
  accounts: AccountDto[];
  existingRows: {
    account_id: string;
    transaction_date: string;
    post_date?: string | null;
    entry_type: "expense" | "income" | "transfer";
    transfer_direction: "in" | "out" | null;
    amount_minor: number;
  }[];
  previewRows: ImportPreviewRowDto[];
  sourceType?: "csv" | "pdf" | "manual";
  statementCheckpoints: StatementCheckpointDraftDto[];
}) {
  if (input.sourceType !== "pdf" || !input.statementCheckpoints.length) {
    return;
  }

  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const accountsByName = groupAccountsByName(input.accounts);

  for (const checkpoint of input.statementCheckpoints) {
    const account = resolvePreviewAccount(accountsById, accountsByName, checkpoint.accountId, checkpoint.accountName);
    if (!account) {
      continue;
    }

    const previousCheckpoint = getImmediatePreviousMatchedCheckpoint(account, checkpoint.checkpointMonth);
    if (!previousCheckpoint) {
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
    if (deltaMinor === 0) {
      continue;
    }

    const promotableRows = input.previewRows.filter((row) => {
      const signedMinor = getSignedLedgerAmountMinor({
        entry_type: row.entryType,
        transfer_direction: row.transferDirection ?? null,
        amount_minor: row.amountMinor
      });
      const matchedLedgerDate = row.reconciliationMatch?.date;
      return (
        row.accountId === account.id
        && row.date >= (statementStartDate ?? "0000-00-00")
        && row.date <= statementEndDate
        && row.commitStatus === "skipped"
        && Boolean(row.reconciliationMatch?.existingTransactionId)
        && (row.reconciliationMatchCount ?? 0) === 1
        && Boolean(matchedLedgerDate)
        && isDateWithinCheckpoint(matchedLedgerDate!, previousCheckpoint)
        && !isDateWithinRange(matchedLedgerDate!, statementStartDate, statementEndDate)
        && deltaMinor + signedMinor === 0
      );
    });

    if (promotableRows.length !== 1) {
      continue;
    }

    const row = promotableRows[0];
    row.commitStatus = "included";
    row.commitStatusReason = "Official statement row belongs to this statement period and will import. The prior certified match belongs to the previous matched statement.";
    row.reconciliationTargetTransactionId = undefined;
    row.reconciliationMatches = undefined;
    row.isCertifiedConflict = false;
    row.isStatementMatchResolved = false;
  }
}

function prioritizeCertifiedRowsExplainingStatementMismatch(input: {
  accounts: AccountDto[];
  existingRows: {
    account_id: string;
    transaction_date: string;
    post_date?: string | null;
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
    if (deltaMinor === 0) {
      continue;
    }

    const explainingRows = input.previewRows.filter((row) => (
      row.accountId === account.id
      && row.date <= statementEndDate
      && row.commitStatus === "skipped"
      && Boolean(row.reconciliationMatch?.existingTransactionId)
      && (row.reconciliationMatchCount ?? 0) === 1
      && Math.abs(getSignedLedgerAmountMinor({
        entry_type: row.entryType,
        transfer_direction: row.transferDirection ?? null,
        amount_minor: row.amountMinor
      })) === Math.abs(deltaMinor)
    ));

    if (explainingRows.length !== 1) {
      continue;
    }

    explainingRows[0].commitStatusReason = `Official statement row is already certified in the ledger. This row matches the current statement mismatch difference of ${formatMinorForReason(Math.abs(deltaMinor))}.`;
  }
}

function formatMinorForReason(amountMinor: number) {
  return (amountMinor / 100).toFixed(2);
}

function getImmediatePreviousMatchedCheckpoint(account: AccountDto, checkpointMonth: string) {
  const previous = (account.checkpointHistory ?? [])
    .filter((item) => item.month < checkpointMonth)
    .sort((left, right) => right.month.localeCompare(left.month))[0];

  if (!previous || previous.deltaMinor !== 0) {
    return undefined;
  }

  return {
    checkpoint_month: previous.month,
    statement_start_date: previous.statementStartDate ?? null,
    statement_end_date: previous.statementEndDate ?? null
  };
}

function isDateWithinRange(value: string, startDate?: string, endDate?: string) {
  return value >= (startDate ?? "0000-00-00") && value <= (endDate ?? "9999-12-31");
}

function isDateWithinCheckpoint(
  value: string,
  checkpoint: { checkpoint_month: string; statement_start_date: string | null; statement_end_date: string | null }
) {
  return isDateWithinRange(
    value,
    checkpoint.statement_start_date ?? undefined,
    checkpoint.statement_end_date ?? getMonthEndDate(checkpoint.checkpoint_month)
  );
}

function markResolvedCertifiedRowsForMatchedStatements(
  previewRows: ImportPreviewRowDto[],
  statementReconciliations: ImportPreviewDto["statementReconciliations"]
) {
  const matchedCheckpoints = statementReconciliations.filter((item) => item.status === "matched" && item.accountId && item.statementEndDate);
  if (!matchedCheckpoints.length) {
    return;
  }

  for (const row of previewRows) {
    row.isStatementMatchResolved = false;
  }

  for (const checkpoint of matchedCheckpoints) {
    for (const row of previewRows) {
      row.isCertifiedConflict = false;
      if (
        row.accountId === checkpoint.accountId
        && row.date <= checkpoint.statementEndDate!
        && row.commitStatus === "skipped"
        && Boolean(row.reconciliationMatch?.existingTransactionId)
      ) {
        row.isStatementMatchResolved = true;
      }
    }
  }
}

function markCertifiedConflictRows(
  previewRows: ImportPreviewRowDto[],
  statementReconciliations: ImportPreviewDto["statementReconciliations"]
) {
  const checkpointsByAccountId = new Map(
    statementReconciliations
      .filter((item) => item.accountId)
      .map((item) => [item.accountId!, item])
  );

  for (const row of previewRows) {
    if (row.isStatementMatchResolved) {
      row.isCertifiedConflict = false;
      continue;
    }

    const checkpoint = row.accountId ? checkpointsByAccountId.get(row.accountId) : undefined;
    const hasCertifiedComparison = row.commitStatus === "skipped" && Boolean(row.reconciliationMatch?.existingTransactionId);
    row.isCertifiedConflict = Boolean(hasCertifiedComparison && checkpoint && checkpoint.status !== "matched");

    if (!row.isCertifiedConflict || !checkpoint) {
      continue;
    }

    const ledgerMatchDate = row.reconciliationMatch?.date;
    const isOutsidePeriod = Boolean(
      ledgerMatchDate
      && (
        (checkpoint.statementStartDate && ledgerMatchDate < checkpoint.statementStartDate)
        || (checkpoint.statementEndDate && ledgerMatchDate > checkpoint.statementEndDate)
      )
    );

    if (isOutsidePeriod && row.commitStatusReason) {
      row.commitStatusReason = `${row.commitStatusReason} The matched certified ledger row is outside this statement period.`;
    }
  }
}

function buildImportPreviewStatementReconciliations(input: {
  accounts: AccountDto[];
  existingRows: {
    account_id: string;
    transaction_date: string;
    post_date?: string | null;
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

function getRequestedReconciliationTargetTransactionId(rawRow: Record<string, string>) {
  const value = rawRow.previewReconciliationTargetTransactionId ?? rawRow.reconciliationTargetTransactionId;
  return value?.trim() || undefined;
}

function applyRequestedReconciliationTargetToPreviewRow(
  previewRow: ImportPreviewRowDto,
  sourceType: "csv" | "pdf" | "manual" | undefined,
  requestedTransactionId?: string
) {
  if (!requestedTransactionId) {
    return;
  }

  const availableMatches = [
    ...(previewRow.reconciliationMatches ?? []),
    ...(previewRow.reconciliationMatch ? [previewRow.reconciliationMatch] : [])
  ];
  const requestedMatch = availableMatches.find((match) => match.existingTransactionId === requestedTransactionId);
  if (!requestedMatch?.existingTransactionId) {
    return;
  }

  previewRow.reconciliationMatch = requestedMatch;
  previewRow.reconciliationMatchCount = availableMatches.length;
  previewRow.reconciliationTargetTransactionId = requestedMatch.existingTransactionId;
  previewRow.reconciliationMatches = undefined;
  previewRow.commitStatus = "included";
  previewRow.commitStatusReason = sourceType === "pdf"
    ? "Official statement will certify the selected existing ledger row while preserving user edits."
    : requestedMatch.existingSourceType === "manual"
      ? "This import will promote the selected manual ledger row while preserving user edits and split links."
      : "This import will reconcile against the selected existing ledger row instead of creating a new one.";
}

function getDuplicateMatchKind(input: {
  dayDistance: number;
  descriptionSimilarity: number;
  tokenSimilarity: number;
}) {
  if (input.dayDistance === 0 && input.descriptionSimilarity >= 0.8) {
    return "exact" as const;
  }

  if (input.dayDistance <= 2 && input.descriptionSimilarity >= 0.6) {
    return "probable" as const;
  }

  if (input.dayDistance <= 7 && input.tokenSimilarity >= 0.5) {
    return "near" as const;
  }

  return undefined;
}

function getDuplicateCandidateMaxDayDistance(amountMinor: number) {
  // High-velocity low-value rows need a much tighter window so recurring
  // fares, coffee, or canteen charges are not treated as the same event.
  return Math.abs(amountMinor) < LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR
    ? LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE
    : STANDARD_DUPLICATE_MAX_DAY_DISTANCE;
}

function getTokenSimilarity(left: string, right: string) {
  const sharedTokenCount = countSharedTokens(left, right);
  const leftTokenCount = normalizeDescriptionTokenCount(left);
  const rightTokenCount = normalizeDescriptionTokenCount(right);
  if (!leftTokenCount || !rightTokenCount) {
    return 0;
  }

  return sharedTokenCount / Math.max(leftTokenCount, rightTokenCount);
}

function normalizeDescriptionTokenCount(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/gi, " ").split(" ").filter(Boolean)).size;
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
    return "An exact reconciliation match already exists in the ledger.";
  }

  if (commitStatus === "skipped" && matchKind === "probable") {
    return "A probable reconciliation match already exists in the ledger.";
  }

  if (commitStatus === "needs_review") {
    return "A possible reconciliation match needs a user decision before commit.";
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
