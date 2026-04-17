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
  reconciliationStatus?: "matched" | "mismatch" | "needs_checkpoint";
  checkpointHistory?: AccountCheckpointDto[];
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
  reconciliationStatus?: "matched" | "mismatch" | "needs_checkpoint";
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

export interface MetricCardDto {
  label: string;
  amountMinor?: number;
  value?: string;
  tone?: "default" | "positive" | "negative";
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
  incomeMinor: number;
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
  amountMinor: number;
  transactionDate: string;
}

export interface EntryDto {
  id: string;
  date: string;
  description: string;
  accountName: string;
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
  linkedTransfer?: LinkedTransferDto;
  splits: EntrySplitDto[];
}

export interface SplitGroupPillDto {
  id: string;
  name: string;
  iconKey?: string;
  balanceMinor: number;
  summaryText: string;
  entryCount: number;
  pendingMatchCount: number;
  isDefault?: boolean;
}

export interface SplitGroupDto {
  id: string;
  name: string;
  iconKey?: string;
  sortOrder: number;
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
  viewerAmountMinor?: number;
  viewerDirectionLabel: string;
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
  matched: boolean;
}

export interface SplitMatchCandidateDto {
  id: string;
  kind: "expense" | "settlement";
  groupId: string;
  groupName: string;
  splitRecordId: string;
  transactionId: string;
  transactionDate: string;
  transactionDescription: string;
  amountMinor: number;
  confidenceLabel: "High" | "Medium";
  reviewLabel: string;
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
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
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
  note?: string;
  linkedTransactionId?: string;
  linkedTransactionDescription?: string;
}

export interface SplitsPageDto {
  month: string;
  groups: SplitGroupPillDto[];
  activity: SplitActivityDto[];
  matches: SplitMatchCandidateDto[];
  donutChart: DonutChartDatumDto[];
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
  planMatchHints?: MonthPlanMatchHintDto[];
  isDerived?: boolean;
  sourceRowIds?: string[];
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
}

export interface ImportBatchDto {
  id: string;
  sourceLabel: string;
  sourceType: "csv" | "pdf" | "manual";
  importedAt: string;
  status: "draft" | "completed" | "rolled_back";
  transactionCount: number;
  startDate?: string;
  endDate?: string;
  accountNames: string[];
  overlapImportCount?: number;
  overlapImports?: ImportOverlapDto[];
  note?: string;
}

export interface ImportOverlapDto {
  id: string;
  sourceLabel: string;
  sourceType: "csv" | "pdf" | "manual";
  importedAt: string;
  status: "draft" | "completed" | "rolled_back";
  transactionCount: number;
  startDate?: string;
  endDate?: string;
  accountNames: string[];
}

export interface ImportPreviewRowDto {
  rowId: string;
  rowIndex: number;
  date: string;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection?: TransferDirection;
  accountId?: string;
  accountName?: string;
  categoryName?: string;
  ownershipType: "direct" | "shared";
  ownerName?: string;
  splitBasisPoints: number;
  note?: string;
  rawRow: Record<string, string>;
  duplicateMatches?: DuplicateCandidateDto[];
}

export interface ImportPreviewDto {
  sourceLabel: string;
  parserKey: string;
  importedRows: number;
  previewRows: ImportPreviewRowDto[];
  unknownAccounts: string[];
  unknownCategories: string[];
  duplicateCandidateCount: number;
  overlappingImportCount: number;
  overlapImports: ImportOverlapDto[];
  startDate?: string;
  endDate?: string;
  accountNames: string[];
  duplicateCandidates: DuplicateCandidateDto[];
  statementReconciliations: ImportPreviewStatementReconciliationDto[];
}

export interface StatementCheckpointDraftDto {
  accountId?: string;
  accountName: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  note?: string;
}

export interface ImportPreviewStatementReconciliationDto {
  accountName: string;
  accountKind?: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  projectedLedgerBalanceMinor?: number;
  deltaMinor?: number;
  status: "matched" | "mismatch" | "unknown_account";
}

export interface StatementCompareRowDto {
  id: string;
  date: string;
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
}

export interface DuplicateCandidateDto {
  existingImportId: string;
  date: string;
  description: string;
  amountMinor: number;
  accountName?: string;
  matchKind: "exact" | "near";
}

export interface TransferIssueDto {
  entryId: string;
  date: string;
  description: string;
  accountName: string;
  amountMinor: number;
  transferDirection?: TransferDirection;
}

export interface AuditEventDto {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  entityType?: string;
  entityId?: string;
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
  accountPills: SummaryAccountPillDto[];
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
  rollbackPolicy: string;
}

export interface ContextViewDto {
  id: string;
  label: string;
  summaryPage: SummaryPageDto;
  monthPage: MonthPageDto;
  splitsPage: SplitsPageDto;
}

export interface SettingsPageDto {
  demo: DemoSettingsDto;
  categoryMatchRules: CategoryMatchRuleDto[];
  categoryMatchRuleSuggestions: CategoryMatchRuleSuggestionDto[];
  unresolvedTransfers: TransferIssueDto[];
  recentAuditEvents: AuditEventDto[];
}

export interface AppBootstrapDto {
  household: HouseholdDto;
  accounts: AccountDto[];
  categories: CategoryDto[];
  views: ContextViewDto[];
  selectedViewId: string;
  importsPage: ImportsPageDto;
  settingsPage: SettingsPageDto;
}
