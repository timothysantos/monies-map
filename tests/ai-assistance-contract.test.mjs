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

const HEADLINE = {
  headlineKind: "worth_a_look",
  fact: "Subscriptions came to $76.09 in August, about $913 a year.",
  think: "Automatic payments are easy to stop noticing. Judge each one by its yearly cost."
};

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
    ...HEADLINE
  };
  const insight = parseFinancialInsightTemplate({ template: "In {{contextLabel}}: {{fact}} {{think}}" }, facts);

  assert.equal(insight, "In August 2026 entries: Subscriptions came to $76.09 in August, about $913 a year. Automatic payments are easy to stop noticing. Judge each one by its yearly cost.");
  // Figures of its own, a missing or repeated fact or think line, and
  // placeholders that no longer exist are all refused.
  for (const template of [
    "{{contextLabel}} is up 34%. {{fact}} {{think}}",
    "{{think}}",
    "{{fact}}",
    "{{fact}} {{fact}} {{think}}",
    "{{notableFact}} {{fact}} {{think}}",
    "{{fact}} {{cashFlowPrinciple}} {{think}}",
    "{{spend}} {{fact}} {{think}}"
  ]) {
    assert.equal(parseFinancialInsightTemplate({ template }, facts), null, template);
  }
  assert.equal(buildDeterministicFinancialInsight(HEADLINE), `${HEADLINE.fact} ${HEADLINE.think}`);
  assert.notEqual(buildFinancialInsightCacheKey(facts, HEADLINE), buildFinancialInsightCacheKey({ ...facts, contextLabel: "Filtered entries" }, HEADLINE));
  assert.notEqual(buildFinancialInsightCacheKey(facts, HEADLINE), buildFinancialInsightCacheKey(facts, { ...HEADLINE, fact: "$913 a year goes to subscriptions. Still using all of them?" }));
});

test("AI wording around the fact must pass the check-in's tone rules", () => {
  const facts = { contextLabel: "August 2026", audienceKind: "household", audienceName: "", ...HEADLINE };
  assert.match(parseFinancialInsightTemplate({ template: "Something small to notice: {{fact}} {{think}}" }, facts), /^Something small to notice: Subscriptions/);
  for (const template of [
    "You should look again. {{fact}} {{think}}",
    "Warning: {{fact}} {{think}}",
    "Nice work! {{fact}} {{think}}",
    "{{fact}} Time to cut back. {{think}}",
    "A problem: {{fact}} {{think}}"
  ]) {
    assert.equal(parseFinancialInsightTemplate({ template }, facts), null, template);
  }
});

test("financial insight facts hold the computed totals, with no generic advice lines", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 entries",
    records: [
      { entryType: "expense", amountMinor: 6_000, categoryName: "Food & Drinks", description: "Restaurant A" },
      { entryType: "expense", amountMinor: 2_000, categoryName: "Food & Drinks", description: "Restaurant B" },
      { entryType: "expense", amountMinor: 1_000, categoryName: "Transport", description: "Taxi" },
      { entryType: "income", amountMinor: 20_000, description: "Salary" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`
  });

  assert.deepEqual(
    [facts.spend, facts.income, facts.net, facts.topCategoryName, facts.topCategoryAmount, facts.topMerchantName, facts.topMerchantAmount],
    ["$90.00", "$200.00", "$110.00", "Food & Drinks", "$80.00", "Restaurant A", "$60.00"]
  );
  // The old trivia pool and "Before buying something non-essential" lines are gone.
  for (const removed of ["notableFact", "cashFlowPrinciple", "nextSpendConsideration", "accountingAdvice"]) {
    assert.equal(Object.hasOwn(facts, removed), false, removed);
  }
  assert.doesNotMatch(JSON.stringify(facts), /non-essential|Before buying/);
});

test("a person's AI wording names the person once through a placeholder, never in the facts", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026",
    audienceKind: "person",
    audienceName: "Tim",
    records: [{ entryType: "expense", amountMinor: 1_200, categoryName: "Food & Drinks", description: "Lunch", date: "2026-08-03" }],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`
  });
  assert.equal(facts.audienceKind, "person");
  assert.equal(facts.audienceName, "Tim");
  const workerSafeFacts = { ...facts, ...HEADLINE, audienceName: "[selected person]" };
  const template = "{{audienceName}}, {{fact}} {{think}}";
  assert.match(parseFinancialInsightTemplate({ template }, workerSafeFacts), /^\[selected person\], Subscriptions/);
  assert.equal(parseFinancialInsightTemplate({ template: "{{fact}} {{think}}" }, workerSafeFacts), null);
  assert.equal(parseFinancialInsightTemplate({ template: "{{audienceName}} and {{audienceName}}: {{fact}} {{think}}" }, workerSafeFacts), null);
});

