// Openable figures (design.md "Openable figures", DOMAIN.md "Money
// figure"): every figure a card shows opens "View entries", Entries
// narrowed to exactly the money behind it, and the total Entries then shows
// is that figure to the cent. Proved here on the real Worker and a real
// local D1 (the demo household, Tim and Joyce), for the Summary range and
// the Month lead in Plan and Simple, the savings bar's parts, Intent vs
// Outcome, "Earned vs spent by month", the Month plan rows' actuals,
// Spending Mix and Top spending, and the Entries pills; with investments
// (the Investments category plus transfers into investment accounts, less
// transfers out), a payback, a Savings move, and person views and scopes.
//
// Each figure's link is the one the menu builds (figure-menu.js
// figureMenu); the Entries side runs the Entries page's own code on the
// entries-page DTO that link fetches (readEntriesFilterParams,
// getEntryDerivedData, buildEntriesTotalsModel).
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { figureMenu } from "../src/client/figure-menu-model.js";
import { readEntriesFilterParams, readEntriesRangeStart, ENTRY_FIGURES } from "../src/client/entry-filter-params.js";
import { getEntryDerivedData, getInvestmentAccountIds } from "../src/client/entry-filtering.js";
import { buildEntriesTotalsModel } from "../src/client/entries-totals-model.js";
import { buildSummaryLeadModel } from "../src/client/summary-lead-model.js";
import { buildMonthLeadModel } from "../src/client/month-lead-model.js";
import { buildMonthMetricCards } from "../src/client/month-helpers.js";
import { buildIntentMonthCard } from "../src/client/summary-intent-outcome-model.js";
import { buildEarnedSpentMonths } from "../src/client/summary-earned-spent-model.js";
import { buildChartMonths, chartSeries, pointFigure } from "../src/client/earned-spent-chart-model.js";
import { buildSavingsBarModel } from "../src/client/savings-bar-model.js";
import { buildSimpleMetrics } from "../src/client/simple-metrics-model.js";
import { bankFeesFigureMinor, changedFigureMinor, MONEY_FIGURES, repeatingFigureMinor } from "../src/domain/money-figures.ts";
import { buildSubscriptionsModel, monthPeriod } from "../src/client/subscriptions-model.js";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { addMonths } from "../src/domain/money-signals/format.ts";
import { buildTripEventLeadModel } from "../src/client/trip-event-lead-model.js";
import { projectEntriesForView } from "../src/client/entry-row-projection.js";
import { entriesRangeMonths } from "../src/domain/pages/entries-page.ts";

