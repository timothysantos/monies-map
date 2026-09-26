// Month page budget and planned-item actuals through the real Worker and a
// real local D1: which ledger rows count toward a bucket in each scope,
// linked planned items, viewer-weighted shared actuals and offsetting
// income. Moved from tests/e2e/month-page.spec.js, where they never touched
// the page (see docs/audits/e2e-unit-audit.md); the requests and assertions
// are unchanged. The browser Month workflows stay in that spec.
import test from "node:test";
import { expect } from "@playwright/test";

import { postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

async function loadMonthPageData(request, { view = "person-tim", month = "2026-05", scope = "direct_plus_shared" } = {}) {
  const response = await request.get(`/api/month-page?view=${view}&month=${month}&scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function findBudgetRow(monthPageData, label) {
  const budgetSection = monthPageData.monthPage.planSections.find((section) => section.key === "budget_buckets");
  const row = budgetSection?.rows.find((item) => item.label === label);
  if (!row) {
    throw new Error(`Budget row not found: ${label}`);
  }
  return row;
}

test("planned item actuals only appear when they are backed by linked current-month entries", async (t) => {
  const request = await openRequest(t);
  const data = await loadMonthPageData(request);
  const plannedRows = data.monthPage.planSections
    .find((section) => section.key === "planned_items")
    ?.rows ?? [];

  const phantomActuals = plannedRows.filter((row) => row.actualMinor > 0 && (row.linkedEntryIds?.length ?? 0) === 0);
  expect(phantomActuals).toEqual([]);

  for (const row of plannedRows.filter((item) => item.linkedEntryIds?.length)) {
    expect(row.actualEntryIds?.length ?? 0, `${row.label} should expose actual entry ids for drilldown`).toBeGreaterThan(0);
    expect(row.actualMinor, `${row.label} should derive actual from linked entries`).toBeGreaterThan(0);
  }
});

test("new direct ledger expense updates the matching budget bucket actual in direct and direct+shared scopes", async (t) => {
  const request = await openRequest(t);
  const beforeDirectMonth = await loadMonthPageData(request, { scope: "direct" });
  const beforeSharedMonth = await loadMonthPageData(request, { scope: "shared" });
  const beforeCombinedMonth = await loadMonthPageData(request, { scope: "direct_plus_shared" });

  await postJson(request, "/api/entries/create", {
    date: "2026-05-20",
    description: "Playwright month food expense",
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 1234,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const directMonth = await loadMonthPageData(request, { scope: "direct" });
  const sharedMonth = await loadMonthPageData(request, { scope: "shared" });
  const combinedMonth = await loadMonthPageData(request, { scope: "direct_plus_shared" });

  expect(findBudgetRow(directMonth, "Food").actualMinor).toBe(findBudgetRow(beforeDirectMonth, "Food").actualMinor + 1234);
  expect(findBudgetRow(sharedMonth, "Food").actualMinor).toBe(findBudgetRow(beforeSharedMonth, "Food").actualMinor);
  expect(findBudgetRow(combinedMonth, "Food").actualMinor).toBe(findBudgetRow(beforeCombinedMonth, "Food").actualMinor + 1234);
});

test("planned items stay at zero until linked, then absorb linked actuals and release the bucket total", async (t) => {
  const request = await openRequest(t);
  const rowId = `playwright-plan-${Date.now()}`;
  await postJson(request, "/api/month-plan/save", {
    rowId,
    month: "2026-05",
    sectionKey: "planned_items",
    categoryName: "Entertainment",
    label: "Playwright date night",
    planDate: "2026-05-18",
    accountName: "",
    plannedMinor: 5000,
    note: "Playwright planned item.",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const firstEntry = await postJson(request, "/api/entries/create", {
    date: "2026-05-18",
    description: "Playwright dinner charge",
    accountName: "UOB One",
    categoryName: "Entertainment",
    amountMinor: 1100,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const secondEntry = await postJson(request, "/api/entries/create", {
    date: "2026-05-19",
    description: "Playwright dessert charge",
    accountName: "UOB One",
    categoryName: "Entertainment",
    amountMinor: 400,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const beforeLink = await loadMonthPageData(request, { scope: "direct_plus_shared" });
  const beforeItem = beforeLink.monthPage.planSections
    .find((section) => section.key === "planned_items")
    .rows.find((row) => row.id === rowId);
  expect(beforeItem.actualMinor).toBe(0);
  const beforeBucketActualMinor = findBudgetRow(beforeLink, "Entertainment").actualMinor;

  await postJson(request, "/api/month-plan/links", {
    rowId,
    month: "2026-05",
    transactionIds: [firstEntry.entryId, secondEntry.entryId]
  });

  const afterLink = await loadMonthPageData(request, { scope: "direct_plus_shared" });
  const linkedItem = afterLink.monthPage.planSections
    .find((section) => section.key === "planned_items")
    .rows.find((row) => row.id === rowId);
  expect(linkedItem.actualMinor).toBe(1500);
  expect(linkedItem.linkedEntryCount).toBe(2);
  expect(findBudgetRow(afterLink, "Entertainment").actualMinor).toBe(beforeBucketActualMinor - 1500);
});

test("linked shared planned items use the viewer split amount instead of the household total", async (t) => {
  const request = await openRequest(t);
  const rowId = `playwright-shared-plan-${Date.now()}`;
  await postJson(request, "/api/month-plan/save", {
    rowId,
    month: "2026-05",
    sectionKey: "planned_items",
    categoryName: "Family & Personal",
    label: "Playwright shared family spend",
    planDate: "2026-05-20",
    accountName: "UOB One",
    plannedMinor: 4000,
    note: "Shared linked actuals should stay view-weighted.",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });

  const linkedEntry = await postJson(request, "/api/entries/create", {
    date: "2026-05-20",
    description: "Playwright shared family charge",
    accountName: "UOB One",
    categoryName: "Family & Personal",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });

  await postJson(request, "/api/month-plan/links", {
    rowId,
    month: "2026-05",
    transactionIds: [linkedEntry.entryId]
  });

  const householdData = await loadMonthPageData(request, { view: "household" });
  const householdRow = householdData.monthPage.planSections
    .find((section) => section.key === "planned_items")
    .rows.find((row) => row.id === rowId);
  expect(householdRow.actualMinor).toBe(2000);

  const timData = await loadMonthPageData(request, { view: "person-tim" });
  const timRow = timData.monthPage.planSections
    .find((section) => section.key === "planned_items")
    .rows.find((row) => row.id === rowId);
  expect(timRow.actualMinor).toBe(500);

  const joyceData = await loadMonthPageData(request, { view: "person-joyce" });
  const joyceRow = joyceData.monthPage.planSections
    .find((section) => section.key === "planned_items")
    .rows.find((row) => row.id === rowId);
  expect(joyceRow.actualMinor).toBe(1500);
});

test("offsetting income reduces the matching budget bucket actual", async (t) => {
  const request = await openRequest(t);
  const beforeMonthData = await loadMonthPageData(request, { scope: "direct_plus_shared" });

  await postJson(request, "/api/entries/create", {
    date: "2026-05-22",
    description: "Playwright groceries charge",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(request, "/api/entries/create", {
    date: "2026-05-23",
    description: "Playwright grocery reimbursement",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 500,
    entryType: "income",
    ownershipType: "direct",
    ownerName: "Tim",
    offsetsCategory: true
  });

  const monthData = await loadMonthPageData(request, { scope: "direct_plus_shared" });
  expect(findBudgetRow(monthData, "Groceries").actualMinor).toBe(findBudgetRow(beforeMonthData, "Groceries").actualMinor + 1500);
});
