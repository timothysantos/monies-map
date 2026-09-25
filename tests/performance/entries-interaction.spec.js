import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installReactCommitCounter } from "../support/react-commit-counter.js";
import { summarizeSamples } from "./performance-stats.mjs";

// Interaction latency on the 2,000-row Entries month (scale-10k, 2026-05).
// Like the other harness specs it records and never asserts timing, so noise
// cannot fail it and budgets cannot be inflated to pass it. It asserts only
// that the harness is valid: the large month is on screen and every
// interaction reached its visible end state.
//
// Per interaction it records two times, both from the page's own clock:
// - settledMs: first trusted input event to the first animation frame whose
//   DOM shows the interaction's end state (includes any deferred render).
// - eventMs: the longest Event Timing entry of that input (what INP reads:
//   input delay + handlers + next paint). Entries under the browser's 16 ms
//   floor are not reported, so they count as 0 here.
// A separate single pass per interaction counts React commits and row renders
// with tests/support/react-commit-counter.js; the counter is off while timing.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_INTERACTION_SAMPLES ?? 8);
const ENTRIES_URL = "/entries?view=household&month=2026-05";
const LARGE_MONTH_FIXTURE_ROWS = 2_000;
const READY_TIMEOUT_MS = 60_000;
const SETTLE_TIMEOUT_MS = 20_000;
// Event Timing entries are delivered after the next paint; give them a beat.
const EVENT_FLUSH_MS = 150;
const ROW_CLASSES = ["entry-row"];

// CPU presets match built-client.spec.js. Interactions run with warm data, so
// network emulation is not applied.
const PROFILES = {
  desktop: { label: "desktop: CPU 1x", cpuRate: 1 },
  mobile: { label: "mobile: CPU 4x", cpuRate: 4 }
};

function contextOptions(use) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = use;
  return { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

function installInteractionProbe() {
  const probe = { firstInputAt: null, events: [] };
  window.__interactionProbe = probe;
  const markInput = (event) => {
    if (event.isTrusted && probe.firstInputAt == null) probe.firstInputAt = event.timeStamp;
  };
  for (const type of ["pointerdown", "mousedown", "keydown", "touchstart"]) {
    window.addEventListener(type, markInput, { capture: true, passive: true });
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.events.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration, interactionId: entry.interactionId ?? 0 });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
    probe.eventTimingSupported = true;
  } catch {
    probe.eventTimingSupported = false;
  }
}

async function beginInteraction(page) {
  await page.evaluate(() => {
    window.__interactionProbe.firstInputAt = null;
    window.__interactionProbe.events = [];
  });
}

async function endInteraction(page, settledAt) {
  await page.waitForTimeout(EVENT_FLUSH_MS);
  return page.evaluate((settled) => {
    const { firstInputAt, events } = window.__interactionProbe;
    const related = events.filter((entry) => firstInputAt != null && entry.startTime >= firstInputAt - 1);
    return {
      settledMs: firstInputAt == null ? null : settled - firstInputAt,
      eventMs: related.reduce((max, entry) => Math.max(max, entry.duration), 0),
      events: related.map((entry) => `${entry.name}:${entry.duration}`)
    };
  }, settledAt);
}

// Runs one interaction: act() dispatches real input through Playwright, then
// the in-page predicate is polled once per animation frame and returns the
// frame's performance.now() when the end state is visible.
// With count set, the React commit counter runs for just this input and its
// settle window.
async function measure(page, act, predicate, arg, { count = false } = {}) {
  await beginInteraction(page);
  if (count) await page.evaluate(() => { window.__reactCommitCounter.reset(); window.__reactCommitCounter.enabled = true; });
  await act();
  const handle = await page.waitForFunction(predicate, arg, { polling: "raf", timeout: SETTLE_TIMEOUT_MS });
  const result = await endInteraction(page, await handle.jsonValue());
  if (count) {
    result.renders = await page.evaluate(() => {
      window.__reactCommitCounter.enabled = false;
      return window.__reactCommitCounter.read();
    });
  }
  return result;
}

const rowCount = () => document.querySelectorAll(".entry-row").length;

