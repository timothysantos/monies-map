import assert from "node:assert/strict";
import test from "node:test";

import { splitMoneyUse } from "../src/client/money-jobs-model.js";
import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";

// Amounts are minor units (cents). The model reuses the lead's own figures,
// split by splitMoneyUse (money filed under Investments and Savings is moved,
// not spent).
const build = (raw, options = {}) => buildSavingsBarModel({ figures: splitMoneyUse(raw), ...options });
const rounded = (value) => Number(value.toFixed(4));
// The always-visible legend's figures per part (the bar has no popover).
const legends = (model) => model.segments.map(({ legend }) => [legend.name, legend.amount, legend.percent]);
const shape = (model) => model.segments.map(({ key, tone, widthPercent, hatched }) => ({ key, tone, widthPercent: rounded(widthPercent), hatched }));
const noFormatting = () => { throw new Error("hidden money must not be formatted"); };

test("a normal saving: spent and kept share the income bar and the sentence says what was kept", () => {
  const model = build({ incomeMinor: 24_700_000, spentMinor: 20_900_000, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000 });
  assert.deepEqual(shape(model), [
    { key: "spent", tone: "short", widthPercent: 84.6154, hatched: false },
    { key: "kept", tone: "in", widthPercent: 15.3846, hatched: false }
  ]);
  assert.equal(model.tickPercent, null);
  assert.deepEqual(legends(model), [
    ["Spent", "$209,000", 85],
    ["Kept", "$38,000", 15]
  ]);
  assert.equal(model.sentence, "You kept $38,000 of the $247,000 you earned (15%)");
  // Without investing the sentence already fits a phone line.
  assert.equal(model.shortSentence, model.sentence);
  // The planned spend leaves out the savings target, which follows it: here
  // the spend plan alone ($247,673) is longer than the income bar.
  assert.deepEqual({ spend: model.plan.spendPercent, invest: model.plan.investPercent, save: model.plan.savePercent }, { spend: 100, invest: 0, save: 0 });
});

test("investments: the bar says invested as its own part, and the sentence says what was kept and invested", () => {
  const model = build({
    incomeMinor: 24_700_000,
    // The lead's spend counts the $8,000 filed under Investments.
    spentMinor: 23_500_000,
    investedMinor: 800_000,
    plannedSpendMinor: 24_000_000,
    savingsTargetMinor: 1_000_000,
    plannedInvestMinor: 1_000_000
  });
  assert.deepEqual(shape(model), [
    { key: "spent", tone: "short", widthPercent: 91.9028, hatched: false },
    { key: "invested", tone: "in", widthPercent: 3.2389, hatched: false },
    { key: "kept", tone: "in", widthPercent: 4.8583, hatched: false }
  ]);
  assert.deepEqual(legends(model), [
    ["Spent", "$227,000", 92],
    ["Invested", "$8,000", 3],
    ["Kept", "$12,000", 5]
  ]);
  // The plan bar is named in the legend: spend $220,000, invest $10,000, keep $10,000.
  assert.equal(model.planLegend, "Plan: spend $220,000 · invest $10,000 · keep $10,000");
  assert.equal(model.sentence, "You kept $12,000 and invested $8,000 of the $247,000 you earned");
  // On a phone the same facts fit one line, so the Month card stays at most 205 px.
  assert.equal(model.shortSentence, "Kept $12,000 · invested $8,000 of $247,000");
  // Plan: spend $220,000, invest $10,000, save $10,000 on the $247,000 scale.
  assert.deepEqual({ spend: rounded(model.plan.spendPercent), invest: rounded(model.plan.investPercent), save: rounded(model.plan.savePercent) }, { spend: 89.0688, invest: 4.0486, save: 4.0486 });
});

test("money filed under Savings was kept, not spent", () => {
  const model = build({ incomeMinor: 1_000_000, spentMinor: 700_000, investedMinor: 100_000, savedMovedMinor: 180_000 });
  assert.deepEqual(model.segments.map(({ key, legend }) => [key, legend.name, legend.amount, legend.percent]), [
    ["spent", "Spent", "$4,200", 42],
    ["invested", "Invested", "$1,000", 10],
    ["kept", "Kept", "$4,800", 48]
  ]);
  assert.equal(model.sentence, "You kept $4,800 and invested $1,000 of the $10,000 you earned");
});

