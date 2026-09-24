import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Optional data warmup (H07). After the page is usable, any page-data
// request made without a navigation is speculative, so these tests record
// data API requests from that point on.

const DATA_API = /^\/api\/(entries-page|month-page|summary-page|summary-account-pills|imports-page|splits-page)$/;
const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

async function newPage(browser, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  // Reseed first (a fresh test database answers its first page request with
  // an error), then let the setup page finish loading so none of its late
  // requests are counted by a test that starts recording afterwards.
  await reseedDemo(page);
  await page.goto("/");
  await waitUsable(page);
  return { context, page };
}

function recordDataRequests(page) {
  const requests = [];
  let recording = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (recording && DATA_API.test(url.pathname)) {
      requests.push({ path: url.pathname, search: url.search, at: Date.now(), request });
    }
  });
  return { requests, start: () => { recording = true; } };
}

async function openUsable(page, path, recorder) {
  await page.goto(path);
  await waitUsable(page);
  recorder.start();
}

async function injectWarmupCosts(page) {
  await page.addInitScript(() => {
    const routes = Object.fromEntries(["summary", "month", "entries", "splits", "imports", "settings", "faq"].map((id) => [id, {
      entry: `${id}-panel.jsx`, estimatedGzipBytes: 1_000, chunks: [{ file: `assets/${id}-panel.js`, estimatedGzipBytes: 1_000 }]
    }]));
    document.addEventListener("DOMContentLoaded", () => {
      const block = document.createElement("script");
      block.id = "monies-warmup-costs";
      block.type = "application/json";
      block.textContent = JSON.stringify({ schemaVersion: 1, buildId: "e2e", revision: "e2e", routes });
      document.head.append(block);
    }, { once: true });
  });
}

test.describe("optional data warmup on desktop", () => {
  test("warms at most two requests per visit, one at a time, at least 1.5 s apart", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=household&month=2026-05", recorder);
    await expect.poll(() => recorder.requests.length, { timeout: 15_000 }).toBe(2);
    await page.waitForTimeout(10_000);
    const [first, second] = recorder.requests;
    expect(recorder.requests).toHaveLength(2);
    expect(`${first.path}${first.search}`).toBe("/api/entries-page?view=household&month=2026-05");
    expect(second.path).toBe("/api/imports-page");
    expect(second.at - first.at).toBeGreaterThanOrEqual(1_400);
    await context.close();
  });

  test("a person's Summary warms that person's Entries, never the household's", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=person-tim&month=2026-05", recorder);
    await expect.poll(() => recorder.requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const first = recorder.requests[0];
    expect(`${first.path}${first.search}`).toBe("/api/entries-page?view=person-tim&month=2026-05");
    expect(recorder.requests.some((entry) => entry.search.includes("view=household"))).toBe(false);
    await context.close();
  });

  test("navigating during a warming Entries request joins it: one network request, correct data", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    let releaseEntries;
    const held = new Promise((resolve) => { releaseEntries = resolve; });
    await page.route("**/api/entries-page**", async (route) => {
      await held;
      await route.continue();
    });
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=household&month=2026-05", recorder);
    await expect.poll(() => recorder.requests.filter((entry) => entry.path === "/api/entries-page").length, { timeout: 15_000 }).toBe(1);
    await page.getByRole("link", { name: "Entries", exact: true }).click();
    // Past the 1.5 s speculative deadline: a promoted request must not be aborted.
    await page.waitForTimeout(2_000);
    releaseEntries();
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    await expect(page.locator(".entry-row").filter({ hasText: "Vivify" }).first()).toBeVisible();
    expect(recorder.requests.filter((entry) => entry.path === "/api/entries-page")).toHaveLength(1);
    expect(await recorder.requests[0].request.failure()).toBeNull();
    await context.close();
  });

  test("opening an editor cancels a speculative request and starts no new work until it closes", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    await page.route("**/api/entries-page**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.continue().catch(() => {});
    });
    const failed = [];
    page.on("requestfailed", (request) => failed.push(new URL(request.url()).pathname));
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=household&month=2026-05", recorder);
    await expect.poll(() => recorder.requests.length, { timeout: 15_000 }).toBe(1);
    await page.getByRole("button", { name: "Edit Bills" }).first().click();
    await expect(page.getByText("Edit category")).toBeVisible();
    await expect.poll(() => failed).toContain("/api/entries-page");
    await page.waitForTimeout(4_000);
    expect(recorder.requests).toHaveLength(1);
    await expect(page.getByText("Edit category")).toBeVisible();
    await context.close();
  });

  test("warmup off makes no speculative data requests", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    await page.addInitScript(() => { window.__MONIES_MAP_WARMUP_MODE__ = "off"; });
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=household&month=2026-05", recorder);
    await page.waitForTimeout(8_000);
    expect(recorder.requests).toEqual([]);
    await context.close();
  });
});

test.describe("optional data warmup on mobile", () => {
  test("no speculative data without measured admission, and no Imports request for the banner", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    await injectWarmupCosts(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: false, effectiveType: "4g", addEventListener() {}, removeEventListener() {} } });
    });
    const panels = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("entries-panel.jsx")) panels.push("entries");
    });
    const recorder = recordDataRequests(page);
    await openUsable(page, "/summary?view=household&month=2026-05", recorder);
    await expect.poll(() => panels, { timeout: 10_000 }).toEqual(["entries"]);
    await page.waitForTimeout(8_000);
    expect(recorder.requests).toEqual([]);
    await context.close();
  });

  test("the mobile banner uses the cached Imports page after an Imports visit, never its own request", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    const imports = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/imports-page") imports.push(Date.now());
    });
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.waitForTimeout(5_000);
    expect(imports).toEqual([]);
    await expect(page.getByText(/bank files? needed/)).toHaveCount(0);

    await page.goto("/imports?view=household&month=2026-05");
    await waitUsable(page);
    expect(imports).toHaveLength(1);
    await page.locator(".mobile-nav, nav").getByRole("link", { name: "Summary", exact: true }).first().click();
    await waitUsable(page);
    await expect(page.getByText(/bank files? needed/)).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(imports).toHaveLength(1);
    await context.close();
  });
});
