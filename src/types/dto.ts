export type PersonScope = "direct" | "shared" | "direct_plus_shared";
export type EntryType = "expense" | "income" | "transfer";
export type TransferDirection = "in" | "out";
export type PlanSectionKey = "planned_items" | "budget_buckets";

export interface DemoSettingsDto {
  salaryPerPersonMinor: number;
  lastSeededAt: string;
  emptyState?: boolean;
}

export interface HouseholdDto {
  id: string;
  name: string;
  baseCurrency: string;
  people: PersonDto[];
}

export interface PersonDto {
  id: string;
  name: string;
}

export interface AccountDto {
  id: string;
  institutionId: string;
  ownerPersonId?: string;
  name: string;
  institution: string;
  kind: string;
  ownerLabel: string;
  currency: string;
  openingBalanceMinor?: number;
  isJoint: boolean;
  isActive: boolean;
  balanceMinor?: number;
  latestTransactionDate?: string;
  latestImportAt?: string;
  unresolvedTransferCount?: number;
  latestCheckpointMonth?: string;
  latestCheckpointStartDate?: string;
  latestCheckpointEndDate?: string;
  latestCheckpointBalanceMinor?: number;
  latestCheckpointComputedBalanceMinor?: number;
  latestCheckpointDeltaMinor?: number;
  latestCheckpointNote?: string;
  reconciliationStatus?: ReconciliationStatus;
  checkpointHistory?: AccountCheckpointDto[];
}

export interface ShortcutSettingsDto {
  endpointPath: string;
  apiKey: string;
  apiKeySource: "app" | "environment" | "none";
  defaultAccountPriorityIds: string[];
  defaultParams: string;
}

export interface AccountCheckpointDto {
  month: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  computedBalanceMinor: number;
  deltaMinor: number;
  note?: string;
}

export interface SummaryAccountPillDto {
  accountId: string;
  accountName: string;
  ownerLabel: string;
  balanceMinor: number;
  unresolvedTransferCount?: number;
  latestCheckpointMonth?: string;
  latestCheckpointDeltaMinor?: number;
  reconciliationStatus?: ReconciliationStatus;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  iconKey: string;
  colorHex: string;
  sortOrder: number;
  isSystem: boolean;
}

export interface CategoryMatchRuleDto {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  priority: number;
  isActive: boolean;
  note?: string;
}

export interface CategoryMatchRuleSuggestionDto {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  sourceCount: number;
  sampleDescriptions: string[];
  lastSeenAt: string;
}

// How money is coloured by its direction or outcome; src/domain/money-tone.ts
// decides it and the .money-<tone> classes render it.
export type MoneyTone = "in" | "short" | "plan" | "caution" | "out" | "neutral";
export type ReconciliationStatus = "matched" | "mismatch" | "needs_checkpoint";

export interface MetricCardDto {
  label: string;
  amountMinor?: number;
  value?: string;
  tone: MoneyTone;
  detail?: string;
}

export interface BarChartDatumDto {
  key: string;
  label: string;
  valueMinor: number;
  secondaryValueMinor?: number;
  tertiaryValueMinor?: number;
}

export interface DonutChartDatumDto {
  key: string;
  categoryId?: string;
  label: string;
  valueMinor: number;
  entryCount?: number;
}

export interface SummaryDonutMonthDto {
  month: string;
  data: DonutChartDatumDto[];
}

export interface SummaryMonthDto {
  month: string;
  plannedIncomeMinor: number;
  actualIncomeMinor: number;
  estimatedExpensesMinor: number;
  realExpensesMinor: number;
  savingsGoalMinor: number;
  realizedSavingsMinor: number;
  estimatedDiffMinor: number;
  realDiffMinor: number;
  note: string;
}

export interface EntrySplitDto {
  personId: string;
  personName: string;
  ratioBasisPoints: number;
  amountMinor: number;
}

export interface LinkedTransferDto {
  transactionId: string;
  accountName: string;
  accountOwnerLabel?: string;
  amountMinor: number;
  transactionDate: string;
}

