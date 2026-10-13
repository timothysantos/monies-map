// Insight questions (DOMAIN.md "Insight Question"; docs/flows/ask-flow.md
// "Insight questions"): "Ask about this" on a Money insights line hands Ask
// the line, its think line and what its signal is based on. These pin, per
// kind of insight, the basis each signal builder gives (its own figures,
// never a new one), the question and answer card Ask builds from it, the
// follow-up chips (each money question one Ask already answers), and the
// fact lines an optional AI may see (bounded, personal numbers removed).
import assert from "node:assert/strict";
import test from "node:test";

import { readAnswerIntent } from "../src/domain/ask-answer-intent.ts";
import {
  buildInsightPromptFacts,
  insightPromptQuestion,
  insightQuestionText,
  readInsightExplainRequest,
  stripPersonalNumbers
} from "../src/domain/ask-insight.ts";
import { buildAccountSignals, missedPaymentsSignal, ownTransferIncomeSignal } from "../src/domain/money-signals/account-signals.ts";
import { buildEntriesSignals, possibleDuplicateSignal, uncategorizedSignal } from "../src/domain/money-signals/entries-signals.ts";
import { buildMonthSignals, categoryOverPlanSignal, oneOffOverPlanSignal, planShortfallSignal } from "../src/domain/money-signals/month-signals.ts";
import { cardBillSignal, statementGapSignal } from "../src/domain/money-signals/shared-signals.ts";
import { settlementPaymentSignal, splitBalanceSignal } from "../src/domain/money-signals/splits-signals.ts";
import { buildSummarySignals, categoryCreepSignal, spendingAboveIncomeSignal } from "../src/domain/money-signals/summary-signals.ts";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { HEADLINE_KIND_ORDER } from "../src/domain/money-signals/types.ts";
import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { buildInsightAnswer, insightExplainBody, readInsightHandoff } from "../src/client/ask-insight-answer.js";

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const TODAY = "2026-10-13";

// The hand-off a line makes (insight-ask-event.js), with the page's context
// as App.jsx adds it.
function handoff(signal, { fact = signal.phrasings[0].fact, think = signal.phrasings[0].think, context = {} } = {}) {
  return {
    key: signal.key,
    kind: signal.kind,
    fact,
    think,
    primaryMinor: signal.numbers.primaryMinor,
    basis: JSON.parse(JSON.stringify(signal.basis)),
    context: { viewId: "household", scope: "direct_plus_shared", month: "2026-10", ...context }
  };
}

function answerFor(signal, options) {
  return buildInsightAnswer(readInsightHandoff(handoff(signal, options)), { today: TODAY });
}

const statementPills = [
  { accountId: "acct-uob", accountName: "UOB One Account", ownerLabel: "Serene", reconciliationStatus: "matched", latestCheckpointDeltaMinor: 0 },
  { accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "mismatch", latestCheckpointMonth: "2026-09", latestCheckpointDeltaMinor: -4_280 }
];

test("statement mismatch: the wallet, the statement and the gap; Open in Entries for that wallet and month, then Compare with the statement", () => {
  const signal = statementGapSignal({ accountPills: statementPills, audience: "household", viewLabel: "Household", formatMoney: sgd });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Wallet", text: "OCBC 365 Card (Serene)" },
      { label: "Statement", text: "September 2026" },
      { label: "Statement and entries differ by", amountMinor: 4_280 }
    ],
    entries: { accountId: "acct-ocbc-365", month: "2026-09" },
    month: "2026-09"
  });
  const answer = answerFor(signal);
  assert.equal(answer.question, "Explain: Serene's OCBC 365 Card statement differs from what's recorded here by $42.80");
  assert.equal(answer.type, "statement-gap");
  assert.equal(answer.kind, "quick_fix");
  assert.equal(answer.fact, "Serene's OCBC 365 Card statement differs from what's recorded here by $42.80.");
  assert.equal(answer.think, "The statement is the bank's own monthly list of payments. A gap like this is usually one payment missing here or recorded twice.");
  assert.deepEqual(answer.lead, { label: "Statement and entries differ by", amountMinor: 4_280, currency: "SGD" });
  const filter = { month: "2026-09", viewId: "household", scope: "direct_plus_shared", search: "", categories: [], wallets: ["acct-ocbc-365"], type: "", minAmountMinor: null, maxAmountMinor: null, entryIds: [] };
  assert.deepEqual(answer.entries, filter);
  assert.deepEqual(answer.links, [
    { kind: "entries", label: "Open in Entries", filter },
    { kind: "imports", label: "Compare with the statement" }
  ]);
});

