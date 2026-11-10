// POST /api/ai-assist/answer through the real Worker and a real local D1
// seeded with the showcase household (Ethan and Serene, seed month
// 2026-05; docs/demo-tour.md). With AI off, every answer is the computed
// one, and every figure equals what the screens show for the same view and
// month: the Month page DTO's cards, Spending Mix and plan rows, the
// Entries page through Entries' own filtering, and the Splits page
// balances. The route only reads: the database is identical afterwards.
import assert from "node:assert/strict";
import test from "node:test";

import { assertSameDatabase, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";
import { summarizeFilterAnswer } from "../src/client/ask-filter-answer.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";

const SHOWCASE_VARS = { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-05" };
const ETHAN = "person-ethan";
const SERENE = "person-serene";

let showcase;
test.before(async () => {
  showcase = await createSeededTemplate({ vars: SHOWCASE_VARS });
});
test.after(async () => {
  await showcase?.dispose();
});

async function ask(api, text, { viewId = "household", month = "2026-05", scope = "direct_plus_shared", keepCandidateIds } = {}) {
  const response = await api("/api/ai-assist/answer", { text, viewId, month, scope, ...(keepCandidateIds ? { keepCandidateIds } : {}) });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function get(api, path) {
  const response = await api(path);
  assert.equal(response.status, 200, path);
  return response.payload;
}

const card = (cards, label) => cards.find((item) => item.label === label)?.amountMinor;

// The Month lead for a Month page (month-lead-model.js): its "Spent" and its
// "of $X plan" are the spend job's (splitMoneyUse), which the plan answer
// reads too.
function monthLead(page) {
  const cards = buildMonthMetricCards({ planSections: page.monthPage.planSections, incomeRows: page.monthPage.incomeRows, currentMonthSummary: page.summaryPage.months[0] });
  return buildMonthLeadModel(cards, page.summaryPage.months[0], {
    planRows: page.monthPage.planSections.flatMap((section) => section.rows),
    categoryShare: page.monthPage.categoryShareChart
  });
}

test("why was March so expensive: the Month page's figures, plan, Spending Mix and biggest costs", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "why was March so expensive?");
  const march = await get(api, "/api/month-page?view=household&month=2026-03&scope=direct_plus_shared");
  const february = await get(api, "/api/month-page?view=household&month=2026-02&scope=direct_plus_shared");

  assert.equal(payload.supported, true);
  assert.equal(payload.intent, "spending");
  assert.deepEqual(payload.months, ["2026-03"]);
  assert.equal(payload.needsConfirmation, false);
  const { answer } = payload;
  // The lead is Month's Actual spend card, measured against its Planned spend.
  assert.equal(answer.lead.amountMinor, card(march.monthPage.metricCards, "Actual spend"));
  assert.equal(answer.lead.planMinor, card(march.monthPage.metricCards, "Planned spend"));
  assert.deepEqual([answer.lead.amountMinor, answer.lead.planMinor], [813467, 693644]);
  // Over plan, so the summary figure is rose.
  assert.equal(answer.lead.tone, "short");
  assert.equal(answer.title, "March spending");
  assert.deepEqual(answer.support, [
    { label: "Plan", amountMinor: 693644, currency: "SGD" },
    { label: "February", amountMinor: card(february.monthPage.metricCards, "Actual spend"), currency: "SGD" },
    { label: "Home", percent: 54 },
    { label: "Family & Personal", percent: 10 }
  ]);
  // The categories are Month's Spending Mix, largest first.
  const mix = march.monthPage.categoryShareChart.slice(0, 3);
  assert.deepEqual(answer.lines.filter((line) => line.tone === "neutral").map((line) => [line.label, line.amountMinor]), mix.map((datum) => [datum.label, datum.valueMinor]));
  assert.deepEqual(answer.lines.filter((line) => line.tone === "out").map((line) => [line.label, line.detail, line.amountMinor]), [
    ["Courts Megastore Tampines", "11 Mar · Home", 268000],
    ["Castlery", "19 Mar · Home", 159000],
    ["HDB Housing Loan Giro", "1 Mar · Loans", 62000]
  ]);
  assert.equal(payload.wording.source, "template");
  assert.equal(payload.wording.text, "March came to $8,134.67, $1,198.23 more than the $6,936.44 you planned. That's $4,213.21 more than February. Home took the most at $4,390.00, and the biggest single cost was Courts Megastore Tampines at $2,680.00.");
  assert.deepEqual(payload.ai, { requested: false, available: false, reason: "AI assistance is turned off." });
  assert.deepEqual(answer.links.map((link) => link.kind), ["entries", "month"]);
  assert.deepEqual(answer.links[1], { kind: "month", label: "Open Month", month: "2026-03", viewId: "household", scope: "direct_plus_shared" });

  // Open in Entries shows every March expense: its spend total is the lead.
  const entriesPage = await get(api, "/api/entries-page?view=household&month=2026-03");
  const opened = summarizeFilterAnswer(entriesPage, answer.links[0].filter);
  assert.equal(opened.totals.grossSpendMinor, entriesPage.monthPage.entries.filter((entry) => entry.entryType === "expense").reduce((sum, entry) => sum + entry.amountMinor, 0));
  assert.ok(opened.entryIds.length > 3);
  // "Spent · N expenses" counts the rows Open in Entries shows.
  assert.equal(answer.lead.label, `Spent · ${opened.count} expenses`);
});

test("where did April go leads with the categories, then the biggest cost and the plan", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "where did April go?");
  assert.equal(payload.intent, "spending");
  assert.equal(payload.answer.lead.tone, "neutral");
  assert.deepEqual(payload.answer.lines.slice(0, 3).map((line) => line.label), ["Family & Personal", "Loans", "Food & Drinks"]);
  assert.equal(payload.wording.text, "April came to $3,667.57, and the largest shares went to family & personal ($800.00), loans ($620.00) and food & drinks ($578.13). The biggest single cost was HDB Housing Loan Giro at $620.00. That's $3,268.87 under the $6,936.44 you planned.");
});