export interface EntryDto {
  id: string;
  date: string;
  postDate?: string;
  description: string;
  accountId?: string;
  accountName: string;
  accountOwnerLabel?: string;
  categoryName: string;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  ownershipType: "direct" | "shared";
  ownerName?: string;
  amountMinor: number;
  totalAmountMinor?: number;
  viewerSplitRatioBasisPoints?: number;
  offsetsCategory: boolean;
  note?: string;
  bankCertificationStatus?: "manual_provisional" | "import_provisional" | "statement_certified";
  bankCertificationLabel?: string;
  importedSourceType?: "csv" | "pdf" | "manual";
  importedSourceLabel?: string;
  statementCertifiedAt?: string;
  linkedTransfer?: LinkedTransferDto;
  linkedSplitExpenseId?: string;
  linkedSplitGroupName?: string;
  linkedSplitCategoryName?: string;
  linkedSplitNote?: string;
  // The linked split's shares in this entry's own (home) currency: a travel
  // split's shares are each person's share of the ledger amount, while the
  // split itself keeps its own-currency shares.
  linkedSplitShares?: EntrySplitDto[];
  splits: EntrySplitDto[];
}

export interface EntriesPageDto {
  viewId: string;
  label: string;
  splitGroups: Array<{
    id: string;
    name: string;
  }>;
  monthPage: {
    month: string;
    selectedPersonId: string;
    selectedScope: PersonScope;
    scopes: Array<{ key: PersonScope; label: string }>;
    entries: EntryDto[];
  };
}

export interface SplitGroupPillDto {
  id: string;
  name: string;
  iconKey?: string;
  balanceMinor: number;
  summaryText: string;
  entryCount: number;
  pendingMatchCount: number;
  currency: string;
  expenseSource: "cash" | "ledger" | "mixed";
  isDefault?: boolean;
}

export interface SplitGroupDto {
  id: string;
  name: string;
  iconKey?: string;
  sortOrder: number;
  currency: string;
  expenseSource: "cash" | "ledger" | "mixed";
}

export interface SplitActivityDto {
  id: string;
  kind: "expense" | "settlement";
  groupId: string;
  groupName: string;
  batchId?: string;
  batchLabel?: string;
  batchClosedAt?: string;
  isArchived: boolean;
  date: string;
  description: string;
  categoryName?: string;
  paidByPersonName?: string;
  fromPersonName?: string;
  toPersonName?: string;
  totalAmountMinor: number;
  currency: string;
  homeAmountMinor?: number;
  fxRateBasisPoints?: number;
  paymentMethod: "cash" | "card" | "bank" | "other";
  paymentStatus: "recorded" | "awaiting_statement" | "certified";
  shares?: EntrySplitDto[];
  viewerAmountMinor?: number;
  editableSplitPersonName?: string;
  editableSplitBasisPoints?: number;
  editableSplitAmountMinor?: number;
  viewerDirectionLabel: string;
  viewerTone?: MoneyTone;
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
  linkedTransactionNote?: string;
  linkedTransactionCategoryName?: string;
  matched: boolean;
  settlementCheckpointId?: string;
  settlementCheckpointStatus?: "open" | "matched" | "partially_matched" | "internally_offset" | "reopened" | "voided";
  settlementStatus?: "settled" | "open_after_settlement" | "open";
}

export interface SplitSettlementCheckpointDto {
  id: string;
  fromPersonId?: string;
  fromPersonName?: string;
  toPersonId?: string;
  toPersonName?: string;
  amountMinor: number;
  currency: string;
  settlementDate: string;
  settledAt?: string;
  status: "open" | "matched" | "partially_matched" | "internally_offset" | "reopened" | "voided";
  matchedTransactionId?: string;
  matchedAmountMinor: number;
  matchedTransfers: SplitSettlementCheckpointTransferDto[];
  includedRecordCount: number;
  note?: string;
  includedRecordIds?: string[];
}

export interface SplitSettlementCheckpointTransferDto {
  transactionId: string;
  transactionDate: string;
  description: string;
  amountMinor: number;
  currency: string;
  ledgerAmountMinor?: number;
  fxRateBasisPoints?: number;
}

export interface SplitMatchCandidateDto {
  id: string;
  kind: "expense" | "settlement";
  groupId: string;
  groupName: string;
  splitRecordId: string;
  splitDate: string;
  splitDescription: string;
  splitAmountMinor: number;
  splitCurrency?: string;
  transactionId: string;
  transactionDate: string;
  transactionDescription: string;
  amountMinor: number;
  transactionCurrency?: string;
  amountDeltaMinor: number;
  dateDeltaDays: number;
  confidenceLabel: "High" | "Medium";
  reviewLabel: string;
  requiresFxReview?: boolean;
  fxRateBasisPoints?: number;
}

