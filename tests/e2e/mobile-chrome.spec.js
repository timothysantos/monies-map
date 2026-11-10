import { expect, test } from "@playwright/test";

import { getPersonColourVars } from "../../src/client/person-colour.js";
import { reseedDemo } from "./helpers";

// The phone chrome in the Lead · Support · Detail hierarchy (design.md,
// "Phone Chrome"):
// - the floating View and scope bar is one calm Support bar: the person's
//   chip in their colour, the scope as a quiet label and the month control
//   as a chip, on one row with 44 px targets, on Summary, Month and Entries;
// - its sheet leads with who you are viewing, then the view and scope as
//   segmented chips, the Entries filters as quiet rows that open the same
//   pickers, and Reset and Done in a bar at the bottom; it swipes down to
//   close;
// - the tab bar, More pages, the round buttons and the Pick a month sheet
//   share the same chrome tokens.
// Every choice still sets exactly the URL params it set before.
//
// Tagged @webkit: `npm run test:e2e:webkit` runs them in WebKit on an
// iPhone 13 profile too (the narrowest phone, 375 px, is set below).

const PHONE = { width: 375, height: 667 };
const MONTH = "2026-05";

test.use({ hasTouch: true });

async function phone(page, { hidden = false } = {}) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
  await page.setViewportSize(PHONE);
  await reseedDemo(page);
}

async function openUsable(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 60_000 }).toBe(true);
  await expect(page.locator(".mobile-context-sticky-bar")).toBeVisible();
}

function params(page) {
  return Object.fromEntries([...new URL(page.url()).searchParams.keys()].map((key) => [key, new URL(page.url()).searchParams.getAll(key).join(",")]));
}

// Every visible button (and text field) inside `root` is at least 44 x 44.
async function smallTargets(root) {
  return root.evaluate((element) => [...element.querySelectorAll("button, input:not([type='hidden']), [role='button']")]
    .filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden")
    .map((node) => ({ name: node.getAttribute("aria-label") || node.textContent.trim() || node.className, box: node.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 2 && (box.width < 44 || box.height < 44))
    .map(({ name, box }) => `${name}: ${Math.round(box.width)}x${Math.round(box.height)}`));
}

// Text that wrapped onto a second line or was cut short.
async function wrappedOrClipped(root, selector) {
  return root.evaluate((element, selector) => [...element.querySelectorAll(selector)]
    .filter((node) => node.getClientRects().length && !node.classList.contains("is-screen-reader-only"))
    .filter((node) => {
      const style = getComputedStyle(node);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.3;
      const textHeight = node.getBoundingClientRect().height - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
      return node.scrollWidth > node.clientWidth + 1 || textHeight > lineHeight * 1.6;
    })
    .map((node) => `${node.className}: ${node.textContent.trim()}`), selector);
}

async function noHorizontalOverflow(page) {
  const fit = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(fit.width).toBeLessThanOrEqual(fit.viewport);
}

async function chromeToken(page, name) {
  return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

async function style(locator, property) {
  return locator.evaluate((element, name) => getComputedStyle(element)[name], property);
}

/**
 * A one-finger drag dispatched as TouchEvents from `from` (viewport px)
 * down by `distance` in ten steps, then a rest and the release (the same
 * TouchEvents as sheet-swipe-dismiss.spec.js: WebKit cannot drive a real
 * touch drag).
 */
function dragDown(page, { from, distance, restMs = 140 }) {
  return page.evaluate(async ({ from, distance, restMs }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const target = document.elementFromPoint(from.x, from.y);
    const canConstructTouch = (() => {
      try {
        return Boolean(new Touch({ identifier: 0, target }));
      } catch {
        return false;
      }
    })();
    const touchAt = (x, y) => canConstructTouch
      ? new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y })
      : document.createTouch(window, target, 7, x + window.scrollX, y + window.scrollY, x, y);
    const list = (...touches) => canConstructTouch ? touches : document.createTouchList(...touches);
    const fire = (type, touch, active) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: active ? list(touch) : list(),
      targetTouches: active ? list(touch) : list(),
      changedTouches: list(touch)
    }));
    fire("touchstart", touchAt(from.x, from.y), true);
    let y = from.y;
    for (let step = 0; step < 10; step += 1) {
      await wait(20);
      y += distance / 10;
      fire("touchmove", touchAt(from.x, y), true);
    }
    await wait(restMs);
    fire("touchend", touchAt(from.x, y), false);
  }, { from, distance, restMs });
}