test("plan doesn't add up: planned spending against the income expected; Open Month for that month, nothing in Entries", () => {
  const row = (id, label, plannedMinor, section = "budget_buckets") => ({ id, label, categoryName: label, plannedMinor, actualMinor: 0 });
  const signal = planShortfallSignal({
    audience: "household",
    viewLabel: "Household",
    month: "2026-10",
    today: "2026-10-13",
    entries: [],
    incomeRows: [{ plannedMinor: 830_000, actualMinor: 0 }, { plannedMinor: 520_000, actualMinor: 0 }],
    planSections: [
      { key: "planned_items", rows: [row("p1", "HDB loan", 148_000), row("p2", "Savings", 250_000)] },
      { key: "budget_buckets", rows: [row("b1", "Food & Drinks", 700_000), row("b2", "Shopping", 372_000)] }
    ],
    summary: null,
    accountPills: [],
    formatMoney: sgd
  });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Month", text: "October 2026" },
      { label: "Planned spending, savings included", amountMinor: 1_470_000 },
      { label: "Income you expect", amountMinor: 1_350_000 },
      { label: "Plan spends more than it expects by", amountMinor: 120_000 },
      { label: "Savings goal in the plan", amountMinor: 250_000 }
    ],
    month: "2026-10"
  });
  const answer = answerFor(signal, { context: { viewId: "person-tim", scope: "direct", month: "2026-10" } });
  assert.equal(answer.question, `Explain: ${signal.phrasings[0].fact.replace(/\.$/, "")}`);
  assert.deepEqual(answer.lead, { label: "Plan spends more than it expects by", amountMinor: 120_000, currency: "SGD" });
  assert.equal(answer.entries, null);
  assert.deepEqual(answer.links, [{ kind: "month", label: "Open Month", month: "2026-10", viewId: "person-tim", scope: "direct" }]);
});

test("one big cost over plan: the month, the plan, the gap and the entries by id; Open in Entries shows exactly them", () => {
  const entries = [
    { id: "e-sofa", date: "2026-08-11", description: "COURTS MEGASTORE", amountMinor: 328_000, categoryName: "Home", entryType: "expense" },
    { id: "e-food", date: "2026-08-12", description: "Cold Storage", amountMinor: 12_000, categoryName: "Groceries", entryType: "expense" }
  ];
  const signal = oneOffOverPlanSignal({
    audience: "household", viewLabel: "Household", month: "2026-08", today: "2026-10-13", entries,
    planSections: [], incomeRows: [], summary: { estimatedExpensesMinor: 100_000, realExpensesMinor: 340_000 }, accountPills: [], formatMoney: sgd
  });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Spent in August 2026", amountMinor: 340_000 },
      { label: "Planned spending", amountMinor: 100_000 },
      { label: "Over the plan by", amountMinor: 240_000 },
      { label: "Courts Megastore on Tue 11 Aug", amountMinor: 328_000 }
    ],
    entries: { entryIds: ["e-sofa"], month: "2026-08" },
    month: "2026-08"
  });
  const answer = answerFor(signal);
  assert.deepEqual(answer.entries.entryIds, ["e-sofa"]);
  assert.deepEqual(answer.entries.categories, []);
  assert.deepEqual(answer.links.map((link) => [link.kind, link.label]), [
    ["entries", "Open in Entries"],
    ["month", "Open Month"],
    ["question", "How am I doing against the plan?"]
  ]);
  assert.deepEqual(answer.links[2].request, { viewId: "household", scope: "direct_plus_shared", month: "2026-08" });
});

