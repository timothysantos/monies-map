import { devices, expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Route work is the shell's ready/busy contract that later warmup and AI
// scheduling read. These tests drive real workflows and read the
// development-only window.__MONIES_MAP_ROUTE_WORK__ snapshot.

const ENTRIES_KEY = "entries|household|2026-05|direct_plus_shared||";

function readRouteWork(page) {
  return page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__ ?? null);
}

async function waitForRouteWork(page, expected) {
  await expect.poll(async () => {
    const work = await readRouteWork(page);
    return work && Object.fromEntries(Object.keys(expected).map((key) => [key, work[key]]));
  }, { timeout: 30_000 }).toEqual(expected);
}

test.describe("route work status", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await reseedDemo(page);
  });

  test("a previous page kept on screen never makes the next route usable", async ({ page }) => {
    await page.goto("/summary?view=household&month=2026-05");
    await waitForRouteWork(page, { usable: true, reason: "usable" });

    let releaseEntries;
    const entriesHeld = new Promise((resolve) => { releaseEntries = resolve; });
    await page.route("**/api/entries-page**", async (route) => {
      await entriesHeld;
      await route.continue();
    });

    await page.getByRole("link", { name: "Entries", exact: true }).click();
    await expect(page).toHaveURL(/\/entries\?/);
    // Summary content is still on screen while Entries data is held back.
    await expect(page.getByRole("button", { name: "View entries for Bills" })).toBeVisible();
    await waitForRouteWork(page, { routeKey: ENTRIES_KEY, ready: false, usable: false });
    const pending = await readRouteWork(page);
    expect(["no-page-view", "shell-loading", "route-data-pending"]).toContain(pending.reason);

    releaseEntries();
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    await waitForRouteWork(page, { routeKey: ENTRIES_KEY, ready: true, busy: false, usable: true, reason: "usable" });
  });

  test("an open entry editor is busy until it closes, and a failed save keeps the draft busy", async ({ page }) => {
    await page.goto("/entries?view=household&month=2026-05");
    await waitForRouteWork(page, { routeKey: ENTRIES_KEY, usable: true });

    const row = page.locator(".entry-row").filter({ hasText: "Vivify" }).first();
    await row.click();
    const editor = page.locator(".entry-edit-grid").first();
    await expect(editor).toBeVisible();
    await waitForRouteWork(page, { ready: true, busy: true, usable: false, reason: "busy" });

    await page.getByRole("button", { name: "Cancel editing entry" }).click();
    await expect(editor).toHaveCount(0);
    await waitForRouteWork(page, { busy: false, usable: true, reason: "usable" });

    await row.click();
    await expect(editor).toBeVisible();
    const amount = editor.getByLabel("Amount");
    await amount.fill("12.34");
    await page.route("**/api/entries/update", (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Simulated save failure" })
    }));
    await page.getByRole("button", { name: "Done editing entry" }).click();
    await expect(editor).toBeVisible();
    await expect(amount).toHaveValue("12.34");
    await waitForRouteWork(page, { busy: true, usable: false });

    await page.unroute("**/api/entries/update");
    await page.getByRole("button", { name: "Done editing entry" }).click();
    await expect(editor).toHaveCount(0);
    await waitForRouteWork(page, { busy: false, usable: true });
  });

  test("a shared category dialog on Summary reports busy through the panel's route key", async ({ page }) => {
    await page.goto("/summary?view=household&month=2026-05");
    await waitForRouteWork(page, { usable: true });
    await page.getByRole("button", { name: "Edit Bills" }).first().click();
    await expect(page.getByText("Edit category")).toBeVisible();
    await waitForRouteWork(page, { ready: true, busy: true, reason: "busy" });
    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit category")).toHaveCount(0);
    await waitForRouteWork(page, { busy: false, usable: true });
  });

  test("an import draft is protected work on the Imports route", async ({ page }) => {
    await page.goto("/imports?view=household&month=2026-05");
    await waitForRouteWork(page, { routeKey: "imports|||||", usable: true });
    await page.getByLabel("Batch note").fill("Route work draft");
    await waitForRouteWork(page, { busy: true, usable: false, reason: "busy" });
    await page.getByLabel("Batch note").fill("");
    await waitForRouteWork(page, { busy: false, usable: true });
  });

  test("a settings account dialog is busy until closed, and FAQ is ready without data", async ({ page }) => {
    await page.goto("/settings?view=household&month=2026-05");
    await waitForRouteWork(page, { routeKey: "settings|||||", usable: true });
    await page.locator("button").filter({ hasText: "Accounts" }).first().click();
    await page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first().getByRole("button", { name: "Edit account" }).click();
    await expect(page.locator(".settings-account-dialog")).toBeVisible();
    await waitForRouteWork(page, { busy: true, usable: false });
    await page.getByRole("button", { name: "Close account dialog" }).click();
    await waitForRouteWork(page, { busy: false, usable: true });

    await page.getByRole("link", { name: "FAQ", exact: true }).click();
    await waitForRouteWork(page, { routeKey: "faq|||||", ready: true, busy: false, usable: true });
  });
});

test.describe("route work status on mobile", () => {
  test("mobile sheets and the context sheet block optional work", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 12 Pro"] });
    const page = await context.newPage();
    await page.goto("/");
    await reseedDemo(page);

    await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
    await waitForRouteWork(page, { routeKey: "month|person-tim|2026-05|direct_plus_shared||", usable: true });
    await page.getByRole("button", { name: "+ Add planned item" }).click();
    const addSheet = page.locator('.entry-mobile-sheet[aria-label="+ Add planned item"]');
    await expect(addSheet).toBeVisible();
    await waitForRouteWork(page, { busy: true, usable: false, reason: "busy" });
    await addSheet.getByRole("button", { name: "Close + add planned item" }).click();
    await expect(addSheet).toHaveCount(0);
    await waitForRouteWork(page, { busy: false, usable: true });

    await page.locator(".mobile-context-sticky-wrap .mobile-context-trigger").click();
    await expect(page.locator(".mobile-context-dialog")).toBeVisible();
    await waitForRouteWork(page, { ready: true, busy: true, reason: "mobile-context-open" });
    await page.keyboard.press("Escape");
    await expect(page.locator(".mobile-context-dialog")).toHaveCount(0);
    await waitForRouteWork(page, { busy: false, usable: true });

    await context.close();
  });
});
