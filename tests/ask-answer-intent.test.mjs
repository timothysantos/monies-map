// The Ask answer intent reader (docs/flows/ask-flow.md "Money questions"):
// a free-form money question read by rules into one of six intents, or
// null. Pure and shared: the route reads the question with it, and the Ask
// page uses the same reader to send the question there before the filter
// reader would turn "why was August so expensive?" into a search for
// "expensive". Demo names only.
import assert from "node:assert/strict";
import test from "node:test";

import { readAnswerIntent } from "../src/domain/ask-answer-intent.ts";
import { readFilterRequest } from "../src/client/ask-filter-reader.js";
import { figureMenu } from "../src/client/figure-menu-model.js";

const people = [
  { id: "person-ethan", name: "Ethan" },
  { id: "person-serene", name: "Serene" }
];
const vocabulary = ["Groceries", "Food & Drinks", "Public Transport", "Bills", "Citi Cash Back Card", "OCBC 360 Account", "UOB One Account"];
const context = { today: "2026-10-12", month: "2026-10", people, vocabulary };

test("reads each supported question into its intent and month", () => {
  const table = [
    ["why was August so expensive?", { kind: "spending", focus: "why", month: "2026-08" }],
    ["Why did we spend so much in September", { kind: "spending", focus: "why", month: "2026-09" }],
    ["where did September go?", { kind: "spending", focus: "where", month: "2026-09" }],
    ["where did my money go this month?", { kind: "spending", focus: "where", month: "2026-10" }],
    ["what did I spend the most on last month?", { kind: "spending", focus: "where", month: "2026-09" }],
    ["how am I doing against the plan?", { kind: "plan", month: "2026-10" }],
    ["Am I on track?", { kind: "plan", month: "2026-10" }],
    ["are we over budget in july?", { kind: "plan", month: "2026-07" }],
    ["compare August with July", { kind: "compare", month: "2026-08", otherMonth: "2026-07" }],
    ["august vs september?", { kind: "compare", month: "2026-08", otherMonth: "2026-09" }],
    ["how does this month compare to last month?", { kind: "compare", month: "2026-10", otherMonth: "2026-09" }],
    ["did I spend more than last month?", { kind: "compare", month: "2026-10", otherMonth: "2026-09" }],
    ["what's my biggest expense this month?", { kind: "biggest", month: "2026-10" }],
    ["What were the largest purchases in March 2026?", { kind: "biggest", month: "2026-03" }],
    ["top expenses in sept", { kind: "biggest", month: "2026-09" }],
    ["what do I owe Serene?", { kind: "owed", personId: "person-serene" }],
    ["how much does Ethan owe me?", { kind: "owed", personId: "person-ethan" }],
    ["who owes who?", { kind: "owed", personId: null }],
    ["are we settled up?", { kind: "owed", personId: null }],
    ["how much income came in this month?", { kind: "income", month: "2026-10" }],
    ["what did we earn in August?", { kind: "income", month: "2026-08" }],
    ["did income match the plan in september?", { kind: "income", month: "2026-09" }]
  ];
  for (const [text, expected] of table) {
    assert.deepEqual(readAnswerIntent(text, context), expected, text);
  }
});

test("the default month is the one Ask is looking at, and a later month name is last year's", () => {
  assert.deepEqual(readAnswerIntent("where did it all go?", { ...context, month: "2026-06" }), { kind: "spending", focus: "where", month: "2026-06" });
  assert.deepEqual(readAnswerIntent("why was november so expensive?", context), { kind: "spending", focus: "why", month: "2025-11" });
  assert.deepEqual(readAnswerIntent("why was 2026-03 so expensive?", context), { kind: "spending", focus: "why", month: "2026-03" });
  // "this month" is today's month even when Ask is looking at another one.
  assert.deepEqual(readAnswerIntent("am I on track this month?", { ...context, month: "2026-06" }), { kind: "plan", month: "2026-10" });
});

test("filter requests, entry sentences and other questions are not answer questions", () => {
  const negatives = [
    "how much on bills?",
    "how much did I spend on groceries in september?",
    "show my citi card spending",
    "income in aug and sep",
    "serene's shared groceries last month",
    "Koufu lunch $12.50",
    "I owe Serene $20 for lunch",
    "did I spend more than $500 on food?",
    "biggest groceries in august?",
    "what's the biggest expense on my Citi card?",
    "why?",
    "What's the weather like?",
    "should I buy a car?",
    "plan a trip to Bali",
    "compare",
    "",
    "   "
  ];
  for (const text of negatives) {
    assert.equal(readAnswerIntent(text, context), null, text);
  }
});

