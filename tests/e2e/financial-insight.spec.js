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

  // The Month check-in counts what the Actual spend card counts: every entry
  // for the household; a person's own entries in the scope for a person view
  // (direct entries in full, split-linked entries at their share). Seeded
  // October 2025 has direct and split-linked entries, so every scope differs.
  test("the month check-in spends what the Actual spend card shows in every view and scope", async ({ page }) => {
    const spentInNarrative = async () => {
      const narrative = await page.locator(".financial-insight-month .financial-insight-narrative").innerText();
      if (/there are no entries/.test(narrative)) return "$0.00";
      return narrative.match(/spent (\S+) across/)?.[1] ?? `no spend in: ${narrative}`;
    };
    const actualSpendCard = async () => (
      (await page.locator(".metric-row-month .metric").filter({ hasText: "Actual spend" }).locator("strong").innerText()).trim()
    );
    const views = [
      ["household", "Household", ["direct_plus_shared"]],
      ["person-joyce", "Joyce", ["direct", "shared", "direct_plus_shared"]],
      ["person-tim", "Tim", ["direct", "shared", "direct_plus_shared"]]
    ];
    const spendByView = {};
    for (const [viewId, label, scopes] of views) {
      for (const scope of scopes) {
        await gotoPageAfterApi(
          page,
          `/month?view=${viewId}&month=2025-10&scope=${scope}`,
          "/api/month-page",
          () => page.getByRole("heading", { name: "Month", exact: true })
        );
        await expect(page.locator(".month-label-view")).toHaveText(label);
        await expect(page.locator(".financial-insight-month")).toContainText(
          viewId === "household" ? "Household money check-in" : `${label}'s money check-in`
        );
        const card = await actualSpendCard();
        expect(await spentInNarrative(), `${viewId} ${scope}`).toBe(card);
        spendByView[`${viewId}:${scope}`] = card;
      }
    }
    // A person's figures are theirs, not the household's, and the scopes differ.
    expect(spendByView["person-joyce:direct_plus_shared"]).not.toBe(spendByView["household:direct_plus_shared"]);
    expect(spendByView["person-tim:direct_plus_shared"]).not.toBe(spendByView["household:direct_plus_shared"]);
    expect(new Set(["direct", "shared", "direct_plus_shared"].map((scope) => spendByView[`person-joyce:${scope}`])).size).toBe(3);
  });

  test("the month wording request sends the person's scoped facts and asks again when the scope changes", async ({ page }) => {
    const bodies = [];
    await page.route("**/api/ai-assist/financial-insight", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const actualSpendCard = page.locator(".metric-row-month .metric").filter({ hasText: "Actual spend" }).locator("strong");
    await gotoPageAfterApi(
      page,
      "/month?view=person-joyce&month=2025-10&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month", exact: true })
    );
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
    const combinedSpend = (await actualSpendCard.innerText()).trim();
    // Only computed facts go out, with the person's name held back.
    expect(Object.keys(bodies[0])).toEqual(["facts"]);
    expect(bodies[0].facts.spend).toBe(combinedSpend);
    expect(bodies[0].facts.audienceKind).toBe("person");
    expect(JSON.stringify(bodies[0])).not.toContain("Joyce");

    await page.locator(".desktop-scope-toggle").getByRole("button", { name: "Shared", exact: true }).click();
    await expect(page).toHaveURL(/scope=shared/);
    await expect(actualSpendCard).not.toHaveText(combinedSpend);
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
    const sharedSpend = (await actualSpendCard.innerText()).trim();
    expect(bodies[1].facts.spend).toBe(sharedSpend);
    expect(bodies[1].facts.spend).not.toBe(bodies[0].facts.spend);
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
    // A person view's Splits check-in is that person's own part of the group.
    await expect(splitsInsight).toContainText("Tim's money check-in");
  });

  // A person's Splits check-in counts their own split share of each group
  // expense, in the group currency, not the group's total. Tim paid ¥12,000
  // for a JPY trip hotel split 25% Tim / 75% Joyce: Tim's part is ¥3,000
  // (he lent Joyce ¥9,000) and Joyce's is ¥9,000.
  test("the splits check-in follows the person view and counts that person's share", async ({ page }) => {
    const bodies = [];
    await page.route("**/api/ai-assist/financial-insight", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const { groupId } = await postJson(page, "/api/splits/groups/create", { name: "Tokyo trip", currency: "JPY", expenseSource: "cash" });
    await postJson(page, "/api/splits/expenses/create", {
      groupId,
      date: "2026-05-12",
      description: "Shinjuku hotel",
      categoryName: "Travel",
      payerPersonName: "Tim",
      amountMinor: 1_200_000,
      splitBasisPoints: 2500,
      currency: "JPY",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });

    await gotoPageAfterApi(
      page,
      `/splits?view=person-tim&month=2026-05&split_group=${groupId}`,
      "/api/splits-page",
      () => page.getByRole("heading", { name: "Splits", exact: true })
    );
    const hotel = page.locator(".split-activity-card").filter({ hasText: "Shinjuku hotel" });
    await expect(hotel).toContainText("You paid JP¥12,000");
    await expect(hotel.locator(".split-activity-amount-line > span").first()).toHaveText("JP¥9,000");
    const splitsInsight = page.locator(".financial-insight-splits");
    await expect(splitsInsight).toContainText("Tim's money check-in");
    await expect(splitsInsight.locator(".financial-insight-narrative")).toContainText("Tim, you received JP¥0 and spent JP¥3,000 across 1 entry in Tokyo trip group.");
    await expect(splitsInsight).not.toContainText("JP¥12,000");

    // Only computed facts go out, with the person's name held back.
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
    expect(Object.keys(bodies[0])).toEqual(["facts"]);
    expect(bodies[0].facts).toMatchObject({ audienceKind: "person", spend: "JP¥3,000", entryCount: 1 });
    expect(JSON.stringify(bodies[0])).not.toContain("Tim");

    // Switching to Joyce's view words the check-in for her share and asks for
    // wording again, because the facts (and so the cache key) changed.
    await page.locator(".context-block .pill[title='Joyce']").click();
    await expect(page).toHaveURL(/view=person-joyce/);
    await expect(splitsInsight).toContainText("Joyce's money check-in");
    await expect(splitsInsight.locator(".financial-insight-narrative")).toContainText("Joyce, you received JP¥0 and spent JP¥9,000 across 1 entry in Tokyo trip group.");
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
    expect(bodies[1].facts).toMatchObject({ audienceKind: "person", spend: "JP¥9,000" });
    expect(JSON.stringify(bodies[1])).not.toContain("Joyce");
  });
});