test("a category over its plan: the plan line, its plan, the spend and the gap; Entries for that category in that month", () => {
  const signal = categoryOverPlanSignal({
    audience: "household", viewLabel: "Household", month: "2026-09", today: "2026-10-13", entries: [], incomeRows: [], summary: null, accountPills: [], formatMoney: sgd,
    planSections: [{ key: "budget_buckets", rows: [{ id: "b-food", label: "Food & Drinks", categoryName: "Food & Drinks", plannedMinor: 80_000, actualMinor: 104_550 }] }]
  });
  assert.deepEqual(signal.basis.lines, [
    { label: "Plan line", text: "Food & Drinks" },
    { label: "Planned for September 2026", amountMinor: 80_000 },
    { label: "Spent", amountMinor: 104_550 },
    { label: "Over the plan by", amountMinor: 24_550 }
  ]);
  const answer = answerFor(signal);
  assert.deepEqual(answer.entries, { month: "2026-09", viewId: "household", scope: "direct_plus_shared", search: "", categories: ["Food & Drinks"], wallets: [], type: "expense", minAmountMinor: null, maxAmountMinor: null, entryIds: [] });
});

test("a card bill: the bill, what's paid and what's left, with the due day", () => {
  const signal = cardBillSignal({
    accountPills: [{ accountId: "acct-citi", accountName: "Citi Rewards", ownerLabel: "Tim", cardBill: { statementMonth: "2026-09", statementEndDate: "2026-09-25", paymentDueDate: "2026-10-16", owedMinor: 120_000, minimumMinor: 5_000, paidSinceMinor: 20_000 } }],
    audience: "household", viewLabel: "Household", today: TODAY, formatMoney: sgd
  });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Card", text: "Citi Rewards (Tim)" },
      { label: "Statement", text: "September 2026" },
      { label: "Bill", amountMinor: 120_000 },
      { label: "Minimum payment", amountMinor: 5_000 },
      { label: "Paid since the statement", amountMinor: 20_000 },
      { label: "Still to pay", amountMinor: 100_000 },
      { label: "Due", text: "Fri 16 Oct" }
    ],
    entries: { accountId: "acct-citi", month: "2026-10" }
  });
  assert.deepEqual(answerFor(signal).lead, { label: "Still to pay", amountMinor: 100_000, currency: "SGD" });
});

test("a Splits balance in the group's own currency; Open Splits for that group and Who owes who?", () => {
  const signal = splitBalanceSignal({
    audience: "person", viewId: "person-tim", viewLabel: "Tim",
    people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    group: { id: "group-tokyo", name: "Tokyo trip", balanceMinor: -1_200_000, currency: "JPY" },
    activity: [], pendingMatchCount: 0, today: TODAY, formatMoney: (minor) => formatCurrencyMinor(minor, "JPY")
  });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Group", text: "Tokyo trip" },
      { label: "Open balance", amountMinor: 1_200_000, currency: "JPY" },
      { label: "Who owes whom", text: "Tim owes Joyce" }
    ],
    groupId: "group-tokyo"
  });
  const answer = answerFor(signal, { context: { viewId: "person-tim", scope: "direct_plus_shared", month: "2026-10" } });
  assert.deepEqual(answer.lead, { label: "Open balance", amountMinor: 1_200_000, currency: "JPY" });
  assert.equal(answer.entries, null);
  assert.deepEqual(answer.links, [
    { kind: "splits", label: "Open Splits", month: "2026-10", viewId: "person-tim", groupId: "group-tokyo" },
    { kind: "question", label: "Who owes who?", text: "Who owes who?", request: { viewId: "person-tim", scope: "direct_plus_shared", month: "2026-10" } }
  ]);
});