const TIM = "person-tim";
const MAY = "2026-05";
const APRIL = "2026-04";
const MARCH = "2026-03";
// The Summary's default range ending in May 2026: twelve months.
const START = "2025-06";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(response.payload).slice(0, 300)}`);
  return response.payload;
}

async function savePlanRow(api, row) {
  const { status, payload } = await api("/api/month-plan/save", {
    sectionKey: "planned_items", planDate: null, accountName: "", note: "", ownershipType: "direct", ownerName: "Tim", ...row
  });
  assert.equal(status, 200, JSON.stringify(payload));
}

// Tim, May 2026: a salary, a GIRO filed under Investments, a move into
// Savings and a payback; Endowus and IBKR (investment accounts): $2,000
// from UOB One into Endowus and $300 Endowus to IBKR in May, $5,000 back
// out of Endowus in April.
async function seed(api) {
  await createEntry(api, { date: "2026-05-25", description: "Figure salary", categoryName: "Salary", entryType: "income", amountMinor: 650_000 });
  await savePlanRow(api, { rowId: "figure-ifast", month: MAY, categoryName: "Investments", label: "iFAST", plannedMinor: 150_000 });
  await createEntry(api, { date: "2026-05-03", description: "iFAST GIRO", categoryName: "Investments", amountMinor: 120_000 });
  await createEntry(api, { date: "2026-05-04", description: "Top up savings", categoryName: "Savings", amountMinor: 50_000 });
  await createEntry(api, { date: "2026-05-05", description: "Figure groceries", categoryName: "Groceries", amountMinor: 8_000 });
  await createEntry(api, { date: "2026-05-06", description: "Refund groceries", categoryName: "Groceries", entryType: "income", amountMinor: 1_234 });
  for (const name of ["Endowus", "IBKR"]) {
    const created = await api("/api/accounts/create", { name, institution: name, kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: TIM });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
  }
  const linkedTransfer = async ({ date, amountMinor, from, to, description }) => {
    const fromEntryId = await createEntry(api, { date, description, accountName: from, categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor });
    const toEntryId = await createEntry(api, { date, description, accountName: to, categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor });
    const linked = await api("/api/transfers/link", { fromEntryId, toEntryId });
    assert.equal(linked.status, 200, JSON.stringify(linked.payload));
  };
  await linkedTransfer({ date: "2026-05-12", amountMinor: 200_000, from: "UOB One", to: "Endowus", description: "Endowus top-up" });
  await linkedTransfer({ date: "2026-05-14", amountMinor: 30_000, from: "Endowus", to: "IBKR", description: "Endowus to IBKR" });
  await linkedTransfer({ date: "2026-04-20", amountMinor: 500_000, from: "Endowus", to: "UOB One", description: "Endowus withdrawal" });
}

// What Entries shows for a location: the page DTO the link fetches, run
// through the Entries page's own filtering and totals.
async function openEntries(api, location, accounts) {
  assert.equal(location.pathname, "/entries");
  const params = new URLSearchParams(location.search);
  const month = params.get("month");
  const from = readEntriesRangeStart(params, month);
  const page = await get(api, `/api/entries-page?view=${params.get("view")}&month=${month}${from ? `&from=${from}` : ""}`);
  const { selectedScope, entryFilters } = readEntriesFilterParams(params);
  const derived = getEntryDerivedData({
    entries: page.monthPage.entries,
    entryFilters,
    selectedScope,
    viewId: page.viewId,
    pinnedEntryIds: [],
    investmentAccountIds: getInvestmentAccountIds(accounts)
  });
  const model = buildEntriesTotalsModel({ ...derived, month: page.monthPage.month, rangeStartMonth: page.monthPage.rangeStartMonth ?? "", personLabel: page.label, figure: entryFilters.figure, figureMinor: derived.figureMinor });
  return { page, derived, model, params };
}

// The lead amount Entries shows after "View entries" from a figure: for a
// money job's figure its own total, for the Entries page's own figures the
// person's share where it differs (the aside), else the lead.
const shownTotal = (model) => model.spent.shareMinor ?? model.spent.amountMinor;

async function viewEntries(api, accounts, figure, { search, period = null, ids = [], arg = "" }) {
  const menu = figureMenu({ fig: figure, period, search, ids, arg });
  const entries = menu.items.find((item) => item.action === "entries");
  assert.ok(entries, `${figure} offers View entries`);
  return openEntries(api, entries.location, accounts);
}

const VIEWS = [
  { viewId: "household", scope: "direct_plus_shared" },
  { viewId: TIM, scope: "direct_plus_shared" },
  { viewId: TIM, scope: "direct" },
  { viewId: TIM, scope: "shared" }
];
const viewSearch = ({ viewId, scope }, month, extra = "") => `?view=${viewId}&month=${month}&scope=${scope}${extra}`;

async function monthLead(api, { viewId, scope }, month) {
  const page = await get(api, `/api/month-page?view=${viewId}&month=${month}&scope=${scope}`);
  const cards = buildMonthMetricCards({ planSections: page.monthPage.planSections, incomeRows: page.monthPage.incomeRows, currentMonthSummary: page.summaryPage.months[0] });
  const lead = buildMonthLeadModel(cards, page.summaryPage.months[0], {
    planRows: page.monthPage.planSections.flatMap((section) => section.rows),
    categoryShare: page.monthPage.categoryShareChart,
    investmentMoves: page.monthPage.investmentMoves
  });
  return { page, lead };
}

async function summaryLead(api, { viewId, scope }, start, end) {
  const { summaryPage } = await get(api, `/api/summary-page?view=${viewId}&month=${end}&scope=${scope}&summary_start=${start}&summary_end=${end}`);
  const lead = buildSummaryLeadModel(summaryPage.metricCards, { categoryShare: summaryPage.categoryShareChart, investmentMoves: summaryPage.investmentMoves ?? null });
  return { summaryPage, lead };
}

// The money jobs' figures a lead shows, by the money figure each opens.
function leadFigures(figures) {
  return {
    spending: figures.spending,
    invested: figures.invested,
    kept: figures.kept,
    earned: figures.income,
    from_savings: Math.max(0, figures.spending - figures.income),
    took_out: figures.takenFromInvestments
  };
}

test("the figure lists agree: Entries reads every money figure the domain defines", () => {
  assert.deepEqual([...ENTRY_FIGURES].sort(), [...MONEY_FIGURES].sort());
});

test("Month lead (Plan and Simple, every view and scope): each figure's View entries total is the figure to the cent", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const view of VIEWS) {
    const { lead } = await monthLead(api, view, MAY);
    const expected = leadFigures(lead.figures);
    const search = viewSearch(view, MAY);
    const period = { startMonth: MAY, endMonth: MAY };
    for (const [figure, amountMinor] of Object.entries(expected)) {
      const { model } = await viewEntries(api, accounts, figure, { search, period });
      assert.equal(model.spent.amountMinor, amountMinor, `${view.viewId}/${view.scope} ${figure}`);
      assert.equal(model.figure, figure);
    }
    // Simple's lead is the same split: Earned and Spent.
    assert.deepEqual([lead.simple.earned.amountMinor, lead.simple.spent.amountMinor], [expected.earned, expected.spending]);
    // The Income and Saved columns are the bar's income and kept.
    assert.deepEqual([lead.income.amountMinor, lead.saved.amountMinor], [expected.earned, expected.kept]);
  }
  // Tim's May has money moved in: invested is the category plus the
  // Endowus top-up (the IBKR move between investment accounts adds nothing).
  const { lead } = await monthLead(api, VIEWS[1], MAY);
  assert.equal(lead.figures.invested, 320_000);
  const { derived } = await viewEntries(api, accounts, "invested", { search: viewSearch(VIEWS[1], MAY), period: { startMonth: MAY, endMonth: MAY } });
  assert.deepEqual(derived.filteredEntries.map((entry) => entry.description).sort(), ["Endowus top-up", "iFAST GIRO"]);
});

test("Summary range: View entries opens every month of the range and its total is the figure; one month alone is not", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const view of VIEWS) {
    const { summaryPage, lead } = await summaryLead(api, view, START, MAY);
    assert.deepEqual([summaryPage.rangeStartMonth, summaryPage.rangeEndMonth], [START, MAY]);
    const search = viewSearch(view, MAY, `&summary_start=${START}&summary_end=${MAY}`);
    const period = { startMonth: START, endMonth: MAY };
    for (const [figure, amountMinor] of Object.entries(leadFigures(lead.figures))) {
      const { model, page } = await viewEntries(api, accounts, figure, { search, period });
      assert.equal(page.monthPage.rangeStartMonth, START);
      assert.equal(model.month, "Jun 2025 – May 2026");
      assert.equal(model.eyebrow.endsWith("· Jun 2025 – May 2026"), true);
      assert.equal(model.spent.amountMinor, amountMinor, `${view.viewId}/${view.scope} ${figure}`);
    }
  }
  // April's withdrawal ($5,000 out of Endowus) is in the range: Tim invested
  // $3,200 in May, so over the range more came out than went in.
  const { lead } = await summaryLead(api, VIEWS[1], START, MAY);
  assert.deepEqual([lead.figures.invested, lead.figures.takenFromInvestments], [0, 180_000]);
  // Negative: the old link (the range's last month only) shows another total.
  const { model: mayOnly } = await openEntries(api, { pathname: "/entries", search: `?view=${TIM}&month=${MAY}&scope=direct_plus_shared&entries_scope=direct_plus_shared&entry_figure=spending` }, accounts);
  assert.notEqual(mayOnly.spent.amountMinor, lead.figures.spending);
});

test("the savings bar's parts, legend lines and sentence open the figure each names", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const [start, end] of [[MAY, MAY], [START, MAY]]) {
    const { lead } = await summaryLead(api, VIEWS[1], start, end);
    const bar = buildSavingsBarModel({ figures: lead.figures });
    const expected = leadFigures(lead.figures);
    const search = viewSearch(VIEWS[1], end, `&summary_start=${start}&summary_end=${end}`);
    for (const segment of bar.segments) {
      const { model } = await viewEntries(api, accounts, segment.fig, { search, period: { startMonth: start, endMonth: end } });
      assert.equal(model.spent.amountMinor, expected[segment.fig], `${start}:${end} ${segment.key}`);
    }
    assert.ok(Object.keys(expected).includes(bar.sentenceFig));
  }
});

test("Intent vs Outcome and Earned vs spent by month: each month's figures open that month's entries with the same totals", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  const view = VIEWS[1];
  const { summaryPage } = await summaryLead(api, view, START, MAY);
  // Per-month investment moves are sent only for the months with one.
  assert.deepEqual(summaryPage.investmentMovesByMonth, [{ month: APRIL, intoMinor: 0, outOfMinor: 500_000 }, { month: MAY, intoMinor: 200_000, outOfMinor: 0 }]);
  const rows = buildEarnedSpentMonths(summaryPage.months, summaryPage.categoryShareByMonth, summaryPage.investmentMovesByMonth);
  for (const month of summaryPage.months) {
    const search = viewSearch(view, month.month);
    const period = { startMonth: month.month, endMonth: month.month };
    const card = buildIntentMonthCard(month);
    for (const [figure, amountMinor] of [["spent", card.spent.amountMinor], ["earned", card.actualIncomeMinor], ["difference", card.metrics[2].actualMinor]]) {
      const { model } = await viewEntries(api, accounts, figure, { search, period });
      assert.equal(model.spent.amountMinor, amountMinor, `${month.month} intent ${figure}`);
    }
    const row = rows.find((item) => item.month === month.month);
    for (const [figure, amountMinor] of [["earned", row.earnedMinor], ["spending", row.spentMinor], ["invested", row.investedMinor], ["kept", row.keptMinor]]) {
      const { model } = await viewEntries(api, accounts, figure, { search, period });
      assert.equal(model.spent.amountMinor, amountMinor, `${month.month} earned-spent ${figure}`);
    }
  }
  // May's row is the Month lead's, investments included.
  const { lead } = await monthLead(api, view, MAY);
  const may = rows.find((item) => item.month === MAY);
  assert.deepEqual([may.investedMinor, may.keptMinor, may.spentMinor], [lead.figures.invested, lead.figures.kept, lead.figures.spending]);
});

test("the month chart's Spent so far and Planned so far: each point opens the spending so far, and the last gap is the Summary lead's", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const view of VIEWS.slice(0, 2)) {
    const { summaryPage, lead } = await summaryLead(api, view, START, MAY);
    const rows = buildChartMonths({ mode: "plan", ...summaryPage });
    const [spentSoFar, plannedSoFar] = chartSeries("plan").slice(3);
    for (const row of rows) {
      for (const series of [spentSoFar, plannedSoFar]) {
        const figure = pointFigure("plan", series, row, rows[0].month);
        const [startMonth, endMonth] = figure.period.split(":");
        const search = viewSearch(view, endMonth, `&summary_start=${startMonth}&summary_end=${endMonth}`);
        const { model } = await viewEntries(api, accounts, figure.fig, { search, period: { startMonth, endMonth } });
        assert.equal(model.spent.amountMinor, row.spentSoFarMinor, `${view.viewId} ${series.key} ${row.month}`);
        // Open plan opens that month's plan.
        const plan = figureMenu({ fig: figure.fig, plan: figure.plan, period: { startMonth, endMonth }, search }).items.find((item) => item.action === "plan");
        assert.match(plan.location.search, new RegExp(`month=${endMonth}`));
      }
    }
    // The gap in the last month is the lead's over or under plan for the range.
    const last = rows.at(-1);
    assert.equal(last.spentSoFarMinor, lead.figures.spending);
    assert.equal(last.plannedSoFarMinor, lead.figures.spendPlan);
    assert.equal(Math.abs(last.plannedSoFarMinor - last.spentSoFarMinor), lead.headroom.amountMinor);
    assert.equal(last.plannedSoFarMinor - last.spentSoFarMinor < 0, lead.headroom.isOver);
  }
  // Tim's May plans iFAST under Investments: the page sends it month by month,
  // and without it the planned total would be that much over the lead's.
  const { summaryPage, lead } = await summaryLead(api, VIEWS[1], START, MAY);
  assert.deepEqual(summaryPage.plannedInvestByMonth, [{ month: MAY, plannedInvestMinor: 150_000 }]);
  const { plannedInvestByMonth: _sent, ...withoutPlan } = summaryPage;
  assert.equal(buildChartMonths({ mode: "plan", ...withoutPlan }).at(-1).plannedSoFarMinor - lead.figures.spendPlan, 150_000);
  // And the money filed under Investments and Savings is not spending: the
  // Spent columns added up are more than Spent so far.
  const rows = buildChartMonths({ mode: "plan", ...summaryPage });
  assert.ok(rows.reduce((total, row) => total + row.spentMinor, 0) > rows.at(-1).spentSoFarMinor);
});

test("Month plan rows' actuals, Spending Mix and Top spending open exactly their entries", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const view of VIEWS.slice(0, 2)) {
    const { page, lead } = await monthLead(api, view, MAY);
    const search = viewSearch(view, MAY);
    const period = { startMonth: MAY, endMonth: MAY };
    let checked = 0;
    for (const section of page.monthPage.planSections) {
      for (const row of section.rows.filter((item) => item.actualEntryIds?.length)) {
        const { model } = await viewEntries(api, accounts, "spent", { search, ids: row.actualEntryIds });
        assert.equal(model.spent.amountMinor, row.actualMinor, `${view.viewId} ${section.key} ${row.label}`);
        checked += 1;
      }
    }
    for (const row of page.monthPage.incomeRows.filter((item) => item.actualEntryIds?.length)) {
      const { model } = await viewEntries(api, accounts, "earned", { search, ids: row.actualEntryIds });
      assert.equal(model.spent.amountMinor, row.actualMinor, `${view.viewId} income ${row.label}`);
      checked += 1;
    }
    assert.ok(checked > 0, "some plan row has an actual");
    for (const slice of page.monthPage.categoryShareChart) {
      const { model } = await viewEntries(api, accounts, "category", { search, period, arg: slice.label });
      assert.equal(model.spent.amountMinor, slice.valueMinor, `${view.viewId} mix ${slice.label}`);
    }
    // Top spending names three of those categories.
    const top = buildSimpleMetrics({ figures: lead.figures, categoryShare: page.monthPage.categoryShareChart, startMonth: MAY, endMonth: MAY, today: "2026-06-15" }).topCategories;
    assert.equal(top.length, 3);
  }
  // Summary's Spending Mix is the range's.
  const { summaryPage } = await summaryLead(api, VIEWS[0], START, MAY);
  const search = viewSearch(VIEWS[0], MAY, `&summary_start=${START}&summary_end=${MAY}`);
  for (const slice of summaryPage.categoryShareChart.slice(0, 4)) {
    const { model } = await viewEntries(api, accounts, "category", { search, period: { startMonth: START, endMonth: MAY }, arg: slice.label });
    assert.equal(model.spent.amountMinor, slice.valueMinor, `range mix ${slice.label}`);
  }
});

// A transfer with a purpose (DOMAIN.md "Transfer Purpose"): Tim's $450 to
// Joyce for Home is his Home spending and lowers hers. In every view the
// Month lead, its plan line, Spending Mix and the Entries pills open the
// rows that add up to them, the transfer read the same way in Entries.
test("a transfer with a purpose: every view's figures open entries that add up to them", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const created = await api("/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  await createEntry(api, { date: "2026-05-05", description: "HDB loan GIRO", accountName: "Joyce Bank", categoryName: "Home", amountMinor: 90_000, ownerName: "Joyce" });
  const fromEntryId = await createEntry(api, { date: "2026-05-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 45_000 });
  const toEntryId = await createEntry(api, { date: "2026-05-01", description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 45_000, ownerName: "Joyce" });
  assert.equal((await api("/api/transfers/link", { fromEntryId, toEntryId })).status, 200);
  assert.equal((await api("/api/transfers/purpose", { entryId: fromEntryId, categoryName: "Home" })).status, 200);
  await savePlanRow(api, { rowId: "figure-house-loan", month: MAY, categoryName: "Home", label: "House loan", plannedMinor: 45_000, planDate: "2026-05-01" });
  assert.equal((await api("/api/month-plan/links", { rowId: "figure-house-loan", month: MAY, transactionIds: [fromEntryId] })).status, 200);
  const { accounts } = await get(api, "/api/reference-data");

  const homeByView = {};
  for (const view of [VIEWS[0], VIEWS[1], VIEWS[2], { viewId: "person-joyce", scope: "direct_plus_shared" }, { viewId: "person-joyce", scope: "direct" }]) {
    const { page, lead } = await monthLead(api, view, MAY);
    const search = viewSearch(view, MAY);
    const period = { startMonth: MAY, endMonth: MAY };
    for (const [figure, amountMinor] of Object.entries(leadFigures(lead.figures))) {
      const { model } = await viewEntries(api, accounts, figure, { search, period });
      assert.equal(model.spent.amountMinor, amountMinor, `${view.viewId}/${view.scope} ${figure}`);
    }
    for (const slice of page.monthPage.categoryShareChart) {
      const { model } = await viewEntries(api, accounts, "category", { search, period, arg: slice.label });
      assert.equal(model.spent.amountMinor, slice.valueMinor, `${view.viewId} mix ${slice.label}`);
    }
    const houseLoan = page.monthPage.planSections.flatMap((section) => section.rows).find((row) => (row.sourceRowIds ?? [row.id]).includes("figure-house-loan"));
    if (houseLoan?.actualEntryIds?.length) {
      const { model } = await viewEntries(api, accounts, "spent", { search, ids: houseLoan.actualEntryIds });
      assert.equal(model.spent.amountMinor, houseLoan.actualMinor, `${view.viewId} House loan`);
    }
    homeByView[`${view.viewId}/${view.scope}`] = {
      home: page.monthPage.categoryShareChart.find((slice) => slice.label === "Home")?.valueMinor ?? 0,
      houseLoan: houseLoan?.actualMinor ?? null
    };
  }
  assert.deepEqual(homeByView["household/direct_plus_shared"].houseLoan, 0);
  assert.deepEqual(homeByView["person-tim/direct_plus_shared"].houseLoan, 45_000);
  assert.equal(homeByView["person-tim/direct_plus_shared"].home + homeByView["person-joyce/direct_plus_shared"].home, homeByView["household/direct_plus_shared"].home);

  // The Entries list itself, in Tim's view: the row counts under Home and
  // keeps its ledger transfer for the editor.
  const { derived } = await openEntries(api, { pathname: "/entries", search: `?view=${TIM}&month=${MAY}&scope=direct_plus_shared&category=Home` }, accounts);
  const row = derived.filteredEntries.find((entry) => entry.id === fromEntryId);
  assert.deepEqual(
    { entryType: row.entryType, categoryName: row.categoryName, role: row.transferPurpose.role, ledger: [row.ledgerEntry.entryType, row.ledgerEntry.categoryName] },
    { entryType: "expense", categoryName: "Home", role: "sent", ledger: ["transfer", "Transfer"] }
  );
});

// The Entries page's own spending by category (entries-overview.jsx,
// design.md "Entries top"): every row and slice is the category's spending
// in the list's reading, so a transfer with a purpose is Tim's Home spending
// (amount and entry count), lowers Joyce's Home, and leaves the household's
// alone; the row's filter lists the transfer, and a slice's View entries
// (on Entries itself, no period of its own) narrows the list to the
// category, whose total is the slice to the cent.
test("Entries spending by category: a transfer with a purpose counts as the view reads it, and each slice opens rows that add up to it", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const created = await api("/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  await createEntry(api, { date: "2026-05-05", description: "HDB loan GIRO", accountName: "Joyce Bank", categoryName: "Home", amountMinor: 90_000, ownerName: "Joyce" });
  const fromEntryId = await createEntry(api, { date: "2026-05-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 45_000 });
  const toEntryId = await createEntry(api, { date: "2026-05-01", description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 45_000, ownerName: "Joyce" });
  assert.equal((await api("/api/transfers/link", { fromEntryId, toEntryId })).status, 200);
  const { accounts } = await get(api, "/api/reference-data");
  const views = ["household", TIM, "person-joyce"];
  const homeOf = async (viewId, extra = "") => {
    const { derived } = await openEntries(api, { pathname: "/entries", search: `?view=${viewId}&month=${MAY}${extra}` }, accounts);
    return { derived, home: derived.expenseBreakdown.find((item) => item.label === "Home") ?? { valueMinor: 0, entryCount: 0 } };
  };
  const before = Object.fromEntries(await Promise.all(views.map(async (viewId) => [viewId, (await homeOf(viewId)).home])));
  assert.equal((await api("/api/transfers/purpose", { entryId: fromEntryId, categoryName: "Home" })).status, 200);

  for (const viewId of views) {
    const search = `?view=${viewId}&month=${MAY}`;
    const { derived, home } = await homeOf(viewId);
    const { page } = await monthLead(api, { viewId, scope: "direct_plus_shared" }, MAY);
    const monthHome = page.monthPage.categoryShareChart.find((slice) => slice.label === "Home")?.valueMinor ?? 0;
    assert.equal(home.valueMinor, monthHome, `${viewId}: Entries' Home is the Month's`);
    if (viewId === "household") {
      assert.deepEqual(home, before.household, "the household's Home is unchanged");
    } else if (viewId === TIM) {
      assert.equal(home.valueMinor, before[TIM].valueMinor + 45_000, "Tim's Home has his $450");
      assert.equal(home.entryCount, before[TIM].entryCount + 1);
    } else {
      assert.equal(home.valueMinor, Math.max(0, before["person-joyce"].valueMinor - 45_000), "Joyce's Home is lowered by it");
    }
    // A row's tap: the category filter lists the transfer in Tim's view.
    const { derived: filtered } = await homeOf(viewId, "&entry_category=Home");
    assert.equal(filtered.filteredEntries.some((entry) => entry.id === fromEntryId), viewId !== "household");
    // Every slice opens rows that add up to it.
    for (const item of derived.expenseBreakdown) {
      const menu = figureMenu({ fig: "category", period: null, search, pathname: "/entries", arg: item.label });
      const location = menu.items.find((entry) => entry.action === "entries").location;
      assert.deepEqual(new URLSearchParams(location.search).getAll("entry_category"), [item.label]);
      const { model } = await openEntries(api, location, accounts);
      assert.equal(model.spent.amountMinor, item.valueMinor, `${viewId} slice ${item.label}`);
    }
  }
});

test("the one figure Entries cannot show as it is: a budget line whose refunds are more than its spending reads zero", async (t) => {
  // The plan row's actual never goes below zero (derivePlanRowActuals);
  // its entries add up to the refund, shown as it is (below zero).
  const { api } = await openSeededDatabase(t, template);
  await createEntry(api, { date: "2026-05-06", description: "Refund only", categoryName: "Groceries", entryType: "income", amountMinor: 1_234 });
  const { accounts } = await get(api, "/api/reference-data");
  const { page } = await monthLead(api, VIEWS[1], MAY);
  const groceries = page.monthPage.planSections.flatMap((section) => section.rows).find((row) => row.categoryName === "Groceries" && row.actualEntryIds?.length);
  assert.ok(groceries, "Tim has a Groceries budget line in May");
  const { model } = await viewEntries(api, accounts, "spent", { search: viewSearch(VIEWS[1], MAY), ids: groceries.actualEntryIds });
  assert.equal(groceries.actualMinor, Math.max(0, shownTotal(model)));
});

test("Entries pills: View entries narrows the list to the rows behind the pill and the pill keeps its figure", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  for (const view of VIEWS) {
    const base = `?view=${view.viewId}&month=${MAY}&scope=${view.scope}&entries_scope=${view.scope}`;
    const { model: whole, derived: wholeRows } = await openEntries(api, { pathname: "/entries", search: base }, accounts);
    const pills = Object.fromEntries(whole.pills.map((pill) => [pill.key, pill]));
    for (const [figure, pill] of [["expenses", whole.spent], ["earned", pills.income], ["difference", pills.difference], ["transfers", pills.transfers], ["outflow", pills.outflow]]) {
      const menu = figureMenu({ fig: figure, period: null, search: base, pathname: "/entries" });
      const { model, derived } = await openEntries(api, menu.items[0].location, accounts);
      assert.equal(model.spent.amountMinor, pill.amountMinor, `${view.viewId}/${view.scope} ${figure}`);
      assert.ok(derived.filteredEntries.length <= wholeRows.filteredEntries.length);
    }
  }
});

// ---- Trips and events (DOMAIN.md "Trip or Event") --------------------------
//
// The trip view (entry_trip): its Spent, each person's pill, While away and
// Before you went, each category bar and each day open the trip view
// narrowed, whose Spent lead is the figure to the cent; pills and bars add
// up to Spent. Seoul trip, 3 to 9 April 2026: flights booked in March,
// a shared hotel added to Splits half each, Joyce's own dinner, Tim's taxi
// and a refund that counts against the trip.
const TRIP_VIEWS = [
  { viewId: "household", scope: "direct_plus_shared" },
  { viewId: TIM, scope: "direct_plus_shared" },
  { viewId: TIM, scope: "direct" },
  { viewId: TIM, scope: "shared" },
  { viewId: "person-joyce", scope: "direct_plus_shared" }
];

async function seedTrip(api) {
  const ids = [
    await createEntry(api, { date: "2026-03-14", description: "SQ flights to Seoul", categoryName: "Travel", amountMinor: 128_640 }),
    await createEntry(api, { date: "2026-04-03", description: "Lotte Hotel Seoul", categoryName: "Travel", amountMinor: 119_820 }),
    await createEntry(api, { date: "2026-04-04", description: "Gwangjang Market", categoryName: "Food & Drinks", accountName: "Citi Rewards", ownerName: "Joyce", amountMinor: 3_680 }),
    await createEntry(api, { date: "2026-04-05", description: "Kakao T taxi", categoryName: "Public Transport", amountMinor: 1_780 }),
    await createEntry(api, { date: "2026-04-06", description: "Refund Gwangjang", categoryName: "Food & Drinks", entryType: "income", amountMinor: 500 })
  ];
  const split = await api("/api/splits/expenses/from-entry", { entryId: ids[1], splitGroupId: null, splitBasisPoints: 5000 });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  // An April entry not on the trip stays out of every figure.
  await createEntry(api, { date: "2026-04-05", description: "Home groceries", categoryName: "Groceries", amountMinor: 4_321 });
  const saved = await api("/api/trip-events/save", { name: "Seoul trip", startDate: "2026-04-03", endDate: "2026-04-09", currency: "KRW" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const tripEvent = saved.payload.tripEvent;
  const set = await api("/api/trip-events/entries/set", { entryIds: ids, tripEventId: tripEvent.id });
  assert.equal(set.status, 200, JSON.stringify(set.payload));
  return tripEvent;
}

async function openTripView(api, location, accounts) {
  assert.equal(location.pathname, "/entries");
  const params = new URLSearchParams(location.search);
  const page = await get(api, `/api/entries-page?view=${params.get("view")}&month=${params.get("month")}&trip=${params.get("entry_trip")}`);
  const { selectedScope, entryFilters } = readEntriesFilterParams(params);
  const derived = getEntryDerivedData({ entries: page.monthPage.entries, entryFilters, selectedScope, viewId: page.viewId, pinnedEntryIds: [], investmentAccountIds: getInvestmentAccountIds(accounts) });
  const aggregateEntries = projectEntriesForView(derived.filteredEntries, page.viewId).aggregateEntries;
  const lead = buildTripEventLeadModel({
    tripEvent: page.tripView.tripEvent,
    aggregateEntries,
    pageEntries: page.monthPage.entries,
    entryFilters,
    viewId: page.viewId,
    people: [{ id: TIM, name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
    investmentAccountIds: getInvestmentAccountIds(accounts)
  });
  return { page, derived, lead };
}

const tripOpen = (search, tripEvent, extra = {}) => figureMenu({ fig: "trip", arg: tripEvent.id, name: tripEvent.name, period: null, search, pathname: "/entries", ...extra });

test("trip view: Spent and every pill, category and day open the trip view narrowed, to the cent, and add up", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const tripEvent = await seedTrip(api);
  const { accounts } = await get(api, "/api/reference-data");
  const sums = [];
  for (const view of TRIP_VIEWS) {
    const search = `?view=${view.viewId}&month=${MAY}&scope=${view.scope}&entries_scope=${view.scope}&entry_trip=${tripEvent.id}`;
    const { lead, derived, page } = await openTripView(api, { pathname: "/entries", search }, accounts);
    const label = `${view.viewId}/${view.scope}`;
    assert.ok(page.monthPage.entries.every((entry) => entry.tripEventId === tripEvent.id), `${label}: only the trip's entries`);
    // Spent is the Entries Spent rule over the same rows.
    assert.equal(lead.spentMinor, derived.entryTotals.spendMinor, `${label} Spent`);
    // Its menu: no View entries (it is the list), Ask about this.
    assert.deepEqual(tripOpen(search, tripEvent, { trip: { list: true } }).items.map((item) => item.action), ["ask"]);
    // Pills and bars add up.
    assert.equal(lead.beforeMinor + lead.whileAwayMinor, lead.spentMinor, `${label} before + away`);
    assert.equal(lead.byCategory.reduce((sum, row) => sum + row.amountMinor, 0), lead.spentMinor, `${label} categories`);
    assert.equal(lead.byDay.reduce((sum, row) => sum + row.amountMinor, 0), lead.spentMinor, `${label} days`);
    if (view.viewId === "household") {
      assert.equal(lead.personPills.reduce((sum, pill) => sum + pill.amountMinor, 0), lead.spentMinor, "Tim + Joyce = Spent");
    }
    // Every figure opens to itself.
    const figures = [
      ...lead.personPills.map((pill) => ({ name: pill.name, minor: pill.amountMinor, trip: { personId: pill.personId } })),
      ...lead.byCategory.map((row) => ({ name: row.categoryName, minor: row.amountMinor, trip: { categoryName: row.categoryName } })),
      ...lead.byDay.map((row) => ({ name: row.key, minor: row.amountMinor, ids: row.entryIds })),
      { name: "before", minor: lead.beforeMinor, ids: lead.byDay.find((row) => row.key === "before")?.entryIds ?? [] },
      { name: "away", minor: lead.whileAwayMinor, ids: lead.byDay.filter((row) => row.key !== "before").flatMap((row) => row.entryIds) }
    ].filter((figure) => figure.ids === undefined || figure.ids.length);
    for (const figure of figures) {
      const menu = tripOpen(search, tripEvent, { ids: figure.ids ?? [], trip: figure.trip ?? {} });
      const opened = await openTripView(api, menu.items[0].location, accounts);
      assert.equal(opened.lead.spentMinor, figure.minor, `${label} ${figure.name}`);
      assert.equal(opened.derived.entryTotals.spendMinor, figure.minor, `${label} ${figure.name} (Entries totals)`);
    }
    sums.push([label, lead.spentMinor]);
  }
  // The household: flights $1,286.40 + hotel $1,198.20 + dinner $36.80 +
  // taxi $17.80 - refund $5.00; Tim's share holds half the hotel.
  assert.deepEqual(sums, [
    ["household/direct_plus_shared", 253_420],
    [`${TIM}/direct_plus_shared`, 128_640 + 59_910 + 1_780 - 500],
    [`${TIM}/direct`, 128_640 + 1_780 - 500],
    [`${TIM}/shared`, 59_910],
    ["person-joyce/direct_plus_shared", 59_910 + 3_680]
  ]);
});

