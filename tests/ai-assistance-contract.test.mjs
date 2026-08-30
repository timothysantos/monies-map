import assert from "node:assert/strict";
import test from "node:test";

import {
  cosineSimilarity,
  redactAiStatementText,
  redactAiText,
  runAiJson
} from "../src/domain/ai-assistance.ts";
import {
  buildDeterministicFinancialInsight,
  buildFinancialInsightFacts,
  buildDeterministicImportExplanation,
  buildFinancialInsightCacheKey,
  buildDeterministicMonthlyNarrative,
  parseFinancialInsightTemplate,
  parseImportExplanationTemplate,
  parseNarrativeTemplate
} from "../src/domain/ai-assistance-insights.ts";

test("AI payload redaction removes long account-like numbers and bounds the text", () => {
  const result = redactAiText("  CARD 5425503003296349\nPAYMENT  ", 24);

  assert.match(result, /^CARD \[redacted-number\]/);
  assert.ok(result.length <= 24);
});

test("statement fallback redacts account-labelled values before optional inference", () => {
  const result = redactAiStatementText("Account Number: 1234567\nCARD 5425503003296349\nMERCHANT 8.50");

  assert.doesNotMatch(result, /1234567|5425503003296349/);
  assert.match(result, /MERCHANT 8\.50/);
});

test("monthly AI prose can only render server-provided financial placeholders", () => {
  const facts = {
    monthName: "August 2026",
    spend: "$120.00",
    income: "$2,000.00",
    topCategoryName: "Food & Drinks",
    topCategoryAmount: "$50.00",
    topMerchantName: "Cold Storage",
    topMerchantAmount: "$20.00"
  };

  const narrative = parseNarrativeTemplate({
    template: "{{monthName}} spending was {{spend}}. {{topCategoryName}} was the largest category at {{topCategoryAmount}}."
  }, facts);

  assert.equal(narrative, "August 2026 spending was $120.00. Food & Drinks was the largest category at $50.00.");
  assert.equal(parseNarrativeTemplate({ template: "{{monthName}} spending rose 34%." }, facts), null);
  assert.equal(buildDeterministicMonthlyNarrative(facts).includes("$120.00"), true);
});

test("view insights substitute computed facts and reject model-supplied figures", () => {
  const facts = {
    contextLabel: "August 2026 entries",
    entryCount: 7,
    spend: "$120.00",
    income: "$2,000.00",
    net: "$1,880.00",
    topCategoryName: "Food & Drinks",
    topCategoryAmount: "$50.00",
    topMerchantName: "Cold Storage",
    topMerchantAmount: "$20.00",
    cashFlowPrinciple: "Recorded spending is higher than recorded income in this view.",
    nextSpendConsideration: "Before the next discretionary spend, check the available budget.",
    accountingAdvice: "Review provisional entries before closing the month.",
    decisionMap: {
      enabled: true,
      needsReview: false,
      lanes: [{
        id: "surplus",
        label: "Recorded surplus",
        value: "$1,880.00",
        detail: "This is not automatically free cash.",
        tone: "positive"
      }]
    }
  };
  const insight = parseFinancialInsightTemplate({
    template: "{{contextLabel}} has {{entryCount}} entries with spending of {{spend}}. {{cashFlowPrinciple}} {{nextSpendConsideration}}"
  }, facts);

  assert.equal(insight, "August 2026 entries has 7 entries with spending of $120.00. Recorded spending is higher than recorded income in this view. Before the next discretionary spend, check the available budget.");
  assert.equal(parseFinancialInsightTemplate({ template: "{{contextLabel}} is up 34%." }, facts), null);
  assert.match(buildDeterministicFinancialInsight(facts), /Food & Drinks/);
  assert.notEqual(buildFinancialInsightCacheKey(facts), buildFinancialInsightCacheKey({ ...facts, contextLabel: "Filtered entries" }));
});

test("financial insight converts computed cash flow into conservative next-spend guidance", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 100_000, description: "Salary" },
      { entryType: "expense", amountMinor: 125_000, categoryName: "Food & Drinks", description: "Dining" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });

  assert.match(facts.cashFlowPrinciple, /higher than recorded income/);
  assert.match(facts.nextSpendConsideration, /next discretionary spend/);
  assert.match(buildDeterministicFinancialInsight(facts), /reduces cash available for savings/);
});