test("a settlement payment waiting to be matched: the payment, the settle-up day and how it counts, with both entries", () => {
  const signal = settlementPaymentSignal({
    audience: "household", viewId: "household", viewLabel: "Household", people: [], group: null, activity: [], pendingMatchCount: 0, today: TODAY, formatMoney: sgd,
    settlementCheckpoints: [{ id: "cp-1", fromPersonName: "Joyce", toPersonName: "Tim", settlementDate: "2026-08-27", paymentCandidate: { date: "2026-08-31", amountMinor: 708_217, entryIds: ["txn-joyce", "txn-tim"], countedAsSpending: true } }]
  });
  assert.deepEqual(signal.basis, {
    lines: [
      { label: "Payment from Joyce to Tim on Mon 31 Aug", amountMinor: 708_217 },
      { label: "Settle-up worked out on", text: "Thu 27 Aug" },
      { label: "Counted as spending", text: "Yes" }
    ],
    entries: { entryIds: ["txn-joyce", "txn-tim"], month: "2026-08" }
  });
});

test("Entries lines: expenses still in Other by category, a possible double charge by its two entries", () => {
  const entries = [
    { id: "t1", date: "2026-09-03", description: "GRAB* A-8XKD2", amountMinor: 1_240, categoryName: "Other", entryType: "expense" },
    { id: "t2", date: "2026-09-04", description: "SHOPEE SG", amountMinor: 3_990, categoryName: "Other", entryType: "expense" },
    { id: "t3", date: "2026-09-10", description: "Netflix", amountMinor: 1_998, categoryName: "Subscriptions", entryType: "expense" },
    { id: "t4", date: "2026-09-12", description: "Netflix", amountMinor: 1_998, categoryName: "Subscriptions", entryType: "expense" }
  ];
  const input = { audience: "household", month: "2026-09", today: TODAY, entries, formatMoney: sgd };
  const other = uncategorizedSignal(input);
  assert.deepEqual(other.basis, {
    lines: [{ label: "Expenses in Other in September 2026", text: "2" }, { label: "Their total", amountMinor: 5_230 }],
    entries: { categoryName: "Other", month: "2026-09", type: "expense" },
    month: "2026-09"
  });
  const double = possibleDuplicateSignal(input);
  assert.deepEqual(double.basis, {
    lines: [{ label: "Netflix on Thu 10 Sep", amountMinor: 1_998 }, { label: "Netflix on Sat 12 Sep", amountMinor: 1_998 }],
    entries: { entryIds: ["t3", "t4"], month: "2026-09" },
    month: "2026-09"
  });
  // Both lines hold the primary amount: the lead is the last of them.
  assert.deepEqual(answerFor(double).lead, { label: "Netflix on Sat 12 Sep", amountMinor: 1_998, currency: "SGD" });
  assert.deepEqual(answerFor(double).links.map((link) => link.kind), ["entries"]);
});

