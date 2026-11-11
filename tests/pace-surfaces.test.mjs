// If this keeps up (DOMAIN.md "Pace") where it shows: the facts the read
// hands it (pages/pace-facts.ts), the line and its figure menu, Month's
// insight lines (paceSteady and paceAhead with the range, paceOver) and
// Ask's answer. Every one reads the same pure sums (pace.ts), is a range,
// never offers View entries and never reassures. Today is fixed.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPaceRange } from "../src/domain/pace.ts";
import { buildPaceDto } from "../src/domain/pages/pace-facts.ts";
import { findRepeatingCharges } from "../src/domain/repeating-charges.ts";
import { paceLineWords } from "../src/client/pace-line-model.js";
import { figureMenu } from "../src/client/figure-menu-model.js";
import { planPaceSignal, pacePartsWords } from "../src/domain/money-signals/month-signals.ts";
import { findAppJargon, findPaceProblems, findToneProblems } from "../src/domain/money-signals/tone.ts";
import { readAnswerIntent } from "../src/domain/ask-answer-intent.ts";
import { buildPaceAnswerFacts, buildPaceCard, buildPacePromptFacts, buildPaceWording } from "../src/domain/ask-pace.ts";

const TODAY = "2026-11-10";
const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);

// The design's November (tests/pace.test.mjs): $2,140.00 spent by the 10th,
// $4,706.46 to $5,064.31 at month end, $1,242.00... of salary to come.
let counter = 0;
const entry = (date, amountMinor, inSeries = false) => ({ id: `p${(counter += 1)}`, date, amountMinor, inSeries });
function novemberPace() {
  const entries = [];
  for (let day = 1; day <= 10; day += 1) entries.push(entry(`2026-11-${String(day).padStart(2, "0")}`, 13_508));
  entries.push(entry("2026-11-01", 18_630, true), entry("2026-11-05", 7_850, true), entry("2026-11-03", 448, true), entry("2026-11-09", 3_992, true), entry("2026-11-06", 48_000));
  const bills = [
    { key: "NETFLIX COM|monthly", name: "Netflix", date: "2026-11-14", lowMinor: 1_998, highMinor: 1_998 },
    { key: "SP SERVICES|monthly", name: "SP Group", date: "2026-11-18", lowMinor: 11_860, highMinor: 14_285 },
    { key: "SINGTEL MOBILE|monthly", name: "Singtel", date: "2026-11-22", lowMinor: 4_290, highMinor: 4_290 },
    { key: "SPOTIFY|monthly", name: "Spotify", date: "2026-11-27", lowMinor: 1_698, highMinor: 1_698 }
  ];
  const range = buildPaceRange({
    month: "2026-11",
    today: TODAY,
    entries,
    usualMonths: [
      { month: "2026-08", everydayMinor: 11_840 * 31, days: 31 },
      { month: "2026-09", everydayMinor: 11_840 * 30, days: 30 },
      { month: "2026-10", everydayMinor: 12_258 * 31, days: 31 }
    ],
    bills,
    incomeSoFarMinor: 0,
    incomeToCome: [{ name: "Salary", date: "2026-11-25", amountMinor: 1_242_000 }],
    monthsWithEntries: 12,
    importsBehind: false
  });
  return { month: "2026-11", range, bills, spentSoFarMinor: 214_000 };
}

// ---- The facts from the Subscriptions and bills read ----------------------

let rowId = 0;
const letters = (index) => `${String.fromCharCode(65 + (index % 26))}${String.fromCharCode(65 + (Math.floor(index / 26) % 26))}${String.fromCharCode(65 + (Math.floor(index / 676) % 26))}`;
const chargeRow = (date, description, amountMinor, accountId = "citi") => ({
  ids: [`r${(rowId += 1)}`], date, description, amountMinor, accountId, categoryName: "Food", entryType: "expense", isForeign: false
});
const monthsBack = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