export interface SplitExpenseDto {
  id: string;
  groupId?: string;
  groupName: string;
  batchId?: string;
  batchLabel?: string;
  batchClosedAt?: string;
  date: string;
  description: string;
  categoryName: string;
  payerPersonId: string;
  payerPersonName: string;
  totalAmountMinor: number;
  currency: string;
  homeAmountMinor?: number;
  fxRateBasisPoints?: number;
  paymentMethod: "cash" | "card" | "bank" | "other";
  paymentStatus: "recorded" | "awaiting_statement" | "certified";
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
  linkedTransactionNote?: string;
  linkedTransactionCategoryName?: string;
  shares: EntrySplitDto[];
}

export interface SplitSettlementDto {
  id: string;
  groupId?: string;
  groupName: string;
  batchId?: string;
  batchLabel?: string;
  batchClosedAt?: string;
  date: string;
  fromPersonId: string;
  fromPersonName: string;
  toPersonId: string;
  toPersonName: string;
  amountMinor: number;
  currency: string;
  fxRateBasisPoints?: number;
  paymentMethod: "cash" | "card" | "bank" | "other";
  paymentStatus: "recorded" | "awaiting_statement" | "certified";
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
  linkedTransactionNote?: string;
  linkedTransactionCategoryName?: string;
}

export interface SplitsPageDto {
  month: string;
  groups: SplitGroupPillDto[];
  activity: SplitActivityDto[];
  matches: SplitMatchCandidateDto[];
  // Open expenses by category in the home currency (SGD).
  donutChart: DonutChartDatumDto[];
  // The same chart for each other split currency with open expenses, in that
  // currency's own amounts; absent when every open expense is in SGD.
  donutChartsByCurrency?: Record<string, DonutChartDatumDto[]>;
  settlementCheckpoints: SplitSettlementCheckpointDto[];
  activityHistory: SplitActivityHistoryDto[];
}

export interface SplitActivityHistoryDto {
  id: string;
  recordKind: "expense" | "settlement";
  recordId: string;
  action: "created" | "updated" | "deleted" | "restored";
  groupId?: string;
  groupName?: string;
  description: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  detail?: string;
  canRestore: boolean;
}

export interface MonthPlanRowDto {
  id: string;
  section: PlanSectionKey;
  categoryId?: string;
  categoryName: string;
  label: string;
  planDate?: string;
  dayLabel?: string;
  dayOfWeek?: string;
  plannedMinor: number;
  actualMinor: number;
  accountId?: string;
  accountName?: string;
  note?: string;
  ownershipType: "direct" | "shared";
  personId?: string;
  ownerName?: string;
  linkedEntryIds?: string[];
  linkedEntryCount?: number;
  actualEntryIds?: string[];
  planMatchHints?: MonthPlanMatchHintDto[];
  isDerived?: boolean;
  sourceRowIds?: string[];
  sourcePlannedMinor?: number;
  sourceNote?: string;
  splits: EntrySplitDto[];
}

export interface MonthPlanMatchHintDto {
  id: string;
  descriptionPattern: string;
  amountMinor?: number;
  accountName?: string;
  categoryName?: string;
}

export interface MonthPlanSectionDto {
  key: PlanSectionKey;
  label: string;
  description: string;
  rows: MonthPlanRowDto[];
}

export interface MonthIncomeRowDto {
  id: string;
  categoryId?: string;
  categoryName: string;
  label: string;
  plannedMinor: number;
  actualMinor: number;
  personId?: string;
  ownerName?: string;
  note?: string;
  isDerived?: boolean;
  sourceRowIds?: string[];
  actualEntryIds?: string[];
}

export interface ImportBatchDto {
  id: string;
  sourceLabel: string;
  sourceType: "csv" | "pdf" | "manual";
  parserKey?: string;
  importedAt: string;
  status: "draft" | "completed" | "rolled_back";
  transactionCount: number;
  startDate?: string;
  endDate?: string;
  accountNames: string[];
  overlapImportCount?: number;
  overlapImports?: ImportOverlapDto[];
  statementCertificateCount?: number;
  statementCertificateStatus?: "certified" | "exception";
  rollbackProtected?: boolean;
  note?: string;
}

