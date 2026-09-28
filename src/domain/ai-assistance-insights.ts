import { redactAiText } from "./ai-assistance";
import { findToneProblems } from "./money-signals/tone";
import type { EntryDto, ImportPreviewDto, ImportPreviewStatementReconciliationDto, SummaryMonthDto } from "../types/dto";

const MAX_TEMPLATE_LENGTH = 520;

export interface MonthlyNarrativeFacts {
  monthName: string;
  spend: string;
  income: string;
  topCategoryName: string;
  topCategoryAmount: string;
  topMerchantName: string;
  topMerchantAmount: string;
}

export interface ImportExplanationFacts {
  accountName: string;
  statementMonth: string;
  difference: string;
  cause: string;
  ledgerRows: number;
  statementRows: number;
}

export interface FinancialInsightFacts {
  contextLabel: string;
  audienceKind?: "person" | "household";
  audienceName?: string;
  entryCount: number;
  spend: string;
  income: string;
  net: string;
  topCategoryName: string;
  topCategoryAmount: string;
  topMerchantName: string;
  topMerchantAmount: string;
}

// The check-in's headline as the optional AI may see it: the fact and the
// way to think about it, which any AI wording must keep word for word.
export interface CheckInHeadlineFacts {
  headlineKind: "quick_fix" | "bigger_question" | "worth_a_look" | "going_well";
  fact: string;
  think: string;
}

export type FinancialInsightWordingFacts = FinancialInsightFacts & CheckInHeadlineFacts;

export interface FinancialInsightRecord {
  amountMinor: number;
  entryType: "expense" | "income" | "transfer";
  categoryName?: string;
  description?: string;
  date?: string;
  // Present on entries adjusted for a person view: a shared or split-linked
  // entry carries the person's part in amountMinor and the whole entry in
  // totalAmountMinor.
  ownershipType?: string;
  linkedSplitExpenseId?: string | null;
  totalAmountMinor?: number | null;
}

export function buildMonthlyNarrativeFacts(
  month: string,
  summary: SummaryMonthDto | undefined,
  entries: EntryDto[],
  formatMoney: (amountMinor: number) => string
): MonthlyNarrativeFacts {
  const expenses = entries.filter((entry) => entry.entryType === "expense");
  const categoryTotals = new Map<string, number>();
  for (const entry of expenses) {
    categoryTotals.set(entry.categoryName, (categoryTotals.get(entry.categoryName) ?? 0) + Math.abs(entry.amountMinor));
  }
  const [topCategoryName, topCategoryMinor] = [...categoryTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["No spending category", 0];
  const topMerchant = [...expenses]
    .sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.description.localeCompare(right.description))[0];

  return {
    monthName: formatMonthName(month),
    spend: formatMoney(summary?.realExpensesMinor ?? expenses.reduce((total, entry) => total + Math.abs(entry.amountMinor), 0)),
    income: formatMoney(summary?.actualIncomeMinor ?? 0),
    topCategoryName: redactAiText(topCategoryName, 80) || "No spending category",
    topCategoryAmount: formatMoney(topCategoryMinor),
    topMerchantName: redactAiText(topMerchant?.description, 100) || "No expense recorded",
    topMerchantAmount: formatMoney(Math.abs(topMerchant?.amountMinor ?? 0))
  };
}

export function buildImportExplanationFacts(preview: ImportPreviewDto, formatMoney: (amountMinor: number) => string): ImportExplanationFacts[] {
  return preview.statementReconciliations
    .filter((item) => item.status === "mismatch")
    .slice(0, 4)
    .map((item) => buildOneImportExplanationFact(item, formatMoney));
}

export function buildDeterministicMonthlyNarrative(facts: MonthlyNarrativeFacts) {
  return `${facts.monthName} recorded ${facts.spend} of spending and ${facts.income} of income. ${facts.topCategoryName} was the largest spending category at ${facts.topCategoryAmount}; the largest recorded expense was ${facts.topMerchantName} at ${facts.topMerchantAmount}.`;
}

export function buildFinancialInsightFacts(input: {
  contextLabel: string;
  records: FinancialInsightRecord[];
  formatMoney: (amountMinor: number) => string;
  audienceKind?: "person" | "household";
  audienceName?: string;
  entryCount?: number;
}) : FinancialInsightFacts {
  const expenses = input.records.filter((record) => record.entryType === "expense");
  const incomeMinor = input.records
    .filter((record) => record.entryType === "income")
    .reduce((total, record) => total + Math.abs(record.amountMinor), 0);
  const spendMinor = expenses.reduce((total, record) => total + Math.abs(record.amountMinor), 0);
  const categoryTotals = new Map<string, number>();
  for (const record of expenses) {
    const categoryName = redactAiText(record.categoryName, 80) || "Uncategorized spending";
    categoryTotals.set(categoryName, (categoryTotals.get(categoryName) ?? 0) + Math.abs(record.amountMinor));
  }
  const [topCategoryName, topCategoryMinor] = [...categoryTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["No spending category", 0];
  const topMerchant = [...expenses]
    .sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || String(left.description ?? "").localeCompare(String(right.description ?? "")))[0];

  const topMerchantName = redactAiText(topMerchant?.description, 100) || "No expense recorded";
  const topMerchantMinor = Math.abs(topMerchant?.amountMinor ?? 0);
  const contextLabel = redactAiText(input.contextLabel, 120) || "Current view";
  const audienceName = redactAiText(input.audienceName, 80);
  const audienceKind = input.audienceKind === "person" && audienceName ? "person" : "household";

  return {
    contextLabel,
    audienceKind,
    audienceName,
    entryCount: Math.max(0, Math.round(input.entryCount ?? input.records.length)),
    spend: input.formatMoney(spendMinor),
    income: input.formatMoney(incomeMinor),
    net: input.formatMoney(incomeMinor - spendMinor),
    topCategoryName,
    topCategoryAmount: input.formatMoney(topCategoryMinor),
    topMerchantName,
    topMerchantAmount: input.formatMoney(topMerchantMinor)
  };
}

