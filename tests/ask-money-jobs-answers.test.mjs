// The money jobs' questions answered on the real Worker (DOMAIN.md "Money
// job" and "Money Question"; docs/flows/ask-flow.md "Money questions"):
// the lead's "Ask about this" asks "How much did I invest…", "How much did
// I save…", "Why did I spend more than I earned…" and, with money hidden,
// "How did my spending compare with…". Each gets its own card, and every
// figure on it is the Month (or Summary) lead's own split of the period's
// money (splitMoneyUse through buildMonthLeadModel / buildSummaryLeadModel,
// worked out here from the page DTOs, not by the code under test). Real
// local D1 seeded with the demo household (Tim and Joyce), AI off; the route
// only reads.
import assert from "node:assert/strict";
import test from "node:test";

import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";
import { summarizeFilterAnswer } from "../src/client/ask-filter-answer.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";

const TIM = "person-tim";
const MAY = "2026-05";
const cents = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const money = (minor) => cents.format(minor / 100).replace("SGD", "$");

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function ask(api, text, { viewId = TIM, month = MAY } = {}) {
  const response = await api("/api/ai-assist/answer", { text, viewId, month, scope: "direct_plus_shared" });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  assert.equal(response.payload.supported, true, text);
  assert.equal(response.payload.needsConfirmation, false, text);
  return response.payload;
}

async function savePlanRow(api, row) {
  const { status, payload } = await api("/api/month-plan/save", {
    sectionKey: "planned_items", planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: "Tim", ...row
  });
  assert.equal(status, 200, JSON.stringify(payload));
}

// May 2026 for Tim: a salary, an iFAST plan line and GIRO under
// Investments, and one more move into Savings.
async function seedMoneyJobs(api) {
  await createEntry(api, { date: "2026-05-25", description: "Ask jobs salary", categoryName: "Salary", entryType: "income", amountMinor: 650_000 });
  await savePlanRow(api, { rowId: "ask-jobs-ifast", month: MAY, categoryName: "Investments", label: "iFAST", plannedMinor: 150_000 });
  await createEntry(api, { date: "2026-05-03", description: "iFAST GIRO", categoryName: "Investments", amountMinor: 120_000 });
  await createEntry(api, { date: "2026-05-04", description: "Top up savings", categoryName: "Savings", amountMinor: 50_000 });
}

// The Month lead for a Month page: its figures are splitMoneyUse's.
async function monthLead(api, month = MAY) {
  const page = await get(api, `/api/month-page?view=${TIM}&month=${month}&scope=direct_plus_shared`);
  const cards = buildMonthMetricCards({ planSections: page.monthPage.planSections, incomeRows: page.monthPage.incomeRows, currentMonthSummary: page.summaryPage.months[0] });
  const lead = buildMonthLeadModel(cards, page.summaryPage.months[0], {
    planRows: page.monthPage.planSections.flatMap((section) => section.rows),
    categoryShare: page.monthPage.categoryShareChart
  });
  return { page, lead, figures: lead.figures };
}

