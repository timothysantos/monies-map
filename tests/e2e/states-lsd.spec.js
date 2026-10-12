import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// App-wide states in Lead · Support · Detail (design.md "States"): one clear
// lead message, quiet support text, and one primary action. On a phone the
// primary action sits in thumb reach: at least 48px tall, full width of its
// card, and not in the top third of the screen.

const PHONE = { width: 390, height: 664 };

const failWith500 = (route) => route.fulfill({
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ ok: false, error: "Month exploded" })
});

async function box(locator) {
  const result = await locator.boundingBox();
  expect(result, "the element is on screen").not.toBeNull();
  return result;
}

// A primary action is in thumb reach on a phone: tall enough to hit, as wide
// as the card around it, and below the top third of the viewport.
async function expectThumbReach(page, button, card) {
  const [buttonBox, cardBox] = [await box(button), await box(card)];
  expect(buttonBox.height).toBeGreaterThanOrEqual(48);
  expect(buttonBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.8);
  expect(buttonBox.y + buttonBox.height / 2).toBeGreaterThan(PHONE.height / 3);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("errors", () => {
  test("a first-load page failure is a rose card: lead, quiet support, technical line, one primary retry", async ({ page }) => {
    await page.route("**/api/month-page**", failWith500);
    await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");

    const card = page.getByRole("alert").filter({ hasText: "The Month page could not load." });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveClass(/state-card/);
    await expect(card).toHaveAttribute("data-state", "error");
    await expect(card).toHaveAttribute("data-tone", "rose");
    // Lead, then Support, then the technical Detail line, in that order.
    await expect(card.locator(".state-title")).toHaveText("The Month page could not load.");
    await expect(card.locator(".state-detail")).toHaveText(/\S/);
    await expect(card.locator(".app-loading-issue-inline")).toContainText("Month exploded");
    const order = await card.evaluate((element) => [".state-title", ".state-detail", ".app-loading-issue-inline"]
      .map((selector) => element.querySelector(selector).getBoundingClientRect().top));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // One primary action; the rest of the card is text.
    await expect(card.getByRole("button")).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Try loading again" })).toHaveClass(/lsd-primary/);
    // Rose is the attention surface: a pastel fill, never a saturated one.
    const fill = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(fill).toBe("rgb(249, 229, 225)");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE });

    test("the retry button is the primary action in thumb reach", async ({ page }) => {
      await page.route("**/api/month-page**", failWith500);
      await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
      const card = page.getByRole("alert").filter({ hasText: "The Month page could not load." });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expectThumbReach(page, card.getByRole("button", { name: "Try loading again" }), card);
    });
  });

  test("a crashed screen offers Try again as the primary action and Reload app quietly", async ({ page }) => {
    await page.route("**/api/splits-page*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.splitsPage = { ...body.splitsPage, groups: 42, activity: 42 };
      await route.fulfill({ response, json: body });
    });
    await page.goto("/splits?view=person-tim&month=2025-10");

    const card = page.getByRole("alert").filter({ hasText: "This page hit a problem" });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-tone", "rose");
    await expect(card.getByRole("button", { name: "Try again" })).toHaveClass(/lsd-primary/);
    await expect(card.getByRole("button", { name: "Reload app" })).toHaveClass(/lsd-quiet/);
    await expect(card.getByRole("button", { name: "Reload app" })).not.toHaveClass(/lsd-primary/);
  });

  test("the import inbox banner is a sky banner with one primary action", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-08&summary_start=2025-09&summary_end=2026-08",
      "/api/summary-page",
      () => page.getByRole("heading", { name: "Summary", exact: true })
    );
    const banner = page.locator(".state-banner").filter({ hasText: "bank file" });
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-tone", "sky");
    await expect(banner.locator(".state-title")).toContainText("bank file");
    await expect(banner.getByRole("button")).toHaveCount(1);
    await expect(banner.getByRole("button", { name: "Open import inbox" })).toHaveClass(/lsd-primary/);
    expect((await box(banner.getByRole("button"))).height).toBeGreaterThanOrEqual(44);
  });
});

// Hold a page API response until the test lets it go.
async function holdResponses(page, pattern) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("loading", () => {
  const FIRST_SCREENS = [
    ["summary", "/summary?view=household&month=2026-05", "**/api/summary-page**", "Summary", "chips lead lines card"],
    ["entries", "/entries?view=person-tim&month=2026-05", "**/api/entries-page**", "Entries", "totals lines filter day row row row"],
    ["splits", "/splits?view=person-tim&month=2025-10", "**/api/splits-page**", "Splits", "nav lead day row row row"],
    ["page", "/settings", "**/api/settings-page**", "Settings", "lead row row row"]
  ];

  for (const [kind, url, pattern, heading, shapes] of FIRST_SCREENS) {
    test(`the ${kind} first load shows its own Lead, Support and Detail blocks, then the page`, async ({ page }) => {
      const release = await holdResponses(page, pattern);
      await page.goto(url);

      const skeleton = page.locator(".state-skeleton");
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute("data-skeleton", kind);
      await expect(skeleton).toHaveAttribute("role", "status");
      await expect(skeleton).toHaveAttribute("aria-busy", "true");
      // The blocks match the page that replaces them, top to bottom.
      const blocks = await skeleton.locator(".sk-panel > .sk").evaluateAll((nodes) => nodes.map((node) => [...node.classList].find((name) => name.startsWith("sk-")).slice(3)));
      expect(blocks).toEqual(["title", ...shapes.split(" ")]);
      // One quiet support line, no controls, and no figure or money sign.
      await expect(skeleton.locator(".state-detail")).toContainText("Loading");
      await expect(skeleton.getByRole("button")).toHaveCount(0);
      await expect(skeleton.getByRole("link")).toHaveCount(0);
      expect(await skeleton.innerText()).not.toMatch(/[$•]|\d{3}/);

      release();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(skeleton).toHaveCount(0);
    });
  }

  test("while the next page loads, the previous page stays and a pill sits clear of the header", async ({ page }) => {
    await page.goto("/summary?view=household&month=2026-05");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    const release = await holdResponses(page, "**/api/entries-page**");
    await page.getByRole("link", { name: "Entries", exact: true }).first().click();

    const pill = page.locator(".state-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Loading latest data");
    // The previous page is still readable, and no skeleton replaces it.
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.locator(".state-skeleton")).toHaveCount(0);
    const [pillBox, barBox] = [await box(pill), await box(page.locator(".control-bar").first())];
    expect(pillBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);

    release();
    await expect(page.getByRole("heading", { name: "Entries", exact: true })).toBeVisible();
    await expect(pill).toHaveCount(0);
  });

  test("the first load adds almost no layout shift when the data lands", async ({ page }) => {
    await page.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__shift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const release = await holdResponses(page, "**/api/summary-page**");
    await page.goto("/summary?view=household&month=2026-05");
    await expect(page.locator(".state-skeleton")).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__shift)).toBeLessThan(0.1);
  });
});
