import { expect, test } from "@playwright/test";
import { installReactCommitCounter } from "../support/react-commit-counter.js";
import {
  INTERACTION_PROFILES as PROFILES,
  contextOptions,
  gitRevision,
  installInteractionProbe,
  measureInteraction as measure,
  summarizeInteractions,
  writeInteractionReport
} from "./interaction-probe.mjs";

// Interaction latency on the 2,000-row Entries month (scale-10k, 2026-05).
// Like the other harness specs it records and never asserts timing, so noise
// cannot fail it and budgets cannot be inflated to pass it. It asserts only
// that the harness is valid: the large month is on screen and every
// interaction reached its visible end state. What settledMs and eventMs mean
// is described in interaction-probe.mjs. A separate single pass per
// interaction counts React commits and row renders.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_INTERACTION_SAMPLES ?? 8);
// off | intent-only | normal (absent = normal), as in built-client.spec.js.
const WARMUP_MODE = process.env.PERFORMANCE_WARMUP_MODE || "normal";
const ENTRIES_URL = "/entries?view=household&month=2026-05";
const LARGE_MONTH_FIXTURE_ROWS = 2_000;
const READY_TIMEOUT_MS = 60_000;
const ROW_CLASSES = ["entry-row"];

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
  // A 4x-throttled 2,000-row run takes minutes; the timing itself is unbounded.
  test.setTimeout(20 * 60_000);
  const mobile = testInfo.project.name.includes("mobile");
  const profile = mobile ? PROFILES.mobile : PROFILES.desktop;
  const context = await browser.newContext(contextOptions(testInfo.project.use));
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(installReactCommitCounter);
  await page.addInitScript(installInteractionProbe);
  if (WARMUP_MODE !== "normal") {
    await page.addInitScript((mode) => { window.__MONIES_MAP_WARMUP_MODE__ = mode; }, WARMUP_MODE);
  }
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
  // PERFORMANCE_INTERACTIONS=search,category,editor,privacy narrows a
  // diagnostic run; cohorts use all four.
  const ALL_SEQUENCES = {
    search: ["searchType", "searchClear"],
    category: ["categoryOn", "categoryOff"],
    editor: ["openEditor", "draftKey", "closeEditor"],
    privacy: ["privacyShow", "privacyHide"]
  };
  const SEQUENCES = (process.env.PERFORMANCE_INTERACTIONS ?? Object.keys(ALL_SEQUENCES).join(","))
    .split(",")
    .map((key) => ALL_SEQUENCES[key.trim()])
    .filter(Boolean);

  const timings = Object.fromEntries(SEQUENCES.flat().map((name) => [name, []]));
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

  await writeInteractionReport({
    task: "entries-interaction",
    ...gitRevision(),
    fixture: FIXTURE,
    warmupMode: WARMUP_MODE,
    route: ENTRIES_URL,
    rowsOnScreen: totalRows,
    browser: { engine: "chromium", version: browser.version() },
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    profile,
    samplesPerInteraction: SAMPLES,
    eventTimingSupported,
    actions: summarizeInteractions(timings),
    renders,
    notMeasured: {
      eventFloor: "Event Timing drops entries under 16 ms; those count as 0 in eventMs",
      physicalDevice: "Chromium emulation with CPU throttling only; not a physical device",
      scroll: "scroll jank is not sampled"
    }
  }, "entries-interaction");
  await context.close();
});
