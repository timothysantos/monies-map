import { redactAiText } from "./ai-assistance";
import { spendingMinor } from "./category-offset";
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

export function buildMonthlyNarrativeFacts(
  month: string,
  summary: SummaryMonthDto | undefined,
  entries: EntryDto[],
  formatMoney: (amountMinor: number) => string
): MonthlyNarrativeFacts {
  const expenses = entries.filter((entry) => entry.entryType === "expense");
  const categoryTotals = new Map<string, number>();
  // Paybacks lower their category (category-offset.ts).
  for (const entry of entries) {
    const amountMinor = spendingMinor(entry, Math.abs(entry.amountMinor));
    if (amountMinor) {
      categoryTotals.set(entry.categoryName, (categoryTotals.get(entry.categoryName) ?? 0) + amountMinor);
    }
  }
  const [topCategoryName, topCategoryMinor] = [...categoryTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["No spending category", 0];
  const topMerchant = [...expenses]
    .sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.description.localeCompare(right.description))[0];

  return {
    monthName: formatMonthName(month),
    spend: formatMoney(summary?.realExpensesMinor ?? entries.reduce((total, entry) => total + spendingMinor(entry, Math.abs(entry.amountMinor)), 0)),
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
