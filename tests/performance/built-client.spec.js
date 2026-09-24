import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseWarmupCosts } from "../../scripts/route-asset-report.mjs";
import { parseServerTiming, summarizeSamples, totalsByType } from "./performance-stats.mjs";

// Built-client baseline for H01. Measures current behaviour only; it asserts
// harness validity (built assets, seeded fixture, usable page), never timing
// budgets, so noise cannot fail it and budgets cannot be inflated to pass it.

const SUMMARY_URL = "/summary?view=household&month=2026-05";
const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const COLD_SAMPLES = Number(process.env.PERFORMANCE_COLD_SAMPLES ?? 5);
const WARM_SAMPLES_PER_DIRECTION = Number(process.env.PERFORMANCE_WARM_SAMPLES ?? 20);
const IDLE_CHECKPOINTS_S = [2, 10, 30];
const READY_TIMEOUT_MS = 30_000;

// Lighthouse-style presets applied through Chromium CDP. CDP adds latency per
// request; it is not Lighthouse's simulated throttling or a real radio.
const PROFILES = {
  desktop: { label: "desktop: 40 ms RTT, 10 Mbps down, 5 Mbps up, CPU 1x", cpuRate: 1, latency: 40, downloadThroughput: 1_310_720, uploadThroughput: 655_360 },
  mobile: { label: "mobile: 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x", cpuRate: 4, latency: 150, downloadThroughput: 204_800, uploadThroughput: 96_000 }
};

// In-page readiness predicates: route-specific fixture values (visible while
// money is hidden) plus an enabled primary control. A heading alone, or the
// previous page kept visible during a transition, cannot satisfy them. Each
// returns in-page performance.now() once usable so assertion polling cannot
// inflate the timing.
const READY = {
  summary: () => {
    if (location.pathname !== "/summary") return false;
    const text = document.querySelector("main")?.innerText ?? "";
    const buttons = [...document.querySelectorAll("button")];
    const label = (button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
    const ready = text.includes("Viewing • Household")
      && buttons.some((button) => label(button).startsWith("Bills") && label(button).includes("4 transactions"))
      && buttons.some((button) => label(button) === "View entries for Bills" && !button.disabled);
    return ready ? performance.now() : false;
  },
  entries: () => {
    if (location.pathname !== "/entries") return false;
    const text = document.querySelector("main")?.innerText ?? "";
    const buttons = [...document.querySelectorAll("button")];
    const ready = text.includes("Viewing entries for Household")
      && text.includes("Vivify")
      && buttons.some((button) => (button.getAttribute("aria-label") ?? "").trim() === "Edit Bills" && !button.disabled);
    return ready ? performance.now() : false;
  }
};

function profileFor(projectName) {
  return projectName.includes("mobile") ? PROFILES.mobile : PROFILES.desktop;
}

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
  await page.addInitScript(() => {
    const perf = { lcp: null, cls: null, longTasks: [], supported: { lcp: false, cls: false, longTasks: false } };
    window.__macroPerf = perf;
    const observe = (type, onEntry) => {
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
        return true;
      } catch {
        return false;
      }
    };
    perf.supported.lcp = observe("largest-contentful-paint", (entry) => { perf.lcp = entry.startTime; });
    perf.supported.cls = observe("layout-shift", (entry) => { if (!entry.hadRecentInput) perf.cls = (perf.cls ?? 0) + entry.value; });
    perf.supported.longTasks = observe("longtask", (entry) => { perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration }); });
  });

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
    requests.push({
      path: url.pathname,
      method: request.method(),
      status,
      startedAtMs: timing.startTime,
      durationMs: timing.responseEnd >= 0 ? timing.responseEnd : null,
      bytes,
      serverTiming
    });
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin !== origin) return;
    requests.push({ path: new URL(request.url()).pathname, method: request.method(), status: null, startedAtMs: request.timing().startTime, durationMs: null, bytes: null, failed: request.failure()?.errorText ?? "failed" });
  });
  return { page, requests, pageErrors };
}

