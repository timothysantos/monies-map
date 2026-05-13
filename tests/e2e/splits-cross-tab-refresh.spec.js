import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("creating a split expense refreshes the same month in another splits tab", async ({ page }) => {
  const description = `Cross-tab split expense ${Date.now()}`;
  const secondPage = await page.context().newPage();

  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await secondPage.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await page.waitForLoadState("networkidle");
  await secondPage.waitForLoadState("networkidle");

  await postJson(page, "/api/splits/expenses/create", {
    date: "2025-10-12",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 1890,
    groupId: null,
    note: "Cross-tab refresh test"
  });
  await page.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "split-mutation",
      ts: Date.now(),
      month: "2025-10",
      invalidateEntries: false,
      invalidateMonth: false,
      invalidateSummary: false,
      refreshShell: false
    }));
  });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(splitsData.splitsPage.activity.some((item) => item.description === description)).toBe(true);
  await expect(secondPage.getByText(description, { exact: true })).toBeVisible();

  await secondPage.close();
});

test("adding an entry to splits refreshes another tab that is already open on splits", async ({ page }) => {
  const description = `Cross-tab entry to splits ${Date.now()}`;
  const secondPage = await page.context().newPage();

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry).toBeTruthy();
  await secondPage.goto("/splits?view=person-tim&month=2026-04&split_group=split-group-none");
  await secondPage.waitForLoadState("networkidle");

  const splitResponse = await page.request.post("/api/splits/expenses/from-entry", {
    data: {
      entryId: createdEntry?.id,
      splitGroupId: null
    }
  });
  expect(splitResponse.ok()).toBeTruthy();
  await page.evaluate(() => {
    localStorage.setItem("monies-map-app-sync", JSON.stringify({
      type: "split-mutation",
      ts: Date.now(),
      month: "2026-04",
      invalidateEntries: true,
      invalidateMonth: true,
      invalidateSummary: true,
      refreshShell: false
    }));
  });

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  expect(splitsData.splitsPage.activity.some((item) => item.description === description)).toBe(true);
  await expect(secondPage.getByText(description, { exact: true })).toBeVisible();

  await secondPage.close();
});
