import { devices, expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Production report (2026-10-15, iPhone): opening the View and scope sheet from
// the floating bar on the Household Summary over All months crashed the whole
// app to "The app hit a problem and could not be shown", on every open, even
// after "Reload app". That text is the app boundary's, which is what catches a
// lazy sheet whose stylesheet or chunk fails to load: the sheet was opened
// from App, outside the page's own boundary. A sheet that cannot load must
// leave the app, the tab bar and the page alone, and the crash must be left in
// the error diagnostics so the next report can be read.
const iPhone = devices["iPhone 13"];
const SUMMARY_URL = "/summary?view=household&summary_start=2025-06&summary_end=2025-10";

test.describe("View and scope sheet on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: iPhone.userAgent, deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  async function openSummary(page) {
    await page.goto(SUMMARY_URL);
    await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
    await expect(page.locator(".mobile-context-trigger")).toBeVisible();
  }

  function watchCrashReports(page) {
    const reports = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/error-diagnostics/record")) {
        reports.push(JSON.parse(request.postData() ?? "{}"));
      }
    });
    return reports;
  }

  test("opens from the Household Summary over All months", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openSummary(page);
    await page.locator(".mobile-context-trigger").tap();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Household" }).first()).toBeVisible();
    await expect(page.getByText("The app hit a problem")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a View and scope sheet that cannot load leaves the app standing and leaves a crash report", async ({ page }) => {
    const reports = watchCrashReports(page);
    await openSummary(page);
    // The sheet's chunk fails to download.
    await page.route("**/mobile-context-sheet.jsx*", (route) => route.abort());
    await page.locator(".mobile-context-trigger").tap();

    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".screen-error-panel")).toBeVisible();
    await expect(page.getByText("The app hit a problem")).toHaveCount(0);
    // The page and its tab bar are still there, and the sheet still closes.
    await expect(page.locator("nav.tab-strip")).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".mobile-context-trigger")).toBeVisible();

    await expect.poll(() => reports.length).toBeGreaterThan(0);
    expect(reports[0]).toMatchObject({ source: "client_crash", action: "Section crashed while rendering", route: "/summary" });
    expect(reports[0].errorMessage).toMatch(/dynamically imported module|Importing a module script failed|Failed to fetch/i);
    expect(JSON.parse(reports[0].requestContextJson).path).toBe("/summary");
    expect(reports[0].requestContextJson).not.toMatch(/household|summary_start/);
  });

  test("a Pick a month sheet that cannot load leaves the app standing too", async ({ page }) => {
    await openSummary(page);
    await page.route("**/summary-month-sheet.jsx*", (route) => route.abort());
    await page.locator(".mobile-month-choice-all").tap();
    await expect(page.locator(".screen-error-panel")).toBeVisible();
    await expect(page.getByText("The app hit a problem")).toHaveCount(0);
    await expect(page.locator("nav.tab-strip")).toBeAttached();
  });

  test("a sheet stylesheet that fails to download is ridden out and reported, not thrown", async ({ page }) => {
    const reports = watchCrashReports(page);
    await openSummary(page);
    // What Vite's preload helper does when a lazy chunk's <link> errors.
    const prevented = await page.evaluate(() => {
      const event = new Event("vite:preloadError", { cancelable: true });
      // @ts-ignore the payload is how Vite hands the error over
      event.payload = new Error("Unable to preload CSS for /assets/mobile-context-sheet-test.css");
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect.poll(() => reports.length).toBeGreaterThan(0);
    expect(reports[0]).toMatchObject({ source: "client_crash", action: "A stylesheet failed to load (ridden out)" });
    await expect(page.getByText("The app hit a problem")).toHaveCount(0);
  });
});
