import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The Splits day header pins like the Entries one (entries-sticky-date.spec.js;
// design.md "Entries list", "Splits activity list"): under the top of the
// screen while that day's rows scroll beneath it, the next day's header
// taking its place. Pinned, its background is a band the full width of the
// window in the Splits colour (--splits-surface) with a hairline at its foot,
// while the date, the count and the refresh button stay where they sit at
// rest. It pins just below the demo and local environment banner, never
// under it, and a row reached by keyboard is never hidden behind it.

const DAY = "2026-06-12";
const DAY_TEXT = "12 Jun 2026";
const NEXT_DAY = "2026-06-09";
const NEXT_DAY_TEXT = "9 Jun 2026";
const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }]
];

async function seedLongDay(page, marker) {
  for (let index = 0; index < 30; index += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      date: DAY,
      description: `${marker} ${String(index + 1).padStart(2, "0")}`,
      categoryName: "Food & Drinks",
      payerPersonName: "Joyce",
      amountMinor: 1000 + index,
      groupId: null
    });
  }
  for (let index = 0; index < 8; index += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      date: NEXT_DAY,
      description: `${marker} next ${index + 1}`,
      categoryName: "Food & Drinks",
      payerPersonName: "Tim",
      amountMinor: 2000 + index,
      groupId: null
    });
  }
}

function openSplits(page, marker) {
  return gotoPageAfterApi(
    page,
    "/splits?view=person-tim&month=2026-06&split_group=split-group-none",
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: `${marker} 01` }).first()
  );
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// Scroll so the element's top sits `fromTop` px below the top of the window.
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

function topChromeBottom(page) {
  return page.evaluate(() => {
    const banner = document.querySelector(".environment-banner");
    if (!banner || getComputedStyle(banner).position !== "sticky") return 0;
    return banner.getBoundingClientRect().bottom;
  });
}

function readHeader(header) {
  return header.evaluate((element) => {
    const style = getComputedStyle(element);
    const band = getComputedStyle(element, "::before");
    const rect = element.getBoundingClientRect();
    const text = element.querySelector("strong").getBoundingClientRect();
    const count = element.querySelector(".split-date-actions").getBoundingClientRect();
    const hasBand = band.content !== "none" && band.position === "absolute";
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      textLeft: text.left,
      textTop: text.top,
      countRight: count.right,
      stuck: element.hasAttribute("data-stuck"),
      look: {
        padding: style.padding,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        blur: style.backdropFilter,
        band: band.content === "none" ? "none" : band.position
      },
      band: hasBand
        ? {
          left: rect.left + parseFloat(band.left),
          top: rect.top + parseFloat(band.top),
          width: rect.width - parseFloat(band.left) - parseFloat(band.right),
          height: parseFloat(band.height),
          hairline: band.borderBottomWidth
        }
        : null,
      windowWidth: document.documentElement.clientWidth
    };
  });
}

