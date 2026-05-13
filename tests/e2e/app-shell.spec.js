import { expect, test } from "@playwright/test";
import { reseedDemo } from "./helpers";

const tabExpectations = [
  { name: "Summary", heading: "Summary", exact: true },
  { name: "Month", heading: "Month", exact: true },
  { name: "Entries", heading: "Entries", exact: true },
  { name: "Splits", heading: "Splits", exact: true },
  { name: "Imports", heading: "Imports", exact: true },
  { name: "Settings", heading: "Settings", exact: true, selector: "article.settings-page h2" },
  { name: "FAQ", heading: "FAQ", exact: true }
];

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRandom(items, random) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

async function getVisibleTabIndex(page) {
  for (let index = 0; index < tabExpectations.length; index += 1) {
    const tab = tabExpectations[index];
    if (await page.getByRole("heading", { name: tab.heading, exact: tab.exact }).isVisible().catch(() => false)) {
      return index;
    }
  }

  return -1;
}

async function waitForVisibleTabIndex(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = await getVisibleTabIndex(page);
    if (index !== -1) {
      return index;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("No top-level tab heading became visible.");
}

function headingLocator(page, tab) {
  return tab.selector
    ? page.locator(tab.selector)
    : page.getByRole("heading", { name: tab.heading, exact: tab.exact });
}

// Derive the legal next directions from the current page before randomizing so
// the walk stays reproducible and never clicks an impossible shell link.
function getAvailableTransitions(currentIndex, visitedIndices) {
  return tabExpectations
    .map((tab, index) => ({ tab, index }))
    .filter(({ index }) => index !== currentIndex && !visitedIndices.has(index));
}

test("app shell request stays shell-only", async ({ page }) => {
  await reseedDemo(page);

  const response = await page.request.get("/api/app-shell");
  expect(response.ok(), await response.text()).toBeTruthy();

  const shell = await response.json();

  expect(shell.availableViewIds).toContain("household");
  expect(shell.trackedMonths.length).toBeGreaterThan(0);
  expect(shell.household.people.length).toBeGreaterThan(0);
  expect(shell.accounts.length).toBeGreaterThan(0);
  expect(shell.categories.length).toBeGreaterThan(0);
  expect(shell.views).toBeUndefined();
  expect(shell.importsPage).toBeUndefined();
  expect(shell.settingsPage).toBeUndefined();
});

test("route transitions keep the previous screen visible until the next page settles", async ({ page }) => {
  await reseedDemo(page);
  await page.goto("/summary?view=person-tim&month=2026-04&summary_start=2025-06&summary_end=2026-04");
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

  await page.route("**/api/entries-page**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  await page.getByRole("link", { name: "Entries" }).click();

  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page).toHaveURL(/\/entries\?/);
  const entries = await page.request.get("/api/entries-page?view=person-tim&month=2026-04");
  expect(entries.ok(), await entries.text()).toBeTruthy();
});

test("month to summary keeps summary stable after the month route resolves", async ({ page }) => {
  await reseedDemo(page);
  await page.goto("/month?view=person-tim&month=2026-04");
  await expect(page).toHaveURL(/\/month\?/);

  await page.getByRole("link", { name: "Summary", exact: true }).click();

  await expect(page).toHaveURL(/\/summary\?/);
  const summary = await page.request.get("/api/summary-page?view=person-tim&month=2026-04&scope=direct_plus_shared&startMonth=2025-06&endMonth=2026-04");
  expect(summary.ok(), await summary.text()).toBeTruthy();
});

test("summary month round trip stays hydrated after month navigation", async ({ page }) => {
  await reseedDemo(page);
  await page.goto("/summary?view=person-tim&month=2026-04&summary_start=2025-06&summary_end=2026-04");
  await expect(page).toHaveURL(/\/summary\?/);

  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page).toHaveURL(/\/month\?/);

  await page.getByRole("link", { name: "Summary", exact: true }).click();
  await expect(page).toHaveURL(/\/summary\?/);
  const summary = await page.request.get("/api/summary-page?view=person-tim&month=2026-04&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-04");
  expect(summary.ok(), await summary.text()).toBeTruthy();
});

test("every top-level tab renders without crashing", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });

  await reseedDemo(page);
  await page.goto("/");
  const rng = createSeededRandom(20260509);
  const startIndex = await waitForVisibleTabIndex(page);
  const visitedIndices = new Set([startIndex]);
  let currentIndex = startIndex;

  await expect(headingLocator(page, tabExpectations[startIndex])).toBeVisible({ timeout: 10_000 });

  while (visitedIndices.size < tabExpectations.length) {
    const availableTransitions = getAvailableTransitions(currentIndex, visitedIndices);
    const randomizedTransitions = shuffleWithRandom(availableTransitions, rng);
    let nextTransition = randomizedTransitions[0];

    if (tabExpectations[currentIndex].name === "Entries") {
      nextTransition = availableTransitions.find(({ tab }) => tab.name === "Month") ?? nextTransition;
    }

    if (!nextTransition) {
      break;
    }

    const nextTab = nextTransition.tab;
    const shouldPauseBeforeClick = visitedIndices.size % 2 === 0 || rng() < 0.35;
    if (shouldPauseBeforeClick) {
      await page.waitForTimeout(150 + Math.floor(rng() * 250));
    }

    await page.getByRole("link", { name: nextTab.name, exact: true }).click();

    const shouldPauseAfterClick = visitedIndices.size % 2 === 1 || rng() < 0.35;
    if (shouldPauseAfterClick) {
      await page.waitForTimeout(100 + Math.floor(rng() * 200));
    }

    await expect(headingLocator(page, nextTab)).toBeVisible({ timeout: 10_000 });
    visitedIndices.add(nextTransition.index);
    currentIndex = nextTransition.index;
  }

  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