test("how a month or a quarter went is intent against outcome: the plan answer, over every month asked about", () => {
  const table = [
    ["how did September go?", { kind: "plan", month: "2026-09" }],
    ["How was August?", { kind: "plan", month: "2026-08" }],
    ["how did we do this month?", { kind: "plan", month: "2026-10" }],
    ["did we stick to the plan in Q3?", { kind: "plan", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] }],
    ["how did Q2 2026 go?", { kind: "plan", month: "2026-06", months: ["2026-04", "2026-05", "2026-06"] }],
    ["how did the second quarter go?", { kind: "plan", month: "2026-06", months: ["2026-04", "2026-05", "2026-06"] }],
    ["how did last quarter go?", { kind: "plan", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] }],
    // A quarter still running ends this month.
    ["how is this quarter going against the plan?", { kind: "plan", month: "2026-10", months: ["2026-10"] }],
    ["how did q4 2025 go?", { kind: "plan", month: "2025-12", months: ["2025-10", "2025-11", "2025-12"] }]
  ];
  for (const [text, expected] of table) {
    assert.deepEqual(readAnswerIntent(text, context), expected, text);
  }
  // Nothing is answered for a quarter that has not started, for one the
  // answer cannot add up (the biggest expenses are one month's), or with
  // one month standing in for it.
  for (const text of ["how did q1 2027 go?", "what were the biggest expenses in Q3?", "how much did I spend in September?", "how often do we eat out?"]) {
    assert.equal(readAnswerIntent(text, context), null, text);
  }
  // Spending and income add a quarter's months up too.
  assert.deepEqual(readAnswerIntent("where did Q3 go?", context), { kind: "spending", focus: "where", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] });
  assert.deepEqual(readAnswerIntent("what did we earn in Q3?", context), { kind: "income", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] });
});

// The money jobs' "Ask about this" (money-jobs-detail.js): every question
// the menu asks, for one month and for the Summary's range, reads as the
// answer it is about. Built from the menu itself, so a reworded template
// is caught here.
const LAST_12 = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
// "Ask about this" in an openable figure's menu (figure-menu-model.js):
// the figure, and the question it asks when not its own (the spent figure
// over its plan asks why).
const menuQuestion = (fig, { ask = "", arg = "", hidden = false, startMonth = "2026-09", endMonth = "2026-09" } = {}) =>
  figureMenu({ fig, ask, arg, hidden, period: { startMonth, endMonth } }).items.find((item) => item.action === "ask").question;