// Everyday spending: one shop a day, never the same shop twice, $40 a day in
// August to October and $50 a day so far in November. Netflix on the 14th
// every month (still to come); Singtel on the 5th (already paid this month).
function readRows() {
  const rows = [];
  let shop = 0;
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const days = month === "2026-09" ? 30 : 31;
    for (let day = 1; day <= days; day += 1) rows.push(chargeRow(`${month}-${String(day).padStart(2, "0")}`, `HAWKER ${letters((shop += 1))}`, 4_000));
  }
  for (let day = 1; day <= 10; day += 1) rows.push(chargeRow(`2026-11-${String(day).padStart(2, "0")}`, `HAWKER ${letters((shop += 1))}`, 5_000));
  for (const month of monthsBack) rows.push(chargeRow(`${month}-14`, "NETFLIX.COM 866-579-7172", 1_998));
  for (const month of [...monthsBack, "2026-11"]) rows.push(chargeRow(`${month}-05`, "SINGTEL MOBILE 81234567", 4_290));
  return rows;
}
const income = [
  { description: "ACME PTE LTD SALARY", date: "2026-09-25", amountMinor: 600_000, categoryName: "Salary" },
  { description: "ACME PTE LTD SALARY", date: "2026-10-25", amountMinor: 600_000, categoryName: "Salary" },
  { description: "INTEREST CREDIT", date: "2026-11-01", amountMinor: 1_234, categoryName: "Other Income" },
  // A refund filed under a spending category lowers spending: never money in.
  { description: "HAWKER REFUND", date: "2026-11-02", amountMinor: 900, categoryName: "Food" }
];
function paceFromRead({ today = TODAY, latest = "2026-11-09", rows = readRows() } = {}) {
  const accountLatestDate = { citi: latest };
  const result = findRepeatingCharges({ today, rows, accountLatestDate });
  return buildPaceDto({ today, rows, result, accountLatestDate, income });
}

test("the read's facts: the bill still to come, not the one already paid, and the salary still due", () => {
  const pace = paceFromRead();
  assert.equal(pace.month, "2026-11");
  assert.equal(pace.quiet, undefined);
  assert.deepEqual(pace.bills.map((bill) => [bill.name, bill.date, bill.lowMinor, bill.highMinor]), [["Netflix", "2026-11-14", 1_998, 1_998]]);
  assert.deepEqual(pace.incomeToCome.map((item) => [item.date, item.amountMinor]), [["2026-11-25", 600_000]]);
  assert.equal(pace.incomeSoFarMinor, 1_234);
  // Everyday: $500.00 in 10 days ($50 a day) against the usual $40 a day.
  assert.equal(pace.range.everydaySoFarMinor, 50_000);
  assert.equal(pace.range.thisRateMinor, 5_000);
  assert.equal(pace.range.usualRateMinor, 4_000);
  assert.equal(pace.range.everydayLowMinor, 20 * 4_000);
  assert.equal(pace.range.everydayHighMinor, 20 * 5_000);
  assert.equal(pace.range.billsLowMinor, 1_998);
  assert.equal(pace.spentSoFarMinor, 50_000 + 4_290);
  assert.equal(pace.range.incomeMinor, 1_234 + 600_000);
});

test("the read's facts are quiet: the first 5 days, imports 11 days behind, too little history", () => {
  assert.deepEqual(paceFromRead({ today: "2026-11-05" }), { month: "2026-11", quiet: "early" });
  assert.deepEqual(paceFromRead({ latest: "2026-10-30" }), { month: "2026-11", quiet: "imports", behind: [{ accountId: "citi", name: "One account", lastDate: "2026-10-30" }] });
  const short = readRows().filter((row) => row.date >= "2026-09-01");
  assert.deepEqual(paceFromRead({ rows: short }), { month: "2026-11", quiet: "history" });
  // Months of history, but nothing recorded in August: no usual rate of $0.
  const gap = readRows().filter((row) => !row.date.startsWith("2026-08"));
  assert.deepEqual(paceFromRead({ rows: gap }), { month: "2026-11", quiet: "history" });
});

// ---- The line and its figure menu ----------------------------------------

