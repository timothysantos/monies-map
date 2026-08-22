import { expect, test } from "@playwright/test";

test("FAQ explains Apple Shortcut ownership, replacement, and releases", async ({ page }) => {
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
    name: "Is the downloaded shortcut tied to the owner's Mac, iPhone, or iCloud?",
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "What should I choose when Apple says the shortcut already exists?",
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "How is a new shortcut version released?",
    exact: true
  })).toBeVisible();
  await expect(page.getByText(/repository contains the reviewable secret-free plist source/)).toBeVisible();
  await expect(page.getByText(/Replacement changes only the local copy on that device/)).toBeVisible();
  await expect(page.getByText(/sign the unsigned.*with Apple's.*--mode anyone/)).toBeVisible();

  const viewport = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  expect(consoleErrors).toEqual([]);
});
