import { redactAiText } from "./ai-assistance";
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
  entryCount: number;
  spend: string;
  income: string;
  net: string;
  topCategoryName: string;
  topCategoryAmount: string;
  topMerchantName: string;
  topMerchantAmount: string;
  notableFact: string;
  cashFlowPrinciple: string;
  nextSpendConsideration: string;
  accountingAdvice: string;
  decisionMap: FinancialDecisionMap;
}

export interface FinancialInsightRecord {
  amountMinor: number;
  entryType: "expense" | "income" | "transfer";
  categoryName?: string;
  description?: string;
}

export interface FinancialDecisionMapLane {
  id: "surplus" | "plan" | "season" | "confidence" | "repeat";
  label: string;
  value: string;
  detail: string;
  tone: "default" | "positive" | "caution";
}

export interface FinancialDecisionMap {
  enabled: boolean;
  needsReview: boolean;
  lanes: FinancialDecisionMapLane[];
}

export interface FinancialDecisionMapContext {
  plannedSpendMinor?: number;
  sameSeason?: {
    label: string;
    spendMinor: number;
    incomeMinor: number;
  };
  confidence?: {
    evaluated?: boolean;
    reconciliationMismatchCount?: number;
    needsCheckpointCount?: number;
    unresolvedTransferCount?: number;
  };
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
  accountingAdvice: string;
  perspective?: "cash_flow" | "partial_view" | "split_obligation";
  entryCount?: number;
  decisionMapContext?: FinancialDecisionMapContext;
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

  const perspective = input.perspective ?? "cash_flow";
  const topMerchantName = redactAiText(topMerchant?.description, 100) || "No expense recorded";
  const topMerchantMinor = Math.abs(topMerchant?.amountMinor ?? 0);
  const contextLabel = redactAiText(input.contextLabel, 120) || "Current view";

  return {
    contextLabel,
    entryCount: Math.max(0, Math.round(input.entryCount ?? input.records.length)),
    spend: input.formatMoney(spendMinor),
    income: input.formatMoney(incomeMinor),
    net: input.formatMoney(incomeMinor - spendMinor),
    topCategoryName,
    topCategoryAmount: input.formatMoney(topCategoryMinor),
    topMerchantName,
    topMerchantAmount: input.formatMoney(topMerchantMinor),
    notableFact: buildNotableEntryFact({
      expenses,
      spendMinor,
      topCategoryName,
      topCategoryMinor,
      topMerchantName,
      topMerchantMinor,
      formatMoney: input.formatMoney,
      contextLabel
    }),
    ...buildFinancialDecisionPrompts({
      perspective,
      spendMinor,
      incomeMinor,
      netMinor: incomeMinor - spendMinor,
      formatMoney: input.formatMoney
    }),
    accountingAdvice: redactAiText(input.accountingAdvice, 260) || "Review this view against the bank record before treating it as final.",
    decisionMap: buildFinancialDecisionMap({
      perspective,
      spendMinor,
      incomeMinor,
      netMinor: incomeMinor - spendMinor,
      topMerchantName,
      topMerchantMinor,
      formatMoney: input.formatMoney,
      context: input.decisionMapContext
    })
  };
}

export function buildDeterministicFinancialInsight(facts: FinancialInsightFacts) {
  if (!facts.entryCount) {
    return `${facts.contextLabel} has no visible entries. ${facts.accountingAdvice}`;
  }
  const snapshot = `${facts.contextLabel} has ${facts.entryCount} visible ${facts.entryCount === 1 ? "entry" : "entries"}: ${facts.spend} of spending, ${facts.income} of income, and a net of ${facts.net}.`;
  const notableFact = facts.notableFact || `${facts.topCategoryName} is the largest expense category at ${facts.topCategoryAmount}.`;
  const openings = [
    `Worth noticing: ${notableFact}`,
    `A useful signal: ${notableFact}`,
    `One entry pattern: ${notableFact}`,
    `At a glance, ${notableFact.charAt(0).toLowerCase()}${notableFact.slice(1)}`
  ];
  const opening = openings[stableInsightIndex(`${facts.contextLabel}|${facts.entryCount}|${facts.spend}|${facts.income}|${facts.topCategoryName}`) % openings.length];
  return `${opening} ${snapshot} ${facts.cashFlowPrinciple} ${facts.nextSpendConsideration} ${facts.accountingAdvice}`;
}

