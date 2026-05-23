import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

async function openTransferManager(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=2026-05&editing_entry=${entryId}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`editing_entry=${entryId}`));
  await expect(page.getByRole("button", { name: "Manage transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Manage transfer" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Transfer details" })).toBeVisible();
  await page.getByRole("button", { name: "Close transfer manager" }).click();
}

test("matched transfer rows open the transfer manager without crashing for both directions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });

  await page.goto("/");
  await reseedDemo(page);

  await openTransferManager(page, "txn-oct-transfer-out");
  await openTransferManager(page, "txn-oct-transfer-in");

  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