test.describe("phone chrome in the Lead · Support · Detail hierarchy", { tag: "@webkit" }, () => {
  test("the floating bar is one Support bar on Summary, Month and Entries: person chip, quiet scope, month chip", async ({ page }) => {
    await phone(page);
    const pages = [
      { url: `/summary?view=person-tim&month=${MONTH}&scope=direct_plus_shared`, person: "Tim", scope: "Direct + Shared", month: /All months/ },
      { url: `/month?view=person-joyce&month=${MONTH}&scope=shared`, person: "Joyce", scope: "Shared", month: /May 2026/ },
      { url: `/entries?view=person-tim&month=${MONTH}&entries_scope=direct`, person: "Tim", scope: "Direct", month: null },
      { url: `/month?view=household&month=${MONTH}`, person: null, scope: null, month: /May 2026/ }
    ];

    for (const { url, person, scope, month } of pages) {
      await openUsable(page, url);
      const bar = page.locator(".mobile-context-sticky-bar");
      const trigger = bar.locator(".mobile-context-trigger");
      const chip = trigger.locator(".mobile-context-person-chip");

      // Who: the person's chip in their colour (the Entries row colour);
      // the household gets a neutral chip.
      if (person) {
        await expect(chip, url).toHaveText(person);
        expect(await chip.evaluate((element) => element.style.getPropertyValue("--person-colour")), url).toBe(getPersonColourVars(person)["--person-colour"]);
        await expect(trigger.locator(".mobile-context-scope"), url).toHaveText(scope);
        // A screen reader hears what it heard before.
        await expect(trigger, url).toHaveAccessibleName(`${person} · ${scope} View and scope`);
      } else {
        await expect(chip, url).toHaveText("Household");
        await expect(chip, url).toHaveClass(/is-household/);
        expect(await chip.evaluate((element) => element.style.getPropertyValue("--person-colour")), url).toBe("");
        await expect(trigger.locator(".mobile-context-scope"), url).toHaveCount(0);
        await expect(trigger, url).toHaveAccessibleName("Household View");
      }
      // The month control is a chip in the same bar (Summary tab), or the
      // month arrows (Entries).
      if (month) {
        await expect(bar.locator(".mobile-month-chip"), url).toHaveText(month);
      } else {
        await expect(bar.getByRole("button", { name: "Previous period" }), url).toBeVisible();
        await expect(bar.getByRole("button", { name: "Next period" }), url).toBeVisible();
      }

      // One bar: one surface with the chrome radius and shadow, nothing
      // inside it floats on its own.
      expect(await style(bar, "borderTopLeftRadius"), url).toBe(await chromeToken(page, "--chrome-radius"));
      expect(await style(bar, "boxShadow"), url).not.toBe("none");
      for (const child of await bar.locator(":scope > *").all()) {
        expect(await style(child, "boxShadow"), url).toBe("none");
      }
      const barBox = await bar.boundingBox();
      expect(barBox.height, url).toBeLessThanOrEqual(48);
      expect(barBox.x, url).toBeGreaterThanOrEqual(12 - 0.5);
      expect(barBox.x + barBox.width, url).toBeLessThanOrEqual(PHONE.width - 12 + 0.5);

      // No wrapping and nothing cut short; every target 44 px or more.
      expect(await wrappedOrClipped(bar, ".mobile-context-person-chip, .mobile-context-scope, .mobile-month-chip, .mobile-context-trigger-label"), url).toEqual([]);
      expect(await smallTargets(bar), url).toEqual([]);
      await noHorizontalOverflow(page);

      // The money toggle floats above the bar, not over it.
      const toggleBox = await page.locator(".totals-visibility-toggle--floating").boundingBox();
      expect(toggleBox.y + toggleBox.height, url).toBeLessThanOrEqual(barBox.y);
    }
  });

  test("the View and scope sheet leads with who you are viewing, then the chips, the filter rows and Done at the bottom", async ({ page }) => {
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared`);
    await page.locator(".mobile-context-trigger").click();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".sheet-drag-handle")).toBeVisible();

    // Lead: the person, large, with the scope and what it counts.
    const lead = sheet.locator(".mobile-context-lead");
    const leadChip = lead.locator(".mobile-context-person-chip");
    await expect(leadChip).toHaveText("Tim");
    expect(await leadChip.evaluate((element) => element.style.getPropertyValue("--person-colour"))).toBe(getPersonColourVars("Tim")["--person-colour"]);
    await expect(lead).toContainText("Direct + Shared");
    await expect(lead).toContainText("Tim's entries plus their share of split expenses.");
    const islandChipSize = Number.parseFloat(await style(page.locator(".mobile-context-sticky-bar .mobile-context-person-chip"), "fontSize"));
    expect(Number.parseFloat(await style(leadChip, "fontSize"))).toBeGreaterThan(islandChipSize);

    // Support: the view and the scope as segmented chips.
    const view = sheet.getByRole("group", { name: "View" });
    const scope = sheet.getByRole("group", { name: "Scope" });
    await expect(view.getByRole("button")).toHaveText(["Household", "Tim", "Joyce"]);
    await expect(view.getByRole("button", { name: "Tim" })).toHaveAttribute("aria-pressed", "true");
    await expect(view.getByRole("button", { name: "Joyce" })).toHaveAttribute("aria-pressed", "false");
    await expect(scope.getByRole("button")).toHaveText(["Direct ownership", "Shared", "Direct + Shared"]);
    await expect(scope.getByRole("button", { name: "Direct + Shared" })).toHaveAttribute("aria-pressed", "true");

    // Detail: the filters as quiet rows, one group of 44 px rows.
    const rows = sheet.locator(".mobile-context-filters .entries-filter");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1)).toContainText("All wallets");
    await expect(rows.nth(2)).toContainText("All categories");
    await expect(rows.nth(3)).toContainText("All types");
    await expect(rows.nth(4)).toContainText("All trips & events");
    for (const row of await rows.all()) {
      expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }

    // The order on screen, top to bottom, and Done under the thumb.
    const order = await Promise.all([lead, view, scope, rows.first(), sheet.getByRole("button", { name: "Done", exact: true })]
      .map(async (locator) => (await locator.boundingBox()).y));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await expect(sheet.getByRole("button", { name: "Done", exact: true })).toHaveCount(1);
    const done = await sheet.getByRole("button", { name: "Done", exact: true }).boundingBox();
    const reset = await sheet.getByRole("button", { name: "Reset filters" }).boundingBox();
    expect(done.y + done.height).toBeGreaterThan(PHONE.height - 80);
    expect(done.x).toBeGreaterThan(reset.x);
    expect(await smallTargets(sheet)).toEqual([]);
    await noHorizontalOverflow(page);
    expect(await style(sheet, "borderTopLeftRadius")).toBe(await chromeToken(page, "--sheet-radius"));

    // Month and Summary have no filters: Done alone in the bar.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await openUsable(page, `/month?view=household&month=${MONTH}`);
    await page.locator(".mobile-context-trigger").click();
    await expect(sheet.locator(".mobile-context-lead .mobile-context-person-chip")).toHaveText("Household");
    await expect(sheet.getByRole("group", { name: "Scope" })).toHaveCount(0);
    await expect(sheet.locator(".mobile-context-filters")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Reset filters" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  });

  // The same steps pass on the sheet before this change: the view, scope
  // and every filter set exactly the URL params they set before.
  test("view, scope and filters set exactly the URL params they set before", async ({ page }) => {
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared`);
    const sheet = page.locator(".mobile-context-dialog");
    const filter = (label) => sheet.locator(".entries-filter").filter({ hasText: label });
    const base = { view: "person-joyce", month: MONTH, entries_scope: "direct_plus_shared" };

    await page.locator(".mobile-context-trigger").click();
    await expect(sheet).toBeVisible();
    // A person keeps the sheet open.
    await sheet.getByRole("button", { name: "Joyce", exact: true }).click();
    await expect.poll(() => params(page)).toEqual(base);
    await expect(sheet).toBeVisible();

    await filter("By wallet").getByRole("button").click();
    const walletPicker = page.getByRole("dialog", { name: "By wallet" });
    const walletOption = walletPicker.locator(".mobile-select-option").first();
    const walletName = (await walletOption.textContent()).trim();
    await walletOption.click();
    await walletPicker.getByRole("button", { name: "Done" }).click();
    await expect(walletPicker).toHaveCount(0);
    await expect(filter("By wallet")).toContainText(walletName);
    await expect.poll(() => params(page).entry_wallet ?? "").not.toBe("");
    const walletId = params(page).entry_wallet;

    await filter("By category").getByRole("button").click();
    const categoryPicker = page.getByRole("dialog", { name: "By category" });
    await categoryPicker.locator("[data-category-option='Groceries']").click();
    await categoryPicker.getByRole("button", { name: "Done" }).click();
    await expect(categoryPicker).toHaveCount(0);

    await filter("By type").getByRole("button").click();
    await page.getByRole("dialog", { name: "By type" }).locator(".mobile-select-option").filter({ hasText: /^expense$/ }).click();
    await expect(page.getByRole("dialog", { name: "By type" })).toHaveCount(0);

    await sheet.locator(".search-filter input").fill("fairprice");
    await expect.poll(() => params(page)).toEqual({
      ...base, entry_wallet: walletId, entry_category: "Groceries", entry_type: "expense", entry_search: "fairprice"
    });

    // Reset clears every filter and keeps the sheet open.
    await sheet.getByRole("button", { name: "Reset filters" }).click();
    await expect.poll(() => params(page)).toEqual(base);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".search-filter input")).toHaveValue("");
    await expect(filter("By wallet")).not.toContainText(walletName);

    // A scope applies and closes the sheet.
    await sheet.getByRole("button", { name: "Shared", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => params(page)).toEqual({ ...base, entries_scope: "shared" });

    // Done closes and changes nothing.
    await page.locator(".mobile-context-trigger").click();
    await sheet.getByRole("button", { name: "Done", exact: true }).last().click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => params(page)).toEqual({ ...base, entries_scope: "shared" });

    // Household closes the sheet and resets the Entries scope.
    await page.locator(".mobile-context-trigger").click();
    await sheet.getByRole("button", { name: "Household", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => params(page)).toEqual({ ...base, view: "household", entries_scope: "direct_plus_shared" });

    // Summary's scope uses its own param.
    await openUsable(page, `/summary?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await page.locator(".mobile-context-trigger").click();
    await sheet.getByRole("button", { name: "Direct ownership", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => params(page)).toEqual({ view: "person-tim", month: MONTH, scope: "direct" });
  });

  // The URL changes at once on Reset filters, but the page re-renders a
  // moment later (about 120 ms on a slow machine). A scope tapped in between
  // used to build its URL from the last render's params (react-router's
  // functional setSearchParams) and bring the cleared filters back. The
  // setters now build on the URL as it is (use-live-search-params.js).
  test("a scope tapped straight after Reset filters keeps the filters cleared", async ({ page }) => {
    await phone(page);
    const base = { view: "person-joyce", month: MONTH, entries_scope: "direct_plus_shared" };
    const filtered = { ...base, entry_category: "Groceries", entry_type: "expense", entry_search: "fairprice" };
    await openUsable(page, `/entries?${new URLSearchParams(filtered).toString()}`);
    const sheet = page.locator(".mobile-context-dialog");
    await page.locator(".mobile-context-trigger").click();
    await expect(sheet.locator(".search-filter input")).toHaveValue("fairprice");

    // Both taps in the same moment, with no render in between: the slowest
    // phone's worst case, every time. The Reset tap writes the URL at once;
    // the scope tap must build on that URL, not on the params the page last
    // drew.
    await expect(sheet.getByRole("button", { name: "Shared", exact: true })).toBeVisible();
    const urlBetween = await page.evaluate(() => {
      const dialog = document.querySelector(".mobile-context-dialog");
      const button = (name) => [...dialog.querySelectorAll("button")].find((item) => item.textContent.trim() === name);
      button("Reset filters").click();
      const between = window.location.search;
      button("Shared").click();
      return between;
    });
    expect(Object.fromEntries(new URLSearchParams(urlBetween)), "Reset wrote the URL before any render").toEqual(base);

    await expect(sheet).toHaveCount(0);
    await expect.poll(() => params(page)).toEqual({ ...base, entries_scope: "shared" });
    // And the page draws them cleared once it catches up.
    await page.locator(".mobile-context-trigger").click();
    await expect(sheet.locator(".search-filter input")).toHaveValue("");
    await expect(sheet.locator(".entries-filter").filter({ hasText: "By category" })).not.toContainText("Groceries");
    expect(params(page)).toEqual({ ...base, entries_scope: "shared" });
  });

  test("the sheet swipes down to close; a short drag springs back", async ({ page }) => {
    await phone(page);
    const url = `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`;
    await openUsable(page, url);
    await page.locator(".mobile-context-trigger").click();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet).toBeVisible();
    const before = params(page);

    const box = await sheet.boundingBox();
    const handle = { x: box.x + box.width / 2, y: box.y + 8 };
    // A short drag is not a dismissal (negative case).
    await dragDown(page, { from: handle, distance: 40 });
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();

    await dragDown(page, { from: handle, distance: 260 });
    await expect(sheet).toHaveCount(0);
    expect(params(page)).toEqual(before);
    await expect(page.locator(".mobile-context-sticky-bar")).toBeVisible();
  });

  test("hidden money: the bar and the sheet look the same and show no money", async ({ page }) => {
    await phone(page, { hidden: true });
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared`);
    const bar = page.locator(".mobile-context-sticky-bar");
    await expect(bar.locator(".mobile-context-person-chip")).toHaveText("Tim");
    await expect(bar.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    expect(await bar.innerText()).not.toMatch(/\$|\d+\.\d{2}/);
    await page.locator(".mobile-context-trigger").click();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet.locator(".mobile-context-lead")).toContainText("Tim's entries plus their share of split expenses.");
    expect(await sheet.innerText()).not.toMatch(/\$|\d+\.\d{2}/);
  });

  test("the tab bar, More pages, the round buttons and the Pick a month sheet share the chrome tokens", async ({ page }) => {
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}`);
    const radius = await chromeToken(page, "--chrome-radius");
    const shadow = await style(page.locator(".mobile-context-sticky-bar"), "boxShadow");
    const tabs = page.locator("nav.tab-strip");
    expect(await style(tabs, "borderTopLeftRadius")).toBe(radius);
    expect(await style(tabs, "boxShadow")).toBe(shadow);
    const eye = page.locator(".totals-visibility-toggle--floating");
    expect(await style(eye, "boxShadow")).toBe(shadow);
    const fab = page.locator(".entries-fab:not(.splits-fab)");
    // The + button is the accent: the same lift, in the accent's shade.
    const geometry = (value) => value.replace(/rgba?\([^)]*\)/g, "").trim();
    expect(geometry(await style(fab, "boxShadow"))).toBe(geometry(shadow));
    for (const target of [eye, fab, ...await tabs.locator("> a.tab:visible, > button.tab").all()]) {
      const box = await target.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // The round buttons line up with the bars' edge.
    const tabsBox = await tabs.boundingBox();
    const eyeBox = await eye.boundingBox();
    const fabBox = await fab.boundingBox();
    expect(Math.round(eyeBox.x + eyeBox.width)).toBe(Math.round(tabsBox.x + tabsBox.width));
    expect(Math.round(fabBox.x + fabBox.width)).toBe(Math.round(tabsBox.x + tabsBox.width));

    await tabs.getByRole("button", { name: "More pages" }).click();
    const popover = page.locator(".tab-overflow-popover");
    await expect(popover).toBeVisible();
    expect(await style(popover, "borderTopLeftRadius")).toBe(radius);
    expect(await style(popover, "outlineStyle")).toBe("none");
    for (const link of await popover.getByRole("link").all()) {
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");

    // The Pick a month sheet: the same sheet radius and title type as the
    // View and scope sheet.
    await openUsable(page, `/month?view=person-tim&month=${MONTH}`);
    await page.locator(".mobile-context-trigger").click();
    const scopeSheet = page.getByRole("dialog", { name: "View and scope" });
    const scopeTitle = await style(scopeSheet.getByRole("heading", { name: "View and scope" }), "fontSize");
    await scopeSheet.getByRole("button", { name: "Done", exact: true }).click();
    await page.locator(".mobile-month-choice-open").click();
    const monthSheet = page.getByRole("dialog", { name: "Pick a month" });
    await expect(monthSheet).toBeVisible();
    expect(await style(monthSheet, "borderTopLeftRadius")).toBe(await chromeToken(page, "--sheet-radius"));
    expect(await style(monthSheet.getByRole("heading", { name: "Pick a month" }), "fontSize")).toBe(scopeTitle);
    expect(await smallTargets(monthSheet.locator(".mobile-context-dialog-head"))).toEqual([]);
  });

  // The Ask tab has an identity of its own (design.md, "Phone Chrome"): its
  // icon and label are the preset's accent in semibold even when it is not
  // the open page, and open it is the same pill as the other tabs with a
  // stronger accent tint. Every colour comes from the --accent (text) and
  // --accent-strong (pill) tokens, so it follows each colour preset.
  test("the Ask tab is the accent in semibold, open or not, and its open pill is tinted stronger than the others'", async ({ page }) => {
    await phone(page);
    await openUsable(page, `/entries?view=person-tim&month=${MONTH}`);
    const resolveColour = (css) => page.evaluate((value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, css);
    const accent = await resolveColour("var(--accent)");
    const strong = await resolveColour("var(--accent-strong)");
    const muted = await resolveColour("var(--muted)");
    expect(accent).toMatch(/^rgb\(/);
    expect(strong).not.toBe(accent);
    const tabs = page.locator("nav.tab-strip");
    const ask = tabs.getByRole("link", { name: "Ask", exact: true });
    const alpha = (value) => Number(value.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1);

    // Not open (Entries is): accent icon and label, semibold; Splits stays quiet.
    await expect(ask).not.toHaveClass(/is-active/);
    expect(await style(ask.locator(".tab-label-with-badge > span"), "color")).toBe(accent);
    expect(Number(await style(ask.locator(".tab-label-with-badge > span"), "fontWeight"))).toBeGreaterThanOrEqual(600);
    expect(await style(ask.locator(".tab-icon"), "color")).toBe(accent);
    const splitsTab = tabs.getByRole("link", { name: "Splits", exact: true });
    expect(await style(splitsTab, "color")).toBe(muted);
    expect(Number(await style(splitsTab, "fontWeight"))).toBeLessThan(600);
    const entriesTab = tabs.getByRole("link", { name: "Entries", exact: true });
    await expect(entriesTab).toHaveClass(/is-active/);
    const openTint = alpha(await style(entriesTab, "backgroundColor"));
    expect(await style(ask, "backgroundColor")).toBe("rgba(0, 0, 0, 0)");

    // Open: still the accent in semibold, on a pill tinted stronger than the
    // other open tabs', in the accent's own channels.
    await ask.click();
    await expect(ask).toHaveClass(/is-active/);
    expect(await style(ask.locator(".tab-label-with-badge > span"), "color")).toBe(accent);
    expect(Number(await style(ask.locator(".tab-label-with-badge > span"), "fontWeight"))).toBeGreaterThanOrEqual(600);
    const askBackground = await style(ask, "backgroundColor");
    expect(askBackground.replace(/,\s*[\d.]+\)$/, ")").replace("rgba", "rgb")).toBe(strong);
    expect(alpha(askBackground)).toBeGreaterThan(openTint);
    // Still a 44px target in the same bar.
    expect((await ask.boundingBox()).height).toBeGreaterThanOrEqual(44);
  });
});