test("how am I doing against the plan: Month's cards and the plan rows that went over", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "how am I doing against the plan?");
  const may = await get(api, "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared");
  assert.equal(payload.intent, "plan");
  assert.equal(payload.answer.title, "May against plan");
  // The Month lead's figures: the spend plan leaves out the savings target
  // and the investment lines (Endowus, StashAway and May's IBKR top-up).
  assert.equal(payload.answer.lead.amountMinor, monthLead(may).spent.amountMinor);
  assert.equal(payload.answer.lead.planMinor, monthLead(may).plannedSpendMinor);
  assert.equal(monthLead(may).plannedSpendMinor, card(may.monthPage.metricCards, "Planned spend") - card(may.monthPage.metricCards, "Savings target") - 200_000);
  assert.equal(payload.answer.outcome.plannedInvestMinor, 200_000);
  const rows = may.monthPage.planSections.flatMap((section) => section.rows);
  for (const line of payload.answer.lines) {
    const row = rows.find((item) => item.label === line.label);
    assert.deepEqual([line.amountMinor, line.secondary.amountMinor], [row.actualMinor, row.plannedMinor], line.label);
    assert.equal(line.tone, "short");
  }
  assert.deepEqual(payload.answer.lines.map((line) => [line.label, line.amountMinor, line.secondary.amountMinor]), [["Beauty", 8985, 6500], ["Pet Care", 7241, 7000]]);
  assert.deepEqual(payload.answer.support, [
    { label: "Plan", amountMinor: 413644, currency: "SGD" },
    { label: "Income", amountMinor: may.summaryPage.months[0].actualIncomeMinor, currency: "SGD" }
  ]);
  assert.equal(payload.wording.text, "May came to $3,989.60, $146.84 under the $4,136.44 you planned. Beauty went furthest over, at $89.85 against $65.00 planned. Income was $10,900.40 against $10,060.00 planned.");
});

