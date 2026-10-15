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
  // "" when purchases in another currency follow the priority list.
  foreignCurrencyAccountId: string;
  // Settings only (DOMAIN.md "Shortcut connection"): one per person, the
  // first person's first. The fields above are that first connection's, so
  // its entry here names the person only.
  connections?: Array<ShortcutConnectionDto | Pick<ShortcutConnectionDto, "personId" | "personName">>;
}

// One person's Apple Pay Shortcut connection: its own key, Default account
// order and card for other currencies. Entries saved through it belong to
// that person.
export interface ShortcutConnectionDto {
  personId: string;
  personName: string;
  apiKey: string;
  apiKeySource: "app" | "environment" | "none";
  defaultAccountPriorityIds: string[];
  defaultParams: string;
  foreignCurrencyAccountId: string;
}

// Settings -> Payment ways (DOMAIN.md "Payment Way"): for one person, the
// account their PayNow and bank transfers (and NETS, GIRO) come from and
// their cash wallet. "" means none: the entry draft then keeps Default
// account priority.
export interface PaymentWayDto {
  personId: string;
  bankTransferAccountId: string;
  cashAccountId: string;
}

export interface AccountCheckpointDto {
  month: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  // What the statement asked for (card statements that print it).
  paymentDueDate?: string;
  minimumPaymentMinor?: number;
  notices?: StatementNoticeDto[];
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
  // Card accounts only: the latest statement's bill, and bank charges no
  // reversal cancelled (card-bill-projection.ts).
  cardBill?: CardBillDto;
  unreversedCharges?: UnreversedChargeDto[];
  // The bank's notices on the card's latest statement, while it is recent.
  cardNotices?: CardNoticesDto;
  // Bank accounts only: what changed in the account's monthly routine
  // (account-routines.ts).
  incomeMoved?: IncomeMovedDto;
  missedPayments?: MissedPaymentDto[];
  accountCharges?: AccountChargeDto[];
  ownTransfersAsIncome?: OwnTransferIncomeDto[];
  upcomingShortfall?: UpcomingShortfallDto;
  // Investment accounts only: what the latest statement says the account was
  // worth on its date (a statement figure, not a ledger balance).
  investmentValue?: { valueMinor: number; asOfDate: string };
}

export interface CardNoticesDto {
  statementMonth: string;
  // What that statement says the card owes (positive), 0 when nothing.
  owedMinor: number;
  notices: StatementNoticeDto[];
}

// What a card's latest statement asks for, and what has been paid to the
// card since it closed. Amounts are positive.
export interface CardBillDto {
  statementMonth: string;
  statementEndDate: string;
  paymentDueDate: string;
  owedMinor: number;
  minimumMinor?: number;
  paidSinceMinor: number;
}

// A late charge, interest, annual fee or other bank fee with no reversal.
export interface UnreversedChargeDto {
  date: string;
  kind: "late_fee" | "interest" | "annual_fee" | "other_fee";
  amountMinor: number;
}

// A bank account's own charges (account-routines.ts): a charge for a
// payment the bank could not make, or the account's monthly fee.
export interface AccountChargeDto {
  date: string;
  kind: "failed_payment" | "account_fee";
  amountMinor: number;
  payee?: string;
}

// A payment that came every month and did not come, with the bank's charge
// for trying.
export interface MissedPaymentDto {
  payee: string;
  amountMinor: number;
  dueDate: string;
  chargeMinor: number;
}

// Regular income that now arrives in another of the owner's accounts while
// payments are still scheduled on this one.
export interface IncomeMovedDto {
  payer: string;
  isSalary: boolean;
  toAccountId: string;
  toAccountName: string;
  movedSince: string;
  payments: Array<{ payee: string; amountMinor: number }>;
  statementEndDate?: string;
  statementBalanceMinor?: number;
}

// Income into this account that left another of the owner's accounts as a
// transfer: money moving between their own accounts.
export interface OwnTransferIncomeDto {
  entryId: string;
  fromEntryId: string;
  date: string;
  fromDate: string;
  amountMinor: number;
  categoryName: string;
  fromAccountName: string;
}