export interface ImportOverlapDto {
  id: string;
  sourceLabel: string;
  sourceType: "csv" | "pdf" | "manual";
  parserKey?: string;
  importedAt: string;
  status: "draft" | "completed" | "rolled_back";
  transactionCount: number;
  startDate?: string;
  endDate?: string;
  accountNames: string[];
  overlapEntries?: ImportOverlapEntryDto[];
}

export interface ImportOverlapEntryDto {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  accountName: string;
  entryType: EntryType;
  transferDirection?: TransferDirection;
}

export interface ImportPreviewRowDto {
  rowId: string;
  rowIndex: number;
  commitStatus?: "included" | "skipped" | "needs_review";
  commitStatusReason?: string;
  commitStatusExplicit?: boolean;
  date: string;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  accountId?: string;
  accountName?: string;
  statementAccountName?: string;
  categoryName?: string;
  ownershipType: "direct" | "shared";
  ownerName?: string;
  splitBasisPoints: number;
  note?: string;
  rawRow: Record<string, string>;
  reconciliationMatches?: ReconciliationCandidateDto[];
  reconciliationMatch?: ReconciliationCandidateDto;
  reconciliationMatchCount?: number;
  reconciliationTargetTransactionId?: string;
  isStatementMatchResolved?: boolean;
  isCertifiedConflict?: boolean;
  // A mid-cycle row dated inside an already confirmed statement period for
  // its account: whether that statement covers it.
  certifiedStatement?: { checkpointMonth: string; covered: boolean };
}

export interface ImportPreviewDto {
  sourceLabel: string;
  parserKey: string;
  importedRows: number;
  previewRows: ImportPreviewRowDto[];
  unknownAccounts: string[];
  unknownCategories: string[];
  reconciliationCandidateCount: number;
  overlappingImportCount: number;
  overlapImports: ImportOverlapDto[];
  startDate?: string;
  endDate?: string;
  accountNames: string[];
  reconciliationCandidates: ReconciliationCandidateDto[];
  statementReconciliations: ImportPreviewStatementReconciliationDto[];
  exceptionSummary: ImportPreviewExceptionDto[];
  // Deterministic explanation of each statement card's difference, with the
  // fixes the user can approve. Present only for statement imports.
  statementDiagnosis?: StatementDiagnosisDto;
  // Statement sections matched to an account by the card's last four digits
  // because their printed name matches no account.
  statementAccountMatches?: {
    detectedAccountName: string;
    accountId: string;
    accountName: string;
    matchedBy: "card_last4";
  }[];
}

// A statement fix is a correction the statement check proposes and the user
// approves. It is applied to the preview at once and written with the import
// commit, in the same batch; rolling the import back undoes it.
// - move_to_statement_account: a provisional entry on another account is the
//   same purchase as a row in this statement's section for `toAccountId`; the
//   commit moves it there and the statement row certifies it.
// - defer_to_next_statement: a provisional entry inside the period is not on
//   the statement and posts after it; the commit sets its posted date to the
//   day after the statement closes.
export type StatementFixDto =
  | {
    kind: "move_to_statement_account";
    entryId: string;
    fromAccountId: string;
    toAccountId: string;
    statementRowIndex: number;
  }
  | {
    kind: "defer_to_next_statement";
    entryId: string;
    accountId: string;
    postDate: string;
  }
  // After a statement is committed: a provisional second copy of a purchase
  // the statement already matched to another entry (on this card or another
  // card of the statement) is removed. Applied by the statement correction
  // command, never by an import commit.
  | {
    kind: "remove_duplicate_entry";
    entryId: string;
    accountId: string;
    coveredByEntryId: string;
  };

export type StatementFindingKind =
  | "wrong_account"
  | "next_statement"
  | "excluded_statement_row"
  | "duplicate_entry"
  | "amount_differs"
  | "not_on_statement"
  | "opening_balance_gap";

// Facts a finding rests on, for the explanation the user reads.
export type StatementFindingFact =
  | { code: "same_amount" }
  | { code: "same_merchant" }
  | { code: "similar_merchant" }
  | { code: "same_transaction_date" }
  | { code: "posted_date_offset"; days: number }
  | { code: "date_offset"; days: number }
  | { code: "same_owner" }
  | { code: "different_owner" }
  | { code: "only_candidate" }
  | { code: "several_candidates"; count: number }
  | { code: "closes_statement" }
  | { code: "improves_statement" }
  | { code: "worsens_statement" }
  | { code: "closed_statement_protects_entry" }
  | { code: "transfer_link_protects_entry" }
  | { code: "no_posted_date" }
  | { code: "near_statement_end"; days: number }
  | { code: "excluded_by_you" }
  // After commit: the correction would unbalance a saved statement that
  // matches now, so it is not offered.
  | { code: "unbalances_saved_statement"; accountName: string; month: string };

