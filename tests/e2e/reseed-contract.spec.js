import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadImportsPage, loadSettingsPage, reseedDemo } from "./helpers";

test("demo reseed is idempotent and restores expected baseline data", async ({ page }) => {
  const firstReseed = await page.request.post("/api/demo/reseed");
  expect(firstReseed.ok(), await firstReseed.text()).toBeTruthy();

  const firstPayload = await firstReseed.json();
  expect(firstPayload.ok).toBeTruthy();
  expect(firstPayload.demo).toBeTruthy();
  expect(firstPayload.demo.emptyState).toBe(false);
  expect(typeof firstPayload.demo.lastSeededAt).toBe("string");

  const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  expect(entriesPage.monthPage).toBeTruthy();
  expect(entriesPage.monthPage.entries.length).toBeGreaterThan(0);

  const importsPage = await loadImportsPage(page);
  expect(importsPage.importsPage).toBeTruthy();
  expect(Array.isArray(importsPage.importsPage.recentImports)).toBeTruthy();

  const settingsPage = await loadSettingsPage(page);
  expect(settingsPage.settingsPage).toBeTruthy();
  expect(settingsPage.settingsPage.demo).toBeTruthy();

  await reseedDemo(page);
  const secondSettings = await loadSettingsPage(page);
  expect(secondSettings.settingsPage.demo.emptyState).toBe(false);
});
