import { expect, test } from "@playwright/test";

import { installReactCommitCounter } from "../support/react-commit-counter.js";
import { postJson, reseedDemo } from "./helpers";

// The Month "Match planned item" picker memoizes its candidate rows: a
// checkbox or filter change re-renders only rows it changes, so a month
// with a thousand candidates stays responsive.

async function countCandidateRenders(page, action) {
  await page.evaluate(() => {
    window.__reactCommitCounter.reset();
    window.__reactCommitCounter.enabled = true;
  });
  await action();
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    window.__reactCommitCounter.enabled = false;
    return window.__reactCommitCounter.read().rowRenders["planned-link-row"] ?? 0;
  });
}

test("toggling one candidate re-renders only that row and its check survives a filter change", async ({ page }) => {
  await page.addInitScript(installReactCommitCounter);
  await reseedDemo(page);
  const label = `Playwright render plan ${Date.now()}`;
  await postJson(page, "/api/month-plan/save", {
    rowId: `playwright-render-plan-${Date.now()}`,
    month: "2026-05",
    sectionKey: "planned_items",
    categoryName: "Food & Drinks",
    label,
    planDate: "2026-05-10",
    accountName: "UOB One",
    plannedMinor: 3000,
    note: "Render coverage.",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  for (const suffix of ["alpha", "bravo", "charlie", "delta"]) {
    await postJson(page, "/api/entries/create", {
      date: "2026-05-10",
      description: `Playwright render candidate ${suffix}`,
      accountName: "UOB One",
      categoryName: "Food & Drinks",
      amountMinor: 1200,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }

  await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
  const planRow = page.locator("tr").filter({ hasText: label }).first();
  await planRow.getByRole("button", { name: "Link entries" }).click();
  const dialog = page.locator(".planned-link-dialog");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__reactCommitCounter.trackRows(["planned-link-row"]));
  const rows = dialog.locator(".planned-link-row");
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(4);

  const target = rows.filter({ hasText: "Playwright render candidate bravo" });
  const toggled = await countCandidateRenders(page, async () => {
    await target.locator("input").check();
    await expect(target.locator("input")).toBeChecked();
  });
  expect(toggled).toBe(1);

  // Narrowing the list to rows already on screen re-renders none of them.
  const filter = dialog.getByPlaceholder("Filter descriptions in this list");
  const narrowed = await countCandidateRenders(page, async () => {
    await filter.fill("render candidate");
    await expect(rows).toHaveCount(4);
  });
  expect(narrowed).toBe(0);
  await expect(target.locator("input")).toBeChecked();

  // The description filter hides even a checked row; clearing it brings the
  // row back still checked, because the draft selection lives outside rows.
  await filter.fill("charlie");
  await expect(rows).toHaveCount(1);
  await filter.fill("");
  await expect(rows).toHaveCount(count);
  await expect(target.locator("input")).toBeChecked();
  // Negative: an untouched candidate stays unchecked.
  await expect(rows.filter({ hasText: "Playwright render candidate alpha" }).locator("input")).not.toBeChecked();
});
