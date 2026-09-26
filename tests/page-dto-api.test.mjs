// Page DTO contracts through the real Worker and a real local D1: what the
// app shell and reference data carry, the demo reseed, a Summary month note
// reaching the Month DTO, a shared entry's viewer amounts, and Settings
// writes (category rules, optional AI suggestions, account and category
// renames) reaching the downstream page DTOs. Moved from the Playwright specs
// app-shell, reseed-contract, summary-workflow, entries-add-to-splits and
// settings-reference-data, where they never touched the page (see
// docs/audits/e2e-unit-audit.md); the requests and assertions are
// unchanged. The browser workflows stay in those specs.
import test from "node:test";
import { expect } from "@playwright/test";

import {
  loadEntriesPage,
  loadImportsPage,
  loadMonthPage,
  loadReferenceData,
  loadSettingsPage,
  loadSummaryAccountPills,
  loadSummaryPage,
  postJson,
  useSeededWorkerRequest
} from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

function uniqueLabel(prefix) {
  return `${prefix} ${Date.now()}`;
}

async function reseedDemo(request) {
  const response = await request.post("/api/demo/reseed");
  expect(response.ok(), await response.text()).toBeTruthy();
}

// ------------------------------------------------ app shell and reference data

test("app shell request stays shell-only", async (t) => {
  const request = await openRequest(t);

  const response = await request.get("/api/app-shell");
  expect(response.ok(), await response.text()).toBeTruthy();

  const shell = await response.json();

  expect(shell.availableViewIds).toContain("household");
  expect(shell.trackedMonths.length).toBeGreaterThan(0);
  expect(shell.household.people.length).toBeGreaterThan(0);
  expect(shell.accounts).toBeUndefined();
  expect(shell.categories).toBeUndefined();
  expect(shell.views).toBeUndefined();
  expect(shell.importsPage).toBeUndefined();
  expect(shell.settingsPage).toBeUndefined();
});

test("reference data owns lightweight account and category lists", async (t) => {
  const request = await openRequest(t);

  const response = await request.get("/api/reference-data");
  expect(response.ok(), await response.text()).toBeTruthy();

  const referenceData = await response.json();

  expect(referenceData.accounts.length).toBeGreaterThan(0);
  expect(referenceData.categories.length).toBeGreaterThan(0);
  expect(referenceData.accounts[0].checkpointHistory).toBeUndefined();
});

// ------------------------------------------------ demo reseed

test("demo reseed is idempotent and restores expected baseline data", async (t) => {
  const request = await openRequest(t);
  const firstReseed = await request.post("/api/demo/reseed");
  expect(firstReseed.ok(), await firstReseed.text()).toBeTruthy();

  const firstPayload = await firstReseed.json();
  expect(firstPayload.ok).toBeTruthy();
  expect(firstPayload.demo).toBeTruthy();
  expect(firstPayload.demo.emptyState).toBe(false);
  expect(typeof firstPayload.demo.lastSeededAt).toBe("string");

  const entriesPage = await loadEntriesPage(request, { view: "person-tim", month: "2026-04" });
  expect(entriesPage.monthPage).toBeTruthy();
  expect(entriesPage.monthPage.entries.length).toBeGreaterThan(0);

  const importsPage = await loadImportsPage(request);
  expect(importsPage.importsPage).toBeTruthy();
  expect(Array.isArray(importsPage.importsPage.recentImports)).toBeTruthy();

  const settingsPage = await loadSettingsPage(request);
  expect(settingsPage.settingsPage).toBeTruthy();
  expect(settingsPage.settingsPage.demo).toBeTruthy();

  await reseedDemo(request);
  const secondSettings = await loadSettingsPage(request);
  expect(secondSettings.settingsPage.demo.emptyState).toBe(false);
});

// ------------------------------------------------ Summary, Month and Entries DTOs

