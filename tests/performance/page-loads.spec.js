import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServerTiming, summarizeSamples, totalsByType } from "./performance-stats.mjs";

// Page-by-page cold loads and the Ask opens, on the built client. Records,
// never asserts timing (noise must not fail it, budgets must not be inflated
// to pass it); it asserts only that the harness is valid. Run it per tree and
// compare cohorts with `node scripts/compare-performance.mjs --pages`.
//
// Per route, one fresh browser context per sample (empty HTTP cache, warm
// Worker): the time until the route is usable, the requests started before
// that (what the first screen costs) and, for the first sample, the requests
// that follow while the page sits idle (optional work). A route this build
// does not have (Ask on an older commit) is reported as missing.
//
// Usable here is structural, so the same predicate holds on the demo and the
// scale fixtures: the route's heading is on screen, every API response the
// route needs has finished, and nothing in the main area is marked busy.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_PAGE_SAMPLES ?? 5);
const IDLE_MS = Number(process.env.PERFORMANCE_PAGE_IDLE_MS ?? 5000);
const READY_TIMEOUT_MS = 60_000;
const MONTH = "2026-05";

const PROFILES = {
  desktop: { label: "desktop: 40 ms RTT, 10 Mbps down, 5 Mbps up, CPU 1x", cpuRate: 1, latency: 40, downloadThroughput: 1_310_720, uploadThroughput: 655_360 },
  mobile: { label: "mobile: 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x", cpuRate: 4, latency: 150, downloadThroughput: 204_800, uploadThroughput: 96_000 }
};

// `api` lists the page APIs the route reads before it can show its data.
const ROUTES = [
  { key: "summary", url: `/summary?view=household&month=${MONTH}`, heading: "Summary", api: ["/api/summary-page", "/api/summary-account-pills"] },
  { key: "month", url: `/month?view=household&month=${MONTH}`, heading: "Month", api: ["/api/month-page"] },
  { key: "entries", url: `/entries?view=household&month=${MONTH}`, heading: "Entries", api: ["/api/entries-page"] },
  { key: "splits", url: `/splits?view=household&month=${MONTH}`, heading: "Splits", api: ["/api/splits-page"] },
  { key: "settings", url: "/settings?view=household", heading: "Settings", api: ["/api/settings-page"] },
  { key: "ask", url: "/ask?view=household", heading: "Ask", api: [] }
];

// In-page predicate: returns performance.now() once the route is usable.
const USABLE = ({ heading, api }) => {
  const title = [...document.querySelectorAll("h1, h2")].some((node) => node.textContent.trim() === heading && node.offsetParent !== null);
  if (!title) return false;
  const finished = performance.getEntriesByType("resource").filter((entry) => entry.responseEnd > 0).map((entry) => new URL(entry.name).pathname);
  if (!api.every((needed) => finished.includes(needed))) return false;
  if (document.querySelector('main [aria-busy="true"]')) return false;
  return performance.now();
};

function contextOptions(use) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = use;
  return { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

async function preparePage(context, profile, origin) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency, downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  const requests = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfinished", async (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    const timing = request.timing();
    let bytes = null;
    let serverTiming = null;
    let status = null;
    try {
      const sizes = await request.sizes();
      bytes = sizes.responseBodySize + sizes.responseHeadersSize;
      const response = await request.response();
      status = response?.status() ?? null;
      serverTiming = parseServerTiming(response ? await response.headerValue("server-timing") : null);
    } catch {}
    requests.push({ path: url.pathname, method: request.method(), status, startedAtMs: timing.startTime, bytes, appMs: serverTiming?.app ?? null });
  });
  return { page, requests, pageErrors };
}

const apiOnly = (requests) => requests.filter((request) => request.path.startsWith("/api/"));
const brief = (requests) => requests.map(({ path: requestPath, method, bytes, appMs }) => ({ path: requestPath, method, bytes, appMs }));

async function coldLoad(browser, project, profile, route) {
  const context = await browser.newContext(contextOptions(project.use));
  const { page, requests, pageErrors } = await preparePage(context, profile, new URL(project.use.baseURL).origin);
  try {
    const response = await page.goto(route.url, { waitUntil: "commit" });
    if (response && response.status() === 404) {
      await context.close();
      return { missing: true };
    }
    let usableMs;
    try {
      // A route an older build lacks never gets its heading; do not wait a minute for it.
      const handle = await page.waitForFunction(USABLE, { heading: route.heading, api: route.api }, { polling: "raf", timeout: route.key === "ask" ? 15_000 : READY_TIMEOUT_MS });
      usableMs = await handle.jsonValue();
    } catch (error) {
      if (route.key === "ask") {
        await context.close();
        return { missing: true };
      }
      throw new Error(`${route.key} never became usable: ${error.message}\nErrors: ${JSON.stringify(pageErrors)}\nRequests: ${JSON.stringify(requests.map((request) => request.path))}`);
    }
    expect(pageErrors).toEqual([]);
    const usableWall = (await page.evaluate(() => performance.timeOrigin)) + usableMs;
    const before = requests.filter((request) => request.startedAtMs <= usableWall);
    return { usableMs, before, requests, usableWall, page, context };
  } catch (error) {
    await context.close();
    throw error;
  }
}

