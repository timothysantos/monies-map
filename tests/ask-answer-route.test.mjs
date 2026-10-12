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
  assert.deepEqual([answer.lead.amountMinor, answer.lead.planMinor], [1039123, 726309]);
  // Over plan, so the summary figure is rose.
  assert.equal(answer.lead.tone, "short");
  assert.equal(answer.title, "March spending");
  assert.deepEqual(answer.support, [
    { label: "Plan", amountMinor: 726309, currency: "SGD" },
    { label: "February", amountMinor: card(february.monthPage.metricCards, "Actual spend"), currency: "SGD" },
    { label: "Home", percent: 54 },
    { label: "Loans", percent: 14 }
  ]);
  // The categories are Month's Spending Mix, largest first.
  const mix = march.monthPage.categoryShareChart.slice(0, 3);
  assert.deepEqual(answer.lines.filter((line) => line.tone === "neutral").map((line) => [line.label, line.amountMinor]), mix.map((datum) => [datum.label, datum.valueMinor]));
  assert.deepEqual(answer.lines.filter((line) => line.tone === "out").map((line) => [line.label, line.detail, line.amountMinor]), [
    ["Courts Megastore Tampines", "11 Mar · Home", 328000],
    ["Castlery", "19 Mar · Home", 219000],
    ["HDB Housing Loan Giro", "1 Mar · Loans", 148000]
  ]);
  assert.equal(payload.wording.source, "template");
  assert.equal(payload.wording.text, "March came to $10,391.23, $3,128.14 more than the $7,263.09 you planned. That's $5,684.61 more than February. Home took the most at $5,650.00, and the biggest single cost was Courts Megastore Tampines at $3,280.00.");
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
  assert.deepEqual(payload.answer.lines.slice(0, 3).map((line) => line.label), ["Loans", "Groceries", "Food & Drinks"]);
  assert.equal(payload.wording.text, "April came to $4,575.39, and the largest shares went to loans ($1,480.00), groceries ($680.09) and food & drinks ($555.64). The biggest single cost was HDB Housing Loan Giro at $1,480.00. That's $2,687.70 under the $7,263.09 you planned.");
});

test("how am I doing against the plan: Month's cards and the plan rows that went over", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "how am I doing against the plan?");
  const may = await get(api, "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared");
  assert.equal(payload.intent, "plan");
  assert.equal(payload.answer.title, "May against plan");
  assert.equal(payload.answer.lead.amountMinor, card(may.monthPage.metricCards, "Actual spend"));
  assert.equal(payload.answer.lead.planMinor, card(may.monthPage.metricCards, "Planned spend"));
  const rows = may.monthPage.planSections.flatMap((section) => section.rows);
  for (const line of payload.answer.lines) {
    const row = rows.find((item) => item.label === line.label);
    assert.deepEqual([line.amountMinor, line.secondary.amountMinor], [row.actualMinor, row.plannedMinor], line.label);
    assert.equal(line.tone, "short");
  }
  assert.deepEqual(payload.answer.lines.map((line) => [line.label, line.amountMinor, line.secondary.amountMinor]), [["Groceries", 72341, 62000], ["Beauty", 8800, 4500]]);
  assert.deepEqual(payload.answer.support, [
    { label: "Plan", amountMinor: 726309, currency: "SGD" },
    { label: "Income", amountMinor: may.summaryPage.months[0].actualIncomeMinor, currency: "SGD" }
  ]);
  assert.equal(payload.wording.text, "May came to $4,697.36, $2,565.73 under the $7,263.09 you planned. Groceries went furthest over, at $723.41 against $620.00 planned. Income was $14,669.48 against $13,500.00 planned.");
});