test("summary month note edits refresh the summary and month DTOs", async (t) => {
  const request = await openRequest(t);
  const editedNote = `Playwright summary note ${Date.now()}`;
  const summaryBefore = await loadSummaryPage(request, { view: "household", month: "2026-04" });
  const targetMonth = summaryBefore.summaryPage.rangeEndMonth;

  await postJson(request, "/api/month-note/update", {
    month: targetMonth,
    personScope: "household",
    note: editedNote
  });

  const summaryPage = await loadSummaryPage(request, { view: "household", month: targetMonth });
  const summaryMonth = summaryPage.summaryPage.months.find((month) => month.month === targetMonth);
  expect(summaryMonth?.note).toBe(editedNote);

  const monthPage = await loadMonthPage(request, { view: "household", month: targetMonth });
  expect(monthPage.monthPage.monthNote).toBe(editedNote);
});

test("a shared entry's viewer amount follows each person's share after the split percentage changes", async (t) => {
  const request = await openRequest(t);
  const description = `Playwright shared totals ${Date.now()}`;
  const transferDescription = `Playwright shared transfer ${Date.now()}`;

  const entry = await postJson(request, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });
  await postJson(request, "/api/entries/create", {
    date: "2026-04-24",
    description: transferDescription,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: 1000,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });

  await postJson(request, "/api/entries/update", {
    entryId: entry.entryId,
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 4000
  });

  const timData = await loadEntriesPage(request, { view: "person-tim", month: "2026-04" });
  const timEntry = timData.monthPage.entries.find((item) => item.description === description);
  expect(timEntry?.amountMinor).toBe(800);
  expect(timEntry?.totalAmountMinor).toBe(2000);
  expect(timEntry?.viewerSplitRatioBasisPoints).toBe(4000);

  const joyceData = await loadEntriesPage(request, { view: "person-joyce", month: "2026-04" });
  const joyceEntry = joyceData.monthPage.entries.find((item) => item.description === description);
  expect(joyceEntry?.amountMinor).toBe(1200);
  expect(joyceEntry?.totalAmountMinor).toBe(2000);
  expect(joyceEntry?.viewerSplitRatioBasisPoints).toBe(6000);
});

test("a shared entry carries the viewer share and the full total in a person view, and the full amount for the household", async (t) => {
  const request = await openRequest(t);
  const description = `Playwright shared editor amount ${Date.now()}`;

  await postJson(request, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4700,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 5000
  });

  const timData = await loadEntriesPage(request, { view: "person-tim", month: "2026-04" });
  const timEntry = timData.monthPage.entries.find((item) => item.description === description);
  expect(timEntry?.amountMinor).toBe(2350);
  expect(timEntry?.totalAmountMinor).toBe(4700);
  expect(timEntry?.viewerSplitRatioBasisPoints).toBe(5000);

  const householdData = await loadEntriesPage(request, { view: "household", month: "2026-04" });
  const householdEntry = householdData.monthPage.entries.find((item) => item.description === description);
  expect(householdEntry?.amountMinor).toBe(4700);
  expect(householdEntry?.viewerSplitRatioBasisPoints).toBeUndefined();
});

// ------------------------------------------------ Settings writes

test("category rule CRUD stays inside the settings page DTO", async (t) => {
  const request = await openRequest(t);
  const before = await loadSettingsPage(request);
  const referenceData = await loadReferenceData(request);
  const targetCategory = referenceData.categories[0];
  const rulePattern = uniqueLabel("Playwright category rule");

  await postJson(request, "/api/category-match-rules/save", {
    pattern: rulePattern,
    categoryId: targetCategory.id,
    priority: 75,
    isActive: true,
    note: "Created by Playwright"
  });

  const afterCreate = await loadSettingsPage(request);
  const createdRule = afterCreate.settingsPage.categoryMatchRules.find((rule) => rule.pattern === rulePattern);
  expect(createdRule).toBeTruthy();
  expect(afterCreate.settingsPage.categoryMatchRules.length).toBe(before.settingsPage.categoryMatchRules.length + 1);

  await postJson(request, "/api/category-match-rules/delete", {
    ruleId: createdRule.id
  });

  const afterDelete = await loadSettingsPage(request);
  expect(afterDelete.settingsPage.categoryMatchRules.find((rule) => rule.pattern === rulePattern)).toBeUndefined();
  expect(afterDelete.settingsPage.categoryMatchRules.length).toBe(before.settingsPage.categoryMatchRules.length);
});

