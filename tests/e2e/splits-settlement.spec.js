import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

test("recording a settlement closes the open batch and archives it", async ({ page }) => {
  const note = `Playwright settle up ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");

  const archiveTrigger = page.locator(".split-archive-trigger");
  await expect(archiveTrigger).toContainText("No settled batches yet");
  await expect(page.getByRole("button", { name: "Settle group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simplify settlement" })).toBeVisible();

  await page.locator("article.panel-splits .panel-head .split-settle-header").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Record payment for this group only");
  await expect(dialog).toContainText("Simplify settlement remains optional");
  await expect(dialog).toContainText("open groups in the same currency");
  await dialog.getByLabel("Note").fill(note);
  await dialog.getByRole("button", { name: "Save settlement" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const selectedGroup = data.splitsPage.groups.find((item) => item.id === "split-group-none");
    return selectedGroup?.summaryText === "Settled up";
  }).toBe(true);
  await expect(archiveTrigger).toContainText("1 settled batch");
  await page.reload();
  await expect(page.locator(".split-archive-trigger")).toContainText("1 settled batch");
});
