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
  buildInterestingWeekdayPattern,
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
    notableFact: "The three largest expenses make up 75% of the spending in this list.",
    cashFlowPrinciple: "More money has gone out than come in so far.",
    nextSpendConsideration: "Before buying something non-essential, check the available budget.",
    accountingAdvice: "Review provisional entries before closing the month.",
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
  const insight = parseFinancialInsightTemplate({
    template: "{{notableFact}} {{contextLabel}} has {{entryCount}} entries with spending of {{spend}}. {{cashFlowPrinciple}} {{nextSpendConsideration}}"
  }, facts);

  assert.equal(insight, "The three largest expenses make up 75% of the spending in this list. August 2026 entries has 7 entries with spending of $120.00. More money has gone out than come in so far. Before buying something non-essential, check the available budget.");
  assert.equal(parseFinancialInsightTemplate({ template: "{{contextLabel}} is up 34%." }, facts), null);
  assert.match(buildDeterministicFinancialInsight(facts), /The three largest expenses make up 75% of the spending in this list/);
  assert.notEqual(buildFinancialInsightCacheKey(facts), buildFinancialInsightCacheKey({ ...facts, contextLabel: "Filtered entries" }));
});

test("financial insight uses plain deterministic wording from the current entries", () => {
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026 entries",
    records: [
      { entryType: "expense", amountMinor: 6_000, categoryName: "Food & Drinks", description: "Restaurant A" },
      { entryType: "expense", amountMinor: 2_000, categoryName: "Food & Drinks", description: "Restaurant B" },
      { entryType: "expense", amountMinor: 1_000, categoryName: "Transport", description: "Taxi" },
      { entryType: "income", amountMinor: 20_000, description: "Salary" }
    ],
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });

  assert.match(facts.notableFact, /Food & Drinks accounted for 89% of household spending|The largest household purchase was Restaurant A at \$60\.00|The three largest household purchases made up 100% of spending/);
  const narrative = buildDeterministicFinancialInsight(facts);
  assert.match(narrative, /^The household received \$200\.00 and spent \$90\.00/);
  assert.doesNotMatch(narrative, /Worth noticing:|A useful signal:|One entry pattern:|At a glance,/);
  assert.match(narrative, new RegExp(facts.notableFact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(narrative, buildDeterministicFinancialInsight(facts));
});

