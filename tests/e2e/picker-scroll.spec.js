import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The app's phone picker (ResponsiveSelect's sheet, also the Entries filter
// multi-select) must scroll by touch when it holds more options than fit, so
// the last wallet or category can be reached and chosen. On an iPhone the
// Wallet picker opened from the Edit entry sheet showed the first nine
// wallets and would not move: the phone layout gave every centred dialog
// `overflow: hidden` and the options list had no scroll of its own, so the
// list was cut off and the open picker's scroll lock cancelled every swipe.
//
// Transfer details, opened from the same sheet, was cut off the same way.
//
// Each case seeds or uses more than 15 options (seeded wallets sort last), swipes the list by touch
// (a real touch scroll gesture in Chromium; in WebKit, which Playwright
// cannot drive by touch, the same touch sequence must reach the list
// uncancelled and the list must scroll natively), then taps the last option
// and checks the row took it.
//
// Tagged @webkit: `npm run test:e2e:webkit` runs it in WebKit on the iPhone
// 13 profile the owner tests on.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SEEDED_WALLETS = 16;

async function seedWallets(page) {
  const stamp = Date.now();
  for (let index = 1; index <= SEEDED_WALLETS; index += 1) {
    await postJson(page, "/api/accounts/create", {
      name: `Zz Picker Wallet ${String(index).padStart(2, "0")} ${stamp}`,
      institution: "Synthetic Test Bank",
      kind: "bank",
      openingBalanceMinor: 0,
      currency: "SGD",
      ownerPersonId: "",
      isJoint: false
    });
  }
}