test("How much did I invest: the lead's invested against the invest job, the Investments entries, and Entries filtered to them", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await seedMoneyJobs(api);
  const before = await dumpDatabase(db);
  const { figures } = await monthLead(api);
  assert.deepEqual([figures.invested, figures.investPlan], [120_000, 150_000]);

  const payload = await ask(api, "How much did I invest in May 2026?");
  assert.equal(payload.intent, "invested");
  assert.deepEqual(payload.months, [MAY]);
  const { answer } = payload;
  assert.equal(answer.title, "May investing");
  assert.deepEqual(answer.lead, { label: "Invested", amountMinor: figures.invested, currency: "SGD", tone: "neutral", planMinor: figures.investPlan, overIsShort: false });
  assert.deepEqual(answer.support, [
    { label: "Plan", amountMinor: figures.investPlan, currency: "SGD" },
    { label: "Income", amountMinor: figures.income, currency: "SGD" }
  ]);
  // Moved, not spent: plain ink.
  assert.deepEqual(answer.lines, [{ label: "iFAST GIRO", detail: "3 May · Investments", amountMinor: 120_000, currency: "SGD", tone: "neutral" }]);
  assert.equal(payload.wording.source, "template");
  assert.equal(payload.wording.text, "You put $1,200.00 into Investments in May. That's $300.00 short of the $1,500.00 you planned to invest. The largest was iFAST GIRO at $1,200.00 on 3 May.");

  // Open in Entries lists exactly the money invested.
  assert.deepEqual(answer.links.map((link) => link.kind), ["entries", "month"]);
  const entries = answer.links[0];
  assert.deepEqual(entries.filter, {
    month: MAY, viewId: TIM, scope: "direct_plus_shared", search: "", categories: ["Investments"], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null
  });
  const opened = summarizeFilterAnswer(await get(api, `/api/entries-page?view=${TIM}&month=${MAY}`), entries.filter);
  assert.equal(opened.count, 1);
  assert.equal(opened.totals.grossSpendMinor, figures.invested);
  assert.equal(answer.outcome.investedMinor, figures.invested);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("How much did I save: the lead's Saved (kept) against the save job, with what went into Savings", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedMoneyJobs(api);
  const { lead, figures } = await monthLead(api);
  assert.ok(figures.kept > 0 && figures.movedToSavings >= 50_000, JSON.stringify(figures));

  const payload = await ask(api, "How much did I save in May 2026?");
  assert.equal(payload.intent, "saved");
  const { answer } = payload;
  assert.equal(answer.title, "May savings");
  // The lead's own Saved pill.
  assert.equal(answer.lead.amountMinor, lead.saved.amountMinor);
  assert.deepEqual(answer.lead, {
    label: "Saved", amountMinor: figures.kept, currency: "SGD", tone: "in",
    ...(figures.savePlan > 0 ? { planMinor: figures.savePlan, overIsShort: false } : {})
  });
  assert.deepEqual(answer.support, [
    { label: "Income", amountMinor: figures.income, currency: "SGD" },
    { label: "Spent", amountMinor: figures.spending, currency: "SGD" },
    { label: "Invested", amountMinor: figures.invested, currency: "SGD" }
  ]);
  // The moves into Savings (largest first, plain ink), then where the
  // spending went, without Investments and Savings.
  const moves = answer.lines.filter((line) => line.detail?.endsWith(" · Savings"));
  assert.ok(moves.length >= 1 && moves.every((line) => line.tone === "neutral"));
  assert.deepEqual(moves.find((line) => line.label === "Top up savings"), { label: "Top up savings", detail: "4 May · Savings", amountMinor: 50_000, currency: "SGD", tone: "neutral" });
  assert.deepEqual(answer.lines.slice(0, moves.length), moves);
  assert.ok(answer.lines.slice(moves.length).every((line) => !["Investments", "Savings"].includes(line.label)));
  assert.deepEqual(answer.links.map((link) => [link.kind, link.filter?.categories ?? link.month]), [["month", MAY], ["entries", ["Savings"]]]);
  const target = figures.savePlan > 0
    ? ` That's ${money(Math.abs(figures.kept - figures.savePlan))} ${figures.kept > figures.savePlan ? "more than" : "short of"} your ${money(figures.savePlan)} savings target.`
    : "";
  assert.equal(
    payload.wording.text,
    `In May you earned ${money(figures.income)}, spent ${money(figures.spending)} and invested ${money(figures.invested)}, so you kept ${money(figures.kept)}.${target} ${money(figures.movedToSavings)} of it went into Savings.`
  );
});

test("Why did I spend more than I earned: spent against earned, what came out of savings, and the categories that drove it", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedMoneyJobs(api);
  await createEntry(api, { date: "2026-05-20", description: "Renovation deposit", categoryName: "Home", amountMinor: 1_000_000 });
  const { page, figures } = await monthLead(api);
  assert.ok(figures.kept < 0, "more went out than came in");

  const payload = await ask(api, "Why did I spend more than I earned in May 2026?");
  assert.equal(payload.intent, "spentVsEarned");
  const { answer } = payload;
  // The title and lead never say which side of income the money fell.
  assert.equal(answer.title, "May spending and income");
  assert.deepEqual(answer.lead, { label: "Spent", amountMinor: figures.spending, currency: "SGD", tone: figures.spending > figures.spendPlan ? "short" : "neutral" });
  assert.deepEqual(answer.support, [
    { label: "Income", amountMinor: figures.income, currency: "SGD" },
    { label: "Invested", amountMinor: figures.invested, currency: "SGD" }
  ]);
  assert.deepEqual(answer.lines[0], { label: "Came out of savings", amountMinor: -figures.kept, currency: "SGD", tone: "short" });
  // The spending categories, largest first, with their share of the spending.
  const spent = page.monthPage.categoryShareChart.filter((datum) => !["Investments", "Savings"].includes(datum.label));
  const spentTotal = spent.reduce((sum, datum) => sum + datum.valueMinor, 0);
  assert.equal(spentTotal, figures.spending);
  assert.deepEqual(answer.lines.slice(1).map((line) => [line.label, line.amountMinor, line.detail.split(" · ")[0]]), spent.slice(0, 3).map((datum) => [
    datum.label, datum.valueMinor, `${Math.round((datum.valueMinor * 100) / spentTotal)}%`
  ]));
  assert.equal(answer.lines[1].label, "Home");
  const [first, second, third] = spent;
  const lower = (name) => name.toLowerCase();
  assert.equal(
    payload.wording.text.split(". ").slice(0, 2).join(". "),
    `In May you earned ${money(figures.income)}, spent ${money(figures.spending)} and invested ${money(figures.invested)}, so ${money(-figures.kept)} came out of savings. Most of the spending went to ${lower(first.label)} (${money(first.valueMinor)}), ${lower(second.label)} (${money(second.valueMinor)}) and ${lower(third.label)} (${money(third.valueMinor)})`
  );
  assert.deepEqual(answer.links.map((link) => [link.kind, link.filter?.type ?? link.month]), [["entries", "expense"], ["month", MAY]]);

  // The same card for the hidden-money wording of the question.
  const hidden = await ask(api, "How did my spending compare with my income in May 2026?");
  assert.equal(hidden.intent, "spentVsEarned");
  assert.deepEqual(hidden.answer, answer);
});