test("how did April go: intent against outcome with the Month lead's figures and the savings bar's", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "how did April go?", { viewId: ETHAN });
  const april = await get(api, `/api/month-page?view=${ETHAN}&month=2026-04&scope=direct_plus_shared`);
  assert.equal(payload.intent, "plan");
  assert.deepEqual(payload.months, ["2026-04"]);
  assert.equal(payload.answer.title, "April against plan");
  // The lead reads exactly as the Month lead: "Spent" and "of $X plan".
  assert.equal(payload.answer.lead.amountMinor, monthLead(april).spent.amountMinor);
  assert.equal(payload.answer.lead.planMinor, monthLead(april).plannedSpendMinor);
  // The figures the Month lead's savings bar draws, each the page's own,
  // which the card splits with the same splitMoneyUse.
  assert.deepEqual(payload.answer.outcome, {
    incomeMinor: april.summaryPage.months[0].actualIncomeMinor,
    spentMinor: card(april.monthPage.metricCards, "Actual spend"),
    plannedSpendMinor: card(april.monthPage.metricCards, "Planned spend"),
    savingsTargetMinor: card(april.monthPage.metricCards, "Savings target"),
    investedMinor: 0,
    savedMovedMinor: 0,
    // Ethan's monthly GIRO into Endowus, planned and done.
    plannedInvestMinor: 60_000,
    movedIntoInvestmentsMinor: april.monthPage.investmentMoves.intoMinor
  });
  assert.equal(april.monthPage.investmentMoves.intoMinor, 60_000);
  assert.deepEqual(payload.answer.links.map((link) => [link.kind, link.label, link.month ?? link.filter?.month]), [["month", "Open Month", "2026-04"], ["entries", "Open in Entries", "2026-04"]]);
  assert.equal(payload.wording.source, "template");
});

test("did we stick to the plan in Q2: each month against its plan, their sum, and Month for the last month", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const payload = await ask(api, "did we stick to the plan in Q2 2026?");
  // June is not in the showcase yet (Month would show May for it): it adds nothing.
  const tracked = await Promise.all(["2026-04", "2026-05"].map((month) => get(api, `/api/month-page?view=household&month=${month}&scope=direct_plus_shared`)));
  assert.deepEqual(tracked.map((page) => page.monthPage.month), ["2026-04", "2026-05"]);
  const sum = (label) => tracked.reduce((total, page) => total + card(page.monthPage.metricCards, label), 0);
  assert.equal(payload.intent, "plan");
  assert.deepEqual(payload.months, ["2026-04", "2026-05", "2026-06"]);
  assert.equal(payload.answer.title, "April to June against plan");
  const leadSum = (pick) => tracked.reduce((total, page) => total + pick(monthLead(page)), 0);
  assert.equal(payload.answer.lead.amountMinor, leadSum((lead) => lead.spent.amountMinor));
  assert.equal(payload.answer.lead.planMinor, leadSum((lead) => lead.plannedSpendMinor));
  assert.deepEqual(payload.answer.outcome, {
    incomeMinor: tracked.reduce((total, page) => total + page.summaryPage.months[0].actualIncomeMinor, 0),
    spentMinor: sum("Actual spend"),
    plannedSpendMinor: sum("Planned spend"),
    savingsTargetMinor: sum("Savings target"),
    investedMinor: 0,
    savedMovedMinor: 0,
    plannedInvestMinor: 300_000,
    movedIntoInvestmentsMinor: tracked.reduce((total, page) => total + page.monthPage.investmentMoves.intoMinor, 0)
  });
  // June has nothing yet, so only April and May are lines, then plan rows:
  // each month as its Month lead reads it.
  assert.deepEqual(payload.answer.lines.slice(0, 2).map((line) => [line.label, line.amountMinor, line.secondary.amountMinor]), tracked.map((page, index) => [
    ["April", "May"][index],
    monthLead(page).spent.amountMinor,
    monthLead(page).plannedSpendMinor
  ]));
  assert.deepEqual(payload.answer.links, [{ kind: "month", label: "Open Month", month: "2026-06", viewId: "household", scope: "direct_plus_shared" }]);
  assert.match(payload.wording.text, /^April to June came to \$[\d,]+\.\d\d, \$[\d,]+\.\d\d (more than|under) the \$[\d,]+\.\d\d you planned\./);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("compare March with February: both months' spend and the categories that moved most", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "compare March with February");
  assert.equal(payload.intent, "compare");
  assert.deepEqual(payload.months, ["2026-03", "2026-02"]);
  assert.deepEqual(payload.answer.support, [{ label: "February", amountMinor: 392146, currency: "SGD" }]);
  assert.deepEqual(payload.answer.lines[0], { label: "Home", amountMinor: 439000, currency: "SGD", tone: "neutral", secondary: { kind: "compare", label: "February", amountMinor: 0 } });
  assert.equal(payload.wording.text, "March came to $8,134.67, $4,213.21 more than February's $3,921.46. The biggest change was home: $4,390.00 in March against $0.00 in February. Income was $10,118.80 in March and $10,664.92 in February.");
});