export interface StatementFindingEntryDto {
  id: string;
  accountId: string;
  accountName: string;
  description: string;
  transactionDate: string;
  postedDate?: string;
  signedAmountMinor: number;
  bankCertificationStatus: "provisional" | "statement_certified";
}

export interface StatementFindingStatementRowDto {
  rowIndex: number;
  accountId?: string;
  description: string;
  transactionDate?: string;
  postedDate: string;
  signedAmountMinor: number;
}

export interface StatementFindingDto {
  id: string;
  kind: StatementFindingKind;
  // high: one clear candidate on strong evidence, and the fixes together
  // close every card they touch. medium: worth applying after a closer look
  // (similar text, a date offset, several candidates, or a partial close).
  // low: amount-only or weak evidence; never offered as a fix.
  confidence: "high" | "medium" | "low";
  // The card whose difference this finding explains.
  accountId: string;
  // The other card a wrong-account entry belongs to.
  relatedAccountId?: string;
  // Signed change to `accountId`'s difference once the finding is resolved.
  effectMinor: number;
  // Signed change to `relatedAccountId`'s difference: a move after commit
  // also adds the entry to the card that was missing it.
  relatedEffectMinor?: number;
  entry?: StatementFindingEntryDto;
  statementRow?: StatementFindingStatementRowDto;
  facts: StatementFindingFact[];
  fix?: StatementFixDto;
  // The fix is already applied to this preview (the user approved it).
  applied: boolean;
}

export type StatementCardOutcome = "resolved" | "partially_resolved" | "still_mismatched" | "needs_manual_review";

export interface StatementCardDiagnosisDto {
  accountId: string;
  accountName: string;
  checkpointMonth: string;
  deltaMinor: number;
  // The difference once every suggested (high or medium) fix is applied.
  projectedDeltaMinor: number;
  // The difference left after every finding, fixable or not, is accounted for.
  unexplainedMinor: number;
  outcome: StatementCardOutcome;
  // Provisional entries on this card dated after the statement closes. They
  // stay provisional for a later statement and are not part of the difference.
  laterStatementEntries: StatementFindingEntryDto[];
  laterStatementEntryCount: number;
}

export interface StatementDiagnosisDto {
  cards: StatementCardDiagnosisDto[];
  findings: StatementFindingDto[];
  appliedFixes: StatementFixDto[];
  rejectedFixes: { fix: StatementFixDto; reason: string }[];
}

export interface ImportPreviewExceptionDto {
  kind: "unknown_account" | "unknown_category" | "review_rows" | "statement_mismatch" | "account_identity" | "entry_reconciliation" | "prior_import_context" | "statement_chain_gap";
  count: number;
  tone: "blocking" | "review" | "context";
}

export interface StatementCheckpointDraftDto {
  accountId?: string;
  accountName: string;
  detectedAccountName?: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  previousBalanceMinor?: number;
  accountLast4?: string;
  note?: string;
}

export interface ImportPreviewStatementReconciliationDto {
  accountName: string;
  accountKind?: string;
  accountId?: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  projectedLedgerBalanceMinor?: number;
  deltaMinor?: number;
  status: "matched" | "mismatch" | "unknown_account" | "identity_unconfirmed" | "missing_prior_statement";
  supersededLedgerRows?: ImportPreviewSupersededLedgerRowDto[];
  reconciliationBreakdown?: ImportPreviewStatementReconciliationBreakdownDto;
}

export interface ImportPreviewSupersededLedgerRowDto {
  transactionId: string;
  importId: string;
  date: string;
  postedDate?: string;
  description: string;
  amountMinor: number;
  signedAmountMinor: number;
  accountName: string;
}