test("the line: a rounded range by month end, the plan's side, what is left, and the note's sums", () => {
  const pace = novemberPace();
  const words = paceLineWords({ pace, spentSoFarMinor: 214_000, planMinor: 520_000, money });
  assert.equal(words.sentence, "If this keeps up: about $4,700 to $5,100 by 30 Nov, under the $5,200 plan.");
  assert.equal(words.left, "About $7,350 to $7,750 left of what comes in.");
  assert.deepEqual(words.note, [
    "How this is worked out",
    "Spent so far $2,140.00",
    "Everyday spending, 20 days to go: $2,368.00 to $2,701.60",
    "Bills still to come: $198.46 to $222.71",
    "Counted once, not repeated: $480.00",
    "Rounded out to the nearest $50. Only what's recorded; nothing is guessed about new spending."
  ]);
  // Over the plan: said in words, never coloured; straddling it: no side.
  assert.equal(paceLineWords({ pace, spentSoFarMinor: 214_000, planMinor: 450_000, money }).sentence, "If this keeps up: about $4,700 to $5,100 by 30 Nov, over the $4,500 plan.");
  assert.equal(paceLineWords({ pace, spentSoFarMinor: 214_000, planMinor: 490_000, money }).sentence, "If this keeps up: about $4,700 to $5,100 by 30 Nov.");
  for (const line of [words.sentence, words.left, ...words.note]) {
    assert.deepEqual([...findPaceProblems(line), ...findToneProblems(line), ...findAppJargon(line)], [], line);
  }
});

test("a pace figure's menu: Ask about this only, never View entries or Open plan, and Ask reads its question", () => {
  const menu = figureMenu({ fig: "pace", period: { startMonth: "2026-11", endMonth: "2026-11" }, search: "?view=household&month=2026-11" });
  assert.deepEqual(menu.title, { name: "If this keeps up", period: "Nov 2026" });
  assert.deepEqual(menu.items.map((item) => item.action), ["ask"]);
  assert.equal(menu.items[0].question, "How will Nov 2026 end if this keeps up?");
  assert.deepEqual(readAnswerIntent(menu.items[0].question, { today: TODAY, month: "2026-11", people: [] }), { kind: "pace", month: "2026-11" });
  // Hidden money: the same menu, no amount in the question.
  const hidden = figureMenu({ fig: "pace", period: { startMonth: "2026-11", endMonth: "2026-11" }, hidden: true });
  assert.deepEqual(hidden.items.map((item) => item.action), ["ask"]);
  assert.doesNotMatch(hidden.items[0].question, /\$/);
});

// ---- Month's insight lines -------------------------------------------------

const monthInput = (extra = {}) => ({
  audience: "household",
  viewLabel: "Household",
  month: "2026-11",
  today: "2026-11-14",
  entries: [],
  planSections: [],
  incomeRows: [],
  summary: { realExpensesMinor: 214_000, estimatedExpensesMinor: 520_000 },
  accountPills: [],
  formatMoney: money,
  ...extra
});

