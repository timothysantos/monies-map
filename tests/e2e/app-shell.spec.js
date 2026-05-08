import { expect, test } from "@playwright/test";
import { reseedDemo } from "./helpers";

test("app shell request stays shell-only", async ({ page }) => {
  await reseedDemo(page);

  const response = await page.request.get("/api/app-shell");
  expect(response.ok(), await response.text()).toBeTruthy();

  const shell = await response.json();

  expect(shell.availableViewIds).toContain("household");
  expect(shell.trackedMonths.length).toBeGreaterThan(0);
  expect(shell.household.people.length).toBeGreaterThan(0);
  expect(shell.accounts.length).toBeGreaterThan(0);
  expect(shell.categories.length).toBeGreaterThan(0);
  expect(shell.views).toBeUndefined();
  expect(shell.importsPage).toBeUndefined();
  expect(shell.settingsPage).toBeUndefined();
});