test("spent plus invested plus kept always adds to 100, even when the shares round half up", () => {
  // 14.5% kept would round to 15 and 85.5% spent to 86; they must not make 101.
  const model = build({ incomeMinor: 20_000, spentMinor: 17_100 });
  assert.deepEqual(model.segments.map((segment) => segment.legend.percent), [85, 15]);
});

test("the plan bar is on the income scale: planned spend, then the investment goal, then the savings goal, cut at the bar's end", () => {
  const fits = build({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 70_000, savingsTargetMinor: 20_000 });
  assert.deepEqual(fits.plan, { spendPercent: 50, investPercent: 0, savePercent: 20 });

  // Spend $500 + invest $300 + save $500 is more than the $1,000 earned.
  const tooBig = build({ incomeMinor: 100_000, spentMinor: 60_000, plannedSpendMinor: 130_000, savingsTargetMinor: 50_000, plannedInvestMinor: 30_000 });
  assert.deepEqual(tooBig.plan, { spendPercent: 50, investPercent: 30, savePercent: 20 });

  assert.equal(build({ incomeMinor: 100_000, spentMinor: 1 }).plan, null);
  // The legend names the thin bar, with the plan's own figures (uncut) and only the goals that exist.
  assert.equal(fits.planLegend, "Plan: spend $500 · keep $200");
  assert.equal(tooBig.planLegend, "Plan: spend $500 · invest $300 · keep $500");
  assert.equal(build({ incomeMinor: 100_000, spentMinor: 1 }).planLegend, null);
});

test("overspent beyond income: no kept part, an income tick, and the hatched part came out of savings", () => {
  const model = build({ incomeMinor: 24_700_000, spentMinor: 30_187_100, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000 });
  assert.deepEqual(shape(model), [
    { key: "spent", tone: "short", widthPercent: 81.823, hatched: false },
    { key: "savings", tone: "short", widthPercent: 18.177, hatched: true }
  ]);
  assert.equal(rounded(model.tickPercent), 81.823);
  assert.deepEqual(legends(model), [
    ["Spent", "$301,871", 122],
    ["From savings", "$54,871", 22]
  ]);
  // The tick says what it marks in plain words, with the figure; the bar part keeps its full name for readers.
  assert.equal(model.tickLabel, "All you earned");
  assert.equal(model.tickLabelWithAmount, "All you earned $247,000");
  assert.equal(model.segments[1].name, "Came out of savings");
  assert.equal(model.planLegend, "Plan: spend $247,673 · keep $41,300");
  assert.equal(model.sentence, "You spent $54,871 more than you earned");
  // The plan shares the longer scale (the spending): $247,673 and $41,300.
  assert.deepEqual({ spend: rounded(model.plan.spendPercent), save: rounded(model.plan.savePercent) }, { spend: 82.046, save: 13.6813 });
});

test("overspent and invested: the investing after the hatched part, and the sentence names both", () => {
  const model = build({ incomeMinor: 100_000, spentMinor: 150_000, investedMinor: 20_000 });
  assert.deepEqual(shape(model), [
    { key: "spent", tone: "short", widthPercent: 66.6667, hatched: false },
    { key: "savings", tone: "short", widthPercent: 20, hatched: true },
    { key: "invested", tone: "in", widthPercent: 13.3333, hatched: false }
  ]);
  assert.equal(rounded(model.tickPercent), 66.6667);
  assert.deepEqual(legends(model), [
    ["Spent", "$1,300", 130],
    ["From savings", "$300", 30],
    ["Invested", "$200", 20]
  ]);
  assert.equal(model.sentence, "You spent $300 more than you earned, and invested $200");
  assert.equal(model.shortSentence, "Spent $300 over income · invested $200");
});