test("page cold loads and idle traffic", async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const mobile = testInfo.project.name.includes("mobile");
  const profile = mobile ? PROFILES.mobile : PROFILES.desktop;
  const results = {};

  for (const route of ROUTES) {
    const samples = [];
    let idle = null;
    let missing = false;
    for (let sample = 1; sample <= SAMPLES; sample += 1) {
      const load = await coldLoad(browser, testInfo.project, profile, route);
      if (load.missing) {
        missing = true;
        break;
      }
      const { usableMs, before, requests, usableWall, page, context } = load;
      samples.push({
        usableMs,
        byTypeBeforeUsable: totalsByType(before),
        apiBeforeUsable: brief(apiOnly(before)),
        pathsBeforeUsable: before.map((request) => request.path).filter((requestPath) => /\.(?:m?js|css)$/.test(requestPath))
      });
      if (sample === 1) {
        // Optional work after the route is usable: nothing is touched, so
        // anything requested now was started by the page itself.
        await page.waitForTimeout(Math.max(0, usableWall + IDLE_MS - Date.now()));
        idle = brief(requests.filter((request) => request.startedAtMs > usableWall && request.startedAtMs <= usableWall + IDLE_MS));
      }
      await context.close();
    }
    results[route.key] = missing
      ? { missing: true }
      : { url: route.url, usable: summarizeSamples(samples.map((item) => item.usableMs)), rawUsableMs: samples.map((item) => item.usableMs), samples, idleAfterFirstLoad: idle };
  }

  // Opening Ask, and its add card, from a page already usable. A route that
  // is a tab (phone) is opened through its link; on a wide screen the field
  // at the bottom right opens the panel beside the page.
  const asks = {};
  for (const step of ["open", "addCard"]) {
    const samples = [];
    let missing = false;
    for (let sample = 1; sample <= SAMPLES && !missing; sample += 1) {
      const route = ROUTES.find((item) => item.key === (step === "open" ? "summary" : "entries"));
      const load = await coldLoad(browser, testInfo.project, profile, route);
      const { page, context, requests } = load;
      const before = requests.length;
      const started = await page.evaluate(() => performance.now());
      let opened = false;
      if (mobile) {
        const askTab = page.locator("nav.tab-strip").getByRole("link", { name: "Ask" });
        if (await askTab.count()) {
          await askTab.click();
          if (step === "addCard") await page.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: /^Add entry$/ }).click();
          opened = true;
        }
      } else if (step === "open") {
        const field = page.getByRole("textbox", { name: "Ask", exact: true });
        if (await field.count()) {
          await field.click();
          opened = true;
        }
      } else {
        const plus = page.locator(".entries-fab:not(.splits-fab)");
        if (await plus.count()) {
          await plus.click();
          opened = true;
        }
      }
      if (!opened) {
        missing = true;
        await context.close();
        break;
      }
      const target = step === "open" ? page.getByRole("textbox", { name: "Message" }) : page.getByRole("heading", { name: "New entry" });
      try {
        await target.first().waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        // This build has no such card (an older Add entry flow).
        missing = true;
        await context.close();
        break;
      }
      const finished = await page.evaluate(() => performance.now());
      await page.waitForTimeout(1500);
      const made = requests.slice(before);
      samples.push({
        settledMs: finished - started,
        byType: totalsByType(made),
        apiRequests: brief(apiOnly(made)),
        codePaths: made.map((request) => request.path).filter((requestPath) => /\.(?:m?js|css)$/.test(requestPath))
      });
      await context.close();
    }
    asks[step] = missing ? { missing: true } : { settled: summarizeSamples(samples.map((item) => item.settledMs)), rawSettledMs: samples.map((item) => item.settledMs), samples };
  }

  const report = {
    task: "page-loads",
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    fixture: FIXTURE,
    project: testInfo.project.name,
    profile,
    browser: { engine: "chromium", version: browser.version() },
    cacheState: "fresh browser context per sample (empty HTTP cache); Worker isolate already warm",
    routes: results,
    ask: asks
  };
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-pages-${testInfo.project.name}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Page loads report: ${outputFile}`);
  console.log(JSON.stringify({ project: testInfo.project.name, usableMedianMs: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.usable?.medianMs ?? null])), ask: Object.fromEntries(Object.entries(asks).map(([key, value]) => [key, value.settled?.medianMs ?? null])) }));
});