const PREDICATES = {
  rowsBelow: (limit) => (document.querySelectorAll(".entry-row").length < limit ? performance.now() : false),
  rowsExactly: (count) => (document.querySelectorAll(".entry-row").length === count ? performance.now() : false),
  editorOpen: (mobile) => {
    const open = mobile
      ? document.querySelector(".entry-mobile-sheet textarea")
      : document.querySelector(".entry-inline-editor textarea");
    return open ? performance.now() : false;
  },
  editorClosed: () => (!document.querySelector(".entry-inline-editor, .entry-mobile-sheet") ? performance.now() : false),
  noteEndsWith: ({ mobile, text }) => {
    const scope = document.querySelector(mobile ? ".entry-mobile-sheet" : ".entry-inline-editor");
    const note = scope?.querySelectorAll("textarea")[1];
    return note && note.value.endsWith(text) ? performance.now() : false;
  },
  moneyShown: (shown) => {
    const amount = document.querySelector(".entry-row .entry-row-amount strong")?.textContent ?? "";
    return (shown ? amount !== "••••" && amount.includes("$") : amount === "••••") ? performance.now() : false;
  }
};

test("Entries interactions on the 2,000-row month", async ({ browser }, testInfo) => {
  test.skip(FIXTURE !== "scale-10k", "the 2,000-row month exists only in the scale-10k fixture");
  const mobile = testInfo.project.name.includes("mobile");
  const profile = mobile ? PROFILES.mobile : PROFILES.desktop;
  const context = await browser.newContext(contextOptions(testInfo.project.use));
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(installReactCommitCounter);
  await page.addInitScript(installInteractionProbe);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });

  await page.goto(ENTRIES_URL);
  await page.waitForFunction((minimum) => document.querySelectorAll(".entry-row").length >= minimum, LARGE_MONTH_FIXTURE_ROWS, { timeout: READY_TIMEOUT_MS });
  await page.evaluate((classes) => window.__reactCommitCounter.trackRows(classes), ROW_CLASSES);
  const totalRows = await page.evaluate(rowCount);
  expect(totalRows).toBeGreaterThanOrEqual(LARGE_MONTH_FIXTURE_ROWS);
  const eventTimingSupported = await page.evaluate(() => window.__interactionProbe.eventTimingSupported);

  const targetRow = page.locator(".entry-row").nth(10);
  const targetRowId = await targetRow.getAttribute("id");
  // Mobile keeps the filter bar in the View and scope sheet.
  const filterScope = mobile ? page.locator(".mobile-context-dialog") : page.locator(".entries-filter-bar").first();
  const search = filterScope.locator(".search-filter-input");
  const privacyToggle = page.locator(".totals-visibility-toggle:visible").first();

  async function openFilters() {
    if (!mobile) return;
    await page.locator(".mobile-context-trigger").click();
    await expect(search).toBeVisible();
  }
  async function closeFilters() {
    if (!mobile) return;
    await page.locator(".mobile-context-dialog-close").click();
    await expect(search).toBeHidden();
  }

  let counting = false;
  const timed = (act, predicate, arg) => measure(page, act, predicate, arg, { count: counting });
  const INTERACTIONS = {
    // One keystroke that narrows the list, then one that restores it.
    searchType: async () => {
      await openFilters();
      await search.click();
      return timed(() => page.keyboard.type("9"), PREDICATES.rowsBelow, totalRows);
    },
    searchClear: async () => {
      const result = await timed(() => page.keyboard.press("Backspace"), PREDICATES.rowsExactly, totalRows);
      await closeFilters();
      return result;
    },
    categoryOn: async () => {
      await openFilters();
      await filterScope.locator(".entries-filter-multiselect-trigger").nth(1).click();
      const option = mobile
        ? page.locator(".mobile-select-option").filter({ hasText: "Groceries" })
        : page.locator(".entries-filter-multiselect-option").filter({ hasText: "Groceries" });
      return timed(() => option.click(), PREDICATES.rowsBelow, totalRows);
    },
    categoryOff: async () => {
      const option = mobile
        ? page.locator(".mobile-select-option").filter({ hasText: "Groceries" })
        : page.locator(".entries-filter-multiselect-option").filter({ hasText: "Groceries" });
      const result = await timed(() => option.click(), PREDICATES.rowsExactly, totalRows);
      if (mobile) {
        await page.locator(".mobile-select-actions").getByRole("button", { name: "Done" }).click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(option).toBeHidden();
      await closeFilters();
      return result;
    },
    openEditor: async () => timed(() => page.locator(`[id="${targetRowId}"] .entry-row-main`).click(), PREDICATES.editorOpen, mobile),
    draftKey: async () => {
      const scope = page.locator(mobile ? ".entry-mobile-sheet" : ".entry-inline-editor");
      await scope.locator("textarea").nth(1).focus();
      const text = `n${Math.random().toString(36).slice(2, 4)}`;
      // One measured keystroke after unmeasured setup keys.
      await page.keyboard.type(text.slice(0, -1));
      return timed(() => page.keyboard.type(text.slice(-1)), PREDICATES.noteEndsWith, { mobile, text });
    },
    closeEditor: async () => {
      const cancel = mobile
        ? page.locator(".entry-mobile-sheet").getByRole("button", { name: /Cancel|Close|Discard/ }).first()
        : page.getByRole("button", { name: "Cancel editing entry" });
      return timed(() => cancel.click(), PREDICATES.editorClosed);
    },
    privacyShow: async () => timed(() => privacyToggle.click(), PREDICATES.moneyShown, true),
    privacyHide: async () => timed(() => privacyToggle.click(), PREDICATES.moneyShown, false)
  };
  const SEQUENCES = [
    ["searchType", "searchClear"],
    ["categoryOn", "categoryOff"],
    ["openEditor", "draftKey", "closeEditor"],
    ["privacyShow", "privacyHide"]
  ];

  const timings = Object.fromEntries(Object.keys(INTERACTIONS).map((name) => [name, []]));
  // One unmeasured warm-up round so lazy chunks (popover, sheet) are loaded.
  for (const sequence of SEQUENCES) for (const name of sequence) await INTERACTIONS[name]();
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    for (const sequence of SEQUENCES) {
      for (const name of sequence) timings[name].push(await INTERACTIONS[name]());
    }
  }

  // Counted pass: one run of each interaction with the commit counter on.
  counting = true;
  const renders = {};
  for (const sequence of SEQUENCES) {
    for (const name of sequence) {
      const { renders: counted } = await INTERACTIONS[name]();
      renders[name] = {
        commits: counted.commits,
        componentRenders: counted.componentRenders,
        entryRowRenders: counted.rowRenders["entry-row"] ?? 0,
        targetRowRenders: (counted.rowIds["entry-row"] ?? []).filter((id) => id === targetRowId).length
      };
    }
  }
  counting = false;
  expect(await page.evaluate(rowCount)).toBe(totalRows);
  expect(pageErrors).toEqual([]);

  const actions = Object.fromEntries(Object.entries(timings).map(([name, samples]) => [name, {
    settled: summarizeSamples(samples.map((item) => item.settledMs)),
    event: summarizeSamples(samples.map((item) => item.eventMs)),
    rawSettledMs: samples.map((item) => item.settledMs),
    rawEventMs: samples.map((item) => item.eventMs)
  }]));
  const report = {
    task: "entries-interaction",
    revision: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    fixture: FIXTURE,
    route: ENTRIES_URL,
    rowsOnScreen: totalRows,
    browser: { engine: "chromium", version: browser.version() },
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    profile,
    samplesPerInteraction: SAMPLES,
    eventTimingSupported,
    actions,
    renders,
    notMeasured: {
      eventFloor: "Event Timing drops entries under 16 ms; those count as 0 in eventMs",
      physicalDevice: "Chromium emulation with CPU throttling only; not a physical device",
      scroll: "scroll jank is not sampled"
    }
  };
  const outputDirectory = process.env.PERFORMANCE_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "monies-map-performance-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${Date.now()}-entries-interaction-${testInfo.project.name}.json`);
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Performance report: ${outputFile}`);
  console.log(JSON.stringify({
    project: testInfo.project.name,
    rows: totalRows,
    settledMedianMs: Object.fromEntries(Object.entries(actions).map(([name, value]) => [name, value.settled.medianMs])),
    eventMedianMs: Object.fromEntries(Object.entries(actions).map(([name, value]) => [name, value.event.medianMs])),
    renders
  }));
  await context.close();
});
