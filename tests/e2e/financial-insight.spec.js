import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

test.describe("financial insights", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
    await page.route("**/api/ai-assist/financial-insight", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false })
      });
    });
  });

  test("the insight endpoint falls back to computed wording when the Worker AI binding is absent", async ({ page }) => {
    const response = await page.request.post("/api/ai-assist/financial-insight", {
      data: {
        facts: {
          contextLabel: "August 2026 entries",
          entryCount: 2,
          spend: "$20.00",
          income: "$100.00",
          net: "$80.00",
          topCategoryName: "Food & Drinks",
          topCategoryAmount: "$20.00",
          topMerchantName: "Cold Storage",
          topMerchantAmount: "$20.00",
          notableFact: "Food & Drinks makes up all spending in this list.",
          cashFlowPrinciple: "$80.00 is left after the spending recorded so far.",
          nextSpendConsideration: "Before buying something non-essential, set aside money for planned bills.",
          accountingAdvice: "Review provisional entries before closing the month.",
          decisionMap: {
            enabled: true,
            needsReview: false,
            lanes: [{
              id: "surplus",
              label: "Money left so far",
              value: "$80.00",
              detail: "This is not automatically free cash.",
              tone: "positive"
            }]
          }
        }
      }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const payload = await response.json();
    expect(payload.available).toBe(false);
    expect(payload.source).toBe("deterministic");
    expect(payload.narrative).toContain("August 2026 entries");
  });

  test("summary and month render computed insights without waiting for AI", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05",
      "/api/summary-page",
      () => page.getByRole("heading", { name: "Summary", exact: true })
    );
    const summaryInsight = page.locator(".financial-insight-summary");
    await expect(summaryInsight).toBeVisible();
    await expect(summaryInsight).toContainText("Household money check-in");
    await expect(summaryInsight).toContainText("May 2026 summary");
    await expect(summaryInsight.getByRole("button", { name: "Read full insight" })).toHaveAttribute("aria-expanded", "false");
    await expect(summaryInsight.locator(".financial-insight-narrative")).toHaveClass(/is-collapsed/);
    await expect(summaryInsight.getByLabel("Money consequence map")).toBeHidden();
    await summaryInsight.getByRole("button", { name: "Read full insight" }).click();
    await expect(summaryInsight.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    await expect(summaryInsight).toContainText("Before buying something non-essential");
    await expect(summaryInsight.getByLabel("Money consequence map")).toBeVisible();
    await expect(summaryInsight).toContainText("Money left so far");
    await expect(summaryInsight).toContainText("Income not in this view");
    await expect(summaryInsight).not.toContainText("One-repeat scenario");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(summaryInsight.getByRole("button", { name: "Show less" })).toBeVisible();
    const mobileWidth = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(mobileWidth.documentWidth).toBeLessThanOrEqual(mobileWidth.viewportWidth + 1);
    await summaryInsight.getByRole("button", { name: "Show less" }).click();
    await expect(summaryInsight.getByRole("button", { name: "Read full insight" })).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 1280, height: 720 });

    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month", exact: true })
    );
    await expect(page.locator(".financial-insight-month")).toContainText("May 2026 month");
  });

  test("entries and splits scope their advice to current filters", async ({ page }) => {
    await postJson(page, "/api/entries/create", {
      date: "2026-05-23",
      description: "Playwright May salary",
      accountName: "UOB One",
      categoryName: "Salary",
      amountMinor: 32_109,
      entryType: "income",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/entries-page",
      () => page.getByRole("heading", { name: "Entries", exact: true })
    );
    const entriesInsight = page.locator(".financial-insight-entries");
    await expect(entriesInsight).toContainText("Tim's money check-in");
    await expect(entriesInsight).toContainText("Tim, you received");
    await expect(entriesInsight).toContainText("May 2026");
    await expect(entriesInsight.locator(".financial-insight-pattern")).toBeVisible();
    await expect(entriesInsight.locator(".financial-insight-pattern")).not.toContainText("Worth noticing");
    await expect(entriesInsight).not.toContainText("A useful signal");
    await entriesInsight.getByRole("button", { name: "Read full insight" }).click();
    await expect(entriesInsight.getByLabel("Money consequence map")).toContainText("Check the full month");
    const incomeAction = entriesInsight.getByRole("button", { name: /See income entries/ });
    const incomeActionLabel = await incomeAction.textContent();
    const incomeAmount = incomeActionLabel?.match(/\(([^)]+)\)/)?.[1] ?? "";
    await expect(incomeAction).toBeVisible();
    await incomeAction.click();
    await expect(page).toHaveURL(/entry_type=income/);
    await expect(page.locator(".entries-totals-item").filter({ hasText: "Income" })).toContainText(incomeAmount);

    await gotoPageAfterApi(
      page,
      "/entries?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/entries-page",
      () => page.getByRole("heading", { name: "Entries", exact: true })
    );
    const resetEntriesInsight = page.locator(".financial-insight-entries");
    await resetEntriesInsight.getByRole("button", { name: "Read full insight" }).click();
    await resetEntriesInsight.getByRole("button", { name: "Review largest expense" }).click();
    await expect(page).toHaveURL(/entry_id=/);

    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2026-06&split_group=split-group-none&split_search=Shopee",
      "/api/splits-page",
      () => page.getByRole("heading", { name: "Splits", exact: true })
    );
    const splitsInsight = page.locator(".financial-insight-splits");
    await expect(splitsInsight).toContainText("search");
    await expect(splitsInsight).toContainText("filtered group view");
  });
});