test("the biggest expenses are the view's five largest, and Open in Entries shows exactly those", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "what were the biggest expenses in March?");
  assert.equal(payload.intent, "biggest");
  const { answer } = payload;
  assert.equal(answer.title, "Biggest in March");
  assert.deepEqual(answer.lead, { label: "Courts Megastore Tampines", amountMinor: 268000, currency: "SGD", tone: "neutral" });
  assert.deepEqual(answer.support, [{ label: "Home" }, { label: "11 Mar" }]);
  assert.equal(answer.lines.length, 5);
  assert.ok(answer.lines.every((line) => line.tone === "out"));

  const entriesPage = await get(api, "/api/entries-page?view=household&month=2026-03");
  const expenses = entriesPage.monthPage.entries.filter((entry) => entry.entryType === "expense").sort((left, right) => right.amountMinor - left.amountMinor);
  assert.deepEqual(answer.lines.map((line) => line.amountMinor), expenses.slice(0, 5).map((entry) => entry.amountMinor));
  const opened = summarizeFilterAnswer(entriesPage, answer.links[0].filter);
  assert.equal(answer.links[0].filter.minAmountMinor, expenses[4].amountMinor);
  assert.equal(opened.count, expenses.filter((entry) => entry.amountMinor >= expenses[4].amountMinor).length);
  assert.equal(payload.wording.text, "Your biggest expense in March was Courts Megastore Tampines at $2,680.00 on 11 Mar. Next came Castlery at $1,590.00 and HDB Housing Loan Giro at $620.00.");
});

test("what do I owe Serene: Ethan's Splits balances plus the settle-up still to pay", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "what do I owe Serene?");
  const splits = await get(api, `/api/splits-page?view=${ETHAN}&month=2026-05`);
  assert.equal(payload.intent, "owed");
  const groups = splits.splitsPage.groups.filter((group) => group.balanceMinor !== 0);
  const balanceLines = payload.answer.lines.filter((line) => line.label !== "Settle-up to pay");
  assert.deepEqual(
    balanceLines.map((line) => [line.label, line.amountMinor, line.currency]).sort(),
    groups.map((group) => [group.name, Math.abs(group.balanceMinor), group.currency]).sort()
  );
  const open = splits.splitsPage.settlementCheckpoints.filter((checkpoint) => checkpoint.status === "open" || checkpoint.status === "partially_matched");
  const homeNet = groups.filter((group) => group.currency === "SGD").reduce((sum, group) => sum + group.balanceMinor, 0)
    + open.reduce((sum, checkpoint) => sum + (checkpoint.toPersonId === ETHAN ? 1 : -1) * (checkpoint.amountMinor - (checkpoint.matchedAmountMinor ?? 0)), 0);
  assert.deepEqual(payload.answer.lead, { label: "Balance", amountMinor: Math.abs(homeNet), currency: "SGD", tone: "in" });
  assert.equal(homeNet, 85536);
  assert.deepEqual(payload.answer.links, [{ kind: "splits", label: "Open Splits", month: "2026-05", viewId: "household", groupId: "split-group-japan-trip" }]);
  assert.equal(payload.wording.text, "Serene owes you $855.36 on Splits. That's $798.51 from the 6 Apr settle-up and $166.35 for Home & Bills, less $109.50 for Dinners out. Japan trip has JP¥26,730 still open.");

  // On the household view with nobody named, both names are used.
  const household = await ask(api, "who owes who?");
  assert.equal(household.answer.lead.tone, "neutral");
  assert.match(household.wording.text, /^Serene owes Ethan \$855\.36 on Splits\./);
  // Serene's own view says it from her side.
  const sereneView = await ask(api, "what do I owe Ethan?", { viewId: SERENE });
  assert.equal(sereneView.answer.lead.tone, "short");
  assert.match(sereneView.wording.text, /^You owe Ethan \$855\.36 on Splits\./);
});

test("income for a person view is that person's income, against their plan", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "how much income came in in April?", { viewId: ETHAN });
  const april = await get(api, `/api/month-page?view=${ETHAN}&month=2026-04&scope=direct_plus_shared`);
  assert.equal(payload.intent, "income");
  assert.equal(payload.viewId, ETHAN);
  assert.equal(payload.answer.lead.amountMinor, april.summaryPage.months[0].actualIncomeMinor);
  assert.equal(payload.answer.lead.planMinor, april.summaryPage.months[0].plannedIncomeMinor);
  assert.deepEqual(payload.answer.lead, { label: "Came in · 2 entries", amountMinor: 570793, currency: "SGD", tone: "in", planMinor: 568000, overIsShort: false });
  assert.equal(payload.wording.text, "$5,707.93 came in during April, $27.93 more than the $5,680.00 you planned. The largest part was salary at $5,680.00. March brought in $5,719.90.");
});