export interface ImportPreviewStatementReconciliationBreakdownDto {
  openingBalanceMinor: number;
  priorLedgerBalanceMinor: number;
  statementPeriodExistingRowsMinor: number;
  includedStatementRowsMinor: number;
  matchedStatementRowsMinor: number;
  skippedStatementRowsMinor: number;
  supersededLedgerRowsMinor: number;
  projectedLedgerBalanceMinor: number;
  statementBalanceMinor: number;
  deltaMinor: number;
  periodExistingLedgerRowCount: number;
  skippedStatementRowCount: number;
  matchedStatementRowCount: number;
  periodExistingLedgerRows: ImportPreviewReconciliationDiagnosticRowDto[];
  skippedStatementRows: ImportPreviewReconciliationDiagnosticRowDto[];
  matchedStatementRows: ImportPreviewReconciliationDiagnosticRowDto[];
  suspectedCauses: string[];
}

export interface ImportPreviewReconciliationDiagnosticRowDto {
  id: string;
  accountId?: string;
  date: string;
  eventDate?: string;
  postedDate?: string;
  dateRole?: "transaction" | "posted";
  description: string;
  signedAmountMinor: number;
  accountName: string;
  source: "ledger" | "statement";
  status?: string;
}

export interface StatementCompareRowDto {
  id: string;
  // The posted day for a statement row; the cleared day for a ledger row.
  date: string;
  // The purchase day, when the ledger entry has a different posted day.
  transactionDate?: string;
  description: string;
  amountMinor: number;
  signedAmountMinor: number;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  categoryName?: string;
  note?: string;
}

export interface StatementCompareCandidateDto {
  statementRow: StatementCompareRowDto;
  ledgerRow: StatementCompareRowDto;
  dateDeltaDays: number;
  descriptionScore: number;
  amountDirectionMismatch?: boolean;
}

export interface StatementCompareDuplicateGroupDto {
  rows: StatementCompareRowDto[];
}

export interface StatementCompareDto {
  accountName: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate: string;
  uploadedStatementStartDate?: string;
  uploadedStatementEndDate?: string;
  statementRowCount: number;
  ledgerRowCount: number;
  matchedRowCount: number;
  unmatchedStatementRows: StatementCompareRowDto[];
  unmatchedLedgerRows: StatementCompareRowDto[];
  possibleMatches: StatementCompareCandidateDto[];
  duplicateStatementGroups: StatementCompareDuplicateGroupDto[];
  duplicateLedgerGroups: StatementCompareDuplicateGroupDto[];
  // The same deterministic diagnosis as the import preview, after commit:
  // entries on the wrong card and second copies, with corrections to apply.
  statementDiagnosis?: StatementDiagnosisDto;
}

export interface ReconciliationCandidateDto {
  existingImportId?: string;
  existingTransactionId?: string;
  existingAccountId?: string;
  existingSourceType?: "csv" | "pdf" | "manual";
  existingBankCertificationStatus?: "provisional" | "statement_certified";
  date: string;
  postedDate?: string;
  description: string;
  amountMinor: number;
  accountName?: string;
  matchKind: "exact" | "probable" | "near";
}

export interface TransferIssueDto {
  entryId: string;
  date: string;
  description: string;
  accountName: string;
  amountMinor: number;
  transferDirection?: TransferDirection;
  descriptionTruncated?: boolean;
}

export interface AuditEventDto {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  entityType?: string;
  entityId?: string;
}

export interface AppErrorDiagnosticDto {
  id: string;
  source: string;
  action: string;
  previousAction?: string;
  method?: string;
  route?: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  errorMessage: string;
  possibleReason?: string;
  requestContextJson?: string;
  responseExcerpt?: string;
  responseBody?: string;
  createdAt: string;
}

