// The facts behind an Ask answer (DOMAIN.md "Money Question"): pure reads
// of the page DTOs the screens already show, never a figure of their own.
// - A month's spending, plan, income and category shares come from the
//   Month page DTO (buildMonthPageDto): the Actual spend and Planned spend
//   cards, the summary month's income, and the Spending Mix donut.
// - The biggest expenses and the income sources come from the same DTO's
//   entries, adjusted and filtered for the view exactly as Month counts
//   them (filterEntriesForView over the view-adjusted entries).
// - Splits balances come from the Splits page DTO seen by one person
//   (buildSplitsPageDto): each group's open balance and the open settlement
//   checkpoints, in their own currency.
// Nothing here reads the database or words anything (ask-answer-wording.ts
// does), and nothing is AI.

import { incomeMinor } from "./category-offset";
import { effectiveScopeForView, filterEntriesForView } from "./person-view-scope";
import type {
  DonutChartDatumDto,
  EntryDto,
  MetricCardDto,
  MonthPageDto,
  PersonScope,
  SplitSettlementCheckpointDto,
  SummaryMonthDto
} from "../types/dto";

export const TOP_CATEGORY_COUNT = 3;
export const BIGGEST_ENTRY_COUNT = 5;
export const PLAN_ROW_COUNT = 4;
export const INCOME_SOURCE_COUNT = 3;
export const CATEGORY_CHANGE_COUNT = 4;

export interface MonthPageFactsInput {
  viewId: string;
  summaryPage: { months: SummaryMonthDto[] };
  monthPage: MonthPageDto;
}

export interface CategoryFact {
  name: string;
  amountMinor: number;
  // Of the month's Spending Mix total, as the donut shows it.
  sharePercent: number;
  entryCount: number;
}

export interface EntryFact {
  id: string;
  description: string;
  date: string;
  categoryName: string;
  amountMinor: number;
}

export interface PlanRowFact {
  label: string;
  plannedMinor: number;
  actualMinor: number;
}

export interface IncomeSourceFact {
  name: string;
  amountMinor: number;
  entryCount: number;
}

export interface MonthFacts {
  month: string;
  viewId: string;
  scope: PersonScope;
  spentMinor: number;
  plannedMinor: number;
  incomeMinor: number;
  plannedIncomeMinor: number;
  // Every entry the view counts this month, and the expenses among them
  // (the rows Open in Entries shows for spending).
  entryCount: number;
  expenseCount: number;
  categories: CategoryFact[];
  // Every category in the Spending Mix (for a comparison), largest first.
  allCategories: CategoryFact[];
  biggest: EntryFact[];
  planRows: PlanRowFact[];
  incomeSources: IncomeSourceFact[];
}

export interface CategoryChangeFact {
  name: string;
  amountMinor: number;
  otherAmountMinor: number;
}

export interface SplitsBalanceFact {
  groupId: string;
  groupName: string;
  currency: string;
  // Positive: the other person owes the viewer (as Splits shows it).
  balanceMinor: number;
}

export interface OpenSettlementFact {
  checkpointId: string;
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
  currency: string;
  date: string;
}

export type AskAnswerFacts =
  | { kind: "spending"; focus: "why" | "where"; current: MonthFacts; previous: MonthFacts | null }
  | { kind: "plan"; current: MonthFacts; isCurrentMonth: boolean }
  | { kind: "compare"; current: MonthFacts; other: MonthFacts; categoryChanges: CategoryChangeFact[] }
  | { kind: "biggest"; current: MonthFacts }
  | { kind: "income"; current: MonthFacts; previous: MonthFacts | null }
  | {
    kind: "owed";
    month: string;
    // The view the question was asked in (Open Splits keeps it).
    viewId: string;
    viewerPersonId: string;
    otherPersonId: string;
    personNameById: Record<string, string>;
    // "You" can be said: a person view, or the question named the other person.
    speaksToViewer: boolean;
    balances: SplitsBalanceFact[];
    openSettlements: OpenSettlementFact[];
  };

function metric(cards: MetricCardDto[], label: string) {
  return cards.find((card) => card.label === label)?.amountMinor ?? 0;
}

function categoryFacts(chart: DonutChartDatumDto[]): CategoryFact[] {
  const total = chart.reduce((sum, datum) => sum + datum.valueMinor, 0);
  return chart.map((datum) => ({
    name: datum.label,
    amountMinor: datum.valueMinor,
    sharePercent: total > 0 ? Math.round((datum.valueMinor * 100) / total) : 0,
    entryCount: datum.entryCount ?? 0
  }));
}

