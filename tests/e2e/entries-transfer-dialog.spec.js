import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

async function openTransferManager(page, entryId) {
  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=2026-05&editing_entry=${entryId}`,
    "/api/entries-page",
    () => page.getByRole("button", { name: "Manage transfer" })
  );
  await page.waitForURL(new RegExp(`editing_entry=${entryId}`));
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

test("the Entries transfer manager offers only the match tools Entries can run", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-05&editing_entry=txn-oct-transfer-out",
    "/api/entries-page",
    () => page.getByRole("button", { name: "Manage transfer" })
  );
  await page.getByRole("button", { name: "Manage transfer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Recheck matches" })).toBeVisible();
  // Entries has no AI ranking handler, so it must not show a button that does nothing.
  await expect(dialog.getByRole("button", { name: "Rank descriptions" })).toHaveCount(0);
});
