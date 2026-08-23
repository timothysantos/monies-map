import { expect, test } from "@playwright/test";
import { reseedDemo } from "./helpers";

test("stale import banner opens Imports and FAQ remains reachable", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });

  await reseedDemo(page);
  await page.goto("/summary?view=household&month=2026-08&summary_start=2025-09&summary_end=2026-08", {
    waitUntil: "domcontentloaded"
  });

  await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open import inbox" })).toBeVisible();

  await page.getByRole("button", { name: "Open import inbox" }).click();
  await expect(page).toHaveURL(/\/imports\?/);
  await expect(page.getByRole("heading", { name: "Imports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import inbox", exact: true })).toBeVisible();

  const firstInboxFileRow = page.locator(".import-inbox-file-row").first();
  await expect(firstInboxFileRow).toContainText(/Owner:/);
  await expect(firstInboxFileRow).toContainText(/\(\d{4}-\d{2}\)/);

  await page.getByRole("link", { name: "FAQ", exact: true }).click();
  await expect(page).toHaveURL(/\/faq\?/);
  await expect(page.getByRole("heading", { name: "FAQ", exact: true })).toBeVisible();

  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
