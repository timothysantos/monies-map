import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSummaryAccountPills, postJson, reseedDemo } from "./helpers";
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

// Money insights headlines use computed wording only. The AI rewording
// route is gone, so no page may ask for it: every test here records any
// request to its old path and expects none.
const REMOVED_WORDING_PATH = "/api/ai-assist/financial-insight";

function recordWordingRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === REMOVED_WORDING_PATH) requests.push(request.url());
  });
  return requests;
}

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

test.describe("financial insights", () => {
  let wordingRequests = [];

  test.beforeEach(async ({ page }) => {
    wordingRequests = recordWordingRequests(page);
    // The phone's insights start folded; these checks read the open block.
    await page.addInitScript(() => {
      window.localStorage.setItem("monies-map:money-totals-visible", "true");
      window.localStorage.setItem("monies-map:money-insights-phone", "true");
    });
    await reseedDemo(page);
  });

  test.afterEach(() => {
    expect(wordingRequests).toEqual([]);
  });

  test("summary and month render computed check-ins", async ({ page }) => {
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
    await expect(summaryInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Worth knowing");
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

    // Month: May 2026's planned bills with no payment matched yet are a To do.
    await gotoPageAfterApi(
      page,
      "/month?view=person-tim&month=2026-05&scope=direct_plus_shared",
      "/api/month-page",
      () => page.getByRole("heading", { name: "Month", exact: true })
    );
    const monthInsight = page.locator(".financial-insight-month");
    await expect(monthInsight).toContainText("Tim's money insights");
    await expect(monthInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("To do");
    await expect(monthInsight.locator(".checkin-fact")).toContainText(/\bbills? (?:you )?planned\b|\bplanned at\b/);
    expect(thinksOf(MONTH_COPY.unlinkedBills)).toContain((await monthInsight.locator(".checkin-think").innerText()).trim());
    await monthInsight.getByRole("button", { name: "See all insights" }).click();
    const also = monthInsight.locator(".checkin-also");
    await expect(also).toContainText("Also this month");
    await expect(also.locator("li")).toHaveCount(2);
    await expect(also).toContainText("Food came to $713.19, $63.19 more than the $650 you planned.");
    // No map, and none of the links that sat under it: the Quick fix and the
    // Worth a look carry their own actions.
    await expect(monthInsight.getByLabel("Money consequence map")).toHaveCount(0);
    await expect(monthInsight.locator(".financial-insight-actions")).toHaveCount(0);
    await expect(monthInsight).not.toContainText(/See income entries|Review bank-record gaps/);
  });

  // Summary's insights (its signals and every copy pool) load beside the
  // first screen, never inside it, and Summary never waits for them. Held
  // back, the page is usable and the insights show only their frame: the
  // label and no words of their own. They fill in when the module arrives.
  test("Summary is usable before its insights module arrives, and the insights fill in after", async ({ page }) => {
    const held = [];
    await page.route("**/src/domain/money-signals/summary-signals.ts*", async (route) => {
      await new Promise((resolve) => held.push(resolve));
      await route.continue();
    });
    await page.goto("/summary?view=household&month=2026-05&scope=direct_plus_shared");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await waitUsable(page);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    const insight = page.locator(".financial-insight-summary");
    await expect(insight).toHaveAttribute("data-checkin-mode", "loading");
    await expect(insight).toHaveAttribute("aria-busy", "true");
    expect((await insight.innerText()).trim()).toBe("HOUSEHOLD MONEY INSIGHTS");
    await expect(page.getByText("Intent vs Outcome", { exact: true })).toBeVisible();

    held.splice(0).forEach((release) => release());
    await expect(insight).not.toHaveAttribute("data-checkin-mode", "loading");
    await expect(insight).not.toHaveAttribute("aria-busy", "true");
    await expect(insight.locator(".checkin-fact")).not.toBeEmpty();
    await expect(insight.getByRole("button", { name: "See all insights" })).toBeVisible();
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
    const bigger = insight.locator(".checkin-also li").filter({ hasText: "Something to think about" });
    await expect(bigger).toContainText(/Courts Megastore Tampines/);
    await expect(bigger).toContainText("$1,181.79");
    await page.waitForTimeout(600);
    await expect(insight.locator(".checkin-quote")).toHaveCount(0);
  });

  // Month's check-in reads the view's wallet health from the same account
  // pills as the Month Accounts section: a statement that does not match is
  // the check-in's Quick fix, with "Compare with the statement". A missing checkpoint
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
    // statement gap leads, and its "Compare with the statement" opens Imports.
    const lady = checked.find((account) => account.accountName === "UOB Lady's");
    await postJson(page, "/api/accounts/reconcile", { accountId: lady.accountId, checkpointMonth: "2026-05", statementBalanceMinor: lady.balanceMinor - 4_280 });
    insight = await openMonth();
    await expect(page.locator(".summary-account-pill").filter({ hasText: "UOB Lady's" })).toContainText("May 2026 statement is off by $42.80");
    await expect(insight.getByText(/UOB Lady's.*\$42\.80|\$42\.80.*UOB Lady's/).first()).toBeVisible();
    await expect(insight.getByRole("button", { name: "Review bank-record gaps" })).toHaveCount(0);
    await expect(insight.locator(".financial-insight-content > .checkin-chip")).toHaveText("To do");
    await expect(insight.locator(".checkin-fact")).toContainText("$42.80");
    await expect(insight.locator(".checkin-also li").filter({ hasText: "To do" }).filter({ hasText: /bills? (?:you )?planned|planned at/ })).toHaveCount(1);
    await insight.getByRole("button", { name: "Compare with the statement" }).click();
    await expect(page).toHaveURL(/\/imports/);
  });

  // The links that sat under the retired map are gone: "See income entries"
  // and "Review largest expense" belonged to no signal (the five largest
  // line carries its own "Show those five"). Splits keeps its bank-match
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
    await expect(insight.locator(".financial-insight-content > .checkin-chip")).toHaveText("Worth knowing");
    await expect(insight.locator(".checkin-fact")).toContainText(/five/i);
    await insight.getByRole("button", { name: "Show those five" }).click();
    await expect(page).toHaveURL(/entry_id=.*entry_id=.*entry_id=.*entry_id=.*entry_id=/);
    // The list now shows exactly those five, so the link would change
    // nothing: it goes, and the fact stays.
    await expect(insight.locator(".checkin-fact")).toContainText(/five/i);
    await expect(insight.getByRole("button", { name: "Show those five" })).toHaveCount(0);
    // Widening the list again brings the link back.
    await page.goBack();
    await expect(insight.getByRole("button", { name: "Show those five" })).toBeVisible();
  });

  // A person's Splits check-in speaks from their side of the group, in the
  // group currency. Tim paid ¥12,000 for a JPY trip hotel split 25% Tim /
  // 75% Joyce: Joyce owes Tim ¥9,000, and Tim's own share is ¥3,000.
  test("the splits check-in follows the person view and says who owes whom", async ({ page }) => {
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
    await expect(splitsInsight.locator(".financial-insight-content > .checkin-chip")).toHaveText("To do");
    await expect(splitsInsight.locator(".checkin-fact")).toContainText("Joyce owes you JP¥9,000");
    // A trip's own think lines, not the ones for a group that is not a trip.
    expect(thinksOf(SPLITS_COPY.owedToYou)).toContain((await splitsInsight.locator(".checkin-think").innerText()).trim());
    await expect(splitsInsight.getByRole("button", { name: "Settle group" })).toBeVisible();

    // Joyce's view speaks from her side.
    await page.locator(".context-block .pill[title='Joyce']").click();
    await expect(page).toHaveURL(/view=person-joyce/);
    await expect(splitsInsight).toContainText("Joyce's money insights");
    await expect(splitsInsight.locator(".checkin-fact")).toContainText(/you owe Tim JP¥9,000/i);

    // Settle group opens the page's own settlement dialog.
    await splitsInsight.getByRole("button", { name: "Settle group" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

// Keeping it fresh: four visits to Tim's Summary in one week, with injected
// dates and the real localStorage. Each visit says something different
// because the data, or the last visit, changed.
test("four visits in one week: a first look, a new quick fix, sorted once, then a quiet visit", async ({ page }) => {
  const wordingRequests = recordWordingRequests(page);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
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
  expect(wednesday.chip).toBe("To do");
  expect(wednesday.text).toContain("$42.80");
  expect(thinksOf(SHARED_COPY.statementGap).some((line) => wednesday.text.includes(line))).toBe(true);
  // The Quick fix's own link replaced the retired map's "Review bank-record
  // gaps": it opens Imports.
  await expect(insight.getByRole("button", { name: "Review bank-record gaps" })).toHaveCount(0);
  await insight.getByRole("button", { name: "Compare with the statement" }).click();
  await expect(page).toHaveURL(/\/imports\?/);

  // Fri 15 May: fixed. The check-in says so once.
  await postJson(page, "/api/accounts/reconcile", { accountId: card.accountId, checkpointMonth: "2026-05", statementBalanceMinor: card.balanceMinor });
  const friday = await visit("2026-05-15T19:00:00+08:00");
  expect(friday.mode).toBe("sorted");
  expect(friday.chip).toBe("Going well");
  expect(friday.text).toMatch(/^Sorted: .* now matches its bank statement\./);
  expect(friday.text).toContain("The totals here for that account now agree with the bank.");

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
  expect(wordingRequests).toEqual([]);
});

// Money insights headlines use computed wording only (no AI rewording):
// once each page is usable, and for longer than the old 700 ms wording
// debounce, the headline stays the bold computed fact and its think line as
// written, and no page asks the removed wording route.
test("every page's headline is the computed fact and think line, and no page asks for AI wording", async ({ page }) => {
  const wordingRequests = recordWordingRequests(page);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
  // A notable Summary headline (May's subscriptions differ from April's).
  await addAprilSubscription(page);
  for (const [path, heading, className, thinks] of [
    ["/summary?view=household&month=2026-05&scope=direct_plus_shared&summary_start=2026-04&summary_end=2026-05", "Summary", ".financial-insight-summary", thinksOf(SUMMARY_COPY.subscriptions)],
    ["/month?view=person-tim&month=2026-05&scope=direct_plus_shared", "Month", ".financial-insight-month", [...thinksOf(MONTH_COPY.unlinkedBills), ...thinksOf(MONTH_COPY.unlinkedBills, { one: true })]],
    ["/entries?view=household&month=2026-05&scope=direct_plus_shared", "Entries", ".financial-insight-entries", null],
    ["/splits?view=person-tim&month=2026-06&split_group=split-group-none", "Splits", ".financial-insight-splits", null]
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await waitUsable(page);
    const narrative = page.locator(`${className} .financial-insight-narrative`);
    const fact = narrative.locator("strong.checkin-fact");
    await expect(fact, heading).not.toBeEmpty();
    if (thinks) {
      const think = (await narrative.locator(".checkin-think").innerText()).trim();
      expect(thinks, heading).toContain(think);
    }
    const computed = await narrative.innerText();
    await page.waitForTimeout(1_500);
    await expect(narrative, heading).toHaveText(computed);
    await expect(narrative.locator(".checkin-fact.is-inline"), heading).toHaveCount(0);
  }
  expect(wordingRequests).toEqual([]);
});