// The wording shown when AI is off: the fact, then the way to think about it.
export function buildDeterministicFinancialInsight(facts: CheckInHeadlineFacts) {
  return [facts.fact, facts.think].filter(Boolean).join(" ");
}

// Changes whenever anything the check-in says changes, so wording is asked
// for again only for new facts.
export function buildFinancialInsightCacheKey(facts: FinancialInsightFacts, headline: CheckInHeadlineFacts) {
  return JSON.stringify([
    facts.contextLabel,
    facts.audienceKind,
    facts.audienceName,
    facts.entryCount,
    facts.spend,
    facts.income,
    facts.net,
    headline.headlineKind,
    headline.fact,
    headline.think
  ]);
}

export function buildDeterministicImportExplanation(facts: ImportExplanationFacts) {
  return `${facts.accountName} is out by ${facts.difference} for ${facts.statementMonth}. Start with the ${facts.ledgerRows} ledger row${facts.ledgerRows === 1 ? "" : "s"} already inside the statement period, then compare the ${facts.statementRows} imported statement row${facts.statementRows === 1 ? "" : "s"}; the likely cause is ${facts.cause}.`;
}

export function parseNarrativeTemplate(value: unknown, facts: MonthlyNarrativeFacts) {
  if (!value || typeof value !== "object" || typeof (value as { template?: unknown }).template !== "string") {
    return null;
  }
  const template = (value as { template: string }).template.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH || /[$\d]/.test(template)) {
    return null;
  }
  const replacements: Record<string, string> = {
    monthName: facts.monthName,
    spend: facts.spend,
    income: facts.income,
    topCategoryName: facts.topCategoryName,
    topCategoryAmount: facts.topCategoryAmount,
    topMerchantName: facts.topMerchantName,
    topMerchantAmount: facts.topMerchantAmount
  };
  if (!hasOnlyKnownTokens(template, replacements) || !template.includes("{{monthName}}")) {
    return null;
  }
  return replaceTokens(template, replacements);
}

// The AI may only choose words around the check-in's fact and think line:
// both must appear exactly once and are inserted from computed facts, the
// wording may not add figures, and it must pass the check-in's tone rules.
export function parseFinancialInsightTemplate(value: unknown, facts: FinancialInsightWordingFacts) {
  if (!value || typeof value !== "object" || typeof (value as { template?: unknown }).template !== "string") {
    return null;
  }
  const template = (value as { template: string }).template.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH || /[$\d]/.test(template)) {
    return null;
  }
  const replacements: Record<string, string> = {
    contextLabel: facts.contextLabel,
    audienceName: facts.audienceName ?? "",
    fact: facts.fact,
    think: facts.think
  };
  const ownWords = template.replace(/{{\s*[^}]+\s*}}/g, " ");
  if (
    !hasOnlyKnownTokens(template, replacements)
    || countToken(template, "fact") !== 1
    || countToken(template, "think") !== 1
    || (facts.audienceKind === "person" && countToken(template, "audienceName") !== 1)
    || findToneProblems(ownWords).length > 0
  ) {
    return null;
  }
  return replaceTokens(template, replacements);
}

function countToken(template: string, token: string) {
  return (template.match(new RegExp(`{{\\s*${token}\\s*}}`, "g")) ?? []).length;
}

export function parseImportExplanationTemplate(value: unknown, facts: ImportExplanationFacts) {
  if (!value || typeof value !== "object" || typeof (value as { template?: unknown }).template !== "string") {
    return null;
  }
  const template = (value as { template: string }).template.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH || /[$\d]/.test(template)) {
    return null;
  }
  const replacements: Record<string, string> = {
    accountName: facts.accountName,
    statementMonth: facts.statementMonth,
    difference: facts.difference,
    cause: facts.cause,
    ledgerRows: String(facts.ledgerRows),
    statementRows: String(facts.statementRows)
  };
  if (!hasOnlyKnownTokens(template, replacements) || !template.includes("{{accountName}}")) {
    return null;
  }
  return replaceTokens(template, replacements);
}

function buildOneImportExplanationFact(item: ImportPreviewStatementReconciliationDto, formatMoney: (amountMinor: number) => string): ImportExplanationFacts {
  const breakdown = item.reconciliationBreakdown;
  const cause = redactAiText(breakdown?.suspectedCauses?.[0], 160) || "a ledger row that is not yet explained by this statement";
  return {
    // The model receives only placeholder names for explanations; keep the
    // existing account label intact when the server renders that template.
    accountName: String(item.accountName ?? "Account").trim().slice(0, 120) || "Account",
    statementMonth: formatMonthName(item.checkpointMonth),
    difference: formatMoney(Math.abs(item.deltaMinor ?? 0)),
    cause,
    ledgerRows: Number(breakdown?.periodExistingLedgerRowCount ?? 0),
    statementRows: Number(breakdown?.skippedStatementRowCount ?? 0) + Number(breakdown?.matchedStatementRowCount ?? 0)
  };
}

function formatMonthName(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    return month;
  }
  return new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function hasOnlyKnownTokens(template: string, replacements: Record<string, string>) {
  const tokens: string[] = template.match(/{{\s*[^}]+\s*}}/g) ?? [];
  return tokens.every((token) => Object.hasOwn(replacements, token.slice(2, -2).trim()));
}

function replaceTokens(template: string, replacements: Record<string, string | number>) {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => String(replacements[key.trim()] ?? ""));
}