test("a person view and scope count what Month counts for them", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "where did March go?", { viewId: SERENE, scope: "direct" });
  const march = await get(api, `/api/month-page?view=${SERENE}&month=2026-03&scope=direct`);
  assert.equal(payload.scope, "direct");
  assert.equal(payload.answer.lead.amountMinor, card(march.monthPage.metricCards, "Actual spend"));
  assert.deepEqual(payload.answer.lines.slice(0, 3).map((line) => line.amountMinor), march.monthPage.categoryShareChart.slice(0, 3).map((datum) => datum.valueMinor));
  assert.deepEqual(payload.answer.links[0].filter, {
    month: "2026-03", viewId: SERENE, scope: "direct", search: "", categories: [], wallets: [], type: "expense", minAmountMinor: null, maxAmountMinor: null
  });
});

test("a month with no entries says so instead of borrowing another month", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "why was November 2024 so expensive?");
  assert.deepEqual(payload.months, ["2024-11"]);
  assert.equal(payload.answer.lead.amountMinor, 0);
  assert.equal(payload.wording.text, "There are no entries for November 2024 yet.");
  const compare = await ask(api, "compare March 2026 with March 2024");
  assert.deepEqual(compare.months, ["2026-03", "2024-03"]);
  assert.equal(compare.wording.text, "March came to $8,134.67. There are no entries for March 2024 to compare it with.");
});

// If this keeps up (ask-pace.ts; DOMAIN.md "Pace"): a month that has ended
// has no pace (Month's Actual spend and plan, no parts, no AI wording);
// today's month gets the pace answer, a range or a plain quiet reason, from
// the Subscriptions and bills read. Never a safe-to-spend line.
test("if this keeps up: May has ended, and today's month is the pace answer; nothing is written", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const may = await ask(api, "How will May 2026 end if this keeps up?");
  const mayPage = await get(api, "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared");
  const mayCards = buildMonthMetricCards({ planSections: mayPage.monthPage.planSections, incomeRows: mayPage.monthPage.incomeRows, currentMonthSummary: mayPage.summaryPage.months[0] });
  assert.equal(may.intent, "pace");
  assert.equal(may.answer.title, "If this keeps up");
  assert.equal(may.answer.lead.label, "Spent so far in May");
  assert.equal(may.answer.lead.amountMinor, card(mayCards, "Actual spend"));
  assert.deepEqual(may.answer.lines, []);
  assert.equal(may.wording.text, "May has already ended, so there is nothing still to come.");
  assert.equal(may.ai.requested, false);

  const now = await ask(api, "where will this month end up?", { month: todayInAppTimeZone().slice(0, 7) });
  assert.equal(now.intent, "pace");
  assert.equal(now.answer.title, "If this keeps up");
  assert.match(now.wording.text, /^(?:If this keeps up, \w+'s spending ends at about \$[\d,]+ to \$[\d,]+ by \d+ \w{3}|It's too early in \w+ to say where it ends|There isn't enough history yet|The latest statements aren't in yet)/);
  assert.doesNotMatch(now.wording.text, /\bsafe|can afford|you'll be fine|will have\b/i);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("an unsupported question, a bad body or a GET is refused plainly, and nothing is written", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, showcase);
  await ask(api, "why was March so expensive?");
  const before = await dumpDatabase(db);
  assert.deepEqual(await ask(api, "What's the weather like?"), { ok: true, supported: false });
  assert.deepEqual(await ask(api, "how much on bills?"), { ok: true, supported: false });
  await ask(api, "why was March so expensive?");
  await ask(api, "what do I owe Serene?");
  assertSameDatabase(await dumpDatabase(db), before);

  const missing = await api("/api/ai-assist/answer", { viewId: "household" });
  assert.deepEqual([missing.status, missing.payload.ok], [400, false]);
  const long = await api("/api/ai-assist/answer", { text: `why ${"so ".repeat(200)}expensive?` });
  assert.deepEqual([long.status, long.payload.error], [400, "The question is too long."]);
  const get = await fetch("/api/ai-assist/answer");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});
