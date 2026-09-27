import { expect, test } from "@playwright/test";

import {
  gotoPageAfterApi,
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

  // Summary follows the route's scope, so on desktop a compact switch under
  // the title names the scope its figures count and switches it in one click.
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
    const direct = scope.getByRole("button", { name: "Direct", exact: true });
    const shared = scope.getByRole("button", { name: "Shared", exact: true });
    const both = scope.getByRole("button", { name: "Both", exact: true });
    await expect(scope).toBeVisible();
    await expect(scope.getByRole("button")).toHaveCount(3);
    await expect(shared).toHaveAttribute("aria-pressed", "true");
    await expect(direct).toHaveAttribute("aria-pressed", "false");
    await expect(both).toHaveAttribute("aria-pressed", "false");
    // What each scope counts is its hover tooltip, not a text row.
    await expect(direct).toHaveAttribute("title", "Joyce's entries that are not part of a split.");
    await expect(shared).toHaveAttribute("title", "Joyce's share of split expenses.");
    await expect(both).toHaveAttribute("title", "Joyce's entries plus their share of split expenses.");
    await expect(page.getByText("Joyce's share of split expenses.")).toHaveCount(0);
    await expect(actualSpend).toHaveText(money(actualSpendMinor(sharedPage)));

    await direct.click();
    await expect(page).toHaveURL(/scope=direct(&|$)/);
    await expect(direct).toHaveAttribute("aria-pressed", "true");
    await expect(shared).toHaveAttribute("aria-pressed", "false");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(directPage)));
    // The Summary check-in follows the scope with the figures: Joyce's
    // one-month Direct range has nothing that needs a look.
    await expect(page.locator(".financial-insight-summary")).toContainText("Joyce's money insights");
    await expect(page.locator(".financial-insight-summary .checkin-fact")).toHaveText("Nothing in this range needs a look right now.");

    // The keyboard reaches and presses it too; desktop has no floating bar.
    await expect(page.locator(".mobile-context-sticky-wrap")).toBeHidden();
    await both.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/scope=direct_plus_shared/);
    await expect(both).toHaveAttribute("aria-pressed", "true");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(combinedPage)));

    // The household view always counts every entry, so it offers no scope.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/summary?view=household&month=2025-10&scope=shared&summary_start=2025-10&summary_end=2025-10");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.locator(".summary-head-metrics .metric").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Scope" })).toHaveCount(0);
  });

  // The desktop switch lives in the space under the Summary title, so the
  // header is exactly as tall and the cards exactly where they are without it.
  test("the desktop scope switch fits under the title without moving the header", async ({ page }) => {
    const measure = () => page.evaluate(() => {
      const box = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        head: box(document.querySelector(".summary-head")),
        title: box(document.querySelector(".summary-head > div:first-child")),
        cards: [...document.querySelectorAll(".summary-head-metrics .metric")].map(box),
        insight: box(document.querySelector(".financial-insight-summary"))
      };
    });

    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoPageAfterApi(
        page,
        "/summary?view=person-tim&month=2026-05&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-05",
        "/api/summary-page",
        () => page.getByRole("group", { name: "Scope" })
      );
      const scope = page.getByRole("group", { name: "Scope" });
      await expect(scope.getByRole("button", { name: "Both", exact: true })).toHaveAttribute("aria-pressed", "true");
      const withSwitch = await measure();
      const switchBox = await scope.boundingBox();
      const titleBox = await page.locator(".summary-head h2").boundingBox();

      // Under the title, inside the title column and the header.
      expect(switchBox.y, `${width}`).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
      expect(switchBox.x, `${width}`).toBeGreaterThanOrEqual(withSwitch.title.x);
      expect(switchBox.x + switchBox.width, `${width}`).toBeLessThanOrEqual(withSwitch.title.x + withSwitch.title.width);
      expect(switchBox.y + switchBox.height, `${width}`).toBeLessThanOrEqual(withSwitch.head.y + withSwitch.head.height);

      // The same page without the switch is the no-control baseline.
      await page.addStyleTag({ content: ".summary-scope-switch { display: none !important; }" });
      await expect(scope).toBeHidden();
      const baseline = await measure();
      expect(withSwitch.head, `${width} header`).toEqual(baseline.head);
      expect(withSwitch.title.width, `${width} title column`).toBe(baseline.title.width);
      expect(withSwitch.cards, `${width} cards`).toEqual(baseline.cards);
      expect(withSwitch.insight, `${width} check-in`).toEqual(baseline.insight);
    }

    // The household counts every entry and has no switch.
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-05",
      "/api/summary-page",
      () => page.locator(".summary-head-metrics .metric").first()
    );
    await expect(page.getByRole("group", { name: "Scope" })).toHaveCount(0);
    await expect(page.locator(".summary-scope-switch")).toHaveCount(0);
  });

  // A phone has one scope control on every page: the floating View and scope
  // bar. Summary shows it instead of the inline pills, and the bar's dialog
  // switches the scope and says what it counts.
  test("on a phone summary switches scope through the View and scope bar", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.setViewportSize({ width: 1280, height: 900 });
    const range = { view: "person-joyce", month: "2025-10", summaryStart: "2025-10", summaryEnd: "2025-10" };
    const [sharedPage, directPage] = await Promise.all(
      ["shared", "direct"].map((scope) => loadSummaryPage(page, { ...range, scope }))
    );
    const actualSpendMinor = (data) => data.summaryPage.metricCards.find((card) => card.label === "Actual spend").amountMinor;
    expect(actualSpendMinor(sharedPage)).not.toBe(actualSpendMinor(directPage));
    const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);

    await page.goto("/summary?view=person-joyce&month=2025-10&scope=shared&summary_start=2025-10&summary_end=2025-10");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    const inlineScope = page.getByRole("group", { name: "Scope" });
    const stickyBar = page.locator(".mobile-context-sticky-wrap");
    const trigger = stickyBar.locator(".mobile-context-trigger");
    const triggerLabel = trigger.locator(".mobile-context-trigger-label");
    const actualSpend = page.locator(".summary-head-metrics .metric").filter({ hasText: "Actual spend" }).locator("strong");
    await expect(inlineScope).toBeVisible();

    // Turning to the phone layout swaps the switch for the bar without a reload.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(stickyBar).toBeVisible();
    await expect(inlineScope).toHaveCount(0);
    await expect(page.locator(".summary-scope-switch")).toHaveCount(0);
    await expect(triggerLabel).toHaveText("Joyce · Shared");
    await expect(trigger).toContainText("View and scope");
    // A screen reader hears the same view and scope the bar shows.
    await expect(trigger).toHaveAccessibleName("Joyce · Shared View and scope");
    await expect(actualSpend).toHaveText(money(actualSpendMinor(sharedPage)));

    await trigger.click();
    const dialog = page.locator(".mobile-context-dialog");
    const scopeSection = dialog.locator('section[aria-label="Scope"]');
    await expect(scopeSection).toBeVisible();
    await expect(scopeSection.getByRole("button", { name: "Shared", exact: true })).toHaveClass(/is-active/);
    await expect(scopeSection).toContainText("Joyce's share of split expenses.");

    await scopeSection.getByRole("button", { name: "Direct ownership", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/scope=direct(&|$)/);
    await expect(actualSpend).toHaveText(money(actualSpendMinor(directPage)));
    await expect(triggerLabel).toHaveText("Joyce · Direct");
    await expect(page.locator(".financial-insight-summary .checkin-fact")).toHaveText("Nothing in this range needs a look right now.");

    await trigger.click();
    await expect(scopeSection.getByRole("button", { name: "Direct ownership", exact: true })).toHaveClass(/is-active/);
    await expect(scopeSection).toContainText("Joyce's entries that are not part of a split.");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);

    // The household counts every entry: the bar switches the view only.
    await page.goto("/summary?view=household&month=2025-10&scope=shared&summary_start=2025-10&summary_end=2025-10");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(triggerLabel).toHaveText("Household");
    await expect(trigger).not.toContainText("Shared");
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(scopeSection).toHaveCount(0);
    await dialog.getByRole("button", { name: "Joyce", exact: true }).click();
    await expect(page).toHaveURL(/view=person-joyce/);
    await expect(scopeSection).toBeVisible();
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