test("trip view: an unknown trip lists nothing and names no trip; the other filters still narrow it", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const tripEvent = await seedTrip(api);
  const missing = await get(api, `/api/entries-page?view=household&month=${MAY}&trip=trip-nowhere`);
  assert.deepEqual(missing.monthPage.entries, []);
  assert.equal(missing.tripView.tripEvent, null);
  assert.equal(missing.monthPage.month, MAY, "the page keeps its month");
  const { accounts } = await get(api, "/api/reference-data");
  const { lead } = await openTripView(api, { pathname: "/entries", search: `?view=household&month=${MAY}&scope=direct_plus_shared&entry_trip=${tripEvent.id}&entry_category=Travel` }, accounts);
  assert.equal(lead.spentMinor, 128_640 + 119_820);
});

test("an unknown figure, a period that is not one, or a missing investment account kind is refused, not guessed", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  await seed(api);
  const { accounts } = await get(api, "/api/reference-data");
  // An unknown figure is no filter: the whole month.
  const base = `?view=${TIM}&month=${MAY}&scope=direct_plus_shared&entries_scope=direct_plus_shared`;
  const { derived: whole } = await openEntries(api, { pathname: "/entries", search: base }, accounts);
  const { derived: unknown, model } = await openEntries(api, { pathname: "/entries", search: `${base}&entry_figure=everything` }, accounts);
  assert.equal(unknown.filteredEntries.length, whole.filteredEntries.length);
  assert.equal(model.figure, "");
  // A period: only when entry_to is the page's month, never backwards, at most 24 months.
  assert.equal(readEntriesRangeStart(new URLSearchParams("entry_from=2026-03&entry_to=2026-05"), MAY), MARCH);
  assert.equal(readEntriesRangeStart(new URLSearchParams("entry_from=2026-03&entry_to=2026-04"), MAY), "");
  assert.equal(readEntriesRangeStart(new URLSearchParams("entry_from=2026-06&entry_to=2026-05"), MAY), "");
  assert.equal(readEntriesRangeStart(new URLSearchParams("entry_from=2024-05&entry_to=2026-05"), MAY), "");
  assert.equal(readEntriesRangeStart(new URLSearchParams("entry_from=2024-06&entry_to=2026-05"), MAY), "2024-06");
  assert.deepEqual(entriesRangeMonths("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(entriesRangeMonths("2026-05", "2026-05"), []);
  assert.deepEqual(entriesRangeMonths("2024-05", "2026-05"), []);
  assert.deepEqual(entriesRangeMonths("May 2026", "2026-05"), []);
  // The server ignores a bad period too: one month, no rangeStartMonth.
  const bad = await get(api, `/api/entries-page?view=${TIM}&month=${MAY}&from=2027-01`);
  assert.equal(bad.monthPage.rangeStartMonth, undefined);
  assert.ok(bad.monthPage.entries.every((entry) => entry.date.startsWith(MAY)));
  // Without the accounts' kinds the moves into Endowus are not known, so the
  // figure is not the lead's: the kinds are what make it exact.
  const { lead } = await monthLead(api, VIEWS[1], MAY);
  const menu = figureMenu({ fig: "invested", period: { startMonth: MAY, endMonth: MAY }, search: viewSearch(VIEWS[1], MAY) });
  const { model: withoutKinds } = await openEntries(api, menu.items[0].location, []);
  assert.notEqual(withoutKinds.spent.amountMinor, lead.figures.invested);
});

// Subscriptions and bills (the `repeating` figure, money-figures.ts): every
// amount on the card (the last month, the last 12 months, a row's last
// charge and its 12 months, and both sides of "Went up") opens exactly the
// charges the server named, and Entries' Spent total is the amount, in every
// view and scope. The route reads the household's real today, so the charges
// are placed relative to it.
test("Subscriptions and bills: every figure opens exactly its charges and Entries' total is the figure", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { accounts } = await get(api, "/api/reference-data");
  const thisMonth = todayInAppTimeZone().slice(0, 7);
  const ago = (count) => addMonths(thisMonth, -count);
  for (let back = 6; back >= 1; back -= 1) {
    await createEntry(api, { date: `${ago(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards", categoryName: "Subscriptions MO", amountMinor: 1998, ownerName: "Joyce" });
    await createEntry(api, { date: `${ago(back)}-22`, description: "SINGTEL MOBILE 81234567", accountName: "UOB One", categoryName: "Bills", amountMinor: back === 1 ? 4290 : 3890, ownerName: "Tim" });
    const shared = await api("/api/entries/create", {
      date: `${ago(back)}-18`, description: "SP SERVICES UTILITIES", accountName: "Household Float", categoryName: "Bills",
      entryType: "expense", amountMinor: 11_000 + back * 1_111, ownershipType: "shared", ownerName: "Tim", splitBasisPoints: 6000
    });
    assert.equal(shared.status, 200, JSON.stringify(shared.payload));
  }
  let checked = 0;
  for (const view of VIEWS) {
    const answer = await get(api, `/api/repeating-charges?view=${view.viewId}&scope=${view.scope}`);
    const model = buildSubscriptionsModel(answer);
    assert.ok(model.rows.length > 0, `${view.viewId}:${view.scope} has rows`);
    const search = viewSearch(view, answer.focusMonth);
    const asPeriod = (text) => {
      const [startMonth, endMonth] = text.split(":");
      return { startMonth, endMonth };
    };
    const figures = [
      ["last month", model.totals.focus, model.focusPeriod],
      ["12 months", model.totals.year, model.yearPeriod],
      ...model.rows.flatMap((series) => [
        [`${series.name} last`, series.latest, monthPeriod(series.latest.date)],
        [`${series.name} year`, series.year, model.yearPeriod],
        ...(series.wentUp ? [
          [`${series.name} from`, { amountMinor: series.wentUp.fromMinor, ids: series.wentUp.fromIds }, monthPeriod(series.wentUp.fromDate)],
          [`${series.name} to`, { amountMinor: series.wentUp.toMinor, ids: series.wentUp.toIds }, monthPeriod(series.wentUp.date)]
        ] : [])
      ])
    ];
    for (const [label, amount, period] of figures) {
      const { model: entries, derived } = await viewEntries(api, accounts, "spent", { search, period: asPeriod(period), ids: amount.ids });
      assert.equal(shownTotal(entries), amount.amountMinor, `${view.viewId}:${view.scope} ${label}`);
      assert.equal(repeatingFigureMinor(amount.ids, derived.filteredEntries), amount.amountMinor, `${view.viewId}:${view.scope} ${label} (rule)`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `checked ${checked} figures`);
});

// Bank fees this year (the `bank_fees` figure): the Money insights line's
// total opens exactly the year's fee rows (a refunded fee and its refund
// net to zero) and Entries' Spent total is the figure, in every view.
test("Bank fees this year: the year's fee rows add up to the line's total in every view", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { accounts } = await get(api, "/api/reference-data");
  const year = "2026";
  await createEntry(api, { date: `${year}-03-02`, description: "ANNUAL MEMBERSHIP FEE", accountName: "Citi Rewards", categoryName: "Fees", amountMinor: 19_620, ownerName: "Joyce" });
  await createEntry(api, { date: `${year}-03-09`, description: "ANNUALMEMBERFEEREV", accountName: "Citi Rewards", categoryName: "Fees", entryType: "income", amountMinor: 19_620, ownerName: "Joyce" });
  await createEntry(api, { date: `${year}-04-18`, description: "LATE PAYMENT CHARGE", accountName: "UOB One", categoryName: "Fees", amountMinor: 10_000, ownerName: "Tim" });
  await createEntry(api, { date: `${year}-05-02`, description: "INTEREST CHARGES", accountName: "UOB One", categoryName: "Fees", amountMinor: 1_840, ownerName: "Tim" });
  for (const [day, amountMinor] of [["03", 150], ["04", 120], ["05", 180]]) {
    await createEntry(api, { date: `${year}-05-${day}`, description: "CCY CONVERSION FEE", accountName: "Citi Rewards", categoryName: "Fees", amountMinor, ownerName: "Joyce" });
  }
  // A shop whose name has "fees" in it is not a fee.
  await createEntry(api, { date: `${year}-05-06`, description: "AMAZE*FEES SINGAPORE", accountName: "UOB One", categoryName: "Shopping", amountMinor: 4_500 });
  const expected = {
    household: 10_000 + 1_840 + 450,
    [`${TIM}:direct_plus_shared`]: 11_840,
    [`${TIM}:direct`]: 11_840,
    [`${TIM}:shared`]: null
  };
  for (const view of VIEWS) {
    const { summaryPage } = await summaryLead(api, view, START, MAY);
    const fees = summaryPage.bankFeesYear;
    const want = expected[view.viewId === "household" ? "household" : `${view.viewId}:${view.scope}`];
    if (want === null) {
      assert.equal(fees, undefined, `${view.viewId}:${view.scope} has no fees`);
      continue;
    }
    assert.equal(fees.netMinor, want, `${view.viewId}:${view.scope} total`);
    const { model, derived } = await viewEntries(api, accounts, "spent", { search: viewSearch(view, MAY), period: { startMonth: `${year}-01`, endMonth: MAY }, ids: fees.ids });
    assert.equal(shownTotal(model), fees.netMinor, `${view.viewId}:${view.scope} Entries total`);
    assert.equal(bankFeesFigureMinor(fees.ids, derived.filteredEntries), fees.netMinor, `${view.viewId}:${view.scope} rule`);
  }
});

// "What changed?" rows and "more than usual so far" (ask-changed.ts,
// usual-so-far.ts): each row's amount and the line's "so far" figure open
// exactly their entries, and Entries' Spent total is the figure.
test("What changed and More than usual so far: every figure opens entries that add up to it", async (t) => {
  const { api } = await openSeededDatabase(t, template);
  const { accounts } = await get(api, "/api/reference-data");
  const today = todayInAppTimeZone();
  const thisMonth = today.slice(0, 7);
  const day = Math.min(Number(today.slice(8, 10)), 28);
  const on = (month, d) => `${month}-${String(d).padStart(2, "0")}`;
  for (let back = 1; back <= 3; back += 1) {
    await createEntry(api, { date: on(addMonths(thisMonth, -back), 1), description: "KOUFU FOOD COURT", categoryName: "Food & Drinks", amountMinor: 2_000 });
  }
  await createEntry(api, { date: on(thisMonth, 1), description: "KOUFU FOOD COURT", categoryName: "Food & Drinks", amountMinor: 9_000 });
  await createEntry(api, { date: on(thisMonth, 1), description: "BURNT ENDS", categoryName: "Food & Drinks", amountMinor: 80_000 });
  await createEntry(api, { date: on(addMonths(thisMonth, -1), day), description: "COURTS", categoryName: "Home", amountMinor: 30_000 });
  const ask = async (text) => (await api("/api/ai-assist/answer", { text, viewId: "household", month: thisMonth, scope: "direct_plus_shared" })).payload;
  const search = viewSearch(VIEWS[0], thisMonth);
  const changed = await ask("what changed this month?");
  assert.equal(changed.intent, "changed");
  const lines = changed.answer.lines;
  assert.ok(lines.some((line) => line.label === "Food & Drinks"), JSON.stringify(lines));
  for (const line of lines.filter((item) => item.figure?.ids?.length)) {
    const [startMonth, endMonth] = line.figure.period.split(":");
    const { model, derived } = await viewEntries(api, accounts, "spent", { search, period: { startMonth, endMonth }, ids: line.figure.ids });
    assert.equal(shownTotal(model), line.amountMinor, line.label);
    assert.equal(changedFigureMinor(line.figure.ids, derived.filteredEntries), line.amountMinor, `${line.label} (rule)`);
  }
  const summary = await get(api, `/api/summary-page?view=household&month=${thisMonth}&scope=direct_plus_shared&summary_start=${addMonths(thisMonth, -6)}&summary_end=${thisMonth}`);
  const above = summary.summaryPage.aboveUsual;
  assert.equal(above.lines[0].category, "Food & Drinks");
  assert.equal(above.lines[0].nowMinor, 89_000);
  const { model } = await viewEntries(api, accounts, "spent", { search, period: { startMonth: thisMonth, endMonth: thisMonth }, ids: above.lines[0].ids });
  assert.equal(shownTotal(model), 89_000);
});