// Resolves with in-page performance.now() at the first animation frame where
// the route is usable.
async function waitUsable(page, route) {
  const handle = await page.waitForFunction(READY[route], undefined, { polling: "raf", timeout: READY_TIMEOUT_MS });
  return handle.jsonValue();
}

function apiDetail(requests) {
  return requests.filter((request) => request.path.startsWith("/api/")).map(({ path: apiPath, status, durationMs, bytes, serverTiming }) => ({ path: apiPath, status, durationMs, bytes, serverTiming }));
}

test("built Summary cold load, Summary/Entries warm navigation and idle traffic", async ({ browser }, testInfo) => {
  // Its readiness predicates read demo values (e.g. Bills with 4 transactions).
  test.skip(FIXTURE !== "demo", "browser readiness is defined on the demo fixture; scale fixtures are measured by api-admission.spec.js");
  const profile = profileFor(testInfo.project.name);
  const coldSamples = [];
  let idle = null;
  let warm = null;
  let warmupMetadata = null;

  for (let sample = 1; sample <= COLD_SAMPLES; sample += 1) {
    // Fresh context = empty HTTP cache and storage. The Worker isolate stays
    // warm across samples; cold-isolate start is not measured here.
    const context = await browser.newContext(contextOptions(testInfo.project.use));
    const { page, requests, pageErrors } = await preparePage(context, profile, new URL(testInfo.project.use.baseURL).origin);
    await page.goto(SUMMARY_URL, { waitUntil: "commit" });
    let usableMs;
    try {
      usableMs = await waitUsable(page, "summary");
    } catch (error) {
      throw new Error(`Summary never became usable: ${error.message}\nErrors: ${JSON.stringify(pageErrors)}\nRequests: ${JSON.stringify(requests.map((request) => request.path))}`);
    }
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "View entries for Bills" })).toBeEnabled();
    expect(pageErrors).toEqual([]);

    const paths = requests.map((request) => request.path);
    expect(paths.some((pathname) => pathname.includes("/@vite/") || pathname.startsWith("/src/"))).toBe(false);
    expect(paths.some((pathname) => /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.js$/.test(pathname))).toBe(true);
    if (sample === 1) {
      warmupMetadata = parseWarmupCosts(await page.locator("script#monies-warmup-costs").textContent());
      expect(warmupMetadata, "built HTML must carry valid warmup cost metadata").not.toBeNull();
      expect(paths.some((pathname) => pathname.includes("warmup-costs"))).toBe(false);
      // The route-work read hook is development-only.
      expect(await page.evaluate(() => "__MONIES_MAP_ROUTE_WORK__" in window)).toBe(false);
    }

    const vitals = await page.evaluate(() => window.__macroPerf);
    // Request timestamps are epoch ms; convert the in-page time to match.
    const usableWall = (await page.evaluate(() => performance.timeOrigin)) + usableMs;
    const loadRequests = requests.filter((request) => request.startedAtMs <= usableWall);
    const coldSample = {
      sample,
      usableMs,
      lcpMs: vitals.lcp,
      cls: vitals.cls,
      longTasksBeforeUsable: vitals.supported.longTasks ? vitals.longTasks.filter((task) => task.startTime <= usableMs).length : null,
      longTaskMsBeforeUsable: vitals.supported.longTasks ? vitals.longTasks.filter((task) => task.startTime <= usableMs).reduce((sum, task) => sum + task.duration, 0) : null,
      requestsBeforeUsable: totalsByType(loadRequests),
      jsCssPathsBeforeUsable: loadRequests.map((request) => request.path).filter((pathname) => /\.(?:m?js|css)$/.test(pathname)),
      api: apiDetail(loadRequests),
      metricSupport: vitals.supported
    };

    if (sample === 1) {
      // Idle traffic after the page became usable, with no user input.
      idle = {};
      for (const seconds of IDLE_CHECKPOINTS_S) {
        await page.waitForTimeout(Math.max(0, usableWall + seconds * 1000 - Date.now()));
        const after = requests.filter((request) => request.startedAtMs > usableWall && request.startedAtMs <= usableWall + seconds * 1000);
        idle[`${seconds}s`] = { byType: totalsByType(after), paths: after.map((request) => request.path) };
      }
    }
    coldSamples.push(coldSample);

    if (sample === 1) {
      // Warm cohort: same page after idle, alternating SPA navigations.
      const link = (name) => page.getByRole("link", { name, exact: true });
      const navigate = async (target) => {
        const started = await page.evaluate(() => performance.now());
        const before = requests.length;
        await link(target === "entries" ? "Entries" : "Summary").click();
        const ready = await waitUsable(page, target);
        return { usableMs: ready - started, apiRequests: apiDetail(requests.slice(before)) };
      };
      const priming = [await navigate("entries"), await navigate("summary")];
      const toEntries = [];
      const toSummary = [];
      for (let index = 0; index < WARM_SAMPLES_PER_DIRECTION; index += 1) {
        toEntries.push(await navigate("entries"));
        toSummary.push(await navigate("summary"));
      }
      await expect(page.getByRole("button", { name: "View entries for Bills" })).toBeEnabled();
      warm = {
        primingRoundTrip: priming,
        summaryToEntries: { ...summarizeSamples(toEntries.map((item) => item.usableMs)), rawMs: toEntries.map((item) => item.usableMs), apiRequestsPerSample: toEntries.map((item) => item.apiRequests.length) },
        entriesToSummary: { ...summarizeSamples(toSummary.map((item) => item.usableMs)), rawMs: toSummary.map((item) => item.usableMs), apiRequestsPerSample: toSummary.map((item) => item.apiRequests.length) }
      };
      expect(pageErrors).toEqual([]);
    }
    await context.close();
  }

  const report = {
    task: "H01",
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    buildId: warmupMetadata?.buildId ?? null,
    fixture: FIXTURE,
    fixtureNote: "existing demo reseed (DEMO_SEED_MONTH=2026-05); seeded once for this Worker cohort",
    browser: { engine: "chromium", version: browser.version() },
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    emulation: testInfo.project.name.includes("mobile") ? "Chromium Pixel 7 device emulation (touch, mobile UA); not a physical device" : "Chromium desktop viewport",
    profile,
    route: SUMMARY_URL,
    cacheState: {
      cold: "fresh browser context per sample (empty HTTP cache); Worker isolate already warm",
      warm: "same page after 30 s idle; loaded chunks and query cache reused"
    },
    cold: { ...summarizeSamples(coldSamples.map((item) => item.usableMs)), samples: coldSamples },
    warm,
    idleAfterFirstColdLoad: idle,
    notMeasured: {
      coldWorkerIsolate: "Worker is not restarted between samples; cold-isolate cost is outside this harness",
      webkit: "CDP throttling is Chromium-only; WebKit runs are not part of this harness",
      physicalDevice: "emulation only; no battery, thermal or radio behaviour",
      byteSource: "Playwright request.sizes() (headers + encoded body as seen by Chromium); not a wire capture"
    }
  };
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-${testInfo.project.name}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Performance report: ${outputFile}`);
  console.log(JSON.stringify({ project: testInfo.project.name, coldMedianMs: report.cold.medianMs, coldP95Ms: report.cold.p95Ms, toEntriesMedianMs: warm.summaryToEntries.medianMs, toEntriesP95Ms: warm.summaryToEntries.p95Ms, toSummaryMedianMs: warm.entriesToSummary.medianMs, toSummaryP95Ms: warm.entriesToSummary.p95Ms, idle30s: idle["30s"].byType }));
});
