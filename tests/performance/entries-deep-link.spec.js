import { expect, test } from "@playwright/test";

// Opening an entry far down the 2,000-row month (a deep link with
// editing_entry, as the mobile sheet and cross-page links use) must bring it
// on screen at the same place as a short scroll. Off-screen rows use an
// estimated height until they render (content-visibility), so a long smooth
// scroll used to end hundreds of pixels off target. This asserts position,
// not timing.

const FIXTURE = process.env.PERFORMANCE_FIXTURE || "demo";
const ENTRIES_URL = "/entries?view=household&month=2026-05";
const READY_TIMEOUT_MS = 60_000;
// Where the scroll helpers in entries-list.jsx aim: the inline editor is
// centred on desktop; the mobile row sits under the 82 px sticky header.
const TOLERANCE_PX = 4;

async function waitForMonth(page) {
  await page.waitForFunction(() => document.querySelectorAll(".entry-row").length >= 2000, undefined, { timeout: READY_TIMEOUT_MS });
}

async function rowBox(page, id) {
  return page.evaluate((rowId) => {
    const box = document.getElementById(rowId).getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
  }, id);
}

test("a deep-linked entry far down the month opens on screen where a near one does", async ({ page }, testInfo) => {
  test.skip(FIXTURE !== "scale-10k", "the 2,000-row month exists only in the scale-10k fixture");
  test.setTimeout(5 * 60_000);
  const mobile = testInfo.project.name.includes("mobile");
  await page.goto(ENTRIES_URL);
  await waitForMonth(page);
  const ids = await page.locator(".entry-row").evaluateAll((rows) => [5, 1500, 1990].map((index) => rows[index].id));

  const positions = [];
  for (const id of ids) {
    await page.goto(`${ENTRIES_URL}&editing_entry=${id}`);
    await waitForMonth(page);
    await expect(page.locator(`[id="${id}"]`)).toHaveClass(/is-editing/);
    // The scroll retries run for about half a second; wait for them to settle.
    await expect.poll(async () => (await rowBox(page, id)).top, { timeout: 10_000, intervals: [250] }).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(1500);
    positions.push(await rowBox(page, id));
  }

  const [near, ...far] = positions;
  expect(near.top).toBeGreaterThanOrEqual(0);
  expect(near.bottom).toBeLessThanOrEqual(near.viewportHeight);
  if (mobile) expect(Math.abs(near.top - 82)).toBeLessThanOrEqual(TOLERANCE_PX);
  for (const box of far) {
    expect(Math.abs(box.top - near.top)).toBeLessThanOrEqual(TOLERANCE_PX);
  }
});