async function createManualEntry(page) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: `Picker scroll ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3_210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return entryId;
}

async function openEditSheet(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  return sheet;
}

// The open picker sheet named `title`, its options list and its options.
function pickerParts(page, title) {
  const dialog = page.locator(".mobile-select-dialog").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const list = dialog.locator(".mobile-select-options");
  return { dialog, list, options: list.locator(".mobile-select-option") };
}

// The touch sequence a finger makes swiping up a scroller, dispatched on its
// second child. Returns whether any listener (a scroll lock) cancelled a
// move, which is what stops a real iPhone from scrolling.
async function touchSwipeIsCancelled(scroller) {
  return scroller.evaluate((element) => {
    const target = element.querySelector(":scope > :nth-child(2)") ?? element;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    // WebKit has no Touch constructor, so the event carries plain touch
    // points with the fields scroll locks read (clientX, clientY).
    const send = (type, y) => {
      const point = { identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      const active = type === "touchend" ? [] : [point];
      Object.defineProperties(event, {
        touches: { value: active },
        targetTouches: { value: active },
        changedTouches: { value: [point] }
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const startY = rect.top + rect.height / 2;
    send("touchstart", startY);
    let cancelled = false;
    for (let step = 1; step <= 6; step += 1) {
      cancelled = send("touchmove", startY - step * 20) || cancelled;
    }
    send("touchend", startY - 120);
    return cancelled;
  });
}

// Swipes a scroller (the options list) up by touch until its end shows. Chromium runs a real
// touch scroll gesture. Playwright has no touch scrolling (or wheel) in
// mobile WebKit, so there the swipe must reach the list uncancelled (above)
// and the list itself must scroll: it moves the list's own scroll position
// as an uncancelled swipe does, and that only works when the list is a
// scroll container with more below.
async function swipeToEnd(page, browserName, list) {
  expect(await touchSwipeIsCancelled(list), "a swipe on the options list must not be cancelled").toBe(false);
  if (browserName !== "chromium") {
    const scrolled = await list.evaluate(async (element) => {
      for (let step = 0; step < 40 && element.scrollTop + element.clientHeight < element.scrollHeight - 1; step += 1) {
        element.scrollBy({ top: 120 });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return element.scrollTop;
    });
    expect(scrolled, "the options list scrolls itself").toBeGreaterThan(0);
    return;
  }
  const box = await list.boundingBox();
  const viewport = page.viewportSize();
  const x = Math.round(box.x + box.width / 2);
  // Start inside the visible part of the list.
  const startY = Math.round(Math.min(box.y + box.height, viewport.height) - 40);
  const distance = Math.round(Math.max(120, startY - Math.max(box.y, 0) - 80));
  const atEnd = () => list.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1);
  const cdp = await page.context().newCDPSession(page);
  for (let swipe = 0; swipe < 12 && !(await atEnd()); swipe += 1) {
    await cdp.send("Input.synthesizeScrollGesture", { x, y: startY, yDistance: -distance, gestureSourceType: "touch", speed: 1600 });
  }
  await cdp.detach();
}

async function expectLastOptionReachable(page, browserName, title, { minimumOptions = 15 } = {}) {
  const { dialog, list, options } = pickerParts(page, title);
  await expect(dialog).toBeVisible();
  // The screen-reader description ("Choose a value for wallet.") is announced, never shown.
  const description = dialog.getByText(/^Choose (a value|one or more values) for /);
  await expect(description).toHaveCount(1);
  const box = await description.boundingBox();
  expect(box && box.width <= 1 && box.height <= 1).toBe(true);
  expect(await options.count()).toBeGreaterThanOrEqual(minimumOptions);
  const last = options.last();
  // The list is longer than the sheet: the last option starts out of sight.
  await expect(last).not.toBeInViewport();
  await swipeToEnd(page, browserName, list);
  // (Nearly all of it: the scroll can stop a sub-pixel short.)
  await expect(last).toBeInViewport({ ratio: 0.9 });
  // The picker's title stays in place while the list scrolls under it.
  await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeInViewport();
  const label = (await last.innerText()).trim();
  await last.tap();
  await expect(dialog).toHaveCount(0);
  return label;
}

test.describe("phone pickers scroll by touch", { tag: "@webkit" }, () => {
  test.use({ ...iPhone13, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  test("Edit entry: the Wallet picker reaches and picks the last of many wallets", async ({ page, browserName }) => {
    await seedWallets(page);
    const entryId = await createManualEntry(page);
    const sheet = await openEditSheet(page, entryId);
    await sheet.getByRole("button", { name: /More details/ }).tap();
    await sheet.locator('[data-row="wallet"]').tap();
    const label = await expectLastOptionReachable(page, browserName, "Wallet");
    expect(label).toMatch(/^Zz Picker Wallet 16 /);
    await expect(sheet.locator('[data-row="wallet"]')).toContainText(label);
  });

  test("Edit entry: the Category picker reaches and picks the last category", async ({ page, browserName }) => {
    const entryId = await createManualEntry(page);
    const sheet = await openEditSheet(page, entryId);
    await sheet.locator('[data-row="category"]').tap();
    const label = await expectLastOptionReachable(page, browserName, "Category");
    await expect(sheet.locator('[data-row="category"]')).toContainText(label);
    await expect(sheet.locator(".lsd-subtitle")).toHaveText(label);
  });

  test("Ask: the card's Wallet picker reaches and picks the last wallet", async ({ page, browserName }) => {
    await seedWallets(page);
    await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
    await page.locator(".entries-fab:not(.splits-fab)").tap();
    await expect(page.locator('[data-ask-card="draft"]')).toBeVisible();
    await page.locator('[data-ask-row="wallet"]').tap();
    const label = await expectLastOptionReachable(page, browserName, "Wallet");
    await expect(page.locator('[data-ask-row="wallet"]')).toContainText(label.split(" - ")[0]);
  });

  test("Create split expense: the Category picker reaches and picks the last category", async ({ page, browserName }) => {
    await page.goto(`/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense`);
    const dialog = page.getByRole("dialog", { name: "Create split expense" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.locator('[data-row="category"]').tap();
    const label = await expectLastOptionReachable(page, browserName, "Category");
    await expect(dialog.locator('[data-row="category"]')).toContainText(label);
  });

  test("Month plan sheet: the Category picker reaches and picks the last category", async ({ page, browserName }) => {
    await gotoPageAfterApi(page, `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`, "/api/month-page", () => page.locator("tr").filter({ hasText: "Savings" }).first());
    await page.locator("tr").filter({ hasText: "Savings" }).first().getByText("Savings", { exact: true }).first().tap();
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');
    await expect(sheet).toBeVisible();
    const categoryRow = sheet.locator("label").filter({ hasText: "Category" });
    await categoryRow.locator(".responsive-select-trigger").tap();
    const label = await expectLastOptionReachable(page, browserName, "Category");
    await expect(categoryRow.locator(".responsive-select-value")).toHaveText(label);
  });

  test("Edit entry: Transfer details scrolls to its last action", async ({ page, browserName }) => {
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=txn-oct-transfer-out`);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await sheet.getByRole("button", { name: "Manage transfer" }).tap();
    const dialog = page.locator(".transfer-match-dialog");
    await expect(dialog).toBeVisible();
    const lastAction = dialog.getByRole("button").last();
    await expect(lastAction).not.toBeInViewport();
    await swipeToEnd(page, browserName, dialog);
    await expect(lastAction).toBeInViewport({ ratio: 0.9 });
    await expect(dialog.getByRole("button", { name: "Close transfer manager" })).toBeVisible();
  });
});