test("Summary lines: months spending more than came in, month by month, and a category that kept rising", () => {
  const month = (key, income, spend) => ({ month: key, plannedIncomeMinor: income, actualIncomeMinor: income, estimatedExpensesMinor: 0, realExpensesMinor: spend });
  const months = [month("2026-05", 1_000_000, 600_000), month("2026-06", 600_000, 700_000), month("2026-07", 600_000, 650_000), month("2026-08", 600_000, 900_000)];
  const base = { audience: "household", viewLabel: "Household", today: "2026-09-27", focusMonth: "", months, categoryShareByMonth: [], accountPills: [], accountKinds: {}, availableMonths: months.map((item) => item.month), formatMoney: sgd };
  const streak = spendingAboveIncomeSignal(base);
  assert.deepEqual(streak.basis, {
    lines: [
      { label: "More went out than came in, June 2026", amountMinor: 100_000 },
      { label: "More went out than came in, July 2026", amountMinor: 50_000 },
      { label: "More went out than came in, August 2026", amountMinor: 300_000 },
      { label: "Months in a row", text: "3" },
      { label: "More out than in, all those months", amountMinor: 450_000 }
    ],
    month: "2026-08"
  });
  const answer = answerFor(streak);
  assert.deepEqual(answer.links.map((link) => link.label), ["Open Month", "Why was August so expensive?"]);
  assert.equal(answer.links[1].text, "Why was August so expensive?");

  const shares = (values) => values.map(([key, valueMinor]) => ({ month: key, data: [{ label: "Food & Drinks", valueMinor }] }));
  const series = [["2025-12", 40_000], ["2026-01", 41_000], ["2026-02", 39_000], ["2026-03", 40_000], ["2026-04", 42_000], ["2026-05", 50_000], ["2026-06", 60_000], ["2026-07", 70_000]];
  const creep = categoryCreepSignal({ ...base, months: series.map(([key]) => month(key, 1_000_000, 500_000)), categoryShareByMonth: shares(series), availableMonths: series.map(([key]) => key) });
  assert.deepEqual(creep.basis, {
    lines: [
      { label: "Category", text: "Food & Drinks" },
      { label: "Months it rose in a row", text: "5" },
      { label: "Spent in February 2026", amountMinor: 39_000 },
      { label: "Spent in July 2026", amountMinor: 70_000 },
      { label: "Above its average month (the 7 months before) by", amountMinor: 25_429 }
    ],
    entries: { categoryName: "Food & Drinks", month: "2026-07", type: "expense" },
    month: "2026-07"
  });
});

test("bank account lines: a missed payment with its charge, own money counted as income with both entries", () => {
  const pill = { accountId: "acct-ocbc-360", accountName: "OCBC 360", ownerLabel: "Joyce" };
  const missed = missedPaymentsSignal({
    accountPills: [{ ...pill, missedPayments: [{ payee: "Ifast Financial", dueDate: "2026-09-23", amountMinor: 100_000, chargeMinor: 1_000 }] }],
    audience: "household", viewLabel: "Household", today: TODAY, formatMoney: sgd
  });
  assert.deepEqual(missed.basis, {
    lines: [
      { label: "Account", text: "OCBC 360 (Joyce)" },
      { label: "Payment to Ifast Financial due Wed 23 Sep", amountMinor: 100_000 },
      { label: "Bank charge for the failed payment", amountMinor: 1_000 }
    ],
    entries: { accountId: "acct-ocbc-360", month: "2026-09" },
    month: "2026-09"
  });
  const own = ownTransferIncomeSignal({
    accountPills: [{ ...pill, ownTransfersAsIncome: [{ entryId: "in-1", fromEntryId: "out-1", fromAccountName: "UOB One", amountMinor: 250_000, date: "2026-09-05", fromDate: "2026-09-05", categoryName: "Other - Income" }] }],
    audience: "household", viewLabel: "Household", today: TODAY, formatMoney: sgd
  });
  assert.deepEqual(own.basis, {
    lines: [
      { label: "Account", text: "OCBC 360 (Joyce)" },
      { label: "Moved in from", text: "UOB One" },
      { label: "Moves counted as income", text: "1" },
      { label: "Largest, on Sat 5 Sep", amountMinor: 250_000 },
      { label: "Counted as income in all", amountMinor: 250_000 }
    ],
    entries: { entryIds: ["in-1", "out-1"], month: "2026-09" },
    month: "2026-09"
  });
});