// One month in one view, from its Month page DTO.
export function buildMonthFacts(input: MonthPageFactsInput, selectedScope: PersonScope | string | null | undefined): MonthFacts {
  const { monthPage } = input;
  const viewId = input.viewId;
  const scope = effectiveScopeForView(viewId, selectedScope ?? monthPage.selectedScope);
  const summaryMonth = input.summaryPage.months[0];
  // monthPage.entries are already adjusted for the view (each shared row at
  // the person's share); Month counts the ones in the view's scope.
  const visible: EntryDto[] = filterEntriesForView(monthPage.entries ?? [], viewId, scope);
  const allCategories = categoryFacts(monthPage.categoryShareChart ?? []);

  const biggest = visible
    .filter((entry) => entry.entryType === "expense" && entry.amountMinor > 0)
    .sort((left, right) => right.amountMinor - left.amountMinor || left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
    .slice(0, BIGGEST_ENTRY_COUNT)
    .map((entry) => ({ id: entry.id, description: entry.description, date: entry.date, categoryName: entry.categoryName, amountMinor: entry.amountMinor }));

  const sources = new Map<string, IncomeSourceFact>();
  for (const entry of visible) {
    const amount = incomeMinor(entry);
    if (amount <= 0) continue;
    const current = sources.get(entry.categoryName) ?? { name: entry.categoryName, amountMinor: 0, entryCount: 0 };
    current.amountMinor += amount;
    current.entryCount += 1;
    sources.set(entry.categoryName, current);
  }

  const planRows = (monthPage.planSections ?? [])
    .flatMap((section) => section.rows)
    .map((row) => ({ label: row.label, plannedMinor: row.plannedMinor, actualMinor: row.actualMinor }));

  return {
    month: monthPage.month,
    viewId,
    scope,
    spentMinor: metric(monthPage.metricCards, "Actual spend"),
    plannedMinor: metric(monthPage.metricCards, "Planned spend"),
    incomeMinor: summaryMonth?.actualIncomeMinor ?? 0,
    plannedIncomeMinor: summaryMonth?.plannedIncomeMinor ?? 0,
    entryCount: visible.length,
    expenseCount: visible.filter((entry) => entry.entryType === "expense").length,
    categories: allCategories.slice(0, TOP_CATEGORY_COUNT),
    allCategories,
    biggest,
    planRows,
    incomeSources: [...sources.values()]
      .sort((left, right) => right.amountMinor - left.amountMinor || left.name.localeCompare(right.name))
      .slice(0, INCOME_SOURCE_COUNT)
  };
}

// The plan rows that went furthest over, else the largest rows by spend.
export function selectPlanRows(facts: MonthFacts): PlanRowFact[] {
  const over = facts.planRows
    .filter((row) => row.actualMinor > row.plannedMinor)
    .sort((left, right) => (right.actualMinor - right.plannedMinor) - (left.actualMinor - left.plannedMinor) || left.label.localeCompare(right.label));
  if (over.length) {
    return over.slice(0, PLAN_ROW_COUNT);
  }
  return facts.planRows
    .filter((row) => row.plannedMinor > 0 || row.actualMinor > 0)
    .sort((left, right) => right.actualMinor - left.actualMinor || right.plannedMinor - left.plannedMinor || left.label.localeCompare(right.label))
    .slice(0, PLAN_ROW_COUNT);
}

// The categories whose spending moved most between the two months.
export function compareCategories(current: MonthFacts, other: MonthFacts): CategoryChangeFact[] {
  const names = new Set([...current.allCategories, ...other.allCategories].map((category) => category.name));
  const amountIn = (facts: MonthFacts, name: string) => facts.allCategories.find((category) => category.name === name)?.amountMinor ?? 0;
  return [...names]
    .map((name) => ({ name, amountMinor: amountIn(current, name), otherAmountMinor: amountIn(other, name) }))
    .filter((change) => change.amountMinor !== change.otherAmountMinor)
    .sort((left, right) => Math.abs(right.amountMinor - right.otherAmountMinor) - Math.abs(left.amountMinor - left.otherAmountMinor) || left.name.localeCompare(right.name))
    .slice(0, CATEGORY_CHANGE_COUNT);
}

// Splits as the viewer sees them: every group with an open balance, and
// every open settlement checkpoint's remaining amount between the two.
export function buildSplitsBalanceFacts(input: {
  groups: Array<{ id: string; name: string; balanceMinor: number; currency: string }>;
  settlementCheckpoints: SplitSettlementCheckpointDto[];
}): { balances: SplitsBalanceFact[]; openSettlements: OpenSettlementFact[] } {
  const balances = input.groups
    .filter((group) => group.balanceMinor !== 0)
    .map((group) => ({ groupId: group.id, groupName: group.name, currency: group.currency || "SGD", balanceMinor: group.balanceMinor }))
    .sort((left, right) => Math.abs(right.balanceMinor) - Math.abs(left.balanceMinor) || left.groupName.localeCompare(right.groupName));
  const openSettlements = input.settlementCheckpoints
    .filter((checkpoint) => (checkpoint.status === "open" || checkpoint.status === "partially_matched") && checkpoint.fromPersonId && checkpoint.toPersonId)
    .map((checkpoint) => ({
      checkpointId: checkpoint.id,
      fromPersonId: checkpoint.fromPersonId as string,
      toPersonId: checkpoint.toPersonId as string,
      amountMinor: checkpoint.amountMinor - (checkpoint.matchedAmountMinor ?? 0),
      currency: checkpoint.currency || "SGD",
      date: checkpoint.settlementDate
    }))
    .filter((settlement) => settlement.amountMinor > 0)
    .sort((left, right) => left.date.localeCompare(right.date) || left.checkpointId.localeCompare(right.checkpointId));
  return { balances, openSettlements };
}