test("each money job's question reads as its own answer, for a month and for the Summary's range", () => {
  const vocabularyWithJobs = { ...context, vocabulary: [...vocabulary, "Investments", "Savings", "Salary"] };
  const table = [
    // The spent part over plan, and under it.
    [menuQuestion("spending", { ask: "spentOverPlan" }), "Why did I spend more than planned in Sep 2026?", { kind: "plan", month: "2026-09" }],
    [menuQuestion("spending"), "What did I spend the most on in Sep 2026?", { kind: "spending", focus: "where", month: "2026-09" }],
    [menuQuestion("spent"), "What did I spend the most on in Sep 2026?", { kind: "spending", focus: "where", month: "2026-09" }],
    // Hidden money: the plan answer, not this month against last.
    [menuQuestion("spending", { ask: "spentOverPlan", hidden: true }), "How did my spending compare with the plan in Sep 2026?", { kind: "plan", month: "2026-09" }],
    // Came out of savings: spending against what came in, not plain income.
    [menuQuestion("from_savings"), "Why did I spend more than I earned in Sep 2026?", { kind: "spentVsEarned", month: "2026-09" }],
    [menuQuestion("from_savings", { hidden: true }), "How did my spending compare with my income in Sep 2026?", { kind: "spentVsEarned", month: "2026-09" }],
    [menuQuestion("invested"), "How much did I invest in Sep 2026?", { kind: "invested", month: "2026-09" }],
    [menuQuestion("took_out"), "How much did I invest in Sep 2026?", { kind: "invested", month: "2026-09" }],
    [menuQuestion("kept"), "How much did I save in Sep 2026?", { kind: "saved", month: "2026-09" }],
    [menuQuestion("difference"), "How much did I save in Sep 2026?", { kind: "saved", month: "2026-09" }],
    [menuQuestion("earned"), "How much did I earn in Sep 2026?", { kind: "income", month: "2026-09" }],
    // A plan figure (the plan legend, "of $x plan", Not planned yet).
    [menuQuestion("plan"), "How did I do against the plan in Sep 2026?", { kind: "plan", month: "2026-09" }],
    // A split balance.
    [menuQuestion("splits", { arg: "split-group-japan" }), "Who owes whom?", { kind: "owed", personId: null }],
    // The Summary's twelve months.
    [menuQuestion("invested", { startMonth: "2025-10" }), "How much did I invest from Oct 2025 to Sep 2026?", { kind: "invested", month: "2026-09", months: LAST_12 }],
    [menuQuestion("kept", { startMonth: "2025-10" }), "How much did I save from Oct 2025 to Sep 2026?", { kind: "saved", month: "2026-09", months: LAST_12 }],
    [menuQuestion("from_savings", { startMonth: "2025-10" }), "Why did I spend more than I earned from Oct 2025 to Sep 2026?", { kind: "spentVsEarned", month: "2026-09", months: LAST_12 }],
    [menuQuestion("spending", { ask: "spentOverPlan", hidden: true, startMonth: "2025-10" }), "How did my spending compare with the plan from Oct 2025 to Sep 2026?", { kind: "plan", month: "2026-09", months: LAST_12 }],
    [menuQuestion("spending", { ask: "spentOverPlan", startMonth: "2025-10" }), "Why did I spend more than planned from Oct 2025 to Sep 2026?", { kind: "plan", month: "2026-09", months: LAST_12 }],
    [menuQuestion("plan", { startMonth: "2025-10" }), "How did I do against the plan from Oct 2025 to Sep 2026?", { kind: "plan", month: "2026-09", months: LAST_12 }],
    [menuQuestion("earned", { startMonth: "2025-10" }), "How much did I earn from Oct 2025 to Sep 2026?", { kind: "income", month: "2026-09", months: LAST_12 }]
  ];
  for (const [question, wording, expected] of table) {
    assert.equal(question, wording);
    assert.deepEqual(readAnswerIntent(question, context), expected, question);
    // The Investments, Savings and Salary categories share the jobs' words:
    // naming them is the question, not a category filter.
    assert.deepEqual(readAnswerIntent(question, vocabularyWithJobs), expected, `${question} (with the jobs' categories)`);
  }
});

test("the money jobs' questions typed by hand read the same way", () => {
  const table = [
    ["how much did we invest last month?", { kind: "invested", month: "2026-09" }],
    ["What did I invest this month", { kind: "invested", month: "2026-10" }],
    ["how much went into investments in August?", { kind: "invested", month: "2026-08" }],
    ["did I hit my investment goal?", { kind: "invested", month: "2026-10" }],
    ["did we invest as much as we planned in Q3?", { kind: "invested", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] }],
    ["how much did we save last month?", { kind: "saved", month: "2026-09" }],
    ["did I hit my savings target?", { kind: "saved", month: "2026-10" }],
    ["how much did we keep in August?", { kind: "saved", month: "2026-08" }],
    ["what did I put aside in July?", { kind: "saved", month: "2026-07" }],
    ["how much have we saved between July and September?", { kind: "saved", month: "2026-09", months: ["2026-07", "2026-08", "2026-09"] }],
    ["did we spend more than we earned last month?", { kind: "spentVsEarned", month: "2026-09" }],
    ["did I spend more than I made in August?", { kind: "spentVsEarned", month: "2026-08" }],
    ["spending vs income in august?", { kind: "spentVsEarned", month: "2026-08" }],
    ["how does my spending compare to my income?", { kind: "spentVsEarned", month: "2026-10" }],
    ["did I spend less than I earned from November to February?", { kind: "spentVsEarned", month: "2026-02", months: ["2025-11", "2025-12", "2026-01", "2026-02"] }],
    ["how did August compare to the plan?", { kind: "plan", month: "2026-08" }],
    ["how does my spending compare with my budget?", { kind: "plan", month: "2026-10" }],
    // "Keep to the plan" is the plan, not what was kept.
    ["did we keep to the plan in July?", { kind: "plan", month: "2026-07" }]
  ];
  for (const [text, expected] of table) {
    assert.deepEqual(readAnswerIntent(text, context), expected, text);
  }
});

