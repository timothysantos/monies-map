import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The Entries day header pins under the top of the screen while that day's
// rows scroll beneath it, and the next day's header takes its place (design.md,
// "Entries list"; docs/flows/entries-flow.md). Pinned, its background is a
// band the full width of the window (left 0 to the window's right edge) in
// the page colour with a hairline at its foot, while the date, the daily net
// and the refresh button stay exactly where they sit at rest, on the content
// column. It pins just below anything already stuck at the top (the demo and
// local environment banner), never under it, and a row reached by keyboard
// is never hidden behind it.

const DAY = "2026-05-24";
const DAY_TEXT = "24 May 2026";
const NEXT_DAY_TEXT = "22 May 2026";
const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }]
];

// How the header looks at rest, as it did before the band (date-row-flat.spec.js
// samples the pixels in every preset; this pins the computed shape).
const REST = {
  desktop: { padding: "18px 2px 12px", radius: "0px", border: "0px", blur: "none", band: "none" },
  phone: { padding: "16px 2px 12px", radius: "0px", border: "0px", blur: "none", band: "none" }
};

async function seedLongDay(page, marker) {
  for (let index = 0; index < 30; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: DAY,
      description: `${marker} ${String(index + 1).padStart(2, "0")}`,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 100 + index,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
}

function openEntries(page, marker) {
  return gotoPageAfterApi(
    page,
    "/entries?view=person-tim&month=2026-05",
    "/api/entries-page",
    () => page.locator(".entry-row").filter({ hasText: `${marker} 01` }).first()
  );
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// Scroll so the element's top sits `fromTop` px below the top of the window.
// Rows further up can still be laying out after a long jump, so it measures
// again until the element stays put. A pinned header cannot be placed by its
// own top, so `locator` may be the section around it.
async function placeAt(page, locator, fromTop) {
  const element = await locator.elementHandle();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const moved = await page.evaluate(({ element, fromTop }) => {
      document.documentElement.style.scrollBehavior = "auto";
      const delta = element.getBoundingClientRect().top - fromTop;
      window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
      return Math.abs(delta);
    }, { element, fromTop });
    await settle(page);
    await page.waitForTimeout(100);
    if (moved < 1) break;
  }
  await settle(page);
}

// The bottom edge of whatever is already stuck or fixed at the top of the
// window (the environment banner on demo and local), or 0.
function topChromeBottom(page) {
  return page.evaluate(() => {
    const banner = document.querySelector(".environment-banner");
    if (!banner || getComputedStyle(banner).position !== "sticky") return 0;
    return banner.getBoundingClientRect().bottom;
  });
}

// The header, its date text and its pinned band (the ::before), in window px.
function readHeader(header) {
  return header.evaluate((element) => {
    const style = getComputedStyle(element);
    const band = getComputedStyle(element, "::before");
    const rect = element.getBoundingClientRect();
    const text = element.querySelector("strong").getBoundingClientRect();
    const total = element.querySelector(".entries-date-actions").getBoundingClientRect();
    const hasBand = band.content !== "none" && band.position === "absolute";
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      textLeft: text.left,
      textTop: text.top,
      totalRight: total.right,
      totalTop: total.top,
      stuck: element.hasAttribute("data-stuck"),
      look: {
        padding: style.padding,
        radius: style.borderTopLeftRadius,
        border: style.borderBottomWidth,
        blur: style.backdropFilter,
        band: band.content === "none" ? "none" : band.position
      },
      // The ::before is placed against the header's own box.
      band: hasBand
        ? {
          left: rect.left + parseFloat(band.left),
          top: rect.top + parseFloat(band.top),
          width: rect.width - parseFloat(band.left) - parseFloat(band.right),
          height: parseFloat(band.height),
          hairline: band.borderBottomWidth,
          colour: band.backgroundColor
        }
        : null,
      windowWidth: document.documentElement.clientWidth
    };
  });
}

function overlaps(a, b) {
  return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

// A token's colour as [r, g, b], read through a canvas.
function readToken(page, token) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    context.fillStyle = resolved;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, token);
}