// H08: optional AI wording waits for a usable route (loaded, no editor or
// save in progress) and a quiet 700 ms. Requests are counted and held with
// page.route; deterministic wording is always on screen meanwhile.
test.describe("financial insight wording readiness", () => {
  const SUMMARY_URL = "/summary?view=household&month=2026-05&scope=direct_plus_shared";
  const AI_WORDING = "Playwright AI wording for this check-in.";

  function controlInsightRequests(page, { respond = "ai" } = {}) {
    const state = { requests: [], held: [], failed: [], hold: false };
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname === "/api/ai-assist/financial-insight") state.failed.push(Date.now());
    });
    const fulfill = async (route) => {
      if (respond === "malformed") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }).catch(() => {});
        return;
      }
      if (respond === "error-with-wording") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ available: true, source: "ai", narrative: AI_WORDING })
        }).catch(() => {});
        return;
      }
      if (respond === "unavailable") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }).catch(() => {});
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true, source: "ai", narrative: AI_WORDING })
      }).catch(() => {});
    };
    return page.route("**/api/ai-assist/financial-insight", async (route) => {
      state.requests.push(Date.now());
      if (state.hold) {
        await new Promise((resolve) => state.held.push(resolve));
      }
      await fulfill(route);
    }).then(() => ({
      state,
      releaseAll: () => state.held.splice(0).forEach((resolve) => resolve())
    }));
  }

  async function waitUsable(page) {
    await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
  }

  async function openSummary(page, { moneyVisible = true } = {}) {
    await page.addInitScript((visible) => window.localStorage.setItem("monies-map:money-totals-visible", String(visible)), moneyVisible);
    await reseedDemo(page);
    await page.goto(SUMMARY_URL);
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await waitUsable(page);
  }

  test("an editor open blocks the request; closing it starts one request after a full quiet period", async ({ page }) => {
    const control = await controlInsightRequests(page);
    await openSummary(page, { moneyVisible: false });
    await page.getByRole("button", { name: "Edit Bills" }).first().click();
    await expect(page.getByText("Edit category")).toBeVisible();
    // Reveal money behind the open dialog: facts are ready but the route is busy.
    // The dialog hides the page from the accessibility tree, so use the class.
    await page.locator(".totals-visibility-toggle").first().dispatchEvent("click");
    await expect(page.locator("html")).toHaveAttribute("data-money-privacy", "visible");
    await page.waitForTimeout(2_000);
    expect(control.state.requests).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit category")).toBeHidden();
    const closedAt = Date.now();
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    expect(control.state.requests[0] - closedAt).toBeGreaterThanOrEqual(650);
    await expect(page.locator(".financial-insight-summary")).toContainText(AI_WORDING);
    await page.waitForTimeout(2_000);
    expect(control.state.requests).toHaveLength(1);
  });

  test("opening an editor during an in-flight request aborts it and nothing is cached", async ({ page }) => {
    const control = await controlInsightRequests(page);
    control.state.hold = true;
    await openSummary(page);
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    await page.getByRole("button", { name: "Edit Bills" }).first().click();
    await expect(page.getByText("Edit category")).toBeVisible();
    await expect.poll(() => control.state.failed.length).toBe(1);
    control.state.hold = false;
    control.releaseAll();
    await page.waitForTimeout(1_000);
    await expect(page.locator(".financial-insight-summary")).not.toContainText(AI_WORDING);
    expect(control.state.requests).toHaveLength(1);

    // The aborted response was not cached, so the next usable state asks again.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit category")).toBeHidden();
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(2);
    await expect(page.locator(".financial-insight-summary")).toContainText(AI_WORDING);
  });

  test("a facts change ignores the old response and asks for the new facts", async ({ page }) => {
    const control = await controlInsightRequests(page);
    control.state.hold = true;
    await openSummary(page);
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    const insight = page.locator(".financial-insight-summary");
    const before = await insight.locator(".financial-insight-narrative").textContent();
    await page.locator(".summary-focus-button").filter({ hasText: "Range overall" }).click();
    await expect(page).toHaveURL(/summary_focus=/);
    await expect(insight.locator(".financial-insight-narrative")).not.toHaveText(before ?? "");
    await expect.poll(() => control.state.failed.length).toBe(1);
    control.state.hold = false;
    control.releaseAll();
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(2);
    await expect(insight).toContainText(AI_WORDING);

    // The cancelled request cached nothing for the first facts, so going back
    // asks again instead of pinning the computed wording for five minutes.
    await page.locator(".summary-focus-button").filter({ hasText: "May 2026" }).click();
    await expect(insight.locator(".financial-insight-narrative")).toHaveText(before ?? "");
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(3);
    await expect(insight).toContainText(AI_WORDING);
  });

  test("hiding money aborts the request and makes no new one", async ({ page }) => {
    const control = await controlInsightRequests(page);
    control.state.hold = true;
    await openSummary(page);
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    await page.getByRole("button", { name: "Hide money totals" }).first().click();
    await expect(page.locator(".financial-insight-summary")).toContainText("Reveal money totals to read this insight.");
    await expect.poll(() => control.state.failed.length).toBe(1);
    control.releaseAll();
    await page.waitForTimeout(2_000);
    expect(control.state.requests).toHaveLength(1);
  });

  for (const respond of ["unavailable", "malformed", "error-with-wording"]) {
    test(`a response that is ${respond} keeps the computed wording and is not retried on return`, async ({ page }) => {
      const control = await controlInsightRequests(page, { respond });
      await openSummary(page);
      const narrative = page.locator(".financial-insight-summary .financial-insight-narrative");
      await expect(narrative).toContainText("May 2026");
      const computed = await narrative.textContent();
      await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
      await page.waitForTimeout(500);
      await expect(narrative).toHaveText(computed ?? "");
      await expect(narrative).not.toContainText(AI_WORDING);

      // Readiness drops and returns; the 5-minute fallback cache answers.
      await page.getByRole("button", { name: "Edit Bills" }).first().click();
      await expect(page.getByText("Edit category")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByText("Edit category")).toBeHidden();
      await page.waitForTimeout(1_500);
      await expect(narrative).toHaveText(computed ?? "");
      expect(control.state.requests).toHaveLength(1);
    });
  }

  test("month, entries and splits each receive wording once their page is usable", async ({ page }) => {
    await controlInsightRequests(page);
    await openSummary(page);
    await expect(page.locator(".financial-insight-summary")).toContainText(AI_WORDING);
    for (const [path, heading, className] of [
      ["/month?view=household&month=2026-05&scope=direct_plus_shared", "Month", ".financial-insight-month"],
      ["/entries?view=household&month=2026-05&scope=direct_plus_shared", "Entries", ".financial-insight-entries"],
      ["/splits?view=household&month=2026-05", "Splits", ".financial-insight-splits"]
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(className)).toContainText(AI_WORDING);
    }
  });

  test("rerenders without a facts change make one request in total", async ({ page }) => {
    const control = await controlInsightRequests(page);
    await openSummary(page);
    const insight = page.locator(".financial-insight-summary");
    // Interactions that rerender the page but leave the facts alone.
    await page.mouse.move(200, 200);
    await insight.getByRole("button", { name: "Read full insight" }).click();
    await insight.getByRole("button", { name: "Show less" }).click();
    await page.mouse.move(400, 300);
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(2_500);
    expect(control.state.requests).toHaveLength(1);
  });
});
