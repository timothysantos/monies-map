export type PersonScope = "direct" | "shared" | "direct_plus_shared";
export type EntryType = "expense" | "income" | "transfer";
export type TransferDirection = "in" | "out";
export type PlanSectionKey = "planned_items" | "budget_buckets";

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
  name: string;
  institution: string;
  kind: string;
  ownerLabel: string;
  currency: string;
  isJoint: boolean;
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
  label: string;
  valueMinor: number;
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
  offsetsCategory: boolean;
  note?: string;
  linkedTransfer?: LinkedTransferDto;
  splits: EntrySplitDto[];
}

export interface MonthPlanRowDto {
  id: string;
  section: PlanSectionKey;
  categoryName: string;
  label: string;
  dayLabel?: string;
  dayOfWeek?: string;
  plannedMinor: number;
  actualMinor: number;
  accountName?: string;
  note?: string;
  ownershipType: "direct" | "shared";
  ownerName?: string;
  splits: EntrySplitDto[];
}

export interface MonthPlanSectionDto {
  key: PlanSectionKey;
  label: string;
  description: string;
  rows: MonthPlanRowDto[];
}

export interface ImportBatchDto {
  id: string;
  sourceLabel: string;
  sourceType: "csv" | "pdf" | "manual";
  importedAt: string;
  status: "draft" | "completed" | "rolled_back";
  transactionCount: number;
  note?: string;
}

export interface SummaryPageDto {
  metricCards: MetricCardDto[];
  months: SummaryMonthDto[];
  categoryShareChart: DonutChartDatumDto[];
  notes: string[];
}

export interface MonthPageDto {
  month: string;
  selectedPersonId: string;
  selectedScope: PersonScope;
  scopes: { key: PersonScope; label: string }[];
  metricCards: MetricCardDto[];
  planSections: MonthPlanSectionDto[];
  categoryShareChart: DonutChartDatumDto[];
  notes: string[];
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
}

export interface AppBootstrapDto {
  household: HouseholdDto;
  accounts: AccountDto[];
  views: ContextViewDto[];
  selectedViewId: string;
  importsPage: ImportsPageDto;
}