test("person check-ins use the selected name locally and recognize strong weekday patterns", () => {
  const records = [
    { entryType: "income", amountMinor: 300_000, description: "Salary", date: "2026-08-01" },
    { entryType: "expense", amountMinor: 1_200, categoryName: "Food & Drinks", description: "Lunch", date: "2026-08-03" },
    { entryType: "expense", amountMinor: 1_500, categoryName: "Food & Drinks", description: "Lunch", date: "2026-08-10" },
    { entryType: "expense", amountMinor: 1_800, categoryName: "Food & Drinks", description: "Lunch", date: "2026-08-17" }
  ];
  const facts = buildFinancialInsightFacts({
    contextLabel: "August 2026",
    audienceKind: "person",
    audienceName: "Tim",
    records,
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });

  assert.equal(
    buildInterestingWeekdayPattern(records, "person", "Tim"),
    "3 of your Food & Drinks purchases landed on Mondays."
  );
  assert.equal(buildInterestingWeekdayPattern(records.slice(0, 3), "person", "Tim"), null);
  assert.match(buildDeterministicFinancialInsight(facts), /^Tim, you received \$3000\.00 and spent \$45\.00/);
  const template = "{{audienceName}}, {{notableFact}} In {{contextLabel}}, {{cashFlowPrinciple}} {{nextSpendConsideration}}";
  const workerSafeFacts = { ...facts, audienceName: "[selected person]" };
  assert.match(parseFinancialInsightTemplate({ template }, workerSafeFacts), /^\[selected person\],/);
  assert.equal(
    parseFinancialInsightTemplate({ template: "{{notableFact}} {{contextLabel}} {{cashFlowPrinciple}} {{nextSpendConsideration}}" }, workerSafeFacts),
    null
  );
  assert.equal(
    parseFinancialInsightTemplate({ template: "{{audienceName}} and {{audienceName}}: {{notableFact}} {{contextLabel}} {{cashFlowPrinciple}} {{nextSpendConsideration}}" }, workerSafeFacts),
    null
  );
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

  assert.match(facts.cashFlowPrinciple, /More money has gone out than come in/);
  assert.match(facts.nextSpendConsideration, /buying something non-essential/);
  assert.match(buildDeterministicFinancialInsight(facts), /less left for savings/);
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

// Owner-approved copy fixes: a person view talks to the person, a Splits
// person view names their share, and counts agree with their nouns.
const formatTestMoney = (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`;

test("a person view with spending and no income asks whether you are saving; the household view keeps household wording", () => {
  const records = [{ entryType: "expense", amountMinor: 4_000, categoryName: "Food & Drinks", description: "Dinner" }];
  const personFacts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    audienceKind: "person",
    audienceName: "Tim",
    records,
    formatMoney: formatTestMoney,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });
  const householdFacts = buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records,
    formatMoney: formatTestMoney,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });

  assert.equal(personFacts.cashFlowPrinciple, "This list has spending but no income, so it cannot show whether you are saving.");
  assert.doesNotMatch(buildDeterministicFinancialInsight(personFacts), /household/);
  // The person's name never goes into the facts text the AI sees.
  assert.doesNotMatch(personFacts.cashFlowPrinciple, /Tim/);
  assert.equal(householdFacts.cashFlowPrinciple, "This list has spending but no income, so it cannot show whether the household is saving.");
});

// The notable fact is one of several candidates picked by a stable hash of
// the context, so the test walks context labels until the largest-item
// candidate is the one shown.
function findLargestItemFact(input) {
  for (let index = 0; index < 60; index += 1) {
    const facts = buildFinancialInsightFacts({ ...input, contextLabel: `${input.contextLabel} ${index}` });
    if (/largest (share|purchase|household purchase) was/.test(facts.notableFact)) {
      return facts;
    }
  }
  throw new Error("No context label picked the largest-item fact.");
}

test("a Splits person view names the largest share, not the largest purchase; other views keep their wording", () => {
  const records = [
    { entryType: "expense", amountMinor: 3_000, categoryName: "Travel", description: "Shinjuku hotel" },
    { entryType: "expense", amountMinor: 1_000, categoryName: "Food & Drinks", description: "Ramen" }
  ];
  const splitPerson = findLargestItemFact({
    contextLabel: "Tokyo trip group",
    audienceKind: "person",
    audienceName: "Tim",
    records,
    formatMoney: formatTestMoney,
    accountingAdvice: "Record the settlement.",
    perspective: "split_obligation"
  });
  assert.equal(splitPerson.notableFact, "Your largest share was Shinjuku hotel at $30.00.");

  const monthPerson = findLargestItemFact({
    contextLabel: "August 2026 month",
    audienceKind: "person",
    audienceName: "Tim",
    records,
    formatMoney: formatTestMoney,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  });
  assert.equal(monthPerson.notableFact, "Your largest purchase was Shinjuku hotel at $30.00.");

  const splitHousehold = findLargestItemFact({
    contextLabel: "Tokyo trip group",
    records,
    formatMoney: formatTestMoney,
    accountingAdvice: "Record the settlement.",
    perspective: "split_obligation"
  });
  assert.equal(splitHousehold.notableFact, "The largest household purchase was Shinjuku hotel at $30.00.");

  // The AI template still accepts the new wording as its notable fact.
  const template = "{{audienceName}}, {{notableFact}} In {{contextLabel}}, {{cashFlowPrinciple}} {{nextSpendConsideration}}";
  assert.match(
    parseFinancialInsightTemplate({ template }, { ...splitPerson, audienceName: "[selected person]" }),
    /Your largest share was Shinjuku hotel at \$30\.00\./
  );
});

test("the money consequence map agrees nouns and verbs with each count", () => {
  const confidenceDetail = (confidence) => buildFinancialInsightFacts({
    contextLabel: "August 2026 month",
    records: [
      { entryType: "income", amountMinor: 100_000, description: "Salary" },
      { entryType: "expense", amountMinor: 20_000, categoryName: "Food & Drinks", description: "Groceries" }
    ],
    formatMoney: formatTestMoney,
    accountingAdvice: "Check the bank record.",
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

// Every notable fact a set of records can produce: the pick is a stable hash
// of the context, so walking context labels reaches each candidate.
function allNotableFacts(input) {
  const facts = new Set();
  for (let index = 0; index < 80; index += 1) {
    facts.add(buildFinancialInsightFacts({ ...input, contextLabel: `${input.contextLabel} ${index}` }).notableFact);
  }
  return [...facts];
}

const PURCHASE_FACT = /largest (household )?purchase|three largest|\bpaid\b/;

test("Summary category totals never read as purchases, payments or a repeatable expense", () => {
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
      accountingAdvice: "Keep the plan current.",
      perspective: "cash_flow",
      recordKind: "category_totals"
    };
    const facts = allNotableFacts(input);
    assert.deepEqual(facts, [audience.audienceKind === "person"
      ? "Your Groceries spending accounted for 60% of what you spent."
      : "Groceries accounted for 60% of household spending."]);
    const lanes = buildFinancialInsightFacts(input).decisionMap.lanes.map((lane) => lane.id);
    assert.deepEqual(lanes, ["surplus", "plan", "season", "confidence"]);
  }

  // The same records read as single entries do produce the purchase facts
  // and the one-repeat scenario, so the guard is what removes them.
  const asEntries = {
    contextLabel: "May 2026 summary",
    records: categoryTotals,
    formatMoney: formatTestMoney,
    accountingAdvice: "Keep the plan current.",
    perspective: "cash_flow"
  };
  assert.ok(allNotableFacts(asEntries).some((fact) => PURCHASE_FACT.test(fact)));
  assert.ok(buildFinancialInsightFacts(asEntries).decisionMap.lanes.some((lane) => lane.id === "repeat"));
});

test("a person view with shares never says they paid; the largest item names a share only when it is one", () => {
  const direct = (description, amountMinor) => ({ entryType: "expense", amountMinor, categoryName: "Dining", description, ownershipType: "direct" });
  const base = {
    contextLabel: "October 2025 month",
    audienceKind: "person",
    audienceName: "Tim",
    formatMoney: formatTestMoney,
    accountingAdvice: "Keep the bank record current.",
    perspective: "cash_flow"
  };
  // Joyce paid the dinner; Tim's half is linked from a split.
  const dinnerShare = { entryType: "expense", amountMinor: 35_659, totalAmountMinor: 71_319, linkedSplitExpenseId: "split-dining", categoryName: "Dining", description: "Anniversary dinner" };
  const utilitiesShare = { entryType: "expense", amountMinor: 4_000, totalAmountMinor: 10_000, ownershipType: "shared", categoryName: "Utilities", description: "SP Group" };

  const withShareLargest = allNotableFacts({ ...base, records: [dinnerShare, utilitiesShare, direct("Kopitiam", 800), direct("Kopitiam", 700)] });
  assert.ok(withShareLargest.includes("Your largest share was Anniversary dinner at $356.59."));
  assert.ok(withShareLargest.every((fact) => !PURCHASE_FACT.test(fact)), withShareLargest.join(" | "));

  const withDirectLargest = allNotableFacts({ ...base, records: [direct("Laptop", 150_000), utilitiesShare, direct("Kopitiam", 800), direct("Kopitiam", 700)] });
  assert.ok(withDirectLargest.includes("Your largest purchase was Laptop at $1500.00."));
  assert.ok(withDirectLargest.every((fact) => !/three largest|\bpaid\b/.test(fact)), withDirectLargest.join(" | "));

  // Only their own direct entries: the purchase and payment facts stay.
  const directOnly = allNotableFacts({ ...base, records: [direct("Laptop", 150_000), direct("Kopitiam", 800), direct("Kopitiam", 700)] });
  assert.ok(directOnly.includes("You paid Kopitiam 2 times."));
  assert.ok(directOnly.includes("Your three largest purchases made up 100% of what you spent."));

  // A Splits person view is always shares, even without share markers.
  const splitPerson = allNotableFacts({ ...base, perspective: "split_obligation", records: [direct("Grab", 2_000), direct("Grab", 1_500), direct("Hotel", 30_000)] });
  assert.ok(splitPerson.includes("Your largest share was Hotel at $300.00."));
  assert.ok(splitPerson.every((fact) => !PURCHASE_FACT.test(fact)), splitPerson.join(" | "));

  // The household keeps its wording: its amounts are whole entries.
  const household = allNotableFacts({ ...base, audienceKind: "household", audienceName: "", records: [dinnerShare, direct("Kopitiam", 800), direct("Kopitiam", 700)] });
  assert.ok(household.includes("Kopitiam was paid 2 times by the household."));
});