test("money consequence map grounds surplus, plan, same-season, and proof gaps in computed evidence", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 200_000, description: "Salary" },
      { entryType: "expense", amountMinor: 75_000, categoryName: "Food & Drinks", description: "Dining" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow",
    decisionMapContext: {
      plannedSpendMinor: 50_000,
      sameSeason: {
        label: "August 2025",
        spendMinor: 60_000,
        incomeMinor: 190_000
      },
      confidence: {
        evaluated: true,
        reconciliationMismatchCount: 1,
        unresolvedTransferCount: 2
      }
    }
  });

  assert.equal(facts.decisionMap.needsReview, true);
  assert.deepEqual(
    facts.decisionMap.lanes.map((lane) => [lane.id, lane.value]),
    [
      ["surplus", "$1250.00"],
      ["plan", "$250.00 over plan"],
      ["season", "$150.00 more spending"],
      ["confidence", "Needs review"],
      ["repeat", "$500.00 after one repeat"]
    ]
  );
  assert.match(facts.decisionMap.lanes.find((lane) => lane.id === "confidence").detail, /statement mismatch/);
  assert.match(facts.decisionMap.lanes.find((lane) => lane.id === "repeat").detail, /not a forecast/);
});

test("money consequence map does not infer cash confidence from filtered or split views", () => {
  const filteredFacts = buildFinancialInsightFacts({
    contextLabel: "Filtered August entries",
    records: [{ entryType: "expense", amountMinor: 1_000, categoryName: "Food & Drinks", description: "Lunch" }],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Check the full month.",
    perspective: "partial_view"
  });
  const splitFacts = buildFinancialInsightFacts({
    contextLabel: "Family group",
    records: [{ entryType: "expense", amountMinor: 1_000, categoryName: "Food & Drinks", description: "Lunch" }],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Record the settlement.",
    perspective: "split_obligation"
  });

  assert.equal(filteredFacts.decisionMap.lanes[0].value, "Investigation evidence");
  assert.match(filteredFacts.decisionMap.lanes[0].detail, /cannot determine whole-month savings/);
  assert.equal(splitFacts.decisionMap.lanes[0].value, "Settlement obligations");
  assert.match(splitFacts.decisionMap.lanes[0].detail, /not a household income/);
});

test("money consequence map leaves bank confidence unevaluated when wallet evidence has not loaded", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 100_000, description: "Salary" },
      { entryType: "expense", amountMinor: 20_000, categoryName: "Food & Drinks", description: "Groceries" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Check the bank record.",
    perspective: "cash_flow",
    decisionMapContext: {
      confidence: { evaluated: false }
    }
  });

  const confidence = facts.decisionMap.lanes.find((lane) => lane.id === "confidence");
  assert.equal(facts.decisionMap.needsReview, false);
  assert.equal(confidence.value, "Check the full month");
  assert.match(confidence.detail, /does not load wallet reconciliation status/);
});

test("split insight never presents group obligations as household savings", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "Family group",
    records: [{ entryType: "expense", amountMinor: 1_000, categoryName: "Food & Drinks", description: "Lunch" }],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Record the settlement when it happens.",
    perspective: "split_obligation"
  });

  assert.match(facts.cashFlowPrinciple, /do not measure household income or savings/);
  assert.match(facts.nextSpendConsideration, /payer, group, and expected settlement/);
});

test("import explanation refuses model-supplied numeric claims and keeps deterministic evidence", () => {
  const facts = {
    accountName: "UOB One Card - Tim",
    statementMonth: "August 2026",
    difference: "$26.00",
    cause: "a post-date timing difference",
    ledgerRows: 1,
    statementRows: 4
  };

  const explanation = parseImportExplanationTemplate({
    template: "Check {{accountName}} for {{statementMonth}}. Start with {{cause}}."
  }, facts);
  assert.equal(explanation, "Check UOB One Card - Tim for August 2026. Start with a post-date timing difference.");
  assert.equal(parseImportExplanationTemplate({ template: "The difference is $26.00." }, facts), null);
  assert.match(buildDeterministicImportExplanation(facts), /ledger row/);
});

test("embedding similarity stays advisory and is mathematically bounded", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
});

test("disabled or unconfigured AI never touches the database or breaks the caller", async () => {
  const result = await runAiJson(null, { AI_ASSIST_ENABLED: "true" }, {
    capability: "monthly_narrative",
    units: 1,
    prompt: "unused",
    maxTokens: 20,
    parse: () => "unused"
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /not configured/);
});

test("a provider failure becomes an unavailable suggestion after the bounded allowance check", async () => {
  let usageUnits = 0;
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async run() {
              usageUnits += 1;
              return { meta: { changes: 1 } };
            },
            async first() {
              return { used_units: usageUnits };
            }
          };
        }
      };
    }
  };
  const result = await runAiJson(db, {
    AI_ASSIST_ENABLED: "true",
    AI: { run: async () => { throw new Error("provider unavailable"); } }
  }, {
    capability: "monthly_narrative",
    units: 1,
    prompt: "unused",
    maxTokens: 20,
    parse: () => "unused"
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /temporarily unavailable/);
  assert.equal(usageUnits, 1);
});