test("mid-month with a pace under the plan: paceSteady's range line and what it counts", () => {
  const pace = novemberPace();
  const signal = planPaceSignal(monthInput({ pace }));
  assert.equal(signal.key, "plan-pace");
  assert.equal(signal.kind, "going_well");
  assert.equal(signal.phrasings[0].fact, "If this keeps up, November's spending ends at about $4,700 to $5,100, under the $5,200 plan.");
  assert.equal(signal.phrasings[0].think, "That counts the 4 bills still to come on their usual days, and 1 big cost once. Spending is on pace with what you planned.");
  // Ahead of the calendar on the 11th (more than 11/30 of the plan spent),
  // still under it: paceAhead's range line.
  const ahead = planPaceSignal(monthInput({ pace, today: "2026-11-11" }));
  assert.equal(ahead.kind, "worth_a_look");
  assert.equal(ahead.phrasings[0].fact, signal.phrasings[0].fact);
  assert.match(ahead.phrasings[0].think, /^That counts the 4 bills still to come on their usual days, and 1 big cost once\. Spending is a bit faster/);
  const fast = planPaceSignal(monthInput({ pace, summary: { realExpensesMinor: 300_000, estimatedExpensesMinor: 620_000 } }));
  assert.equal(fast.kind, "worth_a_look");
  assert.match(fast.phrasings[0].fact, /^If this keeps up, November's spending ends at about \$5,550 to \$5,950, under the \$6,200 plan\.$/);
  for (const phrasing of [...signal.phrasings, ...fast.phrasings]) {
    for (const line of [phrasing.fact, ...phrasing.thinks]) {
      assert.deepEqual([...findPaceProblems(line), ...findToneProblems(line), ...findAppJargon(line)], [], line);
    }
  }
});

test("paceOver: even the low end over the plan, any day the pace shows; never once spent is over", () => {
  const pace = novemberPace();
  const over = planPaceSignal(monthInput({ pace, today: "2026-11-08", summary: { realExpensesMinor: 214_000, estimatedExpensesMinor: 400_000 } }));
  assert.equal(over.kind, "worth_a_look");
  assert.equal(over.phrasings[0].fact, "If this keeps up, November's spending ends at about $4,700 to $5,100, over the $4,000 plan.");
  assert.deepEqual(over.basis.lines.slice(-3).map((line) => line.amountMinor), [470_646, 506_431, 400_000]);
  // Already over the plan: other lines say so; the pace says nothing.
  assert.equal(planPaceSignal(monthInput({ pace, summary: { realExpensesMinor: 410_000, estimatedExpensesMinor: 400_000 } })), null);
  // No plan: nothing to measure against.
  assert.equal(planPaceSignal(monthInput({ pace, summary: { realExpensesMinor: 214_000, estimatedExpensesMinor: 0 } })), null);
});

test("without a pace, or a range across the plan, the mid-month lines keep their old words; early with no pace says nothing", () => {
  const old = planPaceSignal(monthInput());
  assert.match(old.phrasings[0].fact, /^\$2,140\.00 of the \$5,200 you planned is spent/);
  const across = planPaceSignal(monthInput({ pace: novemberPace(), summary: { realExpensesMinor: 214_000, estimatedExpensesMinor: 490_000 } }));
  assert.doesNotMatch(across.phrasings[0].fact, /If this keeps up/);
  assert.equal(planPaceSignal(monthInput({ today: "2026-11-08" })), null);
});

test("what a pace counts, in words", () => {
  const { range, bills } = novemberPace();
  assert.equal(pacePartsWords(range, bills), "the 4 bills still to come on their usual days, and 1 big cost once");
  assert.equal(pacePartsWords({ ...range, oneOffs: [] }, bills.slice(0, 1)), "the 1 bill still to come on its usual day");
  assert.equal(pacePartsWords({ ...range, oneOffs: [] }, []), "everyday spending at this month's pace and its usual pace");
});

// ---- Ask ------------------------------------------------------------------

test("Ask reads 'if this keeps up' questions, and leaves a month that has ended to the other readers", () => {
  const context = { today: TODAY, month: "2026-11", people: [] };
  for (const text of ["How will November end if this keeps up?", "where will this month end up?", "if this keeps up how will we end the month?", "if spending keep up like this?"]) {
    assert.deepEqual(readAnswerIntent(text, context), { kind: "pace", month: "2026-11" }, text);
  }
  for (const text of ["How did October end?", "What did I spend the most on in November?", "is Grab more than usual?"]) {
    assert.notEqual(readAnswerIntent(text, context)?.kind, "pace", text);
  }
});

test("Ask's pace answer: the same sums as the line, Month's spent and plan, and plain quiet reasons", () => {
  const pace = novemberPace();
  const facts = buildPaceAnswerFacts({ month: "2026-11", today: TODAY, viewId: "household", scope: "direct_plus_shared", spentMinor: 214_000, planMinor: 520_000, pace });
  const card = buildPaceCard(facts);
  assert.equal(card.title, "If this keeps up");
  assert.deepEqual(card.lead, { label: "Spent so far in November", amountMinor: 214_000, currency: "SGD", tone: "neutral", planMinor: 520_000 });
  assert.deepEqual(card.lines.map((line) => [line.label, line.amountMinor, line.secondary?.amountMinor ?? null]), [
    ["Everyday spending, 20 days to go", 236_800, 270_160],
    ["Bills still to come", 19_846, 22_271],
    ["Counted once, not repeated", 48_000, null]
  ]);
  assert.ok(card.lines.every((line) => line.tone !== "short" && line.tone !== "in"));
  const wording = buildPaceWording(facts, money);
  assert.equal(wording, "If this keeps up, November's spending ends at about $4,700 to $5,100 by 30 Nov, under the $5,200 plan. That's $2,140.00 spent so far, everyday spending for the 20 days to go at this month's pace and your usual pace, and 4 bills still to come on their usual days. One big cost is counted once, not repeated.");
  assert.equal(buildPacePromptFacts(facts, money)[0], "If this keeps up, spending by month end: about $4,700 to $5,100");
  // Equal ends read as one figure in Ask's words too, never "$5,000 to $5,000".
  const equal = { ...facts, range: { ...facts.range, addLowMinor: 286_000, addHighMinor: 286_000, everydayLowMinor: 100_000, everydayHighMinor: 100_000, billsLowMinor: 20_000, billsHighMinor: 20_000, oneOffs: [] } };
  assert.match(buildPaceWording(equal, money), /ends at about \$[\d,]+ by 30 Nov/);
  assert.ok(!/to \$[\d,]+ by 30 Nov/.test(buildPaceWording(equal, money)));
  assert.ok(!/\$[\d,.]+ to \$[\d,.]+/.test(buildPacePromptFacts(equal, money).join("\n")), buildPacePromptFacts(equal, money).join("\n"));
  const quiet = (extra) => buildPaceWording(buildPaceAnswerFacts({ month: "2026-11", today: TODAY, viewId: "household", scope: "direct_plus_shared", spentMinor: 214_000, planMinor: 0, ...extra }), money);
  assert.equal(quiet({ pace: { month: "2026-11", quiet: "early" } }), "It's too early in November to say where it ends. Ask again after the 5th.");
  assert.equal(quiet({ pace: { month: "2026-11", quiet: "imports" } }), "The latest statements aren't in yet, so there's no pace until they're imported.");
  // Naming the account (pace-quiet.ts, the same words as Summary's note).
  const behind = [{ accountId: "citi", name: "Citi Rewards", lastDate: "2026-10-15" }];
  assert.equal(quiet({ pace: { month: "2026-11", quiet: "imports", behind } }), "Citi Rewards has nothing after 15 Oct, so there's no pace until its statement is imported.");
  assert.equal(quiet({ pace: { month: "2026-11", quiet: "imports", behind: [...behind, { accountId: "uob", name: "UOB One", lastDate: "2026-10-14" }, { accountId: "x", name: "X", lastDate: "2026-10-01" }] } }), "Citi Rewards has nothing after 15 Oct and UOB One has nothing after 14 Oct, and 1 more account is behind too, so there's no pace until their statements are imported.");
  assert.equal(quiet({ pace: { month: "2026-11", quiet: "history" } }), "There isn't enough history yet. This needs 3 complete months of entries.");
  assert.equal(quiet({ month: "2026-10", pace }), "October has already ended, so there is nothing still to come.");
  assert.deepEqual(buildPaceCard(buildPaceAnswerFacts({ month: "2026-10", today: TODAY, viewId: "household", scope: "direct_plus_shared", spentMinor: 1, planMinor: 0, pace })).lines, []);
  for (const line of [wording, quiet({ pace: { month: "2026-11", quiet: "early" } }), quiet({ pace: null })]) {
    assert.deepEqual([...findPaceProblems(line), ...findToneProblems(line), ...findAppJargon(line)], [], line);
  }
});
