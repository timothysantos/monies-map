import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

test("split date group refresh reloads splits without leaving the page", async ({ page }) => {
  const month = "2026-06";
  const description = `Playwright split date refresh ${Date.now()}`;

  await reseedDemo(page);
  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-12`,
    description,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 1560,
    groupId: null,
    note: "refresh date group"
  });

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: description }).first()
  );

  const refreshButton = page.getByRole("button", { name: "Refresh split rows for 12 Jun 2026" });
  await expect(refreshButton).toBeVisible();
  const refreshResponse = page.waitForResponse((response) => response.url().includes("/api/splits-page") && response.ok());
  await refreshButton.click();
  await refreshResponse;

  await expect(page).toHaveURL(/\/splits/);
  await expect(page.locator(".split-activity-card").filter({ hasText: description })).toHaveCount(1);
  await expect(page.locator(".split-refresh-status")).toHaveCount(0);
});

test("split date headers stick while scrolling through a date group", async ({ page }) => {
  const month = "2026-06";
  const marker = `Playwright sticky split date ${Date.now()}`;

  await page.setViewportSize({ width: 1280, height: 720 });
  await reseedDemo(page);

  for (let index = 0; index < 36; index += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      date: `${month}-12`,
      description: `${marker} ${String(index + 1).padStart(2, "0")}`,
      categoryName: "Food & Drinks",
      payerPersonName: "Joyce",
      amountMinor: 1000 + index,
      groupId: null,
      note: "sticky date group"
    });
  }

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: `${marker} 01` }).first()
  );

  const dateHeader = page.locator(".split-date-header").filter({ hasText: "12 Jun 2026" }).first();
  await expect(dateHeader).toBeVisible();
  await expect(dateHeader).toHaveCSS("position", "sticky");

  await page.evaluate((element) => {
    document.documentElement.style.scrollBehavior = "auto";
    const documentTop = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: documentTop + 360, behavior: "instant" });
  }, await dateHeader.elementHandle());

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  const headerTop = await dateHeader.evaluate((element) => element.getBoundingClientRect().top);
  expect(headerTop).toBeGreaterThanOrEqual(-1);
  expect(headerTop).toBeLessThanOrEqual(1);
});

test("split date headers stick on mobile while scrolling through a date group", async ({ page }) => {
  const month = "2026-06";
  const marker = `Playwright mobile sticky split date ${Date.now()}`;

  await page.setViewportSize({ width: 390, height: 844 });
  await reseedDemo(page);

  for (let index = 0; index < 36; index += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      date: `${month}-12`,
      description: `${marker} ${String(index + 1).padStart(2, "0")}`,
      categoryName: "Food & Drinks",
      payerPersonName: "Joyce",
      amountMinor: 1000 + index,
      groupId: null,
      note: "mobile sticky date group"
    });
  }

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: `${marker} 01` }).first()
  );

  const dateHeader = page.locator(".split-date-header").filter({ hasText: "12 Jun 2026" }).first();
  await expect(dateHeader).toBeVisible();
  await expect(dateHeader).toHaveCSS("position", "sticky");
  await expect(page.locator(".shell")).toHaveCSS("overflow-x", "clip");
  await expect(page.locator(".panel-splits")).toHaveCSS("overflow-x", "clip");

  await page.evaluate((element) => {
    document.documentElement.style.scrollBehavior = "auto";
    const documentTop = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: documentTop + 420, behavior: "instant" });
  }, await dateHeader.elementHandle());

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  const headerTop = await dateHeader.evaluate((element) => element.getBoundingClientRect().top);
  expect(headerTop).toBeGreaterThanOrEqual(-1);
  expect(headerTop).toBeLessThanOrEqual(1);
});
