import { expect, test } from "@playwright/test";

// The FAQ page has two guides as accessible tabs. The user guide loads with
// the page; the developer guide downloads only when its tab opens, and the
// open tab lives in the address (?faq=developers).
const DEVELOPER_GUIDE_REQUEST = /developer-guide/;

test("FAQ guide tabs switch by click and keyboard, remember the tab and load the developer guide only on demand", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const developerGuideRequests = [];
  page.on("request", (request) => {
    if (DEVELOPER_GUIDE_REQUEST.test(request.url())) developerGuideRequests.push(request.url());
  });

  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  const tablist = page.getByRole("tablist", { name: "Guide" });
  const userTab = tablist.getByRole("tab", { name: "User guide" });
  const developerTab = tablist.getByRole("tab", { name: "For developers" });
  await expect(userTab).toHaveAttribute("aria-selected", "true");
  await expect(developerTab).toHaveAttribute("aria-selected", "false");
  await expect(userTab).toHaveAttribute("tabindex", "0");
  await expect(developerTab).toHaveAttribute("tabindex", "-1");

  const panel = page.getByRole("tabpanel", { name: "User guide" });
  await expect(panel.getByRole("heading", { name: "Start here", exact: true })).toBeVisible();
  await expect(panel.getByRole("navigation", { name: "Contents" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Set up and run locally" })).toHaveCount(0);
  // Screenshots load lazily and resolve.
  const firstImage = panel.locator(".faq-figure img").first();
  await expect(firstImage).toHaveAttribute("loading", "lazy");
  expect(developerGuideRequests).toEqual([]);

  // A contents link jumps to its section without leaving the page.
  await panel.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Undo an import" }).click();
  await expect(page.getByRole("heading", { name: "Undo an import", exact: true })).toBeInViewport();
  await expect(page).toHaveURL(/\/faq\?.*#undo-an-import$|\/faq#undo-an-import$/);

  // Keyboard: arrow right moves focus and selection to the developer tab.
  await userTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(developerTab).toBeFocused();
  await expect(developerTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]faq=developers/);
  const developerPanel = page.getByRole("tabpanel", { name: "For developers" });
  await expect(developerPanel.getByRole("heading", { name: "Set up and run locally", exact: true })).toBeVisible();
  await expect(developerPanel.getByRole("heading", { name: "Start here", exact: true })).toHaveCount(0);
  expect(developerGuideRequests.length).toBeGreaterThan(0);

  // The FAQ tab parameter never leaks into links to other screens.
  await expect(page.getByRole("link", { name: "Summary", exact: true }).first()).not.toHaveAttribute("href", /faq=/);

  // Home returns to the user guide and clears the parameter.
  await page.keyboard.press("Home");
  await expect(userTab).toBeFocused();
  await expect(userTab).toHaveAttribute("aria-selected", "true");
  await expect(page).not.toHaveURL(/faq=developers/);

  // Clicking works too, and a reload reopens the remembered tab.
  await developerTab.click();
  await expect(page).toHaveURL(/[?&]faq=developers/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "For developers" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Set up and run locally", exact: true })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("a deep link opens the developer tab at its section, and a cross-tab link returns to the user guide", async ({ page }) => {
  const developerGuideRequests = [];
  page.on("request", (request) => {
    if (DEVELOPER_GUIDE_REQUEST.test(request.url())) developerGuideRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/faq?faq=developers#how-do-i-regenerate-the-screenshots", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "For developers" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "How do I regenerate the screenshots?", exact: true })).toBeInViewport();

  await page.getByRole("link", { name: "Record Apple Pay purchases automatically" }).click();
  await expect(page.getByRole("tab", { name: "User guide" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Record Apple Pay purchases automatically", exact: true })).toBeInViewport();
  await expect(page).not.toHaveURL(/faq=developers/);
  expect(developerGuideRequests.length).toBeGreaterThan(0);

  const viewport = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
});