export interface ReconciliationExceptionDto {
  id: string;
  accountId?: string;
  accountName?: string;
  transactionId?: string;
  transactionDate?: string;
  transactionDescription?: string;
  checkpointMonth?: string;
  kind: "missing_bank_row" | "extra_ledger_row" | "duplicate" | "direction_mismatch" | "wrong_account" | "timing_difference" | "manual_review" | "adjustment_needed";
  severity: "info" | "review" | "blocking";
  status: "open" | "resolved";
  title: string;
  note?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface SummaryPageDto {
  metricCards: MetricCardDto[];
  availableMonths: string[];
  rangeStartMonth: string;
  rangeEndMonth: string;
  rangeMonths: string[];
  months: SummaryMonthDto[];
  categoryShareChart: DonutChartDatumDto[];
  categoryShareByMonth: SummaryDonutMonthDto[];
  notes: string[];
}

export interface MonthPageDto {
  month: string;
  selectedPersonId: string;
  selectedScope: PersonScope;
  scopes: { key: PersonScope; label: string }[];
  metricCards: MetricCardDto[];
  monthNote: string;
  incomeRows: MonthIncomeRowDto[];
  planSections: MonthPlanSectionDto[];
  categoryShareChart: DonutChartDatumDto[];
  entries: EntryDto[];
}

export interface ImportsPageDto {
  recentImports: ImportBatchDto[];
  importInbox?: ImportInboxDto;
  rollbackPolicy: string;
  pendingSplitMatchCount?: number;
}

export interface ImportInboxDto {
  generatedAt: string;
  currentMonth: string;
  summary: {
    activeAccountCount: number;
    currentAccountCount: number;
    staleAccountCount: number;
    requiredFileCount: number;
    optionalFileCount: number;
    institutionCount: number;
    pendingSplitMatchCount: number;
  };
  sessions: ImportInboxSessionDto[];
  reviewQueue: ImportInboxExpectedFileDto[];
  cleanup: ImportInboxCleanupDto;
}

export interface ImportInboxSessionDto {
  institution: string;
  status: "current" | "needs_files" | "optional";
  requiredFileCount: number;
  optionalFileCount: number;
  portalUrl?: string;
  downloadInstructions: string[];
  accounts: ImportInboxAccountDto[];
  expectedFiles: ImportInboxExpectedFileDto[];
}

export interface ImportInboxAccountDto {
  accountId: string;
  accountName: string;
  institution: string;
  ownerLabel: string;
  kind: string;
  status: "current" | "statement_due" | "activity_optional" | "needs_setup";
  latestCertifiedMonth?: string;
  latestActivityImportAt?: string;
  nextExpectedStatementMonth?: string;
}

export interface ImportInboxExpectedFileDto {
  id: string;
  institution: string;
  accountId: string;
  accountName: string;
  ownerLabel: string;
  sourceType: "pdf_statement" | "activity_export";
  priority: "required" | "optional";
  periodMonth: string;
  label: string;
  detail: string;
  supportedFileTypes: string[];
  reviewOrder: number;
  // A statement that covers several accounts (a bank's combined card
  // statement) is one expected file; `accountName` then names them all.
  coveredAccounts?: { accountId: string; accountName: string }[];
}

export interface ImportInboxCleanupDto {
  pendingSplitMatchCount: number;
  status: "clear" | "needs_review";
  detail: string;
}

export interface ContextViewDto {
  id: string;
  label: string;
  summaryPage: SummaryPageDto;
  monthPage: MonthPageDto;
  splitsPage: SplitsPageDto;
}

export interface SettingsPageDto {
  accounts: AccountDto[];
  shortcutSettings: ShortcutSettingsDto;
  demo: DemoSettingsDto;
  categoryMatchRules: CategoryMatchRuleDto[];
  categoryMatchRuleSuggestions: CategoryMatchRuleSuggestionDto[];
  ignoredCategoryMatchRuleIssueIds: string[];
  unresolvedTransfers: TransferIssueDto[];
  reconciliationExceptions: ReconciliationExceptionDto[];
  recentAuditEvents: AuditEventDto[];
  errorDiagnostics: AppErrorDiagnosticDto[];
}

export interface AppShellDto {
  appEnvironment?: "demo" | "local" | "production" | "test";
  household: HouseholdDto;
  availableViewIds: string[];
  selectedViewId: string;
  trackedMonths: string[];
  viewerPersonId?: string;
  viewerIdentity?: {
    email: string;
    personId?: string;
  };
  viewerRegistration?: {
    email: string;
    suggestedPersonId: string;
  };
}

export interface ReferenceDataDto {
  accounts: AccountDto[];
  categories: CategoryDto[];
}

export interface EntriesShellDto {
  appEnvironment?: "demo" | "local" | "production" | "test";
  household: HouseholdDto;
  accounts: AccountDto[];
  categories: CategoryDto[];
  views: ContextViewDto[];
  selectedViewId: string;
  viewerPersonId?: string;
  viewerIdentity?: {
    email: string;
    personId?: string;
  };
  viewerRegistration?: {
    email: string;
    suggestedPersonId: string;
  };
  importsPage: ImportsPageDto;
  settingsPage: SettingsPageDto;
}
