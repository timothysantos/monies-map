import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The Splits page no longer sends what a settlement covered: each settled
// section arrives as its heading's numbers, and its rows load when it is
// opened (with the app's spinner, and a Try again when the read fails). A
// search looks inside the settled sections on the server; a deep link to a
// settled expense reads its section first and opens the card read-only.

const month = "2026-05";
const PHONE = { width: 390, height: 844 };
const HEADING = /^Settled up on 20 May( 2026)? · 4 entries · \$1,000\.00$/;

async function createExpense(page, groupId, description, date, amountMinor) {
  return postJson(page, "/api/splits/expenses/create", {
    groupId,
    date,
    description,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
}

// Four older expenses ($1,000.00) covered by a bank-matched settlement on
// 20 May, then two newer open ones.
async function createSettledGroup(page, stamp) {
  const group = await postJson(page, "/api/splits/groups/create", { name: `Okaeri ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  const older = [];
  for (const [description, date, amountMinor] of [
    [`Old rent ${stamp}`, `${month}-02`, 10_000],
    [`Old flights ${stamp}`, `${month}-03`, 20_000],
    [`Old hotel ${stamp}`, `${month}-04`, 30_000],
    [`Old tour ${stamp}`, `${month}-05`, 40_000]
  ]) {
    older.push({ description, id: (await createExpense(page, group.groupId, description, date, amountMinor)).splitExpenseId });
  }
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });
  const transfer = await postJson(page, "/api/entries/create", {
    date: `${month}-21`,
    description: `Settle-up transfer ${stamp}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: checkpoint.amountMinor,
    entryType: "transfer",
    transferDirection: "in",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await postJson(page, "/api/splits/checkpoints/match", { checkpointId: checkpoint.checkpointId, transactionId: transfer.entryId });
  await createExpense(page, group.groupId, `New dinner ${stamp}`, `${month}-25`, 3_000);
  await createExpense(page, group.groupId, `New taxi ${stamp}`, `${month}-26`, 4_500);
  return { groupId: group.groupId, checkpointId: checkpoint.checkpointId, older };
}

async function openGroup(page, groupId, extra = "") {
  await gotoPageAfterApi(page, `/splits?view=person-tim&month=${month}&split_group=${groupId}${extra}`, "/api/splits-page", () => page.locator(".splits-lead"));
}

const settledSection = (page) => page.locator(".split-settled-section");
const settledToggle = (page) => settledSection(page).locator(".split-settled-section-toggle");

// Holds the section's rows until `release()` is called, so the loading
// state can be seen.
async function holdSettledRows(page) {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/splits/settled-rows?**", async (route) => {
    await released;
    await route.continue();
  });
  return () => release();
}

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", PHONE]]) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await page.setViewportSize(size);
    });

    test("the page sends the section's numbers only; opening it loads its rows behind a spinner", async ({ page }) => {
      const stamp = Date.now();
      const settled = await createSettledGroup(page, stamp);
      const data = await loadSplitsPage(page, { view: "person-tim", month });
      expect(data.splitsPage.activity.filter((item) => item.groupId === settled.groupId).map((item) => item.description).sort())
        .toEqual([`New dinner ${stamp}`, `New taxi ${stamp}`]);
      expect(data.splitsPage.settledSections.filter((section) => section.groupId === settled.groupId))
        .toEqual([expect.objectContaining({ checkpointId: settled.checkpointId, entryCount: 4, spendMinor: 100_000, isPaid: true })]);

      const rowRequests = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/splits/settled-rows")) rowRequests.push(request.url());
      });
      const release = await holdSettledRows(page);
      await openGroup(page, settled.groupId);
      await expect(settledToggle(page)).toHaveText(HEADING);
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "false");
      // Collapsed: not even asked for (a phone never reads ahead).
      if (name === "phone") {
        expect(rowRequests).toEqual([]);
      }

      const listHeight = await page.locator(".split-activity-list").evaluate((element) => element.getBoundingClientRect().height);
      await settledToggle(page).click();
      const status = settledSection(page).locator(".split-settled-section-status");
      await expect(status).toContainText("Loading...");
      await expect(settledSection(page).locator(".split-settled-section-body")).toHaveAttribute("aria-busy", "true");
      expect(await page.locator(".split-activity-list").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(listHeight);

      release();
      const rows = settledSection(page).locator(".split-activity-card");
      await expect(rows).toHaveCount(4);
      await expect(status).toHaveCount(0);
      expect(rowRequests.length).toBe(1);
      for (const { description } of settled.older) {
        await expect(rows.filter({ hasText: description })).toHaveCount(1);
      }
      // Closed and opened again: the rows come from the cache, no second read.
      await settledToggle(page).click();
      await settledToggle(page).click();
      await expect(rows).toHaveCount(4);
      expect(rowRequests.length).toBe(1);

      // A settled row still opens read-only, with the reason and Undo on top.
      await rows.filter({ hasText: settled.older[2].description }).click();
      const lock = page.locator(".settlement-lock-error").first();
      await expect(lock).toBeVisible();
      await expect(lock.getByRole("button", { name: "Undo simplification" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save expense" })).toHaveCount(0);
    });

    test("a section that fails to load says so and loads on Try again", async ({ page }) => {
      const settled = await createSettledGroup(page, Date.now());
      let failures = 1;
      await page.route("**/api/splits/settled-rows?**", async (route) => {
        if (failures > 0) {
          failures -= 1;
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Settled split rows failed" }) });
          return;
        }
        await route.continue();
      });
      await openGroup(page, settled.groupId);
      await settledToggle(page).click();
      const failed = settledSection(page).locator(".inline-error");
      await expect(failed).toContainText("We couldn't reach your data just now.");
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(0);
      await failed.getByRole("button", { name: "Try again" }).click();
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(4);
      await expect(failed).toHaveCount(0);
    });

    test("typing a search finds a settled record and opens its section with the match's numbers", async ({ page }) => {
      const stamp = Date.now();
      const settled = await createSettledGroup(page, stamp);
      await openGroup(page, settled.groupId);
      const searches = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/splits/settled-search")) searches.push(request.url());
      });
      await page.getByRole("combobox", { name: "Search" }).fill(`Old flights ${stamp}`);
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(settledToggle(page)).toHaveText(/^Settled up on 20 May( 2026)? · 1 entry · \$200\.00$/);
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(1);
      await expect(settledSection(page).locator(".split-activity-card")).toContainText(`Old flights ${stamp}`);
      await expect(page.getByText("No split activity matches this search.")).toHaveCount(0);
      // One read for the settled part, after the typing pause.
      expect(searches.length).toBeLessThanOrEqual(2);

      // Negative: a word nothing has shows the no-results card and no section.
      await page.getByRole("combobox", { name: "Search" }).fill("zzqqxxnothing");
      await expect(page.getByText("No split activity matches this search.")).toBeVisible();
      await expect(settledSection(page)).toHaveCount(0);
    });

    test("a link to a settled expense reads its section and opens the card read-only", async ({ page }) => {
      const settled = await createSettledGroup(page, Date.now());
      const target = settled.older[1];
      await page.goto(`/splits?view=person-tim&month=${month}&split_group=${settled.groupId}&editing_split_expense=${target.id}`);
      const lock = page.locator(".settlement-lock-error").first();
      await expect(lock).toBeVisible({ timeout: 60_000 });
      await expect(lock).toContainText("Undo the simplification to change it.");
      await expect(page.getByRole("button", { name: "Save expense" })).toHaveCount(0);
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(page).not.toHaveURL(/editing_split_expense/);
    });

    test("hidden money hides the section's total before and after its rows load", async ({ page }) => {
      const settled = await createSettledGroup(page, Date.now());
      await openGroup(page, settled.groupId);
      await page.getByRole("button", { name: "Hide money totals" }).first().click();
      await expect(settledToggle(page)).toHaveText(/^Settled up on 20 May( 2026)? · 4 entries · ••••$/);
      await settledToggle(page).click();
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(4);
      await expect(settledToggle(page)).not.toContainText("$");
      await expect(settledSection(page).locator(".split-activity-card").first()).not.toContainText("$");
    });
  });
}