// The Money consequence map is retired: the facts carry the totals the AI
// wording and the check-in read, and nothing that projects, scores or
// forecasts (no lanes, no one-repeat scenario, no bank-confidence verdict).
test("financial insight facts carry no consequence map, scenario or forecast in any view", () => {
  const records = [
    { entryType: "income", amountMinor: 100_000, description: "Salary" },
    { entryType: "expense", amountMinor: 125_000, categoryName: "Food & Drinks", description: "Dining" }
  ];
  const expected = ["contextLabel", "audienceKind", "audienceName", "entryCount", "spend", "income", "net", "topCategoryName", "topCategoryAmount", "topMerchantName", "topMerchantAmount"];
  // Old callers' map inputs (a perspective, a plan, wallet confidence) are
  // ignored rather than turned into lanes.
  for (const extra of [{}, { recordKind: "category_totals" }, { perspective: "split_obligation", decisionMapContext: { plannedSpendMinor: 50_000, confidence: { evaluated: true, reconciliationMismatchCount: 1 } } }]) {
    const facts = buildFinancialInsightFacts({ contextLabel: "August 2026 month", records, formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`, ...extra });
    assert.deepEqual(Object.keys(facts), expected);
    assert.equal(facts.net, "$-250.00");
    assert.doesNotMatch(JSON.stringify(facts), /deficit|repeat|forecast|safe-to-spend|lanes|Needs review|proof gap/i);
  }
});

test("the insights module no longer exports a map builder", async () => {
  const insights = await import("../src/domain/ai-assistance-insights.ts");
  assert.deepEqual(Object.keys(insights).filter((name) => /map|lane|decision/i.test(name)), []);
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

// Owner-approved copy fixes: a person view talks to the person, a Splits
// person view names their share, and counts agree with their nouns.
const formatTestMoney = (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`;

test("a Splits person view's check-in counts shares and says who owes whom, never who bought what", async () => {
  const { buildSplitsSignals } = await import("../src/domain/money-signals/splits-signals.ts");
  const signals = buildSplitsSignals({
    audience: "person",
    viewId: "person-tim",
    viewLabel: "Tim",
    people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    group: { id: "tokyo", name: "Tokyo trip", balanceMinor: 900_000 },
    activity: [
      { kind: "expense", date: "2026-05-12", description: "Shinjuku hotel", totalAmountMinor: 1_200_000, paidByPersonName: "Tim" },
      { kind: "expense", date: "2026-05-13", description: "Ramen", totalAmountMinor: 300_000, paidByPersonName: "Joyce" }
    ],
    pendingMatchCount: 0,
    today: "2026-05-20",
    formatMoney: formatTestMoney
  });
  const copy = signals.flatMap((signal) => signal.phrasings.map((phrasing) => phrasing.fact));
  assert.ok(copy.includes("Joyce owes you $9000.00 from the Tokyo trip."), copy.join(" | "));
  assert.ok(copy.every((line) => !/purchase/i.test(line)), copy.join(" | "));
});

const PURCHASE_FACT = /purchase|three largest|\bpaid\b/i;

test("Summary's signals never read category totals as purchases or payments", async () => {
  const { buildSummarySignals } = await import("../src/domain/money-signals/summary-signals.ts");
  const categoryTotals = [
    { entryType: "expense", amountMinor: 124_000, categoryName: "Groceries", description: "Groceries" },
    { entryType: "expense", amountMinor: 61_000, categoryName: "Dining", description: "Dining" },
    { entryType: "expense", amountMinor: 20_000, categoryName: "Transport", description: "Transport" },
    { entryType: "income", amountMinor: 500_000, description: "Recorded income" }
  ];
  // Summary's signals speak of categories and months, never of purchases.
  const months = ["2026-02", "2026-03", "2026-04", "2026-05"].map((month) => ({ month, actualIncomeMinor: 500_000, realExpensesMinor: 205_000, estimatedExpensesMinor: 300_000 }));
  const signals = buildSummarySignals({
    audience: "person",
    viewLabel: "Tim",
    today: "2026-06-10",
    focusMonth: "2026-05",
    months,
    categoryShareByMonth: months.map(({ month }) => ({ month, data: categoryTotals.filter((item) => item.entryType === "expense").map((item) => ({ label: item.categoryName, valueMinor: item.amountMinor, entryCount: 3 })) })),
    accountPills: [],
    accountKinds: {},
    availableMonths: months.map(({ month }) => month),
    formatMoney: formatTestMoney
  });
  const copy = signals.flatMap((signal) => signal.phrasings.map((phrasing) => phrasing.fact));
  assert.ok(copy.length > 0);
  assert.ok(copy.every((line) => !PURCHASE_FACT.test(line)), copy.join(" | "));
});
