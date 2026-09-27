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
    ...HEADLINE,
    decisionMap: {
      enabled: true,
      needsReview: false,
      lanes: [{
        id: "surplus",
        label: "Money left so far",
        value: "$1,880.00",
        detail: "This is not automatically free cash.",
        tone: "positive"
      }]
    }
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

test("financial insight facts hold the computed totals and the map, with no generic advice lines", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 entries",
    records: [
      { entryType: "expense", amountMinor: 6_000, categoryName: "Food & Drinks", description: "Restaurant A" },
      { entryType: "expense", amountMinor: 2_000, categoryName: "Food & Drinks", description: "Restaurant B" },
      { entryType: "expense", amountMinor: 1_000, categoryName: "Transport", description: "Taxi" },
      { entryType: "income", amountMinor: 20_000, description: "Salary" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    perspective: "cash_flow"
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
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    perspective: "cash_flow"
  });
  assert.equal(facts.audienceKind, "person");
  assert.equal(facts.audienceName, "Tim");
  const workerSafeFacts = { ...facts, ...HEADLINE, audienceName: "[selected person]" };
  const template = "{{audienceName}}, {{fact}} {{think}}";
  assert.match(parseFinancialInsightTemplate({ template }, workerSafeFacts), /^\[selected person\], Subscriptions/);
  assert.equal(parseFinancialInsightTemplate({ template: "{{fact}} {{think}}" }, workerSafeFacts), null);
  assert.equal(parseFinancialInsightTemplate({ template: "{{audienceName}} and {{audienceName}}: {{fact}} {{think}}" }, workerSafeFacts), null);
});

test("more out than in shows in the map as a deficit, without generic spending advice", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 100_000, description: "Salary" },
      { entryType: "expense", amountMinor: 125_000, categoryName: "Food & Drinks", description: "Dining" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    perspective: "cash_flow"
  });

  const surplus = facts.decisionMap.lanes.find((lane) => lane.id === "surplus");
  assert.equal(surplus.value, "$250.00 deficit");
  assert.match(surplus.detail, /More money has gone out than come in/);
  assert.doesNotMatch(JSON.stringify(facts), /non-essential/);
});

test("money consequence map grounds surplus, plan, same-season, and proof gaps in computed evidence", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 200_000, description: "Salary" },
      { entryType: "expense", amountMinor: 75_000, categoryName: "Food & Drinks", description: "Dining" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
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
    perspective: "partial_view"
  });
  const splitFacts = buildFinancialInsightFacts({
    contextLabel: "Family group",
    records: [{ entryType: "expense", amountMinor: 1_000, categoryName: "Food & Drinks", description: "Lunch" }],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
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
    perspective: "split_obligation"
  });

  assert.deepEqual(facts.decisionMap.lanes.map((lane) => lane.value), ["Settlement obligations"]);
  assert.match(facts.decisionMap.lanes[0].detail, /not a household income, savings, or safe-to-spend calculation/);
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

test("with spending and no income, the map says income is not in this view, for a person and the household alike", () => {
  const records = [{ entryType: "expense", amountMinor: 4_000, categoryName: "Food & Drinks", description: "Dinner" }];
  for (const audience of [{ audienceKind: "person", audienceName: "Tim" }, { audienceKind: "household" }]) {
    const facts = buildFinancialInsightFacts({ contextLabel: "August 2026 month", ...audience, records, formatMoney: formatTestMoney, perspective: "cash_flow" });
    const surplus = facts.decisionMap.lanes.find((lane) => lane.id === "surplus");
    assert.equal(surplus.value, "Income not in this view");
    // The person's name never goes into any lane the AI sees.
    assert.doesNotMatch(JSON.stringify(facts.decisionMap), /Tim/);
  }
});

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

test("the money consequence map agrees nouns and verbs with each count", () => {
  const confidenceDetail = (confidence) => buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 100_000, description: "Salary" },
      { entryType: "expense", amountMinor: 20_000, categoryName: "Food & Drinks", description: "Groceries" }
    ],
    formatMoney: formatTestMoney,
    perspective: "cash_flow",
    decisionMapContext: { confidence: { evaluated: true, ...confidence } }
  }).decisionMap.lanes.find((lane) => lane.id === "confidence").detail;

  assert.match(
    confidenceDetail({ reconciliationMismatchCount: 2, needsCheckpointCount: 2, unresolvedTransferCount: 2 }),
    /^2 wallets have a statement mismatch, 2 wallets need a statement checkpoint,? and 2 transfers are unresolved\./
  );
  assert.match(
    confidenceDetail({ reconciliationMismatchCount: 1, needsCheckpointCount: 1, unresolvedTransferCount: 1 }),
    /^1 wallet has a statement mismatch, 1 wallet needs a statement checkpoint,? and 1 transfer is unresolved\./
  );
  assert.doesNotMatch(confidenceDetail({ needsCheckpointCount: 2 }), /2 wallet need/);
});

const PURCHASE_FACT = /purchase|three largest|\bpaid\b/i;

test("Summary category totals never read as purchases, payments or a repeatable expense", async () => {
  const { buildSummarySignals } = await import("../src/domain/money-signals/summary-signals.ts");
  const categoryTotals = [
    { entryType: "expense", amountMinor: 124_000, categoryName: "Groceries", description: "Groceries" },
    { entryType: "expense", amountMinor: 61_000, categoryName: "Dining", description: "Dining" },
    { entryType: "expense", amountMinor: 20_000, categoryName: "Transport", description: "Transport" },
    { entryType: "income", amountMinor: 500_000, description: "Recorded income" }
  ];
  for (const audience of [{ audienceKind: "household" }, { audienceKind: "person", audienceName: "Tim" }]) {
    const input = {
      contextLabel: "May 2026 summary",
      ...audience,
      records: categoryTotals,
      formatMoney: formatTestMoney,
      perspective: "cash_flow",
      recordKind: "category_totals"
    };
    const lanes = buildFinancialInsightFacts(input).decisionMap.lanes.map((lane) => lane.id);
    assert.deepEqual(lanes, ["surplus", "plan", "season", "confidence"]);
  }
  // The same records read as single entries do produce the one-repeat
  // scenario, so the guard is what removes it.
  const asEntries = { contextLabel: "May 2026 summary", records: categoryTotals, formatMoney: formatTestMoney, perspective: "cash_flow" };
  assert.ok(buildFinancialInsightFacts(asEntries).decisionMap.lanes.some((lane) => lane.id === "repeat"));

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
