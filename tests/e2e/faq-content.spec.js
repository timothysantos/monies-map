import { expect, test } from "@playwright/test";

test("FAQ explains Apple Shortcut ownership, replacement, and republishing", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/faq", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "FAQ", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Is the shared iCloud shortcut the same as the copy on the owner's Mac or iPhone?",
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "What should I choose when Apple says the shortcut already exists?",
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "How is a new shortcut version published?",
    exact: true
  })).toBeVisible();
  await expect(page.getByText(/durable source of truth is also committed in the repository/)).toBeVisible();
  await expect(page.getByText(/Replacement changes only the local copy on that device/)).toBeVisible();
  await expect(page.getByText(/published as a new iCloud release/)).toBeVisible();

  const viewport = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  expect(consoleErrors).toEqual([]);
});