test("invest, save and earn in a search, a purchase, a named wallet or a range too long are not money-job answers", () => {
  const filterContext = { today: "2026-10-12", month: "2026-10", viewId: "household", scope: "direct_plus_shared", people, accounts: [], categories: [] };
  // A merchant search with "invest" in it still searches.
  for (const text of ["show invest in a new phone case", "find invest in a new phone case", "search invest in a new phone case"]) {
    assert.equal(readAnswerIntent(text, context), null, text);
    const reading = readFilterRequest(text, filterContext);
    assert.equal(reading.kind, "filter", text);
    assert.match(reading.filter.search, /\binvest\b.*\bphone case\b/, text);
  }
  const negatives = [
    "invest in a new phone case",
    "did I invest in a new phone case?",
    "how much did I spend on the invest in a new phone case?",
    // A wallet named: the filter reader's question.
    "how much did I save on my UOB One Account in August?",
    "how much income came into my OCBC 360 Account?",
    // A comparison with another month.
    "did I save more than in July?",
    // Longer than the Summary's twelve months, or not started yet.
    "how much did I invest from Jan 2025 to Sep 2026?",
    "how much did I save from Nov 2026 to Dec 2026?",
    // An amount is a filter.
    "did I invest more than $500 in August?",
    // A request, not a question about what happened.
    "can you save this?",
    "could you invest it for me?"
  ];
  for (const text of negatives) {
    assert.equal(readAnswerIntent(text, context), null, text);
  }
});

test("a compare question needs two different months", () => {
  assert.equal(readAnswerIntent("compare august with august", context), null);
  assert.deepEqual(readAnswerIntent("compare july", context), { kind: "compare", month: "2026-07", otherMonth: "2026-06" });
});

test("every supported example reaches the route before the filter reader could misread it", () => {
  // Without the answer reader these turn into searches ("expensive",
  // "biggest") or a which-month question; with it they are answers.
  const filterContext = { today: "2026-10-12", month: "2026-10", viewId: "household", scope: "direct_plus_shared", people, accounts: [], categories: [] };
  assert.equal(readFilterRequest("why was August so expensive?", filterContext).filter?.search, "expensive");
  assert.equal(readFilterRequest("compare August with July", filterContext).kind, "question");
  for (const text of ["why was August so expensive?", "compare August with July", "what's my biggest expense this month?"]) {
    assert.ok(readAnswerIntent(text, context), text);
  }
});

test("a category's Ask about this (Spending Mix, Top spending, a budget line) reads as that category's spending in the period", () => {
  const question = menuQuestion("category", { arg: "Groceries" });
  assert.equal(question, "How much did I spend on Groceries in Sep 2026?");
  // Not a whole-month answer: it names a category, so it is a filter answer.
  assert.equal(readAnswerIntent(question, context), null);
  const reading = readFilterRequest(question, { today: "2026-10-12", month: "2026-10", viewId: "household", scope: "direct_plus_shared", people, accounts: [], categories: [{ id: "cat-groceries", name: "Groceries" }] });
  assert.equal(reading.kind, "filter");
  assert.deepEqual([reading.filter.categories, reading.filter.month], [["Groceries"], "2026-09"]);
});

// "Is that more than usual?" (DOMAIN.md "Usual Level"): the subject as
// written, a category, wallet or person by its name, the month as said.
test("more than usual: the subject as written and the month; a plain question is not one", () => {
  const usual = (text, extra = {}) => readAnswerIntent(text, { ...context, ...extra });
  assert.deepEqual(usual("is Grab more than usual this month?"), { kind: "usual", subject: "grab", month: "2026-10" });
  assert.deepEqual(usual("are we spending more than normal on groceries?"), { kind: "usual", subject: "Groceries", month: "2026-10" });
  assert.deepEqual(usual("is Serene's spending higher than usual in September?"), { kind: "usual", subject: "Serene", month: "2026-09" });
  assert.deepEqual(usual("grab mor than usual?"), { kind: "usual", subject: "grab", month: "2026-10" });
  assert.deepEqual(usual("groceries normal?"), { kind: "usual", subject: "Groceries", month: "2026-10" });
  assert.deepEqual(usual("is that more than usual"), { kind: "usual", subject: null, month: "2026-10" });
  assert.deepEqual(usual("do we usually spend this much at Koufu?"), { kind: "usual", subject: "koufu", month: "2026-10" });
  // Not a "usual" question.
  assert.equal(usual("how much did I spend on groceries?"), null);
  assert.deepEqual(usual("did we stick to the plan in September?"), { kind: "plan", month: "2026-09" });
  // An amount makes it a filter, never an answer.
  assert.equal(usual("is $50 more than usual for grab?"), null);
});