test("investing more than spending left: the tick falls in the invested part and nothing is hatched", () => {
  const model = build({ incomeMinor: 100_000, spentMinor: 130_000, investedMinor: 50_000 });
  assert.deepEqual(shape(model), [
    { key: "spent", tone: "short", widthPercent: 61.5385, hatched: false },
    { key: "invested", tone: "in", widthPercent: 38.4615, hatched: false }
  ]);
  assert.equal(rounded(model.tickPercent), 76.9231);
  assert.equal(model.sentence, "You invested $500, $300 of it from savings");
  assert.equal(model.tickLabelWithAmount, "All you earned $1,000");
});

test("spending exactly the income keeps nothing and is not overspent", () => {
  const model = build({ incomeMinor: 50_000, spentMinor: 50_000 });
  assert.deepEqual(model.segments.map((segment) => [segment.key, segment.widthPercent]), [["spent", 100]]);
  assert.equal(model.tickPercent, null);
  assert.equal(model.tickLabel, null);
  assert.equal(model.sentence, "You kept $0 of the $500 you earned (0%)");
});

test("nothing spent keeps all of the income", () => {
  const model = build({ incomeMinor: 50_000, spentMinor: 0 });
  assert.deepEqual(model.segments.map((segment) => [segment.key, segment.widthPercent]), [["kept", 100]]);
  assert.equal(model.sentence, "You kept $500 of the $500 you earned (100%)");
});

test("zero income with spending: the whole bar is hatched, with no tick and no percent of income", () => {
  const model = build({ incomeMinor: 0, spentMinor: 12_345, plannedSpendMinor: 10_000 });
  assert.deepEqual(model.segments.map(({ key, hatched, widthPercent, legend }) => ({ key, hatched, widthPercent, legend })), [
    { key: "savings", hatched: true, widthPercent: 100, legend: { name: "From savings", amount: "$123", percent: null } }
  ]);
  assert.equal(model.tickPercent, null);
  assert.equal(model.sentence, "You spent $123 more than you earned");
});

test("no income and nothing out, or a refund-only period, draws nothing", () => {
  assert.equal(build({ incomeMinor: 0, spentMinor: 0, plannedSpendMinor: 5_000 }), null);
  assert.equal(build({ incomeMinor: -500, spentMinor: -300 }), null);
  // Money moved to savings with nothing earned and nothing spent is not drawn as spending.
  assert.equal(build({ incomeMinor: 0, spentMinor: 5_000, savedMovedMinor: 5_000 }), null);
});

test("hidden money keeps the percentages and drops every amount and every sign word", () => {
  const model = build({ incomeMinor: 24_700_000, spentMinor: 20_900_000, plannedSpendMinor: 28_897_300, savingsTargetMinor: 4_130_000 }, { hidden: true, formatMoney: noFormatting });
  assert.deepEqual(legends(model), [["Spent", null, 85], ["Kept", null, 15]]);
  assert.equal(model.sentence, "Spent and kept, as a share of what you earned");
  assert.equal(model.plan, null);
  assert.equal(model.planLegend, null);

  const over = build({ incomeMinor: 100_000, spentMinor: 125_000 }, { hidden: true, formatMoney: noFormatting });
  assert.deepEqual(legends(over), [["Spent", null, 125], ["From savings", null, 25]]);
  // The tick's words stay, without the figure.
  assert.equal(over.tickLabel, "All you earned");
  assert.equal(over.tickLabelWithAmount, "All you earned");
  assert.equal(over.sentence, "Spent and kept, as a share of what you earned");
  assert.doesNotMatch(JSON.stringify(over), /\$|more than|kept \d/);

  const invested = build({ incomeMinor: 24_700_000, spentMinor: 23_500_000, investedMinor: 800_000 }, { hidden: true, formatMoney: noFormatting });
  assert.deepEqual(legends(invested), [["Spent", null, 92], ["Invested", null, 3], ["Kept", null, 5]]);
  assert.equal(invested.sentence, "Spent, invested and kept, as shares of income");
  assert.equal(invested.shortSentence, invested.sentence);
  assert.doesNotMatch(JSON.stringify(invested), /\$|more than|from savings/);
});