export function buildFinancialInsightCacheKey(facts: FinancialInsightFacts) {
  return JSON.stringify([
    facts.contextLabel,
    facts.entryCount,
    facts.spend,
    facts.income,
    facts.net,
    facts.topCategoryName,
    facts.topCategoryAmount,
    facts.topMerchantName,
    facts.topMerchantAmount,
    facts.notableFact,
    facts.cashFlowPrinciple,
    facts.nextSpendConsideration,
    facts.accountingAdvice,
    facts.decisionMap
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

export function parseFinancialInsightTemplate(value: unknown, facts: FinancialInsightFacts) {
  if (!value || typeof value !== "object" || typeof (value as { template?: unknown }).template !== "string") {
    return null;
  }
  const template = (value as { template: string }).template.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH || /[$\d]/.test(template)) {
    return null;
  }
  const replacements: Record<string, string> = {
    contextLabel: facts.contextLabel,
    entryCount: String(facts.entryCount),
    spend: facts.spend,
    income: facts.income,
    net: facts.net,
    topCategoryName: facts.topCategoryName,
    topCategoryAmount: facts.topCategoryAmount,
    topMerchantName: facts.topMerchantName,
    topMerchantAmount: facts.topMerchantAmount,
    notableFact: facts.notableFact,
    cashFlowPrinciple: facts.cashFlowPrinciple,
    nextSpendConsideration: facts.nextSpendConsideration,
    accountingAdvice: facts.accountingAdvice
  };
  if (
    !hasOnlyKnownTokens(template, replacements)
    || !template.includes("{{contextLabel}}")
    || !template.includes("{{notableFact}}")
    || !template.includes("{{cashFlowPrinciple}}")
    || !template.includes("{{nextSpendConsideration}}")
  ) {
    return null;
  }
  return replaceTokens(template, replacements);
}

function buildNotableEntryFact(input: {
  expenses: FinancialInsightRecord[];
  spendMinor: number;
  topCategoryName: string;
  topCategoryMinor: number;
  topMerchantName: string;
  topMerchantMinor: number;
  formatMoney: (amountMinor: number) => string;
  contextLabel: string;
}) {
  if (!input.expenses.length || input.spendMinor <= 0) {
    return "There is no visible expense pattern to compare yet.";
  }

  const merchantCounts = new Map<string, number>();
  for (const expense of input.expenses) {
    const merchant = redactAiText(expense.description, 100) || "Unlabelled expense";
    merchantCounts.set(merchant, (merchantCounts.get(merchant) ?? 0) + 1);
  }
  const [mostFrequentMerchant, mostFrequentMerchantCount] = [...merchantCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["", 0];
  const largestExpensesMinor = [...input.expenses]
    .map((expense) => Math.abs(expense.amountMinor))
    .sort((left, right) => right - left)
    .slice(0, 3)
    .reduce((total, amountMinor) => total + amountMinor, 0);
  const categoryShare = Math.round((input.topCategoryMinor / input.spendMinor) * 100);
  const topThreeShare = Math.round((largestExpensesMinor / input.spendMinor) * 100);
  const candidates = [
    `${input.topCategoryName} accounts for ${categoryShare}% of visible spending.`,
    `${input.topMerchantName} is the largest visible expense at ${input.formatMoney(input.topMerchantMinor)}.`,
    input.expenses.length >= 3 ? `The three largest expenses account for ${topThreeShare}% of visible spending.` : null,
    mostFrequentMerchantCount >= 2 ? `${mostFrequentMerchant} appears ${mostFrequentMerchantCount} times among the visible expenses.` : null
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates[stableInsightIndex(`${input.contextLabel}|${input.spendMinor}|${input.topCategoryName}|${mostFrequentMerchant}`) % candidates.length];
}

function stableInsightIndex(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function buildFinancialDecisionPrompts(input: {
  perspective: "cash_flow" | "partial_view" | "split_obligation";
  spendMinor: number;
  incomeMinor: number;
  netMinor: number;
  formatMoney: (amountMinor: number) => string;
}) {
  if (input.perspective === "split_obligation") {
    return {
      cashFlowPrinciple: "Split expenses and settlements track who owes whom; they do not measure household income or savings.",
      nextSpendConsideration: "Before adding another shared expense, confirm the payer, group, and expected settlement so the obligation stays visible."
    };
  }

  if (input.perspective === "partial_view") {
    return {
      cashFlowPrinciple: "This filtered view is evidence for an investigation, not a complete measure of the month or household savings.",
      nextSpendConsideration: "Before the next discretionary spend, check the unfiltered month or summary view for income, planned obligations, and remaining budget."
    };
  }

  if (input.incomeMinor === 0 && input.spendMinor > 0) {
    return {
      cashFlowPrinciple: "This view records spending but no income, so it cannot by itself show whether the household is saving.",
      nextSpendConsideration: "Before the next discretionary spend, check the month or range summary to confirm that total income still covers planned bills, transfers, and savings."
    };
  }

  if (input.netMinor < 0) {
    return {
      cashFlowPrinciple: "Recorded spending is higher than recorded income in this view. Repeating that pattern across the month reduces cash available for savings.",
      nextSpendConsideration: "Before the next discretionary spend, pause and check whether it can be delayed, reduced, or covered by an existing budget category."
    };
  }

  if (input.netMinor === 0 && input.incomeMinor > 0) {
    return {
      cashFlowPrinciple: "There is no recorded surplus in this view, so none of this income is yet available to save after the recorded spending.",
      nextSpendConsideration: "Before the next discretionary spend, confirm it is covered by unspent budget or income that has not already been committed."
    };
  }

  return {
    cashFlowPrinciple: `The recorded surplus is ${input.formatMoney(input.netMinor)} before future bills, transfers, and savings contributions are accounted for.`,
    nextSpendConsideration: "Before the next discretionary spend, reserve what is needed for planned obligations and an intentional savings transfer rather than treating all remaining cash as available."
  };
}

function buildFinancialDecisionMap(input: {
  perspective: "cash_flow" | "partial_view" | "split_obligation";
  spendMinor: number;
  incomeMinor: number;
  netMinor: number;
  topMerchantName: string;
  topMerchantMinor: number;
  formatMoney: (amountMinor: number) => string;
  context?: FinancialDecisionMapContext;
}): FinancialDecisionMap {
  if (input.perspective !== "cash_flow") {
    const isSplit = input.perspective === "split_obligation";
    return {
      enabled: true,
      needsReview: false,
      lanes: [{
        id: "confidence",
        label: isSplit ? "What this view measures" : "What this view measures",
        value: isSplit ? "Settlement obligations" : "Investigation evidence",
        detail: isSplit
          ? "This group tracks who owes whom. It is not a household income, savings, or safe-to-spend calculation."
          : "This filter is useful for investigating specific records, but it cannot determine whole-month savings or free cash.",
        tone: "default"
      }]
    };
  }

  const plannedSpendMinor = Math.max(0, Math.round(input.context?.plannedSpendMinor ?? 0));
  const confidence = input.context?.confidence ?? {};
  const mismatchCount = Math.max(0, Math.round(confidence.reconciliationMismatchCount ?? 0));
  const checkpointCount = Math.max(0, Math.round(confidence.needsCheckpointCount ?? 0));
  const unresolvedTransferCount = Math.max(0, Math.round(confidence.unresolvedTransferCount ?? 0));
  const hasConfidenceWarning = confidence.evaluated === true && (mismatchCount > 0 || checkpointCount > 0 || unresolvedTransferCount > 0);
  const lanes: FinancialDecisionMapLane[] = [
    buildSurplusLane(input),
    buildPlanLane({ ...input, plannedSpendMinor }),
    buildSeasonLane({ ...input, sameSeason: input.context?.sameSeason }),
    buildConfidenceLane({ evaluated: confidence.evaluated === true, mismatchCount, checkpointCount, unresolvedTransferCount })
  ];
  const repeatLane = buildRepeatLane(input);
  if (repeatLane) {
    lanes.push(repeatLane);
  }

  return {
    enabled: true,
    needsReview: hasConfidenceWarning,
    lanes
  };
}

function buildSurplusLane(input: {
  incomeMinor: number;
  spendMinor: number;
  netMinor: number;
  formatMoney: (amountMinor: number) => string;
}): FinancialDecisionMapLane {
  if (input.incomeMinor <= 0 && input.spendMinor > 0) {
    return {
      id: "surplus",
      label: "Recorded surplus",
      value: "Income not in this view",
      detail: "Spending alone cannot establish whether there is money left to save or spend. Use the complete month or range before deciding.",
      tone: "caution"
    };
  }
  if (input.netMinor < 0) {
    return {
      id: "surplus",
      label: "Recorded cash flow",
      value: `${input.formatMoney(Math.abs(input.netMinor))} deficit`,
      detail: "Recorded spending exceeds recorded income. This is not a safe-to-spend position; first identify what can be delayed, reduced, or funded from a stated plan.",
      tone: "caution"
    };
  }
  return {
    id: "surplus",
    label: "Recorded surplus",
    value: input.formatMoney(input.netMinor),
    detail: "This is before future bills, transfers, debt payments, and intentional savings are reserved. It is not automatically free cash.",
    tone: input.netMinor > 0 ? "positive" : "caution"
  };
}

function buildPlanLane(input: {
  spendMinor: number;
  plannedSpendMinor: number;
  formatMoney: (amountMinor: number) => string;
}): FinancialDecisionMapLane {
  if (!input.plannedSpendMinor) {
    return {
      id: "plan",
      label: "Plan position",
      value: "No spend plan set",
      detail: "A recorded surplus is easier to protect when expected bills and flexible category limits are recorded before spending happens.",
      tone: "default"
    };
  }
  const varianceMinor = input.spendMinor - input.plannedSpendMinor;
  if (varianceMinor > 0) {
    return {
      id: "plan",
      label: "Plan position",
      value: `${input.formatMoney(varianceMinor)} over plan`,
      detail: "The recorded spending has used more than the planned amount. Review the largest category before changing the plan or treating the difference as a one-off.",
      tone: "caution"
    };
  }
  return {
    id: "plan",
    label: "Plan position",
    value: `${input.formatMoney(Math.abs(varianceMinor))} unspent`,
    detail: "Unspent plan is a decision point, not a prompt to spend it. Reserve known obligations and savings before reallocating it.",
    tone: "positive"
  };
}

function buildSeasonLane(input: {
  spendMinor: number;
  incomeMinor: number;
  sameSeason?: FinancialDecisionMapContext["sameSeason"];
  formatMoney: (amountMinor: number) => string;
}): FinancialDecisionMapLane {
  const reference = input.sameSeason;
  if (!reference || (reference.spendMinor <= 0 && reference.incomeMinor <= 0)) {
    return {
      id: "season",
      label: "Same-season comparison",
      value: "No comparable month loaded",
      detail: "The app only compares the same month in a prior year when that completed month is already present in the selected summary range.",
      tone: "default"
    };
  }
  const spendDifferenceMinor = input.spendMinor - reference.spendMinor;
  const direction = spendDifferenceMinor > 0 ? "more" : spendDifferenceMinor < 0 ? "less" : "the same";
  const value = direction === "the same"
    ? "Spending is unchanged"
    : `${input.formatMoney(Math.abs(spendDifferenceMinor))} ${direction} spending`;
  const incomeDifferenceMinor = input.incomeMinor - reference.incomeMinor;
  const incomeDetail = incomeDifferenceMinor === 0
    ? "Recorded income is unchanged from that comparison."
    : `Recorded income is ${input.formatMoney(Math.abs(incomeDifferenceMinor))} ${incomeDifferenceMinor > 0 ? "higher" : "lower"}.`;
  return {
    id: "season",
    label: `Compared with ${reference.label}`,
    value,
    detail: `${incomeDetail} This is a historical comparison, not a forecast.`,
    tone: spendDifferenceMinor > 0 ? "caution" : "positive"
  };
}

function buildConfidenceLane(input: {
  evaluated: boolean;
  mismatchCount: number;
  checkpointCount: number;
  unresolvedTransferCount: number;
}): FinancialDecisionMapLane {
  if (!input.evaluated) {
    return {
      id: "confidence",
      label: "Snapshot confidence",
      value: "Check the full month",
      detail: "This view does not load wallet reconciliation status. Use Summary or Month before relying on its cash-flow position for a spending decision.",
      tone: "default"
    };
  }
  const issues: string[] = [];
  if (input.mismatchCount) {
    issues.push(`${input.mismatchCount} wallet ${input.mismatchCount === 1 ? "has" : "have"} a statement mismatch`);
  }
  if (input.checkpointCount) {
    issues.push(`${input.checkpointCount} wallet ${input.checkpointCount === 1 ? "needs" : "need"} a statement checkpoint`);
  }
  if (input.unresolvedTransferCount) {
    issues.push(`${input.unresolvedTransferCount} transfer ${input.unresolvedTransferCount === 1 ? "is" : "are"} unresolved`);
  }
  if (issues.length) {
    return {
      id: "confidence",
      label: "Snapshot confidence",
      value: "Needs review",
      detail: `${joinWithAnd(issues)}. Treat the cash-flow position as provisional until those bank-record checks are resolved.`,
      tone: "caution"
    };
  }
  return {
    id: "confidence",
    label: "Snapshot confidence",
    value: "No visible proof gap",
    detail: "No reconciliation or transfer warning is visible for the wallets in this view. Continue importing and reconciling before relying on older periods.",
    tone: "positive"
  };
}

function buildRepeatLane(input: {
  incomeMinor: number;
  netMinor: number;
  topMerchantName: string;
  topMerchantMinor: number;
  formatMoney: (amountMinor: number) => string;
}): FinancialDecisionMapLane | null {
  if (input.incomeMinor <= 0 || input.topMerchantMinor <= 0 || input.topMerchantName === "No expense recorded") {
    return null;
  }
  const afterRepeatMinor = input.netMinor - input.topMerchantMinor;
  const value = afterRepeatMinor >= 0
    ? `${input.formatMoney(afterRepeatMinor)} after one repeat`
    : `${input.formatMoney(Math.abs(afterRepeatMinor))} deficit after one repeat`;
  return {
    id: "repeat",
    label: "One-repeat scenario",
    value,
    detail: `This is not a forecast. It shows the recorded cash-flow result if one more expense equal to ${input.topMerchantName} is added before other future commitments.`,
    tone: afterRepeatMinor < 0 ? "caution" : "default"
  };
}

function joinWithAnd(values: string[]) {
  if (values.length < 2) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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
  const tokens = template.match(/{{\s*[^}]+\s*}}/g) ?? [];
  return tokens.every((token) => Object.hasOwn(replacements, token.slice(2, -2).trim()));
}

function replaceTokens(template: string, replacements: Record<string, string | number>) {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => String(replacements[key.trim()] ?? ""));
}
