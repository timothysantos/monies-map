import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

test("entries search filters visible rows and preserves the query in the URL", async ({ page }) => {
  const month = "2026-06";
  const targetDescription = `Playwright search FairPrice ${Date.now()}`;
  const otherDescription = `Playwright search Grab ${Date.now()}`;

  await reseedDemo(page);
  await postJson(page, "/api/entries/create", {
    date: `${month}-12`,
    description: targetDescription,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4280,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "weekly shop"
  });
  await postJson(page, "/api/entries/create", {
    date: `${month}-12`,
    description: otherDescription,
    accountName: "UOB One",
    categoryName: "Taxi",
    amountMinor: 1890,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: "airport"
  });

  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=${month}`,
    "/api/entries-page",
    () => page.locator(".entry-row").filter({ hasText: targetDescription }).first()
  );

  await expect(page.locator(".entry-row").filter({ hasText: targetDescription })).toHaveCount(1);
  await expect(page.locator(".entry-row").filter({ hasText: otherDescription })).toHaveCount(1);

  await page.getByRole("combobox", { name: "Search" }).fill("fairprice 42.80");

  await expect(page.locator(".entry-row").filter({ hasText: targetDescription })).toHaveCount(1);
  await expect(page.locator(".entry-row").filter({ hasText: otherDescription })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("entry_search")).toBe("fairprice 42.80");
});

test("splits search filters activity and preserves the query in the URL", async ({ page }) => {
  const month = "2026-06";
  const targetDescription = `Playwright split search Din Tai Fung ${Date.now()}`;
  const otherDescription = `Playwright split search Groceries ${Date.now()}`;

  await reseedDemo(page);
  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-12`,
    description: targetDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 8880,
    groupId: null,
    note: "birthday dinner"
  });
  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-12`,
    description: otherDescription,
    categoryName: "Groceries",
    payerPersonName: "Joyce",
    amountMinor: 3210,
    groupId: null,
    note: "weekly shop"
  });

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: targetDescription }).first()
  );

  await expect(page.locator(".split-activity-card").filter({ hasText: targetDescription })).toHaveCount(1);
  await expect(page.locator(".split-activity-card").filter({ hasText: otherDescription })).toHaveCount(1);

  await page.getByRole("combobox", { name: "Search" }).fill("din 88.80");

  await expect(page.locator(".split-activity-card").filter({ hasText: targetDescription })).toHaveCount(1);
  await expect(page.locator(".split-activity-card").filter({ hasText: otherDescription })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("split_search")).toBe("din 88.80");
});