function overlaps(a, b) {
  return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

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
  test(`splits ${viewportName}: the day header pins under the top chrome with a full-width band while its rows scroll`, async ({ page }) => {
    test.setTimeout(180_000);
    const marker = `Playwright splits sticky ${viewportName} ${Date.now()}`;
    await page.setViewportSize(viewport);
    await reseedDemo(page);
    await seedLongDay(page, marker);
    await openSplits(page, marker);

    const day = page.locator(".split-date-group").filter({ hasText: DAY_TEXT }).first();
    const header = day.locator(".split-date-header");
    const nextDay = page.locator(".split-date-group").filter({ hasText: NEXT_DAY_TEXT }).first();
    const nextHeader = nextDay.locator(".split-date-header");
    await expect(header).toHaveCSS("position", "sticky");
    await expect(nextHeader).toBeVisible();

    await placeAt(page, day, 240);
    const rest = await readHeader(header);
    expect(rest.stuck).toBe(false);
    expect(rest.band).toBeNull();
    expect(rest.look.radius).toBe("0px");

    // 600 px into the day: the header holds the top, its rows run under it.
    await placeAt(page, day, -600);
    const top = await topChromeBottom(page);
    await expect(header).toHaveAttribute("data-stuck", "");
    const pinned = await readHeader(header);
    expect(Math.abs(pinned.top - top), `pinned top ${pinned.top} vs the top chrome's foot ${top}`).toBeLessThanOrEqual(1);
    // No layout shift, the text column stays: not the old inset rounded bar.
    expect(pinned.height).toBeCloseTo(rest.height, 0);
    expect(pinned.left).toBeCloseTo(rest.left, 0);
    expect(pinned.right).toBeCloseTo(rest.right, 0);
    expect(pinned.textLeft).toBeCloseTo(rest.textLeft, 0);
    expect(pinned.countRight).toBeCloseTo(rest.countRight, 0);
    expect(pinned.textTop - pinned.top).toBeCloseTo(rest.textTop - rest.top, 0);
    expect(pinned.look.radius).toBe("0px");
    expect(pinned.look.padding).toBe(rest.look.padding);

    // The band: the window's full width, the header's top and height, a hairline.
    expect(pinned.band, "a full-width band behind the pinned header").not.toBeNull();
    expect(pinned.band.left).toBe(0);
    expect(pinned.band.width).toBeCloseTo(pinned.windowWidth, 0);
    expect(Math.abs(pinned.band.top - pinned.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.band.height - pinned.height)).toBeLessThanOrEqual(1);
    expect(pinned.band.hairline).toBe("1px");

    // On screen: the Splits colour across the window, over the white rows too.
    const surface = await readToken(page, "--splits-surface");
    const at = await readPixels(page);
    const y = pinned.top + 4;
    for (const x of [2, (pinned.left + pinned.right) / 2, pinned.windowWidth - 3]) {
      expect(distance(at(x, y), surface), `band at x=${Math.round(x)}: ${at(x, y)} vs ${surface}`).toBeLessThanOrEqual(24);
    }

    // Nothing stuck or floating overlaps it.
    const floating = await page.evaluate(() => Array.from(document.querySelectorAll(
      ".mobile-context-sticky-wrap, .desktop-splits-floating-tabs, .ask-dock-field, .entries-fab, .splits-fab, .tab-strip, .totals-visibility-toggle--floating, .scroll-direction-fab, .environment-banner, .splits-strip"
    )).map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
    }).filter((rect) => rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight));
    expect(floating.length).toBeGreaterThan(0);
    const bandRect = { top: pinned.band.top, bottom: pinned.band.top + pinned.band.height, left: 0, right: pinned.windowWidth };
    for (const rect of floating) {
      expect(overlaps(bandRect, rect), `band overlaps ${rect.name}`).toBe(false);
    }

    // Keyboard focus walking back up the rows is never hidden behind it.
    const firstClear = await page.evaluate((headerBottom) => {
      const rows = Array.from(document.querySelectorAll(".split-date-items .split-activity-card"));
      const index = rows.findIndex((row) => row.getBoundingClientRect().top >= headerBottom + 4);
      rows[index].focus({ preventScroll: true });
      return index;
    }, pinned.bottom);
    expect(firstClear).toBeGreaterThan(2);
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Shift+Tab");
      await settle(page);
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        const rect = element.getBoundingClientRect();
        return { inRows: Boolean(element.closest(".split-date-items")), top: rect.top, label: element.className || element.tagName };
      });
      if (!focus.inRows) break;
      const now = await readHeader(header);
      expect(focus.top, `focused ${focus.label} sits below the pinned header (${now.bottom})`).toBeGreaterThanOrEqual(now.bottom - 1);
    }

    // The next day's header pushes it up and takes its place.
    await placeAt(page, nextDay, top + pinned.height / 2);
    const handoff = await readHeader(header);
    const arriving = await readHeader(nextHeader);
    expect(handoff.bottom).toBeLessThanOrEqual(arriving.top + 1);
    expect(handoff.top).toBeLessThan(top);
    await placeAt(page, nextDay, -20);
    await expect(nextHeader).toHaveAttribute("data-stuck", "");
    const next = await readHeader(nextHeader);
    expect(Math.abs(next.top - top)).toBeLessThanOrEqual(1);
    expect(next.band?.width).toBeCloseTo(next.windowWidth, 0);

    // Back at rest: no band, the look as before.
    await placeAt(page, day, 240);
    await expect(header).not.toHaveAttribute("data-stuck", "");
    expect((await readHeader(header)).look).toEqual(rest.look);
  });

  test(`splits ${viewportName}: under the environment banner the header pins just below it, never under it`, async ({ page }) => {
    test.setTimeout(120_000);
    const marker = `Playwright splits sticky banner ${viewportName} ${Date.now()}`;
    await page.setViewportSize(viewport);
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
    await openSplits(page, marker);

    const day = page.locator(".split-date-group").filter({ hasText: DAY_TEXT }).first();
    const header = day.locator(".split-date-header");
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
