import { expect, test } from "@playwright/test";

import {
  gotoPageAfterApi,
  loadReferenceData,
  postJson,
  reseedDemo
} from "./helpers";

// Owner bug: confirming "Delete rule" on a row in the duplicates card left the
// group on screen. A delete must visibly update the list.
async function openRules(page) {
  await gotoPageAfterApi(
    page,
    "/settings?view=person-tim",
    "/api/settings-page",
    () => page.getByRole("heading", { name: "Settings" })
  );
  await page.getByRole("button", { name: /Category matching/ }).click();
}

async function confirmDelete(page, pattern, phone, rowText = "") {
  const issue = page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern }).first();
  const row = rowText ? issue.locator(".settings-duplicate-rule-row").filter({ hasText: rowText }) : issue.locator(".settings-duplicate-rule-row").first();
  await row.getByRole("button", { name: "Delete rule" }).click();
  const dialog = phone ? page.getByRole("dialog") : page.locator(".delete-popover");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete rule" }).click();
}

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 900 }, phone: false },
  { name: "phone", size: { width: 390, height: 844 }, phone: true }
]) {
  test.describe(`settings duplicate rule delete (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test("deleting one of two overlapping rules refreshes the list and removes the group", async ({ page }) => {
      await reseedDemo(page);
      const referenceData = await loadReferenceData(page);
      const category = referenceData.categories[0];
      const pattern = `PWDEL ${viewport.name} ${Date.now()}`;
      await postJson(page, "/api/category-match-rules/save", {
        pattern, categoryId: category.id, priority: 40, isActive: true, note: "first"
      });
      await postJson(page, "/api/category-match-rules/save", {
        pattern: `${pattern} cafe`, categoryId: category.id, priority: 80, isActive: true, note: "second"
      });

      await openRules(page);
      const issue = page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern });
      await expect(issue).toHaveCount(1);
      await expect(issue.locator(".settings-duplicate-rule-row")).toHaveCount(2);

      const settingsReloads = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/settings-page")) settingsReloads.push(request.url());
      });
      const deleted = page.waitForResponse((response) => response.url().includes("/api/category-match-rules/delete"));
      await confirmDelete(page, pattern, viewport.phone);
      expect((await deleted).status()).toBe(200);

      await expect(page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern })).toHaveCount(0);
      expect(settingsReloads.length).toBeGreaterThan(0);
    });

    // Owner bug in production: the rule had already been removed elsewhere, the
    // list on screen was stale, and the confirm did nothing visible.
    test("deleting a rule another tab already removed clears the stale row", async ({ page }) => {
      await reseedDemo(page);
      const referenceData = await loadReferenceData(page);
      const category = referenceData.categories[0];
      const pattern = `PWSTALE ${viewport.name} ${Date.now()}`;
      await postJson(page, "/api/category-match-rules/save", {
        pattern, categoryId: category.id, priority: 40, isActive: true
      });
      const second = await postJson(page, "/api/category-match-rules/save", {
        pattern: `${pattern} cafe`, categoryId: category.id, priority: 80, isActive: true
      });

      await openRules(page);
      await expect(page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern })).toHaveCount(1);
      await postJson(page, "/api/category-match-rules/delete", { ruleId: second.ruleId });

      await confirmDelete(page, pattern, viewport.phone, `${pattern} cafe`);
      await expect(page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern })).toHaveCount(0);
    });

    test("a failed delete keeps the confirm open with the reason beside the button", async ({ page }) => {
      await reseedDemo(page);
      const referenceData = await loadReferenceData(page);
      const category = referenceData.categories[0];
      const pattern = `PWFAIL ${viewport.name} ${Date.now()}`;
      await postJson(page, "/api/category-match-rules/save", {
        pattern, categoryId: category.id, priority: 40, isActive: true
      });
      await postJson(page, "/api/category-match-rules/save", {
        pattern: `${pattern} cafe`, categoryId: category.id, priority: 80, isActive: true
      });
      await openRules(page);

      await page.route("**/api/category-match-rules/delete", (route) => route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Rule delete refused for the test." })
      }));
      await confirmDelete(page, pattern, viewport.phone);
      const dialog = viewport.phone ? page.getByRole("dialog") : page.locator(".delete-popover");
      await expect(dialog).toContainText("Rule delete refused for the test.");
      await expect(page.locator(".settings-duplicate-rule-issue").filter({ hasText: pattern })).toHaveCount(1);
    });
  });
}