// Every line that can lead or sit under Also, from broad inputs on every
// page: each has a basis Ask and the route accept, in plain words.
test("every headline-kind signal has a basis the route accepts, in plain words, and its figures are its own", () => {
  const pills = [
    ...statementPills,
    { accountId: "acct-citi", accountName: "Citi Rewards", ownerLabel: "Tim", cardBill: { statementMonth: "2026-09", statementEndDate: "2026-09-25", paymentDueDate: "2026-10-16", owedMinor: 120_000, paidSinceMinor: 0 }, unreversedCharges: [{ date: "2026-10-01", kind: "late_fee", amountMinor: 10_000 }, { date: "2026-10-02", kind: "interest", amountMinor: 2_345 }], cardNotices: { statementMonth: "2026-09", owedMinor: 120_000, notices: [{ code: "penalty_interest", annualRatePercent: 29.9 }] } }
  ];
  const signals = [
    ...buildSummarySignals({ audience: "household", viewLabel: "Household", today: "2026-10-13", focusMonth: "", months: [], categoryShareByMonth: [], accountPills: pills, accountKinds: {}, availableMonths: [], formatMoney: sgd }),
    ...buildAccountSignals({ accountPills: [{ accountId: "acct-ocbc-360", accountName: "OCBC 360", ownerLabel: "Joyce", accountCharges: [{ date: "2026-10-02", kind: "failed_payment", amountMinor: 1_000 }] }], audience: "household", viewLabel: "Household", today: TODAY, formatMoney: sgd }),
    ...buildEntriesSignals({ audience: "household", month: "2026-10", today: TODAY, entries: [
      { id: "a", date: "2026-10-02", description: "Netflix", amountMinor: 1_998, categoryName: "Other", entryType: "expense" },
      { id: "b", date: "2026-10-03", description: "Netflix", amountMinor: 1_998, categoryName: "Other", entryType: "expense" }
    ], formatMoney: sgd }),
    ...buildMonthSignals({ audience: "household", viewLabel: "Household", month: "2026-10", today: "2026-10-13", entries: [], planSections: [{ key: "planned_items", rows: [{ id: "r1", label: "Singtel", categoryName: "Bills", planDate: "2026-10-02", plannedMinor: 4_500, actualMinor: 0 }] }], incomeRows: [], summary: { estimatedExpensesMinor: 500_000, realExpensesMinor: 200_000, plannedIncomeMinor: 800_000, actualIncomeMinor: 800_000 }, accountPills: [], formatMoney: sgd })
  ].filter((signal) => HEADLINE_KIND_ORDER.includes(signal.kind));
  const types = new Set(signals.map((signal) => signal.key.split(":")[0]));
  for (const type of ["statement-gap", "card-bill", "bank-charges", "penalty-interest", "account-charges", "uncategorized", "duplicate", "unlinked-bills", "plan-pace"]) {
    assert.ok(types.has(type), `${type} fired`);
  }
  for (const signal of signals) {
    assert.ok(signal.basis?.lines.length, `${signal.key} has a basis`);
    const request = readInsightExplainRequest({ kind: signal.kind, fact: signal.phrasings[0].fact, think: signal.phrasings[0].think, lines: signal.basis.lines });
    assert.ok(request, `${signal.key}: the route reads its basis`);
    for (const line of signal.basis.lines) {
      assert.deepEqual(findAppJargon(line.label), [], `${signal.key}: ${line.label}`);
      if (line.amountMinor !== undefined) assert.ok(Number.isSafeInteger(line.amountMinor), `${signal.key}: ${line.label}`);
    }
    // The figure the line is about is one of its basis lines.
    assert.ok(buildInsightAnswer(readInsightHandoff(handoff(signal)), { today: TODAY }).question.startsWith("Explain: "));
  }
});

test("every follow-up question is one Ask's answer reader already answers, for the insight's month", () => {
  const context = { today: TODAY, month: "2026-08", people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }], vocabulary: [] };
  assert.deepEqual(readAnswerIntent("How am I doing against the plan?", context), { kind: "plan", month: "2026-08" });
  assert.deepEqual(readAnswerIntent("How much income came in?", context), { kind: "income", month: "2026-08" });
  assert.deepEqual(readAnswerIntent("Who owes who?", context), { kind: "owed", personId: null });
  assert.deepEqual(readAnswerIntent("What were the biggest expenses?", context), { kind: "biggest", month: "2026-08" });
  assert.deepEqual(readAnswerIntent("Why was August so expensive?", context), { kind: "spending", focus: "why", month: "2026-08" });
});