// The scheduled check: the latest statement balance (plus what is recorded
// since) cannot cover the payments still scheduled on the account within
// the next month.
export interface UpcomingShortfallDto {
  statementEndDate: string;
  statementBalanceMinor: number;
  balanceMinor: number;
  payments: Array<{ payee: string; amountMinor: number; dueDate: string }>;
  shortMinor: number;
  firstShortDate: string;
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

// A rule's past entries still in Other or Other - Income that it now matches
// (app-repository-category-rule-backfill.ts).
export interface CategoryMatchRuleBackfillDto {
  ruleId: string;
  pattern: string;
  categoryName: string;
  entryCount: number;
  sampleDescriptions: string[];
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

// Which in-app tool created an entry (DOMAIN.md "Added by"), derived from
// its external reference on the server; absent when not known.
export type EntryAddedBy = "apple_pay_shortcut" | "ask";

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
  addedBy?: EntryAddedBy;
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
    // The first month of a period of months (the request's `from`), when
    // the page lists more than `month`.
    rangeStartMonth?: string;
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
  // An open settlement's likely bank payment: the same amount between the
  // two people within two weeks, not yet matched.
  paymentCandidate?: SplitSettlementPaymentCandidateDto;
}

export interface SplitSettlementPaymentCandidateDto {
  date: string;
  amountMinor: number;
  // The payer's entry first, then the receiver's, when each is recorded.
  entryIds: string[];
  // True while either side still counts as spending or income.
  countedAsSpending: boolean;
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
  // Investment statements: how many statement values this import saved. Such
  // an import may have no transactions at all; its account and its dates
  // then come from the saved value.
  investmentValueCount?: number;
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
  // An investment statement's contribution or withdrawal: the bank entry it
  // is the other side of. The commit links the two as one transfer.
  transferMatch?: ImportTransferMatchDto;
}

// An entry an earlier activity export created that this one, covering its
// date, no longer lists: a pending hold the bank released, or a charge it
// posted again at another amount. The commit removes it unless kept.
export interface ImportNoLongerListedEntryDto {
  transactionId: string;
  importId: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  amountMinor: number;
  entryType: EntryType;
}

// An Apple Pay entry this file's card should list and does not, whose
// purchase is a bank row on another card: it was paid with the other card
// and is counted twice. HIGH is offered for removal (the user confirms, the
// commit checks every fact again); MEDIUM is only a note. The twin is the
// other card's bank row, from the ledger or from this same file.
export interface ImportWrongCardDuplicateDto {
  transactionId: string;
  confidence: "high" | "medium";
  // The entry is linked to a split or a plan, so it cannot be removed here.
  isLinked?: boolean;
  // Which file did not list the entry: this one, or an earlier import of
  // the same card (and when that was imported).
  coverage: { kind: "this_file" | "earlier_import"; importedAt?: string };
  entry: { accountId: string; accountName: string; date: string; description: string; amountMinor: number };
  twin: {
    kind: "ledger" | "this_file";
    id: string;
    accountId: string;
    accountName: string;
    date: string;
    description: string;
    importedAt?: string;
  };
}

// A foreign currency estimate an earlier activity export updated from a row
// this one, covering its date, no longer lists (usually a hold the bank
// released). Its final charge may be a row of this file at another foreign
// amount, which never pairs by itself: the user links it, or the commit puts
// the estimate back to its own saved amount.
export interface ImportUnlistedEstimateDto {
  transactionId: string;
  importId: string;
  accountId: string;
  accountName: string;
  date: string;
  walletDescription: string;
  originalAmount: string;
  currency: string;
  amountMinor: number;
  restoredAmountMinor: number;
  candidates: { rowId: string; date: string; description: string; amountMinor: number }[];
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
  // Investment statements only: the value each one saves for its account.
  investmentValues?: ImportPreviewInvestmentValueDto[];
  exceptionSummary: ImportPreviewExceptionDto[];
  // Deterministic explanation of each statement card's difference, with the
  // fixes the user can approve. Present only for statement imports.
  statementDiagnosis?: StatementDiagnosisDto;
  // Statement sections matched to an account by the card's last four digits
  // because their printed name matches no account.
  // Activity exports only: entries the bank no longer lists.
  noLongerListedEntries?: ImportNoLongerListedEntryDto[];
  unlistedEstimates?: ImportUnlistedEstimateDto[];
  // Activity exports only, and only when there is one to mention.
  wrongCardDuplicates?: ImportWrongCardDuplicateDto[];
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
  // The balance before this statement is off and no statement is saved for
  // the months between the account's last saved statement and this one.
  // Balances use the internal sign (owed card balances are negative).
  | {
    code: "missing_statements";
    months: string[];
    lastStatementMonth: string;
    lastStatementEndDate: string;
    lastStatementBalanceMinor?: number;
    previousStatementBalanceMinor: number;
  }
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
  paymentDueDate?: string;
  minimumPaymentMinor?: number;
  notices?: StatementNoticeDto[];
  // An investment statement: what the account was worth at period end. Such a
  // checkpoint is saved as an investment statement value, never as a bank
  // balance, and is not reconciled (DOMAIN.md, "Investment Statement Value").
  investmentValue?: StatementInvestmentValueDto;
  note?: string;
}

export interface StatementInvestmentValueDto {
  // The account number printed on the statement, which the bank rows paying
  // it carry in their text.
  accountReference: string;
  currency: string;
  totalAssetsMinor: number;
  marketValueMinor: number;
  cashMinor: number;
  incomeMinor: number;
  // A StashAway summary row, used by the preview and never saved.
  openingMinor?: number;
  cashflowMinor?: number;
  returnsMinor?: number;
  feesMinor?: number;
}

// The bank entry a statement movement pairs with as one transfer.
export interface ImportTransferMatchDto {
  transactionId: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  amountMinor: number;
  // "reference": the bank row names the statement's account number.
  basis: "reference" | "amount_and_date";
}

// What an investment statement import will save for one account and month.
export interface ImportPreviewInvestmentValueDto {
  accountId?: string;
  accountName: string;
  detectedAccountName: string;
  accountKind?: string;
  checkpointMonth: string;
  asOfDate: string;
  totalAssetsMinor: number;
  cashMinor: number;
  currency: string;
  // A value already saved for the month, which this statement replaces.
  replaces?: { asOfDate: string; totalAssetsMinor: number };
  // The statement opens somewhere other than where the saved statement of the
  // month before it ended (more than a cent apart): said, never blocking.
  startsAfter?: { openingMinor: number; earlierValueMinor: number; earlierAsOfDate: string };
}

// The bank's own notice about a card, printed on its statement.
export type StatementNoticeDto =
  | { code: "past_due" }
  | { code: "penalty_interest"; annualRatePercent: number };

export interface ImportPreviewStatementReconciliationDto {
  accountName: string;
  accountKind?: string;
  accountId?: string;
  // The card or account number's last four digits printed on the statement.
  accountLast4?: string;
  // What the statement asks for, and the bank's notices about the card.
  paymentDueDate?: string;
  minimumPaymentMinor?: number;
  notices?: StatementNoticeDto[];
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  projectedLedgerBalanceMinor?: number;
  deltaMinor?: number;
  status: "matched" | "mismatch" | "unknown_account" | "identity_unconfirmed" | "missing_prior_statement";
  // The latest completed import that already saved this account's statement
  // for the same month (the statement is being uploaded again).
  previousStatementImport?: {
    importId: string;
    sourceLabel: string;
    importedAt: string;
  };
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
  // The entry is a foreign currency estimate: what was paid ("IDR 159,000")
  // and the currency of its estimated amountMinor.
  originalAmount?: string;
  currency?: string;
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

// Money moved into and out of investment accounts in a period (DOMAIN.md
// "Money job", investment-moves.ts): transfers into an account of kind
// `investment`, and transfers out of one back to a cash account. Left out
// of a page when both are zero.
export interface InvestmentMovesDto {
  intoMinor: number;
  outOfMinor: number;
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
  investmentMoves?: InvestmentMovesDto;
  // The same moves month by month, only for the months where something
  // moved (left out when nothing did): "Earned vs spent by month" counts a
  // month's invested and kept as the Month lead does.
  investmentMovesByMonth?: Array<InvestmentMovesDto & { month: string }>;
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
  investmentMoves?: InvestmentMovesDto;
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
  // One row per household person, in household order.
  paymentWays: PaymentWayDto[];
  demo: DemoSettingsDto;
  categoryMatchRules: CategoryMatchRuleDto[];
  categoryMatchRuleSuggestions: CategoryMatchRuleSuggestionDto[];
  categoryRuleBackfills: CategoryMatchRuleBackfillDto[];
  ignoredCategoryMatchRuleIssueIds: string[];
  unresolvedTransfers: TransferIssueDto[];
  reconciliationExceptions: ReconciliationExceptionDto[];
  recentAuditEvents: AuditEventDto[];
  errorDiagnostics: AppErrorDiagnosticDto[];
}

export interface AppShellDto {
  // The signed-in login's Plan | Simple choice (DOMAIN.md "Lead View"); absent
  // without a login or a choice.
  leadView?: "plan" | "simple";
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

// Entry draft (DOMAIN.md "Entry Draft"): a typed sentence read into the
// fields /api/entries/create takes, for the user to confirm. Never a ledger
// entry until the user saves it through the normal create route.
export type EntryDraftFieldSource = "sentence" | "rule" | "default" | "ai";

export interface EntryDraftFieldDto<T> {
  value: T;
  source: EntryDraftFieldSource;
}

// The create fields a draft can lack. Each one blocks createBody.
export type EntryDraftField = "date" | "description" | "accountId" | "amountMinor" | "ownerName" | "splitBasisPoints";

export type EntryDraftQuestionReason =
  | "missing"
  | "ambiguous"
  | "transfer_from"
  | "conflicting"
  | "invalid"
  | "future"
  | "unknown_currency"
  | "foreign_currency"
  | "unclear_payer"
  | "uneven_split";

export type EntryDraftFlag =
  | "empty_text"
  | "truncated"
  | "conflicting_amounts"
  | "unknown_currency"
  | "foreign_currency"
  | "future_date"
  | "invalid_date"
  | "ambiguous_account";

// One choice for a follow-up question. Only the keys the question needs are
// set: a date, an account, an amount (with its currency when one was named),
// a person, or a person with the splitBasisPoints that choice would post.
export interface EntryDraftQuestionOptionDto {
  date?: string;
  accountId?: string;
  accountName?: string;
  amountMinor?: number;
  currency?: string;
  personName?: string;
  splitBasisPoints?: number;
}

// Structured, not prose: the client words the question.
export interface EntryDraftQuestionDto {
  field: EntryDraftField;
  reason: EntryDraftQuestionReason;
  options: EntryDraftQuestionOptionDto[];
}

// Exactly the /api/entries/create body, set only when nothing is missing.
export interface EntryDraftCreateBodyDto {
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  categoryName: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  ownershipType: "direct" | "shared";
  ownerName?: string;
  splitBasisPoints?: number;
}

export interface EntryDraftDto {
  fields: {
    date?: EntryDraftFieldDto<string>;
    description?: EntryDraftFieldDto<string>;
    accountId?: EntryDraftFieldDto<string>;
    accountName?: EntryDraftFieldDto<string>;
    categoryName: EntryDraftFieldDto<string>;
    amountMinor?: EntryDraftFieldDto<number>;
    entryType: EntryDraftFieldDto<EntryType>;
    transferDirection?: EntryDraftFieldDto<TransferDirection>;
    ownershipType: EntryDraftFieldDto<"direct" | "shared">;
    ownerName?: EntryDraftFieldDto<string>;
    splitBasisPoints?: EntryDraftFieldDto<number>;
  };
  // An amount in another currency than the account's (IDR 159,000 on an SGD
  // card): kept as typed; amountMinor stays missing until the user confirms
  // the account-currency amount.
  foreignAmount?: { amountMinor: number; currency: string; source: EntryDraftFieldSource };
  // The other side of a transfer, for the later transfer match. Not posted.
  transferAccount?: EntryDraftFieldDto<{ accountId: string; accountName: string }>;
  missing: EntryDraftField[];
  questions: EntryDraftQuestionDto[];
  flags: EntryDraftFlag[];
  createBody?: EntryDraftCreateBodyDto;
}

export interface EntryDraftResponseDto {
  ok: true;
  draft: EntryDraftDto;
  // requested: the sentence left the amount or description missing, so the
  // optional AI gap-filler was asked. available: it answered with something
  // that passed validation and was merged (fields marked "ai").
  ai: { requested: boolean; available: boolean; reason?: string; remaining?: number };
}

// AI provider status (DOMAIN.md "AI Provider Status"): served only by
// GET /api/ai-assist/provider-status and POST .../topped-up, and only to a
// viewer listed in AI_ALERT_EMAILS (everyone when it is "*"); anyone else
// gets { visible: false }.
export type ClaudeFailureCategory = "credit_exhausted" | "spend_capped" | "auth" | "other";
export type ClaudeCreditState = "ok" | "low" | "exhausted" | "capped" | "unknown";

// Auto-balance (src/domain/ai-provider-status.ts): who is asked first.
export type ClaudeSpendMode = "claude_all" | "ask_only" | "basic_first";

export type AiProviderStatusResponseDto =
  | { ok: true; visible: false }
  | {
    ok: true;
    visible: true;
    claudeConfigured: boolean;
    state: ClaudeCreditState;
    // An estimate from response token counts and configured prices since
    // the last top-up mark; the Claude Console balance is authoritative.
    estimatedSpendUsd: number;
    creditUsd: number;
    warnAtUsd: number;
    // Estimated Claude spend this calendar month (Asia/Singapore), the
    // monthly target, and the resulting auto-balance mode.
    monthSpendUsd: number;
    monthTargetUsd: number;
    mode: ClaudeSpendMode;
    lastFailureAt?: string;
    lastFailureReason?: ClaudeFailureCategory;
    lastSuccessAt?: string;
    consoleBillingUrl: string;
  };

// Skew candidates (DOMAIN.md "Skew Candidate"): read-only flags for ledger
// entries that are most likely a split settlement between household members
// or a move between one person's own accounts, yet still counted as spending
// or income. Served only by GET /api/skew-candidates, never in a page DTO.
export type SkewCandidateKind = "settlement" | "own_transfer";

export interface SkewCandidateEntryDto {
  id: string;
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  // The account owner (a joint account never takes part).
  ownerPersonId: string;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  categoryName: string;
  amountMinor: number;
  // Dated in the requested month; only such entries count towards `skew`.
  inMonth: boolean;
}

export type SkewCandidateReasonDto =
  | { code: "same_amount"; amountMinor: number }
  | { code: "days_from_settlement"; entryId: string; days: number }
  | { code: "days_apart"; days: number }
  | { code: "payer_account" | "payee_account"; entryId: string; personId: string; personName: string; accountName: string }
  | { code: "same_owner"; personId: string; personName: string; fromAccountName: string; toAccountName: string }
  | { code: "counterparty_named"; entryId: string; personName: string }
  | { code: "counted_as_spending" | "counted_as_income" | "counted_as_payback"; entryId: string; categoryName: string };

// An existing write route that resolves the candidate, in order. The finder
// never calls them; a person (or a reviewed chat proposal) does.
export type SkewCandidateActionDto =
  | { action: "link_transfer"; method: "POST"; path: "/api/transfers/link"; body: { fromEntryId: string; toEntryId: string } }
  | {
    action: "reclassify_as_transfer";
    method: "POST";
    path: "/api/entries/update-classification";
    body: { entryId: string; entryType: "transfer"; transferDirection: TransferDirection; categoryName: "Transfer" };
  }
  | { action: "match_settlement_checkpoint"; method: "POST"; path: "/api/splits/checkpoints/match"; body: { checkpointId: string; transactionId: string } }
  | {
    action: "record_group_settle_up";
    method: "POST";
    path: "/api/splits/settlements/create";
    body: {
      groupId: string | null;
      date: string;
      fromPersonName: string;
      toPersonName: string;
      amountMinor: number;
      currency: string;
      paymentMethod: "bank";
      paymentStatus: "recorded";
    };
    // Link the new settle-up to this (transfer) entry afterwards with
    // /api/splits/matches/link-settlement and the returned settlementId.
    linkTransactionId: string;
  };

export interface SkewCandidateDto {
  id: string;
  kind: SkewCandidateKind;
  // high: both sides found, or the one side names the other person.
  // A medium settlement (one side, no name) is served only with
  // `?include=medium`; a medium own transfer (two equally close receiving
  // entries) is always served.
  confidence: "high" | "medium";
  amountMinor: number;
  currency: string;
  // Payer and payee; the same person for an own transfer.
  fromPerson: PersonDto;
  toPerson: PersonDto;
  settlement?:
    | { source: "settlement_checkpoint"; checkpointId: string; anchorDate: string }
    | { source: "group_balance"; groupId: string; groupName: string; anchorDate: string };
  bothSidesFound: boolean;
  entryIds: string[];
  outflowEntry?: SkewCandidateEntryDto;
  inflowEntry?: SkewCandidateEntryDto;
  reasons: SkewCandidateReasonDto[];
  // What the candidate's in-month entries add to the view's spending and
  // income now; linking them as a transfer would remove exactly this.
  skew: { spendingMinor: number; incomeMinor: number };
  suggestedActions: SkewCandidateActionDto[];
}

export interface SkewCandidatesDto {
  viewId: string;
  label: string;
  month: string;
  scope: PersonScope;
  candidates: SkewCandidateDto[];
  // Totals and omittedCandidateCount cover the candidates served for this
  // request: hidden medium settlements count only with `?include=medium`.
  totals: { spendingMinor: number; incomeMinor: number };
  omittedCandidateCount: number;
}

// Ask's answer to a money question (DOMAIN.md "Money Question",
// POST /api/ai-assist/answer). Every figure comes from the same projections
// the screens show; only `wording.text` may be AI-phrased, and only after
// validation against the facts it was given.
export type AskAnswerIntentKind = "spending" | "plan" | "compare" | "biggest" | "owed" | "income" | "invested" | "saved" | "spentVsEarned";

export interface AskAnswerLeadDto {
  label: string;
  amountMinor: number;
  currency: string;
  tone: MoneyTone;
  // The plan the lead is measured against (the actual-vs-plan bar).
  planMinor?: number;
  // Income: more than the plan is fine.
  overIsShort?: boolean;
}

// A Support chip: a name, with an amount or a share when it has one.
export interface AskAnswerChipDto {
  label: string;
  amountMinor?: number;
  currency?: string;
  percent?: number;
}

// A Detail row: what it is, a short non-money detail, its amount and,
// optionally, the plan or the other month beside it.
export interface AskAnswerLineDto {
  label: string;
  detail?: string;
  amountMinor: number;
  currency: string;
  tone: MoneyTone;
  secondary?: { kind: "plan" | "compare"; label: string; amountMinor: number };
}

// The Entries filter an answer opens, read back by Entries' own reader
// (src/client/entry-filter-params.js); the client builds the URL.
export interface AskAnswerEntriesFilterDto {
  month: string;
  viewId: string;
  scope: PersonScope;
  search: string;
  categories: string[];
  wallets: string[];
  type: "" | "expense" | "income" | "transfer";
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  // With `categories` ["Investments"]: also list the transfers into
  // investment accounts (investment-moves.ts), so the invested answer's
  // Entries shows every entry its amount counts. Only when there were any.
  investmentMovesIn?: boolean;
}

export type AskAnswerLinkDto =
  | { kind: "entries"; label: string; filter: AskAnswerEntriesFilterDto }
  | { kind: "month"; label: string; month: string; viewId: string; scope: PersonScope }
  | { kind: "splits"; label: string; month: string; viewId: string; groupId: string | null };

export interface AskAnswerCardDto {
  title: string;
  lead: AskAnswerLeadDto;
  support: AskAnswerChipDto[];
  lines: AskAnswerLineDto[];
  links: AskAnswerLinkDto[];
  // Intent against outcome (the plan answer): the figures the Month and
  // Summary savings bar draws, the Month cards' own (income received,
  // Actual spend, Planned spend, Savings target) and the money jobs' (money
  // moved to Investments and Savings, the plan's Investments rows), split by
  // the shared splitMoneyUse as the Month lead splits them.
  outcome?: {
    incomeMinor: number;
    spentMinor: number;
    plannedSpendMinor: number;
    savingsTargetMinor: number;
    investedMinor: number;
    savedMovedMinor: number;
    plannedInvestMinor: number;
    // Transfers into and out of investment accounts (InvestmentMovesDto),
    // left out when zero.
    movedIntoInvestmentsMinor?: number;
    takenFromInvestmentsMinor?: number;
  };
}

export interface AskAnswerResponseDto {
  ok: true;
  supported: boolean;
  intent?: AskAnswerIntentKind;
  viewId?: string;
  scope?: PersonScope;
  months?: string[];
  // A high-confidence skew candidate would change the facts: no answer
  // until the person resolves it or says it is real.
  needsConfirmation?: boolean;
  candidates?: SkewCandidateDto[];
  answer?: AskAnswerCardDto;
  wording?: { text: string; source: "template" | "ai" };
  ai?: { requested: boolean; available: boolean; reason?: string; remaining?: number };
}

// The optional AI explanation on an insight question (POST
// /api/ai-assist/insight-explain): null when AI is off, out of allowance or
// its phrasing failed the check. The insight card's facts never come from
// here.
export interface InsightExplainResponseDto {
  ok: true;
  explanation: { text: string; source: "ai" } | null;
  ai: { requested: boolean; available: boolean; reason?: string; remaining?: number };
}

// A plan draft (DOMAIN.md "Plan Draft", POST /api/ai-assist/plan-draft):
// a typed request to change a month's plan, read by rules (or, when the
// rules cannot, by the optional AI into the same structure) and resolved
// against that month's month plan rows. Nothing is written until the
// person taps Save, which posts `apply` to POST /api/month-plan/apply-changes.
export type PlanDraftKind = "set" | "change" | "move" | "add" | "copy";

export type PlanSectionWithIncome = "income" | "planned_items" | "budget_buckets";

export interface PlanDraftChangeDto {
  rowId: string;
  action: "update" | "create";
  section: PlanSectionWithIncome;
  label: string;
  categoryName: string;
  // The person the line belongs to, or "Shared".
  ownerLabel: string;
  beforeMinor: number;
  afterMinor: number;
}

// The view's plan totals, as the Month cards add them up.
export interface PlanTotalsDto {
  plannedIncomeMinor: number;
  plannedSpendMinor: number;
  // Planned income minus planned spend (the Month "Remaining budget" card).
  remainingMinor: number;
}

// One change to a month's plan, as POST /api/month-plan/apply-changes
// takes it. `expectedMinor` is what the line held when the draft was
// made: a line changed since then refuses the whole save.
export type MonthPlanChangeDto =
  | { action: "update"; rowId: string; expectedMinor: number; plannedMinor: number }
  | { action: "delete"; rowId: string; expectedMinor: number }
  | {
    action: "create";
    rowId: string;
    sectionKey: PlanSectionWithIncome;
    categoryName: string;
    label: string;
    plannedMinor: number;
    ownershipType: "direct" | "shared";
    ownerName?: string;
    splitBasisPoints?: number;
    planDate?: string | null;
    accountName?: string | null;
    note?: string | null;
  };

export interface PlanDraftDto {
  month: string;
  viewId: string;
  kind: PlanDraftKind;
  copyFrom: string | null;
  // The lead: the line the request named (set, change, add), the amount
  // moved and its two lines (move), or the month's planned spend (copy).
  lead: {
    label: string;
    categoryName: string | null;
    amountMinor: number;
    beforeMinor: number | null;
    fromLabel?: string;
    toLabel?: string;
  };
  changes: PlanDraftChangeDto[];
  totals: { before: PlanTotalsDto; after: PlanTotalsDto };
  // The plan after the change spends more than it expects to earn (the
  // Money insights plan-balance check, planShortfallSignal).
  warning: { text: string; shortMinor: number } | null;
  apply: MonthPlanChangeDto[];
}

export type PlanDraftQuestionDto =
  | { field: "month"; options: string[] }
  | { field: "line"; name: string; options: Array<{ rowId: string; label: string; ownerLabel: string; plannedMinor: number }> }
  | { field: "owner"; line: string; options: Array<{ key: string; label: string }> };

export type PlanDraftNoteDto =
  | { reason: "no_plan_to_copy"; month: string }
  | { reason: "same_month"; month: string }
  | { reason: "unknown_line"; name: string; month: string }
  | { reason: "nothing_changes"; month: string }
  | { reason: "not_enough"; label: string; plannedMinor: number }
  | { reason: "move_mixed" };

// Answers to the questions a draft asked, sent back with the same text.
export interface PlanDraftAnswersDto {
  month?: string;
  // Line name as said → the month plan row id chosen.
  lines?: Record<string, string>;
  // A person id, or "shared".
  owner?: string;
}

export interface PlanDraftResponseDto {
  ok: true;
  // false: not a plan request after all; the page reads it as before.
  supported: boolean;
  source?: "rules" | "ai";
  draft?: PlanDraftDto;
  question?: PlanDraftQuestionDto;
  note?: PlanDraftNoteDto;
  ai?: { requested: boolean; available: boolean; reason?: string; remaining?: number };
}

// What one receipt says, read either by the optional AI provider from an
// image the user explicitly supplied, or by in-browser OCR when AI is off.
// It is a draft only: nothing is saved until the user taps save in the
// normal entry editor. Every value is validated by the app
// (src/domain/receipt-read.ts); the model never supplies wording.
export type ReceiptFieldConfidence = "high" | "medium" | "low";

export type ReceiptQuestionField = "merchant" | "date" | "total" | "currency";

// Why the app wants the user to check a field. The client words the
// question; the reason and candidates come from validation, never from a
// model's prose.
export type ReceiptQuestionReason =
  | "missing"
  | "unclear"
  | "ambiguous"
  | "future_date"
  | "old_date"
  | "invalid_amount"
  | "unsupported_currency";

export interface ReceiptQuestionDto {
  field: ReceiptQuestionField;
  reason: ReceiptQuestionReason;
  // Validated alternatives the user can pick from (ISO dates for an
  // ambiguous date such as 03/04), at most three.
  candidates?: string[];
}

export interface ReceiptLineItemDto {
  description: string;
  // Signed: a discount line is negative.
  amountMinor: number | null;
  quantity: number | null;
}

export interface ReceiptReadDto {
  source: "ai" | "ocr";
  merchant: { value: string | null; confidence: ReceiptFieldConfidence };
  // ISO YYYY-MM-DD.
  date: { value: string | null; confidence: ReceiptFieldConfidence };
  total: {
    amountMinor: number | null;
    // ISO 4217 code from the app's allowlist.
    currency: string | null;
    confidence: ReceiptFieldConfidence;
  };
  // Only ever the last four digits of a printed card number.
  cardLast4: string | null;
  lineItems: ReceiptLineItemDto[];
  questions: ReceiptQuestionDto[];
}

// A split suggestion (DOMAIN.md "Split Suggestion",
// POST /api/splits/suggestion): the split group and share an expense's
// payer usually puts entries like it on, from the household's own last
// 12 months. Read-only and deterministic; nothing is written until the
// person saves with Splits on.
export interface SplitSuggestionDto {
  // "split-group-none" for Non-group expenses.
  groupId: string;
  groupName: string;
  // The payer's (the entry owner's) share; the other person has the rest.
  basisPoints: number;
  otherPersonId: string;
  otherPersonName: string;
  // How many matching entries went to this group with this share, out of
  // matchedCount matching entries in the window.
  evidenceCount: number;
  matchedCount: number;
  matchedBy: "description" | "category";
}

// An entry that may be the other side of a transfer (GET
// /api/transfers/draft-candidates): the same candidates the Entries transfer
// dialog offers (src/domain/transfer-candidates.ts), best first, without the
// ones already paired or on Splits.
export interface TransferOptionDto {
  entryId: string;
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  accountOwnerLabel?: string;
  amountMinor: number;
  categoryName: string;
}
