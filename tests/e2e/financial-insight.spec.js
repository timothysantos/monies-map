import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadMonthPage, loadSummaryAccountPills, postJson, reseedDemo } from "./helpers";
import { MONTH_COPY } from "../../src/domain/money-signals/month-signals.ts";
import { SHARED_COPY } from "../../src/domain/money-signals/shared-signals.ts";
import { SPLITS_COPY } from "../../src/domain/money-signals/splits-signals.ts";
import { SUMMARY_CALM_LINES, SUMMARY_COPY } from "../../src/domain/money-signals/summary-signals.ts";

// Every think line a signal's copy may pair with: its wording rotates by
// the month viewed (the year rule), so any of them may show.
const thinksOf = (entry, { one = false } = {}) => [
  entry.think, one ? entry.thinkOne : undefined,
  ...entry.phrasings.map((phrasing) => (typeof phrasing === "string" ? undefined : phrasing.think))
].flat().filter(Boolean);

const money = (minor) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(minor / 100);

// The seed's subscriptions are the same every month it has them, so on
// Summary they are steady: they lead only in the last month of each
// quarter. A subscription added in April makes May's total differ from
// April's by more than 10%, which is notable, so May's Summary leads with
// it (docs/developer-guide.md, "Notability").
async function addAprilSubscription(page, ownerName = "Tim") {
  await postJson(page, "/api/entries/create", {
    date: "2026-04-15",
    description: "SPOTIFY P1234567",
    accountName: "UOB One",
    categoryName: "Subscriptions MO",
    amountMinor: 1_098,
    entryType: "expense",
    ownershipType: "direct",
    ownerName
  });
}

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

  test("summary and month render computed check-ins without waiting for AI", async ({ page }) => {
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-05&summary_end=2026-05",
      "/api/summary-page",
      () => page.getByRole("heading", { name: "Summary", exact: true })
    );
    const summaryInsight = page.locator(".financial-insight-summary");
    await expect(summaryInsight).toBeVisible();
    await expect(summaryInsight).toContainText("Household money insights");
    // Seeded May 2026 has subscriptions of $28.70 and nothing to compare
    // them with in a May-only range: steady, and May is not their turn, so
    // the range is calm and nothing is listed under Also.
    await expect(summaryInsight).toHaveAttribute("data-checkin-mode", "calm");
    await expect(summaryInsight.locator(".financial-insight-content > .checkin-chip")).toHaveCount(0);
    expect(SUMMARY_CALM_LINES).toContain((await summaryInsight.locator(".checkin-fact").innerText()).trim());
    await summaryInsight.getByRole("button", { name: "See all insights" }).click();
    await expect(summaryInsight.locator(".checkin-also")).toHaveCount(0);
    await expect(summaryInsight).not.toContainText(/[Ss]ubscriptions/);

    // With April loaded and different, May's subscriptions are news: a
    // Worth a look, with the approved way to think about it.
    await addAprilSubscription(page);
    await gotoPageAfterApi(
      page,
      "/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-04&summary_end=2026-05",
      "/api/summary-page",
      () => page.getByRole("heading", { name: "Summary", exact: true })
    );
    await expect(summaryInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Worth a look");
    await expect(summaryInsight.locator(".checkin-fact")).toContainText(/[Ss]ubscriptions/);
    await expect(summaryInsight.locator(".checkin-fact")).toContainText(/\$28\.70|\$344|\$0\.94/);
    expect(thinksOf(SUMMARY_COPY.subscriptions)).toContain((await summaryInsight.locator(".checkin-think").innerText()).trim());
    await expect(summaryInsight).not.toContainText("Before buying something non-essential");
    await expect(summaryInsight.getByRole("button", { name: "See all insights" })).toHaveAttribute("aria-expanded", "false");
    await expect(summaryInsight.locator(".checkin-quote")).toHaveCount(0);
    await summaryInsight.getByRole("button", { name: "See all insights" }).click();
    await expect(summaryInsight.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    // The Money consequence map is retired: the expanded view is the other
    // signals, a quote and nothing else.
    await expect(summaryInsight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(summaryInsight).not.toContainText(/Money left so far|Plan position|Snapshot confidence|One-repeat scenario/);
    await expect(summaryInsight.getByRole("button", { name: "Review bank-record gaps" })).toHaveCount(0);
    // Beside a Worth a look, the expanded view has one public-domain quote.
    await expect(summaryInsight.locator(".checkin-quote blockquote")).toHaveCount(1);
    await expect(summaryInsight.locator(".checkin-quote figcaption")).toContainText(/, /);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(summaryInsight.getByRole("button", { name: "Show less" })).toBeVisible();
    const mobileWidth = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(mobileWidth.documentWidth).toBeLessThanOrEqual(mobileWidth.viewportWidth + 1);
    await summaryInsight.getByRole("button", { name: "Show less" }).click();
    await expect(summaryInsight.getByRole("button", { name: "See all insights" })).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 1280, height: 720 });

    // Month: May 2026's planned bills without a linked entry are a Quick fix.
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month", exact: true })
    );
    const monthInsight = page.locator(".financial-insight-month");
    await expect(monthInsight).toContainText("Tim's money insights");
    await expect(monthInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Quick fix");
    await expect(monthInsight.locator(".checkin-fact")).toContainText(/planned bills/);
    expect(thinksOf(MONTH_COPY.unlinkedBills)).toContain((await monthInsight.locator(".checkin-think").innerText()).trim());
    await monthInsight.getByRole("button", { name: "See all insights" }).click();
    const also = monthInsight.locator(".checkin-also");
    await expect(also).toContainText("Also this month");
    await expect(also.locator("li")).toHaveCount(2);
    await expect(also).toContainText("Food went $63.19 over its $650 plan.");
    // No map, and none of the links that sat under it: the Quick fix and the
    // Worth a look carry their own actions.
    await expect(monthInsight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(monthInsight.locator(".financial-insight-actions")).toHaveCount(0);
    await expect(monthInsight).not.toContainText(/See income entries|Review bank-record gaps/);
  });

  // A quote is never shown beside a bigger question. A $2,000 one-off makes
  // Tim's May go over plan, with most of it from that one entry.
  test("no quote shows beside a bigger question, and its action opens those entries", async ({ page }) => {
    await postJson(page, "/api/entries/create", {
      date: "2026-05-20",
      description: "COURTS MEGASTORE TAMPINES",
      accountName: "UOB One",
      categoryName: "Shopping",
      amountMinor: 200_000,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await gotoPageAfterApi(page, "/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/month-page", () => page.getByRole("heading", { name: "Month", exact: true }));
    const insight = page.locator(".financial-insight-month");
    await insight.getByRole("button", { name: "See all insights" }).click();
    const bigger = insight.locator(".checkin-also li").filter({ hasText: "Bigger question" });
    await expect(bigger).toContainText(/Courts Megastore Tampines/);
    await expect(bigger).toContainText("$1,181.79 over plan");
    await page.waitForTimeout(600);
    await expect(insight.locator(".checkin-quote")).toHaveCount(0);
  });

  // Month's check-in reads the view's wallet health from the same account
  // pills as the Month Accounts section: a statement that does not match is
  // the check-in's Quick fix, with "Review statement". A missing checkpoint
  // is shown by the Accounts section only; the check-in claims nothing about
  // it (the Money consequence map and its "Needs review" lane are retired).
  test("the month check-in's statement Quick fix follows the view's statement checkpoints", async ({ page }) => {
    const monthUrl = "/month?view=person-joyce&month=2026-05&scope=direct_plus_shared";
    const openMonth = async () => {
      await gotoPageAfterApi(page, monthUrl, "/api/month-page", () => page.getByRole("heading", { name: "Month", exact: true }));
      const insight = page.locator(".financial-insight-month");
      await insight.getByRole("button", { name: "See all insights" }).click();
      return insight;
    };
    const pills = await loadSummaryAccountPills(page, { view: "person-joyce" });
    const checked = pills.accountPills.filter((account) => account.reconciliationStatus === "needs_checkpoint");
    expect(checked.map((account) => account.accountName)).toEqual(["Citi Rewards", "UOB Lady's"]);

    // The seed has no statement checkpoints for Joyce's cards: no Quick fix
    // about a statement, and no verdict about the missing checkpoints.
    let insight = await openMonth();
    await expect(insight).not.toContainText(/statement|Needs review|proof gap/i);
    await expect(insight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(page.locator(".summary-account-pill").filter({ hasText: "UOB Lady's" })).toContainText("No statement checkpoint yet");

    // Every card reconciled to its May statement: still nothing to fix.
    for (const account of checked) {
      await postJson(page, "/api/accounts/reconcile", { accountId: account.accountId, checkpointMonth: "2026-05", statementBalanceMinor: account.balanceMinor });
    }
    insight = await openMonth();
    await expect(insight).not.toContainText(/statement|Needs review|proof gap/i);
    await expect(page.locator(".summary-account-pill").filter({ hasText: "UOB Lady's" })).toContainText("Reconciled to May 2026 statement");

    // One statement $42.80 away from the ledger: a Quick fix names it. The
    // month's unlinked bills led the two earlier visits and now rest, so the
    // statement gap leads, and its Review statement opens Imports.
    const lady = checked.find((account) => account.accountName === "UOB Lady's");
    await postJson(page, "/api/accounts/reconcile", { accountId: lady.accountId, checkpointMonth: "2026-05", statementBalanceMinor: lady.balanceMinor - 4_280 });
    insight = await openMonth();
    await expect(page.locator(".summary-account-pill").filter({ hasText: "UOB Lady's" })).toContainText("May 2026 statement is off by $42.80");
    await expect(insight.getByText(/UOB Lady's.*\$42\.80|\$42\.80.*UOB Lady's/).first()).toBeVisible();
    await expect(insight.getByRole("button", { name: "Review bank-record gaps" })).toHaveCount(0);
    await expect(insight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Quick fix");
    await expect(insight.locator(".checkin-fact")).toContainText("$42.80");
    await expect(insight.locator(".checkin-also li").filter({ hasText: "Quick fix" }).filter({ hasText: /planned bills?/ })).toHaveCount(1);
    await insight.getByRole("button", { name: "Review statement" }).click();
    await expect(page).toHaveURL(/\/imports/);
  });

  // The Month check-in counts what the Actual spend card counts: every entry
  // for the household; a person's own entries in the scope for a person view.
  // The wording request carries that spend, so it must equal the card in
  // every view and scope.
  test("the month check-in spends what the Actual spend card shows in every view and scope", async ({ page }) => {
    const bodies = [];
    await page.route("**/api/ai-assist/financial-insight", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const views = [
      ["household", "Household", ["direct_plus_shared"]],
      ["person-joyce", "Joyce", ["direct", "shared", "direct_plus_shared"]],
      ["person-tim", "Tim", ["direct", "shared", "direct_plus_shared"]]
    ];
    const spendByView = {};
    for (const [viewId, label, scopes] of views) {
      for (const scope of scopes) {
        const data = await loadMonthPage(page, { view: viewId, month: "2026-05", scope });
        const card = data.monthPage.metricCards.find((item) => item.label === "Actual spend").amountMinor;
        const before = bodies.length;
        await gotoPageAfterApi(page, `/month?view=${viewId}&month=2026-05&scope=${scope}`, "/api/month-page", () => page.getByRole("heading", { name: "Month", exact: true }));
        await expect(page.locator(".month-label-view")).toHaveText(label);
        const insight = page.locator(".financial-insight-month");
        await expect(insight).toContainText(viewId === "household" ? "Household money insights" : `${label}'s money insights`);
        await expect.poll(() => bodies.length, { message: `${viewId} ${scope} wording request`, timeout: 15_000 }).toBeGreaterThan(before);
        expect(bodies.at(-1).facts.spend, `${viewId} ${scope}`).toBe(money(card));
        spendByView[`${viewId}:${scope}`] = bodies.at(-1).facts.spend;
      }
    }
    // A person's figures are theirs, not the household's, and scopes differ.
    expect(spendByView["person-joyce:direct_plus_shared"]).not.toBe(spendByView["household:direct_plus_shared"]);
    expect(spendByView["person-tim:direct_plus_shared"]).not.toBe(spendByView["household:direct_plus_shared"]);
    expect(spendByView["person-joyce:direct"]).not.toBe(spendByView["person-joyce:shared"]);
  });

  test("the month wording request sends the person's scoped facts and headline, and asks again when the scope changes", async ({ page }) => {
    const bodies = [];
    await page.route("**/api/ai-assist/financial-insight", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const actualSpendCard = page.locator(".metric-row-month .metric").filter({ hasText: "Actual spend" }).locator("strong");
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month", exact: true })
    );
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
    const combinedSpend = (await actualSpendCard.innerText()).trim();
    // Only computed facts go out, with the person's name held back: the
    // headline's fact and think line, which the AI must keep word for word.
    expect(Object.keys(bodies[0])).toEqual(["facts"]);
    expect(bodies[0].facts.spend).toBe(combinedSpend);
    expect(bodies[0].facts.audienceKind).toBe("person");
    expect(bodies[0].facts.headlineKind).toBe("quick_fix");
    const insight = page.locator(".financial-insight-month");
    expect(bodies[0].facts.fact).toBe((await insight.locator(".checkin-fact").innerText()).trim());
    expect(bodies[0].facts.think).toBe((await insight.locator(".checkin-think").innerText()).trim());
    expect([...thinksOf(MONTH_COPY.unlinkedBills), ...thinksOf(MONTH_COPY.unlinkedBills, { one: true })]).toContain(bodies[0].facts.think);
    expect(JSON.stringify(bodies[0])).not.toContain("Tim");
    for (const removed of ["notableFact", "cashFlowPrinciple", "nextSpendConsideration", "accountingAdvice"]) {
      expect(Object.hasOwn(bodies[0].facts, removed)).toBe(false);
    }

    await page.locator(".desktop-scope-toggle").getByRole("button", { name: "Shared", exact: true }).click();
    await expect(page).toHaveURL(/scope=shared/);
    await expect(actualSpendCard).not.toHaveText(combinedSpend);
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
    const sharedSpend = (await actualSpendCard.innerText()).trim();
    expect(bodies[1].facts.spend).toBe(sharedSpend);
    expect(bodies[1].facts.spend).not.toBe(bodies[0].facts.spend);
  });

  // The links that sat under the retired map are gone: "See income entries"
  // and "Review largest expense" belonged to no signal (the five largest
  // line carries its own "Show those entries"). Splits keeps its bank-match
  // link, which its Quick fix owns.
  test("entries and splits check-ins show no map and no orphan links", async ({ page }) => {
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
    await expect(entriesInsight).toContainText("Tim's money insights");
    await expect(entriesInsight.locator(".financial-insight-narrative")).not.toBeEmpty();
    await expect(entriesInsight).not.toContainText("Before buying something non-essential");
    await entriesInsight.getByRole("button", { name: "See all insights" }).click();
    await expect(entriesInsight.getByRole("button", { name: "Show less" })).toBeVisible();
    await expect(entriesInsight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(entriesInsight.locator(".financial-insight-actions")).toHaveCount(0);
    await expect(entriesInsight).not.toContainText(/See income entries|Review largest expense|Investigation evidence|Check the full month/);

    // A search does not change what the Splits check-in says about the
    // group, and no map follows it.
    await gotoPageAfterApi(
      page,
      "/splits?view=person-tim&month=2026-06&split_group=split-group-none&split_search=Shopee",
      "/api/splits-page",
      () => page.getByRole("heading", { name: "Splits", exact: true })
    );
    const splitsInsight = page.locator(".financial-insight-splits");
    await expect(splitsInsight).toContainText("Tim's money insights");
    await expect(splitsInsight.locator(".checkin-fact")).toContainText(/you owe Joyce \$260\.25/i);
    await splitsInsight.getByRole("button", { name: "See all insights" }).click();
    await expect(splitsInsight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(splitsInsight).not.toContainText(/Settlement obligations|What this view measures/);
  });

  test("the entries check-in's action filters the list to the entries it names", async ({ page }) => {
    await gotoPageAfterApi(page, "/entries?view=household&month=2026-05&scope=direct_plus_shared", "/api/entries-page", () => page.getByRole("heading", { name: "Entries", exact: true }));
    const insight = page.locator(".financial-insight-entries");
    await expect(insight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Worth a look");
    await expect(insight.locator(".checkin-fact")).toContainText(/five/i);
    await insight.getByRole("button", { name: "Show those entries" }).click();
    await expect(page).toHaveURL(/entry_id=.*entry_id=.*entry_id=.*entry_id=.*entry_id=/);
  });

  // A person's Splits check-in speaks from their side of the group, in the
  // group currency. Tim paid ¥12,000 for a JPY trip hotel split 25% Tim /
  // 75% Joyce: Joyce owes Tim ¥9,000, and Tim's own share is ¥3,000.
  test("the splits check-in follows the person view and says who owes whom", async ({ page }) => {
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
    const splitsInsight = page.locator(".financial-insight-splits");
    await expect(splitsInsight).toContainText("Tim's money insights");
    await expect(splitsInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Quick fix");
    await expect(splitsInsight.locator(".checkin-fact")).toContainText("Joyce owes you JP¥9,000");
    // A trip's own think lines, not the ones for a group that is not a trip.
    expect(thinksOf(SPLITS_COPY.owedToYou)).toContain((await splitsInsight.locator(".checkin-think").innerText()).trim());
    await expect(splitsInsight.getByRole("button", { name: "Settle group" })).toBeVisible();

    // Only computed facts go out, with the person's name held back; the
    // facts count Tim's own share.
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);
    expect(Object.keys(bodies[0])).toEqual(["facts"]);
    expect(bodies[0].facts).toMatchObject({ audienceKind: "person", spend: "JP¥3,000", entryCount: 1, headlineKind: "quick_fix" });
    expect(JSON.stringify(bodies[0])).not.toContain("Tim");

    // Joyce's view speaks from her side and asks for wording again.
    await page.locator(".context-block .pill[title='Joyce']").click();
    await expect(page).toHaveURL(/view=person-joyce/);
    await expect(splitsInsight).toContainText("Joyce's money insights");
    await expect(splitsInsight.locator(".checkin-fact")).toContainText(/you owe Tim JP¥9,000/i);
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(2);
    expect(bodies[1].facts).toMatchObject({ audienceKind: "person", spend: "JP¥9,000" });
    expect(JSON.stringify(bodies[1])).not.toContain("Joyce");

    // Settle group opens the page's own settlement dialog.
    await splitsInsight.getByRole("button", { name: "Settle group" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

// Keeping it fresh: four visits to Tim's Summary in one week, with injected
// dates and the real localStorage. Each visit says something different
// because the data, or the last visit, changed.
test("four visits in one week: a first look, a new quick fix, sorted once, then a quiet visit", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.route("**/api/ai-assist/financial-insight", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await reseedDemo(page);
  // Something notable all week (May's subscriptions differ from April's), so
  // the first look leads with a signal and a quiet visit has one to hold.
  await addAprilSubscription(page);
  const pills = await loadSummaryAccountPills(page, { view: "person-tim" });
  const card = pills.accountPills.find((account) => account.reconciliationStatus !== "mismatch");
  const insight = page.locator(".financial-insight-summary");
  const visit = async (isoInstant) => {
    await page.clock.setFixedTime(new Date(isoInstant));
    await gotoPageAfterApi(page, "/summary?view=person-tim&month=2026-05&scope=direct_plus_shared", "/api/summary-page", () => page.getByRole("heading", { name: "Summary", exact: true }));
    await expect(insight.locator(".financial-insight-narrative")).toBeVisible();
    const chip = insight.locator(".financial-insight-content > .checkin-chip");
    return {
      mode: await insight.getAttribute("data-checkin-mode"),
      chip: (await chip.count()) ? await chip.textContent() : null,
      text: (await insight.locator(".financial-insight-narrative").innerText()).trim()
    };
  };

  // Mon 4 May: a first look.
  const monday = await visit("2026-05-04T09:00:00+08:00");
  expect(monday.mode).toBe("signal");

  // Wed 13 May: a statement arrives $42.80 away from the app: it leads.
  await postJson(page, "/api/accounts/reconcile", { accountId: card.accountId, checkpointMonth: "2026-05", statementBalanceMinor: card.balanceMinor - 4_280 });
  const wednesday = await visit("2026-05-13T20:00:00+08:00");
  expect(wednesday.chip).toBe("Quick fix");
  expect(wednesday.text).toContain("$42.80");
  expect(thinksOf(SHARED_COPY.statementGap).some((line) => wednesday.text.includes(line))).toBe(true);
  // The Quick fix's own link replaced the retired map's "Review bank-record
  // gaps": it opens Imports.
  await expect(insight.getByRole("button", { name: "Review bank-record gaps" })).toHaveCount(0);
  await insight.getByRole("button", { name: "Review statement" }).click();
  await expect(page).toHaveURL(/\/imports\?/);

  // Fri 15 May: fixed. The check-in says so once.
  await postJson(page, "/api/accounts/reconcile", { accountId: card.accountId, checkpointMonth: "2026-05", statementBalanceMinor: card.balanceMinor });
  const friday = await visit("2026-05-15T19:00:00+08:00");
  expect(friday.mode).toBe("sorted");
  expect(friday.chip).toBe("Going well");
  expect(friday.text).toMatch(/^Sorted: .* now matches its statement\./);
  expect(friday.text).toContain("That's the part that makes every other number here trustworthy.");

  // Sun 17 May: nothing new since Friday: one quiet line.
  const sunday = await visit("2026-05-17T10:00:00+08:00");
  expect(sunday.mode).toBe("quiet");
  expect(sunday.chip).toBeNull();
  expect(sunday.text).toMatch(/Friday/);
  expect(sunday.text).not.toContain("Sorted");

  expect(new Set([monday.text, wednesday.text, friday.text, sunday.text]).size).toBe(4);
  // The memory is this browser's only.
  const stored = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("monies-map:checkin:")));
  expect(stored).toEqual(["monies-map:checkin:v1:summary:person-tim"]);
});

// H08: optional AI wording waits for a usable route (loaded, no editor or
// save in progress) and a quiet 700 ms. Requests are counted and held with
// page.route; deterministic wording is always on screen meanwhile.
test.describe("financial insight wording readiness", () => {
  const SUMMARY_URL = "/summary?view=household&month=2026-05&scope=direct_plus_shared";
  // The stub rewords around the fact and think line it was sent, as the
  // Worker's template does: the client keeps only wording that carries both.
  const AI_WORDING = "Playwright AI wording:";

  function controlInsightRequests(page, { respond = "ai" } = {}) {
    const state = { requests: [], held: [], failed: [], hold: false };
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname === "/api/ai-assist/financial-insight") state.failed.push(Date.now());
    });
    const aiNarrative = (route) => {
      const facts = route.request().postDataJSON()?.facts ?? {};
      return `${AI_WORDING} ${facts.fact} ${facts.think}`;
    };
    const fulfill = async (route) => {
      if (respond === "malformed") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }).catch(() => {});
        return;
      }
      if (respond === "error-with-wording") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ available: true, source: "ai", narrative: aiNarrative(route) })
        }).catch(() => {});
        return;
      }
      if (respond === "drops-the-fact") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ available: true, source: "ai", narrative: `${AI_WORDING} something else entirely.` })
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
        body: JSON.stringify({ available: true, source: "ai", narrative: aiNarrative(route) })
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
    // A notable headline to reword: a calm range has nothing to ask for.
    await addAprilSubscription(page);
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
    // The AI's words sit around the computed fact, which stays bold.
    await expect(page.locator(".financial-insight-summary .checkin-fact.is-inline")).not.toBeEmpty();
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
    await expect(page.locator(".financial-insight-summary")).toContainText("Reveal money totals to read these insights.");
    await expect.poll(() => control.state.failed.length).toBe(1);
    control.releaseAll();
    await page.waitForTimeout(2_000);
    expect(control.state.requests).toHaveLength(1);
  });

  for (const respond of ["unavailable", "malformed", "error-with-wording", "drops-the-fact"]) {
    test(`a response that is ${respond} keeps the computed wording and is not retried on return`, async ({ page }) => {
      const control = await controlInsightRequests(page, { respond });
      await openSummary(page);
      const insight = page.locator(".financial-insight-summary");
      const narrative = insight.locator(".financial-insight-narrative");
      await expect(insight.locator(".checkin-fact")).not.toBeEmpty();
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
    await insight.getByRole("button", { name: "See all insights" }).click();
    await insight.getByRole("button", { name: "Show less" }).click();
    await page.mouse.move(400, 300);
    await expect.poll(() => control.state.requests.length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(2_500);
    expect(control.state.requests).toHaveLength(1);
  });
});