test("a hand-off that is not an insight is refused; an odd context falls back to the household", () => {
  const signal = statementGapSignal({ accountPills: statementPills, audience: "household", viewLabel: "Household", formatMoney: sgd });
  const good = handoff(signal);
  assert.equal(readInsightHandoff(null), null);
  assert.equal(readInsightHandoff({ ...good, kind: "just_for_fun" }), null);
  assert.equal(readInsightHandoff({ ...good, fact: "   " }), null);
  assert.equal(readInsightHandoff({ ...good, key: 42 }), null);
  const odd = readInsightHandoff({ ...good, context: { viewId: "", scope: "everyone", month: "September" }, basis: { lines: [{ label: "", text: "x" }, { label: "Bad", amountMinor: 1.5 }, ...good.basis.lines], entries: { entryIds: [7] }, month: "2026-9" } });
  assert.deepEqual(odd.context, { viewId: "household", scope: "direct_plus_shared", month: "" });
  // Malformed lines are dropped; a fractional amount is not money.
  assert.deepEqual(odd.basis.lines, good.basis.lines);
  assert.equal(odd.basis.entries, null);
  assert.equal(odd.basis.month, "");
  assert.deepEqual(insightExplainBody(readInsightHandoff(good)), { kind: "quick_fix", fact: good.fact, think: good.think, lines: good.basis.lines });
});

test("the question reads as a request, and the AI sees the facts with personal numbers removed", () => {
  assert.equal(insightQuestionText("  Your plan is $120.00 short.  "), "Explain: Your plan is $120.00 short");
  assert.equal(insightQuestionText(""), "");
  assert.equal(stripPersonalNumbers("PAYNOW TRANSFER 91234567 JOHN TAN"), "PAYNOW TRANSFER JOHN TAN");
  assert.equal(stripPersonalNumbers("FAST PAYMENT to 0123-4567-8901 S1234567A ref 12 Sep"), "FAST PAYMENT to ref 12 Sep");
  assert.equal(stripPersonalNumbers("Card 4111 1111 1111 1111 on 3 Aug, $1,234.50"), "Card on 3 Aug, $1,234.50");
  const request = readInsightExplainRequest({
    kind: "worth_a_look",
    fact: "PAYNOW 91234567 came to $42.80.",
    think: "A gap like this is usually one payment missing.",
    lines: [{ label: "Payment to 91234567 on 3 Aug", amountMinor: 4_280 }, { label: "Group", text: "Tokyo trip" }, { label: "Open balance", amountMinor: 1_200_000, currency: "JPY" }]
  });
  assert.deepEqual(buildInsightPromptFacts(request), [
    "The insight: PAYNOW came to $42.80.",
    "A way to think about it: A gap like this is usually one payment missing.",
    "Payment to on 3 Aug: $42.80",
    "Group: Tokyo trip",
    "Open balance: JP¥12,000"
  ]);
  assert.equal(insightPromptQuestion(request), "Explain: PAYNOW came to $42.80");
});

test("the route reads only a bounded insight: a known kind, a short line, at most 12 well-formed lines", () => {
  const line = { label: "Bill", amountMinor: 120_000 };
  const base = { kind: "quick_fix", fact: "Your bill is due.", think: "", lines: [line] };
  assert.deepEqual(readInsightExplainRequest(base), { kind: "quick_fix", fact: "Your bill is due.", think: "", lines: [line] });
  for (const bad of [
    null,
    [],
    { ...base, kind: "just_for_fun" },
    { ...base, fact: "" },
    { ...base, fact: "x".repeat(401) },
    { ...base, lines: "Bill" },
    { ...base, lines: Array.from({ length: 13 }, () => line) },
    { ...base, lines: [{ label: "Bill", amountMinor: 12.5 }] },
    { ...base, lines: [{ label: "Bill", amountMinor: 1e15 }] },
    { ...base, lines: [{ label: "Bill", amountMinor: 100, currency: "dollars" }] },
    { ...base, lines: [{ label: "", text: "x" }] },
    { ...base, lines: [{ label: "Note", text: "y".repeat(121) }] }
  ]) {
    assert.equal(readInsightExplainRequest(bad), null, JSON.stringify(bad)?.slice(0, 80));
  }
});