test("optional AI category suggestions leave the existing rule queue unchanged when AI is unavailable", async (t) => {
  const request = await openRequest(t);
  const before = await loadSettingsPage(request);
  const response = await postJson(request, "/api/ai-assist/category-rule-suggestions", {});
  expect(response).toMatchObject({ ok: true, available: false, proposed: 0 });

  const after = await loadSettingsPage(request);
  expect(after.settingsPage.categoryMatchRuleSuggestions).toEqual(before.settingsPage.categoryMatchRuleSuggestions);
});

test("account rename updates reference data plus summary and entries downstream DTOs", async (t) => {
  const request = await openRequest(t);
  const beforeReferenceData = await loadReferenceData(request);
  const beforeSummaryPills = await loadSummaryAccountPills(request, { view: "household" });
  const visiblePill = beforeSummaryPills.accountPills[0];
  const targetAccount = beforeReferenceData.accounts.find((account) => account.id === visiblePill?.accountId) ?? beforeReferenceData.accounts[0];
  const renamedAccount = uniqueLabel(`${targetAccount.name} renamed`);
  const createdDescription = uniqueLabel("Playwright account rename");

  await postJson(request, "/api/entries/create", {
    date: "2026-04-24",
    description: createdDescription,
    accountName: targetAccount.name,
    categoryName: beforeReferenceData.categories[0].name,
    amountMinor: 4321,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(request, "/api/accounts/update", {
    accountId: targetAccount.id,
    name: renamedAccount,
    institution: targetAccount.institution,
    kind: targetAccount.kind,
    currency: targetAccount.currency,
    openingBalanceMinor: targetAccount.openingBalanceMinor ?? 0,
    ownerPersonId: targetAccount.isJoint ? null : (targetAccount.ownerPersonId ?? null),
    isJoint: targetAccount.isJoint
  });

  const afterReferenceData = await loadReferenceData(request);
  expect(afterReferenceData.accounts.find((account) => account.id === targetAccount.id)?.name).toBe(renamedAccount);

  const summaryPage = await loadSummaryAccountPills(request, { view: "household" });
  expect(
    summaryPage.accountPills.some((pill) => pill.accountId === targetAccount.id && pill.accountName === renamedAccount)
  ).toBe(true);

  const entriesPage = await loadEntriesPage(request, { view: "person-tim", month: "2026-04" });
  expect(
    entriesPage.monthPage.entries.some((entry) => entry.description === createdDescription && entry.accountName === renamedAccount)
  ).toBe(true);
});

test("category rename refreshes reference data plus month and summary downstream DTOs", async (t) => {
  const request = await openRequest(t);
  const beforeReferenceData = await loadReferenceData(request);
  const targetCategory = beforeReferenceData.categories.find((category) => !category.isSystem) ?? beforeReferenceData.categories[0];
  const renamedCategory = uniqueLabel(`${targetCategory.name} renamed`);
  const createdDescription = uniqueLabel("Playwright category rename");
  const targetAccount = beforeReferenceData.accounts.find((account) => account.isActive) ?? beforeReferenceData.accounts[0];

  await postJson(request, "/api/entries/create", {
    date: "2026-04-25",
    description: createdDescription,
    accountName: targetAccount.name,
    categoryName: targetCategory.name,
    amountMinor: 5432,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(request, "/api/categories/update", {
    categoryId: targetCategory.id,
    name: renamedCategory,
    slug: targetCategory.slug,
    iconKey: targetCategory.iconKey,
    colorHex: targetCategory.colorHex
  });

  const afterReferenceData = await loadReferenceData(request);
  expect(afterReferenceData.categories.find((category) => category.id === targetCategory.id)?.name).toBe(renamedCategory);

  const monthPage = await loadMonthPage(request, { view: "person-tim", month: "2026-04" });
  expect(
    monthPage.monthPage.entries.some((entry) => entry.description === createdDescription && entry.categoryName === renamedCategory)
  ).toBe(true);

  const summaryPage = await loadSummaryPage(request, { view: "person-tim", month: "2026-04" });
  const aprilDonut = summaryPage.summaryPage.categoryShareByMonth.find((month) => month.month === "2026-04");
  expect(aprilDonut?.data.some((item) => item.label === renamedCategory)).toBe(true);
});