test("compare March with February: both months' spend and the categories that moved most", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "compare March with February");
  assert.equal(payload.intent, "compare");
  assert.deepEqual(payload.months, ["2026-03", "2026-02"]);
  assert.deepEqual(payload.answer.support, [{ label: "February", amountMinor: 470662, currency: "SGD" }]);
  assert.deepEqual(payload.answer.lines[0], { label: "Home", amountMinor: 565000, currency: "SGD", tone: "neutral", secondary: { kind: "compare", label: "February", amountMinor: 0 } });
  assert.equal(payload.wording.text, "March came to $10,391.23, $5,684.61 more than February's $4,706.62. The biggest change was home: $5,650.00 in March against $0.00 in February. Income was $13,510.00 in March and $15,516.38 in February.");
});

test("the biggest expenses are the view's five largest, and Open in Entries shows exactly those", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "what were the biggest expenses in March?");
  assert.equal(payload.intent, "biggest");
  const { answer } = payload;
  assert.equal(answer.title, "Biggest in March");
  assert.deepEqual(answer.lead, { label: "Courts Megastore Tampines", amountMinor: 328000, currency: "SGD", tone: "neutral" });
  assert.deepEqual(answer.support, [{ label: "Home" }, { label: "11 Mar" }]);
  assert.equal(answer.lines.length, 5);
  assert.ok(answer.lines.every((line) => line.tone === "out"));

  const entriesPage = await get(api, "/api/entries-page?view=household&month=2026-03");
  const expenses = entriesPage.monthPage.entries.filter((entry) => entry.entryType === "expense").sort((left, right) => right.amountMinor - left.amountMinor);
  assert.deepEqual(answer.lines.map((line) => line.amountMinor), expenses.slice(0, 5).map((entry) => entry.amountMinor));
  const opened = summarizeFilterAnswer(entriesPage, answer.links[0].filter);
  assert.equal(answer.links[0].filter.minAmountMinor, expenses[4].amountMinor);
  assert.equal(opened.count, expenses.filter((entry) => entry.amountMinor >= expenses[4].amountMinor).length);
  assert.equal(payload.wording.text, "Your biggest expense in March was Courts Megastore Tampines at $3,280.00 on 11 Mar. Next came Castlery at $2,190.00 and HDB Housing Loan Giro at $1,480.00.");
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
  assert.equal(homeNet, 118241);
  assert.deepEqual(payload.answer.links, [{ kind: "splits", label: "Open Splits", month: "2026-05", viewId: "household", groupId: "split-group-japan-trip" }]);
  assert.equal(payload.wording.text, "Serene owes you $1,182.41 on Splits. That's $1,019.17 from the 6 Apr settle-up and $303.15 for Home & Bills, less $139.91 for Dinners out. Japan trip has JP¥26,730 still open.");

  // On the household view with nobody named, both names are used.
  const household = await ask(api, "who owes who?");
  assert.equal(household.answer.lead.tone, "neutral");
  assert.match(household.wording.text, /^Serene owes Ethan \$1,182\.41 on Splits\./);
  // Serene's own view says it from her side.
  const sereneView = await ask(api, "what do I owe Ethan?", { viewId: SERENE });
  assert.equal(sereneView.answer.lead.tone, "short");
  assert.match(sereneView.wording.text, /^You owe Ethan \$1,182\.41 on Splits\./);
});

test("income for a person view is that person's income, against their plan", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const payload = await ask(api, "how much income came in in April?", { viewId: ETHAN });
  const april = await get(api, `/api/month-page?view=${ETHAN}&month=2026-04&scope=direct_plus_shared`);
  assert.equal(payload.intent, "income");
  assert.equal(payload.viewId, ETHAN);
  assert.equal(payload.answer.lead.amountMinor, april.summaryPage.months[0].actualIncomeMinor);
  assert.equal(payload.answer.lead.planMinor, april.summaryPage.months[0].plannedIncomeMinor);
  assert.deepEqual(payload.answer.lead, { label: "Came in · 1 entry", amountMinor: 830000, currency: "SGD", tone: "in", planMinor: 830000, overIsShort: false });
  assert.equal(payload.wording.text, "$8,300.00 came in during April, just as you planned. The largest part was salary at $8,300.00. March brought in $8,300.00.");
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
  assert.equal(compare.wording.text, "March came to $10,391.23. There are no entries for March 2024 to compare it with.");
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
