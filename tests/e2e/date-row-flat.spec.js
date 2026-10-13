import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The sticky date row above each day on Entries and Splits (design.md,
// "Entries list", "Splits activity list") is a quiet label, not a box. At
// rest it paints the exact surface behind it (--page on Entries, the Splits
// surface on Splits), so no lighter band or square corner shows above the
// day's rounded group, in every colour preset and in light and dark. Stuck
// under the top of the screen it keeps that colour and fades out at its
// bottom edge instead of cutting the rows off with a hard rectangle.

const PRESETS = ["70s", "60s", "80s", "modern", "mono", "code", "midnight", "genz", "future"];
const MODES = ["light", "dark"];
const SCHEMES = PRESETS.flatMap((palette) => MODES.map((mode) => ({ palette, mode })));
const VIEWPORTS = [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }]
];

// Per colour channel: PNG screenshots are exact, but colour-mix() and alpha
// layers can land a unit away from the token.
const TOLERANCE = 2;

const PAGES = {
  entries: {
    head: ".entries-date-head",
    headText: "24 May 2026",
    surfaceToken: "--page",
    async seed(page, marker) {
      for (let index = 0; index < 40; index += 1) {
        await postJson(page, "/api/entries/create", {
          date: "2026-05-24",
          description: `${marker} ${String(index + 1).padStart(2, "0")}`,
          accountName: "UOB One",
          categoryName: "Groceries",
          amountMinor: 100 + index,
          entryType: "expense",
          ownershipType: "direct",
          ownerName: "Tim"
        });
      }
    },
    open(page, marker) {
      return gotoPageAfterApi(
        page,
        "/entries?view=person-tim&month=2026-05",
        "/api/entries-page",
        () => page.locator(".entry-row").filter({ hasText: `${marker} 01` }).first()
      );
    }
  },
  splits: {
    head: ".split-date-header",
    headText: "12 Jun 2026",
    surfaceToken: "--splits-surface",
    async seed(page, marker) {
      for (let index = 0; index < 36; index += 1) {
        await postJson(page, "/api/splits/expenses/create", {
          date: "2026-06-12",
          description: `${marker} ${String(index + 1).padStart(2, "0")}`,
          categoryName: "Food & Drinks",
          payerPersonName: "Joyce",
          amountMinor: 1000 + index,
          groupId: null,
          note: "date row flat"
        });
      }
    },
    open(page, marker) {
      return gotoPageAfterApi(
        page,
        "/splits?view=person-tim&month=2026-06&split_group=split-group-none",
        "/api/splits-page",
        () => page.locator(".split-activity-card").filter({ hasText: `${marker} 01` }).first()
      );
    }
  }
};

// The same steps as Settings > Colours (colour-presets.js): load the
// scheme's sheet, then set the two attributes.
async function applyScheme(page, { palette, mode }) {
  await page.evaluate(async ({ palette, mode }) => {
    const sheet = `${palette}-${mode}`;
    if (sheet !== "70s-light" && !document.querySelector(`link[data-palette-sheet="${sheet}"]`)) {
      await new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/palettes/${sheet}.css`;
        link.dataset.paletteSheet = sheet;
        link.onload = link.onerror = resolve;
        document.head.append(link);
      });
    }
    const root = document.documentElement;
    root.setAttribute("data-mode", mode);
    if (palette === "70s") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", palette);
  }, { palette, mode });
}

// A token's colour as [r, g, b], read through a canvas so colour-mix() and
// color(srgb ...) results parse the same way.
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

// One viewport screenshot, read back as raw pixels.
async function readPixels(page) {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x, y) => {
    const offset = (Math.round(y) * info.width + Math.round(x)) * 3;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
}

function expectSame(actual, expected, label) {
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(actual[channel] - expected[channel]), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
  }
}

// Put the header `fromTop` px below the top of the screen.
async function placeHeader(page, header, fromTop) {
  await page.evaluate(({ element, fromTop }) => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - fromTop, behavior: "instant" });
  }, { element: await header.elementHandle(), fromTop });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const [pageName, config] of Object.entries(PAGES)) {
  for (const [viewportName, viewport] of VIEWPORTS) {
    test(`${pageName} ${viewportName}: the date row is not a box at rest in any colour scheme, and fades when stuck`, async ({ page }) => {
      test.setTimeout(240_000);
      const marker = `Playwright date row ${pageName} ${viewportName} ${Date.now()}`;
      await page.setViewportSize(viewport);
      await reseedDemo(page);
      await config.seed(page, marker);
      await config.open(page, marker);

      const header = page.locator(config.head).filter({ hasText: config.headText }).first();
      await expect(header).toBeVisible();
      await expect(header).toHaveCSS("position", "sticky");

      for (const scheme of SCHEMES) {
        const label = `${scheme.palette} ${scheme.mode}`;
        await applyScheme(page, scheme);
        await placeHeader(page, header, 220);
        const surface = await readToken(page, config.surfaceToken);
        const box = await header.boundingBox();
        expect(box.y, `${label}: header sits clear of the top, so it is not stuck`).toBeGreaterThan(100);
        const at = await readPixels(page);

        // Inside the row: its top padding, and the foot of its bottom
        // padding, clear of the label and the button.
        const probeX = box.x + box.width * 0.5;
        expectSame(at(probeX, box.y + 3), surface, `${label}: top of the date row`);
        expectSame(at(probeX, box.y + box.height - 2), surface, `${label}: foot of the date row`);
        // Level with the row, just outside its edges where the screen has room.
        expectSame(at(probeX, box.y + 3), at(Math.max(box.x - 6, 1), box.y + 3), `${label}: row against the surface to its left`);
        if (box.x + box.width + 6 < viewport.width - 16) {
          expectSame(at(probeX, box.y + 3), at(box.x + box.width + 6, box.y + 3), `${label}: row against the surface to its right`);
        }
        // No rounded, bordered, shadowed or blurred box of its own.
        const looks = await header.evaluate((element) => {
          const style = getComputedStyle(element);
          return { radius: style.borderTopLeftRadius, bottom: style.borderBottomWidth, shadow: style.boxShadow, blur: style.backdropFilter };
        });
        expect(looks, label).toEqual({ radius: "0px", bottom: "0px", shadow: "none", blur: "none" });
      }

      // Stuck under the top of the screen, in 70s Light and in a dark preset:
      // still sticky and the surface colour behind the label, with a fade at
      // its foot rather than a hard rectangle.
      for (const scheme of [{ palette: "70s", mode: "light" }, { palette: "modern", mode: "dark" }]) {
        const label = `stuck ${scheme.palette} ${scheme.mode}`;
        await applyScheme(page, scheme);
        await placeHeader(page, header, 0);
        const box = await header.boundingBox();
        expect(Math.abs(box.y), `${label}: header holds the top of the screen`).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => window.scrollY), label).toBeGreaterThan(200);
        const surface = await readToken(page, config.surfaceToken);
        const at = await readPixels(page);
        expectSame(at(box.x + box.width * 0.5, 3), surface, `${label}: top of the date row`);
        const stuck = await header.evaluate((element) => {
          const style = getComputedStyle(element);
          return { image: style.backgroundImage, blur: style.backdropFilter, radius: style.borderTopLeftRadius };
        });
        expect(stuck.blur, label).toBe("none");
        expect(stuck.radius, label).toBe("0px");
        expect(stuck.image, label).toMatch(/linear-gradient/);
        expect(stuck.image, label).toMatch(/, 0\)/);
      }
    });
  }
}
