import assert from "node:assert/strict";
import test from "node:test";

import {
  cosineSimilarity,
  redactAiStatementText,
  redactAiText,
  runAiJson
} from "../src/domain/ai-assistance.ts";
import {
  buildDeterministicImportExplanation,
  buildDeterministicMonthlyNarrative,
  parseImportExplanationTemplate,
  parseNarrativeTemplate
} from "../src/domain/ai-assistance-insights.ts";

test("AI payload redaction removes long account-like numbers and bounds the text", () => {
  const result = redactAiText("  CARD 5000000000006349\nPAYMENT  ", 24);

  assert.match(result, /^CARD \[redacted-number\]/);
  assert.ok(result.length <= 24);
});

test("statement fallback redacts account-labelled values before optional inference", () => {
  const result = redactAiStatementText("Account Number: 1234567\nCARD 5000000000006349\nMERCHANT 8.50");

  assert.doesNotMatch(result, /1234567|5000000000006349/);
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

test("the insights module no longer exports a map builder", async () => {
  const insights = await import("../src/domain/ai-assistance-insights.ts");
  assert.deepEqual(Object.keys(insights).filter((name) => /map|lane|decision/i.test(name)), []);
});

// Money insights headlines use computed wording only: the module that
// builds AI prompts and templates has nothing for them any more.
test("the insights module has no Money insights wording builders", async () => {
  const insights = await import("../src/domain/ai-assistance-insights.ts");
  assert.deepEqual(Object.keys(insights).filter((name) => /FinancialInsight|CheckInHeadline/i.test(name)), []);
  assert.deepEqual(Object.keys(insights).sort(), [
    "buildDeterministicImportExplanation",
    "buildDeterministicMonthlyNarrative",
    "buildImportExplanationFacts",
    "buildMonthlyNarrativeFacts",
    "parseImportExplanationTemplate",
    "parseNarrativeTemplate"
  ]);
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
