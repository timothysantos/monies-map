import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

test("editing an existing split expense keeps the row in place and persists the change", async ({ page }) => {
  const updatedNote = `Updated split note ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");

  await page.locator(".split-activity-card").filter({ hasText: "Family support" }).first().click();
  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await inlineEditor.locator("textarea").nth(1).fill(updatedNote);
  await inlineEditor.getByRole("button", { name: "Done editing split" }).click();

  await expect(page.getByText(updatedNote, { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.activity.find((item) => item.description === "Family support")?.note ?? "";
  }).toBe(updatedNote);
});
