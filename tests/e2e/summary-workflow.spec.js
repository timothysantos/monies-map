import { expect, test } from "@playwright/test";

import {
  loadSummaryPage,
  reseedDemo
} from "./helpers";

test.describe("summary workflow", () => {
  test.beforeEach(async ({ page }) => {
    await reseedDemo(page);
  });

  test("summary controls stay usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const summaryBefore = await loadSummaryPage(page, { view: "household", month: "2026-04" });
    const targetMonth = summaryBefore.summaryPage.months[0].month;

    await page.goto(`/summary?view=household&month=${targetMonth}&scope=direct_plus_shared&summary_start=2025-06&summary_end=${targetMonth}`);
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Intent vs Outcome" })).toBeVisible();
    await expect(page.getByText("Range overall")).toBeVisible();
    await expect(page.getByText("Total spend")).toBeVisible();
  });

  // Summary follows the route's scope, so it says which scope its figures
  // count and lets the person switch it, on desktop and on a phone.
  test("summary shows the active scope and switching scope updates the figures", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.setViewportSize({ width: 1280, height: 900 });
    const range = { view: "person-joyce", month: "2025-10", summaryStart: "2025-10", summaryEnd: "2025-10" };
    const [sharedPage, directPage, combinedPage] = await Promise.all(
      ["shared", "direct", "direct_plus_shared"].map((scope) => loadSummaryPage(page, { ...range, scope }))
    );
    const actualSpendMinor = (data) => data.summaryPage.metricCards.find((card) => card.label === "Actual spend").amountMinor;
    // Seeded October 2025 has direct and split-linked entries, so each scope
    // has its own figure and a stale screen cannot pass.
    expect(new Set([sharedPage, directPage, combinedPage].map(actualSpendMinor)).size).toBe(3);
    const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);

    await page.goto("/summary?view=person-joyce&month=2025-10&scope=shared&summary_start=2025-10&summary_end=2025-10");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    const scope = page.getByRole("group", { name: "Scope" });
    const actualSpend = page.locator(".summary-head-metrics .metric").filter({ hasText: "Actual spend" }).locator("strong");
    await expect(scope).toBeVisible();
    await expect(scope.getByRole("button", { name: "Shared", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(scope.getByRole("button", { name: "Direct ownership", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(scope.getByRole("button", { name: "Direct + Shared", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(sharedPage)));

    await scope.getByRole("button", { name: "Direct ownership", exact: true }).click();
    await expect(page).toHaveURL(/scope=direct(&|$)/);
    await expect(scope.getByRole("button", { name: "Direct ownership", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(scope.getByRole("button", { name: "Shared", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(directPage)));
    // The Summary check-in counts the same spend as the card.
    await expect(page.locator(".financial-insight-summary .financial-insight-narrative"))
      .toContainText(`spent ${money(actualSpendMinor(directPage))} across`);

    // On a phone the same control stays on screen and switches the figures.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scope).toBeVisible();
    await scope.getByRole("button", { name: "Direct + Shared", exact: true }).click();
    await expect(page).toHaveURL(/scope=direct_plus_shared/);
    await expect(scope.getByRole("button", { name: "Direct + Shared", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(combinedPage)));
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);

    // The household view always counts every entry, so it offers no scope.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/summary?view=household&month=2025-10&scope=shared&summary_start=2025-10&summary_end=2025-10");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.locator(".summary-head-metrics .metric").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Scope" })).toHaveCount(0);
  });

  test("summary spending mix cards keep readable text columns on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05");
    await expect(page.getByRole("heading", { name: "Spending Mix" })).toBeVisible();
    await page.getByRole("button", { name: "Show money totals" }).click();
    const firstCard = page.locator(".share-list .share-row").first();
    await expect(firstCard).toBeVisible();

    const layout = await firstCard.evaluate((card) => {
      const textButton = card.querySelector(".share-row-button");
      const title = textButton?.querySelector("strong");
      const amount = textButton?.querySelector("p");
      const cardBox = card.getBoundingClientRect();
      const textBox = textButton?.getBoundingClientRect();
      const titleStyle = title ? getComputedStyle(title) : null;
      const titleLineHeight = titleStyle ? parseFloat(titleStyle.lineHeight) : 0;
      return {
        cardWidth: cardBox.width,
        textWidth: textBox?.width ?? 0,
        titleLines: title && titleLineHeight ? title.getBoundingClientRect().height / titleLineHeight : 0,
        amountText: amount?.textContent ?? "",
        overflows: card.scrollWidth > card.clientWidth + 1 || card.scrollHeight > card.clientHeight + 1
      };
    });

    expect(layout.cardWidth).toBeGreaterThan(300);
    expect(layout.textWidth).toBeGreaterThan(170);
    expect(layout.titleLines).toBeLessThanOrEqual(2);
    expect(layout.amountText).toMatch(/^\$/);
    expect(layout.overflows).toBe(false);
  });
});
