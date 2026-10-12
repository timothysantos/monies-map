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
  // A quarter only reads as the plan answer; nothing is answered for a
  // quarter that has not started, or with one month standing in for it.
  for (const text of ["where did Q3 go?", "what did we earn in Q3?", "how did q1 2027 go?", "how much did I spend in September?", "how often do we eat out?"]) {
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
