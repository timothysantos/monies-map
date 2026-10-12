// The plan request reader (docs/flows/ask-flow.md "Planning by chat"): a
// typed request to change a month's plan read by rules into a structured
// request (copy a month, set, change, move or add a line), "unread" when it
// looks like a plan request the rules cannot read (the route may then ask
// the optional AI), or "none" so the other Ask readers get it. Pure and
// shared by the Ask page and the plan-draft route. Demo names only.
import assert from "node:assert/strict";
import test from "node:test";

import { readAmount, readMonth, readPlanRequest } from "../src/domain/plan-draft-reader.ts";

const context = { today: "2026-10-13", walletNames: ["DBS Multiplier Account", "OCBC 360 Account", "UOB One Account", "Citi Cash Back Card"] };
const request = (month, ops, copyFrom = null) => ({ kind: "request", request: { month, copyFrom, ops } });

test("reads each request shape into its exact structure", () => {
  const table = [
    ["plan November like September but Groceries $700", request("2026-11", [{ kind: "set", line: "groceries", amountMinor: 70_000 }], "2026-09")],
    ["Plan November like September", request("2026-11", [], "2026-09")],
    ["copy September's plan to November, groceries 650 and transport $150", request("2026-11", [
      { kind: "set", line: "groceries", amountMinor: 65_000 },
      { kind: "set", line: "transport", amountMinor: 15_000 }
    ], "2026-09")],
    ["make the plan for december the same as november's", request("2026-12", [], "2026-11")],
    ["set groceries plan to $700 for November", request("2026-11", [{ kind: "set", line: "groceries", amountMinor: 70_000 }])],
    ["Set the shopping budget to 300 in Oct.", request("2026-10", [{ kind: "set", line: "shopping", amountMinor: 30_000 }])],
    ["change food & drinks to $1,250.50 for next month", request("2026-11", [{ kind: "set", line: "food & drinks", amountMinor: 125_050 }])],
    ["plan $700 for groceries in november", request("2026-11", [{ kind: "set", line: "groceries", amountMinor: 70_000 }])],
    ["groceries budget 700", request(null, [{ kind: "set", line: "groceries", amountMinor: 70_000 }])],
    ["set shopping to 0 this month", request("2026-10", [{ kind: "set", line: "shopping", amountMinor: 0 }])],
    ["move $50 from Shopping to Groceries in October", request("2026-10", [{ kind: "move", from: "shopping", to: "groceries", amountMinor: 5_000 }])],
    ["please move 200 from the shopping budget to travel this month", request("2026-10", [{ kind: "move", from: "shopping", to: "travel", amountMinor: 20_000 }])],
    ["raise groceries by $50 for november", request("2026-11", [{ kind: "change", line: "groceries", deltaMinor: 5_000 }])],
    ["cut the shopping plan by 1.2k", request(null, [{ kind: "change", line: "shopping", deltaMinor: -120_000 }])],
    ["add $50 to the groceries plan in november", request("2026-11", [{ kind: "change", line: "groceries", deltaMinor: 5_000 }])],
    ["add a Travel line of $300 to November", request("2026-11", [{ kind: "add", line: "travel", amountMinor: 30_000 }])],
    ["add a new line for gifts at $120 in december", request("2026-12", [{ kind: "add", line: "gifts", amountMinor: 12_000 }])],
    ["can you set groceries to 700 for nov 2027?", request("2027-11", [{ kind: "set", line: "groceries", amountMinor: 70_000 }])],
    ["set groceries to 700 for 2026-11", request("2026-11", [{ kind: "set", line: "groceries", amountMinor: 70_000 }])]
  ];
  for (const [text, expected] of table) {
    assert.deepEqual(readPlanRequest(text, context), expected, text);
  }
});

test("leaves entries, transfers, questions and searches to the other readers", () => {
  for (const text of [
    "lunch 12.50",
    "add lunch $12 today",
    "add $50 to groceries",
    "grab to the airport 32",
    "how am I doing against the plan?",
    "did we stick to the plan in Q3?",
    "what's my groceries budget?",
    "show planned items",
    "groceries last month",
    "move $50 from DBS to OCBC",
    "",
    "x".repeat(301)
  ]) {
    assert.deepEqual(readPlanRequest(text, context), { kind: "none" }, text);
  }
});

test("a request that sounds like planning but does not fit a shape is unread, for the optional AI", () => {
  for (const text of [
    "set aside a bit more for groceries in november",
    "plan november around the japan trip",
    "budget for the wedding",
    "move some money from shopping to groceries"
  ]) {
    assert.deepEqual(readPlanRequest(text, context), { kind: "unread" }, text);
  }
});

test("a copy whose changes cannot be read is not guessed", () => {
  assert.deepEqual(readPlanRequest("plan november like september but less on eating out", context), { kind: "unread" });
});

test("a month named without a year is the nearest one, either way", () => {
  assert.equal(readMonth("november", "2026-10-13"), "2026-11");
  assert.equal(readMonth("september", "2026-10-13"), "2026-09");
  assert.equal(readMonth("january", "2026-10-13"), "2027-01");
  assert.equal(readMonth("april", "2026-10-13"), "2027-04", "six months ahead wins the tie over six back");
  assert.equal(readMonth("march", "2026-10-13"), "2027-03");
  assert.equal(readMonth("may", "2026-10-13"), "2026-05");
  assert.equal(readMonth("next month", "2026-12-01"), "2027-01");
  assert.equal(readMonth("2026-13", "2026-10-13"), null);
  assert.equal(readMonth("smarch", "2026-10-13"), null);
});

test("amounts read as cents and refuse anything unreadable or absurd", () => {
  assert.equal(readAmount("$1,200.50"), 120_050);
  assert.equal(readAmount("1.2k"), 120_000);
  assert.equal(readAmount("700"), 70_000);
  assert.equal(readAmount("12.345"), null);
  assert.equal(readAmount("$100000000"), null);
});