test("How did my spending compare with the plan: the plan answer, not May against April", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedMoneyJobs(api);
  const { lead } = await monthLead(api);
  const payload = await ask(api, "How did my spending compare with the plan in May 2026?");
  assert.equal(payload.intent, "plan");
  assert.deepEqual(payload.months, [MAY]);
  assert.equal(payload.answer.title, "May against plan");
  assert.deepEqual([payload.answer.lead.amountMinor, payload.answer.lead.planMinor], [lead.spent.amountMinor, lead.plannedSpendMinor]);
  assert.deepEqual(payload.answer, (await ask(api, "How am I doing against the plan in May 2026?")).answer);
});

test("the Summary's range: invested and saved over every month, as the Summary lead reads them", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seedMoneyJobs(api);
  await savePlanRow(api, { rowId: "ask-jobs-stashaway", month: "2025-10", categoryName: "Investments", label: "Stashaway", plannedMinor: 45_000 });
  await createEntry(api, { date: "2025-10-06", description: "Stashaway top-up", categoryName: "Investments", amountMinor: 30_000 });
  const summary = await get(api, `/api/summary-page?view=${TIM}&month=${MAY}&scope=direct_plus_shared&summary_start=2025-10&summary_end=${MAY}`);
  const lead = buildSummaryLeadModel(summary.summaryPage.metricCards, { categoryShare: summary.summaryPage.categoryShareChart });
  const { figures } = lead;
  assert.deepEqual([figures.invested, figures.investPlan], [150_000, 195_000]);

  const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const invested = await ask(api, "How much did I invest from Oct 2025 to May 2026?");
  assert.equal(invested.intent, "invested");
  assert.deepEqual(invested.months, months);
  assert.equal(invested.answer.title, "October 2025 to May investing");
  assert.deepEqual([invested.answer.lead.amountMinor, invested.answer.lead.planMinor], [figures.invested, figures.investPlan]);
  // Largest first, across the months.
  assert.deepEqual(invested.answer.lines.map((line) => [line.label, line.amountMinor]), [["iFAST GIRO", 120_000], ["Stashaway top-up", 30_000]]);
  // Entries shows one month: a period opens Month for its last month.
  assert.deepEqual(invested.answer.links, [{ kind: "month", label: "Open Month", month: MAY, viewId: TIM, scope: "direct_plus_shared" }]);
  assert.equal(invested.wording.text.split(". ")[0], "You put $1,500.00 into Investments from October 2025 to May");

  const saved = await ask(api, "How much did I save from Oct 2025 to May 2026?");
  assert.equal(saved.intent, "saved");
  assert.equal(saved.answer.lead.amountMinor, lead.saved.amountMinor);
  assert.equal(saved.answer.lead.planMinor ?? 0, figures.savePlan);
  assert.deepEqual(saved.answer.support.map((chip) => chip.amountMinor), [figures.income, figures.spending, figures.invested]);
});

test("a search that only mentions investing is not answered here", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const response = await api("/api/ai-assist/answer", { text: "show invest in a new phone case", viewId: TIM, month: MAY, scope: "direct_plus_shared" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { ok: true, supported: false });
});
