import { expect, test } from "@playwright/test";
import { installReactCommitCounter } from "../support/react-commit-counter.js";
import {
  INTERACTION_PROFILES,
  contextOptions,
  gitRevision,
  installInteractionProbe,
  measureInteraction,
  summarizeInteractions,
  writeInteractionReport
} from "./interaction-probe.mjs";

// Month page "Match planned item" picker on the 2,000-row month
// (scale-10k, 2026-05). The picker scores every expense in the month
// against the planned item (981 Groceries rows match its category) and
// lists the best 80 (buildPlanLinkCandidates). Records timing and render
// counts; asserts only that the harness is valid.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const SAMPLES = Number(process.env.PERFORMANCE_INTERACTION_SAMPLES ?? 8);
const MONTH = "2026-05";
// A person's view: a direct plan row is editable there, not in the household
// view. The Month page carries all 2,018 rows of the month in either view.
const MONTH_URL = `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`;
const PLAN_ROW = {
  // A fixed id makes the save an upsert, so repeated runs reuse one row.
  rowId: "perf-plan-link-groceries",
  month: MONTH,
  sectionKey: "planned_items",
  categoryName: "Groceries",
  label: "Performance groceries plan",
  planDate: `${MONTH}-01`,
  accountName: "UOB One",
  plannedMinor: 40_000,
  note: "Performance harness plan row.",
  ownershipType: "direct",
  ownerName: "Tim"
};
// The picker's cap; fewer means the fixture did not load.
const MIN_CANDIDATES = 80;
const READY_TIMEOUT_MS = 60_000;

test("Month plan-link picker on the 2,000-row month", async ({ browser }, testInfo) => {
  test.skip(FIXTURE !== "scale-10k", "the 2,000-row month exists only in the scale-10k fixture");
  test.setTimeout(20 * 60_000);
  const mobile = testInfo.project.name.includes("mobile");
  const profile = mobile ? INTERACTION_PROFILES.mobile : INTERACTION_PROFILES.desktop;
  const context = await browser.newContext(contextOptions(testInfo.project.use));
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(installReactCommitCounter);
  await page.addInitScript(installInteractionProbe);

  const saved = await page.request.post("/api/month-plan/save", { data: PLAN_ROW });
  expect(saved.ok(), await saved.text()).toBe(true);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  await page.goto(MONTH_URL);
  const planRow = page.locator("tr").filter({ hasText: PLAN_ROW.label }).first();
  const trigger = planRow.locator(".planned-link-manage-trigger");
  await expect(trigger).toBeEnabled({ timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.__reactCommitCounter.trackRows(["planned-link-row"]));

  // Desktop uses a dialog, mobile a bottom sheet with the same content.
  const picker = mobile ? page.locator('.entry-mobile-sheet[aria-label="Match planned item"]') : page.locator(".planned-link-dialog");
  const pickerSelector = mobile ? '.entry-mobile-sheet[aria-label="Match planned item"]' : ".planned-link-dialog";
  const filter = picker.getByPlaceholder("Filter descriptions in this list");
  let candidateCount = 0;

  const PREDICATES = {
    candidatesAtLeast: ({ selector, minimum }) => (document.querySelector(selector)?.querySelectorAll(".planned-link-row").length >= minimum ? performance.now() : false),
    candidatesBelow: ({ selector, limit }) => {
      const rows = document.querySelector(selector)?.querySelectorAll(".planned-link-row").length;
      return rows != null && rows < limit ? performance.now() : false;
    },
    candidatesExactly: ({ selector, count }) => (document.querySelector(selector)?.querySelectorAll(".planned-link-row").length === count ? performance.now() : false),
    checked: ({ selector, index, checked }) => (document.querySelector(selector)?.querySelectorAll(".planned-link-row input")[index]?.checked === checked ? performance.now() : false),
    closed: (selector) => (!document.querySelector(selector) ? performance.now() : false)
  };

  let counting = false;
  const timed = (act, predicate, arg) => measureInteraction(page, act, predicate, arg, { count: counting });
  const candidate = () => picker.locator(".planned-link-row input").nth(4);
  const INTERACTIONS = {
    openPicker: async () => {
      const result = await timed(() => trigger.click(), PREDICATES.candidatesAtLeast, { selector: pickerSelector, minimum: MIN_CANDIDATES });
      candidateCount = await picker.locator(".planned-link-row").count();
      return result;
    },
    toggleOn: async () => timed(() => candidate().click(), PREDICATES.checked, { selector: pickerSelector, index: 4, checked: true }),
    toggleOff: async () => timed(() => candidate().click(), PREDICATES.checked, { selector: pickerSelector, index: 4, checked: false }),
    filterType: async () => {
      await filter.click();
      return timed(() => page.keyboard.type("9"), PREDICATES.candidatesBelow, { selector: pickerSelector, limit: candidateCount });
    },
    filterClear: async () => timed(() => page.keyboard.press("Backspace"), PREDICATES.candidatesExactly, { selector: pickerSelector, count: candidateCount }),
    closePicker: async () => timed(
      () => (mobile ? page.getByRole("button", { name: "Cancel" }).click() : page.keyboard.press("Escape")),
      PREDICATES.closed,
      pickerSelector
    )
  };
  const SEQUENCE = ["openPicker", "toggleOn", "toggleOff", "filterType", "filterClear", "closePicker"];

  const timings = Object.fromEntries(SEQUENCE.map((name) => [name, []]));
  // One unmeasured round loads the dialog code.
  for (const name of SEQUENCE) await INTERACTIONS[name]();
  expect(candidateCount).toBeGreaterThanOrEqual(MIN_CANDIDATES);
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    for (const name of SEQUENCE) timings[name].push(await INTERACTIONS[name]());
  }

  counting = true;
  const renders = {};
  for (const name of SEQUENCE) {
    const { renders: counted } = await INTERACTIONS[name]();
    renders[name] = {
      commits: counted.commits,
      componentRenders: counted.componentRenders,
      candidateRowRenders: counted.rowRenders["planned-link-row"] ?? 0
    };
  }
  counting = false;
  expect(pageErrors).toEqual([]);

  await writeInteractionReport({
    task: "month-interaction",
    ...gitRevision(),
    fixture: FIXTURE,
    route: MONTH_URL,
    candidatesOnScreen: candidateCount,
    browser: { engine: "chromium", version: browser.version() },
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    profile,
    samplesPerInteraction: SAMPLES,
    actions: summarizeInteractions(timings),
    renders,
    notMeasured: {
      eventFloor: "Event Timing drops entries under 16 ms; those count as 0 in eventMs",
      physicalDevice: "Chromium emulation with CPU throttling only; not a physical device",
      candidateRowRenders: "before the fix candidates were plain elements, so only componentRenders compares across versions"
    }
  }, "month-interaction");
  await context.close();
});