async function readPixels(page) {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => {
    const offset = (Math.round(y) * info.width + Math.round(x)) * 3;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
}

function distance(a, b) {
  return Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
}

for (const [viewportName, viewport] of VIEWPORTS) {
  test(`entries ${viewportName}: the day header pins under the top chrome with a full-width band while its rows scroll`, async ({ page }) => {
    test.setTimeout(180_000);
    const marker = `Playwright sticky date ${viewportName} ${Date.now()}`;
    await page.setViewportSize(viewport);
    await reseedDemo(page);
    await seedLongDay(page, marker);
    await openEntries(page, marker);

    const day = page.locator(".entries-date-group").filter({ hasText: DAY_TEXT }).first();
    const header = day.locator(".entries-date-head");
    const nextDay = page.locator(".entries-date-group").filter({ hasText: NEXT_DAY_TEXT }).first();
    const nextHeader = nextDay.locator(".entries-date-head");
    await expect(header).toHaveCSS("position", "sticky");
    await expect(nextHeader).toBeVisible();

    // At rest: exactly as before, no band.
    await placeAt(page, day, 240);
    const rest = await readHeader(header);
    expect(rest.stuck).toBe(false);
    expect(rest.look).toEqual(REST[viewportName]);
    expect(rest.band).toBeNull();

    // Scroll 600 px into the day: the header holds the top, its rows run under it.
    await placeAt(page, day, -600);
    const top = await topChromeBottom(page);
    await expect(header).toHaveAttribute("data-stuck", "");
    const pinned = await readHeader(header);
    expect(Math.abs(pinned.top - top), `pinned top ${pinned.top} vs the top chrome's foot ${top}`).toBeLessThanOrEqual(1);
    // No layout shift and the text column does not move: same height, same
    // left edges, the date and the daily net where they were at rest.
    expect(pinned.height).toBeCloseTo(rest.height, 0);
    expect(pinned.left).toBeCloseTo(rest.left, 0);
    expect(pinned.right).toBeCloseTo(rest.right, 0);
    expect(pinned.textLeft).toBeCloseTo(rest.textLeft, 0);
    expect(pinned.totalRight).toBeCloseTo(rest.totalRight, 0);
    expect(pinned.textTop - pinned.top).toBeCloseTo(rest.textTop - rest.top, 0);
    expect(pinned.look.radius).toBe("0px");

    // The band: the full width of the window, the header's own top and
    // height, a hairline at its foot.
    expect(pinned.band, "a full-width band behind the pinned header").not.toBeNull();
    expect(pinned.band.left).toBe(0);
    expect(pinned.band.width).toBeCloseTo(pinned.windowWidth, 0);
    expect(Math.abs(pinned.band.top - pinned.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.band.height - pinned.height)).toBeLessThanOrEqual(1);
    expect(pinned.band.hairline).toBe("1px");

    // On screen: the hairline reaches both edges of the window (it shows
    // against the band just above it, as it does mid-column), and inside the
    // band over the rows the page colour shows, not the white rows.
    const pageColour = await readToken(page, "--page");
    const at = await readPixels(page);
    const hairlineY = Math.floor(pinned.bottom) - 1;
    const midX = Math.round((pinned.left + pinned.right) / 2);
    const midHairline = at(midX, hairlineY);
    expect(distance(midHairline, at(midX, hairlineY - 4)), "the hairline shows mid-column").toBeGreaterThanOrEqual(6);
    for (const x of [1, pinned.windowWidth - 2]) {
      const hairline = at(x, hairlineY);
      expect(distance(hairline, at(x, hairlineY - 4)), `hairline at x=${x}: ${hairline} vs the band above it`).toBeGreaterThanOrEqual(6);
      expect(distance(hairline, midHairline), `hairline at x=${x}: ${hairline} vs mid-column ${midHairline}`).toBeLessThanOrEqual(16);
    }
    const insideOverRows = at((pinned.left + pinned.right) / 2, pinned.top + 4);
    expect(distance(insideOverRows, pageColour), `band over the rows ${insideOverRows} vs the page ${pageColour}`).toBeLessThanOrEqual(24);

    // Nothing stuck or floating overlaps it: the floating bar and Ask field
    // on a wide screen, the tab bar, the View and scope bar and the round
    // buttons on a phone.
    const floating = await page.evaluate(() => Array.from(document.querySelectorAll(
      ".mobile-context-sticky-wrap, .desktop-splits-floating-tabs, .ask-dock-field, .entries-fab, .tab-strip, .totals-visibility-toggle--floating, .scroll-direction-fab, .environment-banner"
    )).map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
    }).filter((rect) => rect.height > 0));
    expect(floating.length).toBeGreaterThan(0);
    const bandRect = { top: pinned.band.top, bottom: pinned.band.top + pinned.band.height, left: 0, right: pinned.windowWidth };
    for (const rect of floating) {
      expect(overlaps(bandRect, rect), `band overlaps ${rect.name}`).toBe(false);
    }

    // Keyboard focus walking back up the rows is never hidden behind it.
    const firstClear = await page.evaluate((headerBottom) => {
      const rows = Array.from(document.querySelectorAll(".entries-date-group .entry-row-main"));
      const index = rows.findIndex((row) => row.getBoundingClientRect().top >= headerBottom + 4);
      rows[index].focus({ preventScroll: true });
      return index;
    }, pinned.bottom);
    expect(firstClear).toBeGreaterThan(2);
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press("Shift+Tab");
      await settle(page);
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        const rect = element.getBoundingClientRect();
        return { inRows: Boolean(element.closest(".entries-rows")), top: rect.top, label: element.className || element.tagName };
      });
      if (!focus.inRows) break;
      const now = await readHeader(header);
      expect(focus.top, `focused ${focus.label} sits below the pinned header (${now.bottom})`).toBeGreaterThanOrEqual(now.bottom - 1);
    }
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".entries-date-group .entry-row-main")).scrollMarginTop)).not.toBe("0px");

    // The next day's header pushes it up and takes its place.
    await placeAt(page, nextDay, top + pinned.height / 2);
    const handoff = await readHeader(header);
    const arriving = await readHeader(nextHeader);
    expect(handoff.bottom).toBeLessThanOrEqual(arriving.top + 1);
    expect(handoff.top, `pushed up: ${JSON.stringify({ handoff, arriving })}`).toBeLessThan(top);
    await placeAt(page, nextDay, -20);
    await expect(nextHeader).toHaveAttribute("data-stuck", "");
    const next = await readHeader(nextHeader);
    expect(Math.abs(next.top - top)).toBeLessThanOrEqual(1);
    expect(next.band?.width).toBeCloseTo(next.windowWidth, 0);
    expect((await readHeader(header)).bottom).toBeLessThanOrEqual(top + 1);

    // Back at rest: the band goes and the look is as before.
    await placeAt(page, day, 240);
    await expect(header).not.toHaveAttribute("data-stuck", "");
    expect((await readHeader(header)).look).toEqual(REST[viewportName]);
  });

  test(`entries ${viewportName}: under the environment banner the header pins just below it, never under it`, async ({ page }) => {
    test.setTimeout(120_000);
    const marker = `Playwright sticky date banner ${viewportName} ${Date.now()}`;
    await page.setViewportSize(viewport);
    // The demo and local sites show a sticky banner at the top of the shell
    // (app-shell-status.jsx); the test site does not, so add the same element
    // as soon as the shell renders.
    await page.addInitScript(() => {
      const add = () => {
        const shell = document.querySelector("main.shell");
        if (!shell || shell.querySelector(":scope > .environment-banner")) return;
        const banner = document.createElement("div");
        banner.className = "environment-banner environment-banner-demo";
        banner.textContent = "demo";
        shell.prepend(banner);
      };
      new MutationObserver(add).observe(document, { childList: true, subtree: true });
    });
    await reseedDemo(page);
    await seedLongDay(page, marker);
    await openEntries(page, marker);

    const day = page.locator(".entries-date-group").filter({ hasText: DAY_TEXT }).first();
    const header = day.locator(".entries-date-head");
    await placeAt(page, day, -600);
    const top = await topChromeBottom(page);
    expect(top, "the banner is stuck at the top").toBeGreaterThan(10);
    await expect(header).toHaveAttribute("data-stuck", "");
    const pinned = await readHeader(header);
    expect(Math.abs(pinned.top - top), `pinned top ${pinned.top} vs the banner's foot ${top}`).toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.band.top - top)).toBeLessThanOrEqual(1);
    const banner = await page.locator(".environment-banner").boundingBox();
    expect(overlaps({ top: pinned.band.top, bottom: pinned.band.top + pinned.band.height, left: 0, right: pinned.windowWidth }, {
      top: banner.y, bottom: banner.y + banner.height, left: banner.x, right: banner.x + banner.width
    })).toBe(false);
  });
}
