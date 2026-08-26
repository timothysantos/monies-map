import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

async function expectInlineSearch(root) {
  const label = root.locator(".entries-filter-label");
  const control = root.locator(".search-filter-control");
  const icon = control.locator("svg").first();
  const input = control.locator("input");
  const [labelBox, controlBox, iconBox, inputBox] = await Promise.all([
    label.boundingBox(),
    control.boundingBox(),
    icon.boundingBox(),
    input.boundingBox()
  ]);

  expect(labelBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(iconBox).not.toBeNull();
  expect(inputBox).not.toBeNull();

  const labelMidline = labelBox.y + labelBox.height / 2;
  const controlMidline = controlBox.y + controlBox.height / 2;
  const iconMidline = iconBox.y + iconBox.height / 2;
  const inputMidline = inputBox.y + inputBox.height / 2;

  expect(Math.abs(labelMidline - controlMidline)).toBeLessThanOrEqual(12);
  expect(Math.abs(iconMidline - inputMidline)).toBeLessThanOrEqual(8);
  expect(controlBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
  expect(iconBox.x).toBeGreaterThanOrEqual(controlBox.x);
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(controlBox.x + controlBox.width);
}

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

test("entries mobile search keeps the label, icon, and field on one line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reseedDemo(page);

  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-06",
    "/api/entries-page",
    () => page.locator(".mobile-context-sticky-wrap")
  );

  await page.locator(".mobile-context-trigger").click();
  const dialog = page.locator(".mobile-context-dialog");
  await expect(dialog).toBeVisible();
  await expectInlineSearch(dialog.locator(".search-filter").first());
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

test("splits search is integrated into the themed summary strip on desktop and mobile", async ({ page }) => {
  await reseedDemo(page);

  await gotoPageAfterApi(
    page,
    "/splits?view=person-tim&month=2026-06&split_group=split-group-none",
    "/api/splits-page",
    () => page.locator(".splits-summary-strip .split-summary-search")
  );

  const desktopSearch = page.locator(".splits-summary-strip .split-summary-search");
  await expect(desktopSearch).toBeVisible();
  await expectInlineSearch(desktopSearch);
  await expect(desktopSearch.locator(".entries-filter-label")).toHaveCSS("color", "rgba(255, 248, 243, 0.9)");
  await expect(page.locator(".split-search-bar")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(desktopSearch).toBeVisible();
  await expectInlineSearch(desktopSearch);
});
