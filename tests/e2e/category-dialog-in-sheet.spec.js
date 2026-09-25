import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The category dialog opens from inside entry and plan-row forms (the
// mobile sheets and the desktop entry composer). It is portalled, but React
// still bubbles its submit through the component tree, so saving the
// category must stay inside the category dialog: the surrounding form keeps
// its draft, stays open and is not saved.

const PHONE = { width: 390, height: 844 };

function countRequests(page, fragment) {
  const seen = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(fragment)) {
      seen.push(request.url());
    }
  });
  return seen;
}

async function saveCategoryFrom(page, container, { submitWithEnter = false } = {}) {
  await container.locator(".category-icon-button").first().click();
  const categoryDialog = page.getByRole("dialog", { name: "Edit category" });
  await expect(categoryDialog).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().includes("/api/categories/update") && response.ok());
  if (submitWithEnter) {
    await categoryDialog.getByRole("textbox").first().press("Enter");
  } else {
    await categoryDialog.getByRole("button", { name: "Save category" }).click();
  }
  await saved;
  await expect(categoryDialog).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.__MONIES_MAP_WARMUP_MODE__ = "off";
  });
  await page.goto("/");
  await reseedDemo(page);
});

test("mobile: saving the category from the entry edit sheet saves only the category", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const rows = page.locator(".entry-row");
  await gotoPageAfterApi(page, "/entries?view=household&month=2026-05", "/api/entries-page", () => rows.first());
  const entrySaves = countRequests(page, "/api/entries/update");
  const categorySaves = countRequests(page, "/api/categories/update");

  // An expense row: transfer rows show a locked category icon.
  await rows.filter({ hasText: "Vivify" }).first().click();
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible();
  const description = sheet.getByLabel("Description");
  const draft = `Unsaved sheet draft ${Date.now()}`;
  await description.fill(draft);

  await saveCategoryFrom(page, sheet);
  await saveCategoryFrom(page, sheet, { submitWithEnter: true });

  await expect(sheet).toBeVisible();
  await expect(description).toHaveValue(draft);
  await page.waitForTimeout(500);
  expect(categorySaves).toHaveLength(2);
  expect(entrySaves).toEqual([]);
});

test("mobile: saving the category from the add planned item sheet saves only the category", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await gotoPageAfterApi(
    page,
    "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
    "/api/month-page",
    () => page.getByRole("button", { name: "+ Add planned item" })
  );
  const planSaves = countRequests(page, "/api/month-plan/save");
  const categorySaves = countRequests(page, "/api/categories/update");

  await page.getByRole("button", { name: "+ Add planned item" }).click();
  const sheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
  await expect(sheet).toBeVisible();
  const label = sheet.getByLabel("Item", { exact: true });
  const draft = `Unsaved plan draft ${Date.now()}`;
  await label.fill(draft);

  await saveCategoryFrom(page, sheet);

  await expect(sheet).toBeVisible();
  await expect(label).toHaveValue(draft);
  await page.waitForTimeout(500);
  expect(categorySaves).toHaveLength(1);
  expect(planSaves).toEqual([]);
});

test("desktop: saving the category from the new entry composer saves only the category", async ({ page }) => {
  const rows = page.locator(".entry-row");
  await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-05", "/api/entries-page", () => rows.first());
  const entryCreates = countRequests(page, "/api/entries/create");
  const categorySaves = countRequests(page, "/api/categories/update");

  await page.getByRole("button", { name: "+ Add entry" }).first().click();
  const composer = page.locator(".entry-composer");
  await expect(composer).toBeVisible();
  const draft = `Unsaved composer draft ${Date.now()}`;
  await composer.getByLabel("Description").fill(draft);
  await composer.getByLabel("Amount").fill("12.34");

  await saveCategoryFrom(page, composer);

  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Description")).toHaveValue(draft);
  await page.waitForTimeout(500);
  expect(categorySaves).toHaveLength(1);
  expect(entryCreates).toEqual([]);
});

test("desktop: typing and saving in the category dialog opened from an entry row never opens the row editor", async ({ page }) => {
  const rows = page.locator(".entry-row");
  await gotoPageAfterApi(page, "/entries?view=household&month=2026-05", "/api/entries-page", () => rows.first());
  const entrySaves = countRequests(page, "/api/entries/update");
  const categorySaves = countRequests(page, "/api/categories/update");
  const row = rows.filter({ hasText: "Vivify" }).first();

  await row.locator(".category-icon-button").first().click();
  const categoryDialog = page.getByRole("dialog", { name: "Edit category" });
  await expect(categoryDialog).toBeVisible();
  const name = categoryDialog.getByRole("textbox").first();
  const original = await name.inputValue();
  // Space and Enter are the row's own "open editor" keys.
  await name.press("End");
  await name.pressSequentially(" x");
  await expect(name).toHaveValue(`${original} x`);
  await expect(page.locator(".entry-edit-grid")).toHaveCount(0);

  const saved = page.waitForResponse((response) => response.url().includes("/api/categories/update") && response.ok());
  await name.press("Enter");
  await saved;
  await expect(categoryDialog).toHaveCount(0);
  await expect(page.locator(".entry-edit-grid")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(categorySaves).toHaveLength(1);
  expect(entrySaves).toEqual([]);
});
