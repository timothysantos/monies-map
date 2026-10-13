import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Settings > Colours (design.md, "Colour presets"): choosing a preset
// re-colours the page at once, the choice survives a reload on this device
// without a flash of the 70s default, and blocked storage keeps the default.

const PALETTE_KEY = "monies-map:palette";

async function openSettings(page) {
  await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
}

function coloursRow(page) {
  return page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: "Colours", exact: true }) });
}

const rootToken = (page, name) => page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
});

test("choosing a preset re-colours the page at once and the row names it", async ({ page }) => {
  await openSettings(page);
  await expect(coloursRow(page)).toContainText("70s Warm");
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-palette"))).toBe(false);
  expect(await rootToken(page, "--accent-strong")).toBe("#b15e2f");

  await coloursRow(page).click();
  const choices = page.getByRole("group", { name: "Colour scheme" });
  await expect(choices.getByRole("button")).toHaveText(["70s Warm", "60s Mod", "80s Pop", "Modern", "Black & White", "Code"]);
  await expect(choices.getByRole("button", { name: "70s Warm" })).toHaveAttribute("aria-pressed", "true");

  await choices.getByRole("button", { name: "Modern" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "modern");
  await expect.poll(() => rootToken(page, "--accent-strong")).toBe("#4f46e5");
  // The page itself changes, not just a token: the background and the
  // selected chip's ring take the new colours.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgb(238, 228, 207)");
  await expect(choices.getByRole("button", { name: "Modern" })).toHaveAttribute("aria-pressed", "true");
  await expect(choices.getByRole("button", { name: "Modern" })).toHaveCSS("border-top-color", "rgb(79, 70, 229)");
  await expect(coloursRow(page)).toContainText("Modern");
  expect(await page.evaluate((key) => localStorage.getItem(key), PALETTE_KEY)).toBe("modern");

  // Back to the default clears the attribute and the stored choice.
  await choices.getByRole("button", { name: "70s Warm" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-palette", /.+/);
  expect(await rootToken(page, "--accent-strong")).toBe("#b15e2f");
  expect(await page.evaluate((key) => localStorage.getItem(key), PALETTE_KEY)).toBeNull();
});

test("a chosen preset persists across a reload and is in place at the first frame", async ({ page }) => {
  await openSettings(page);
  await coloursRow(page).click();
  await page.getByRole("group", { name: "Colour scheme" }).getByRole("button", { name: "Code" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "code");

  // Hold the preset's stylesheet back: if it did not block the first paint,
  // the first frame would show the 70s accent.
  await page.route("**/palettes/code.css", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__firstFrame = new Promise((resolve) => {
      requestAnimationFrame(() => resolve({
        palette: document.documentElement.getAttribute("data-palette"),
        accent: getComputedStyle(document.documentElement).getPropertyValue("--accent-strong").trim(),
        background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
      }));
    });
  });
  await gotoPageAfterApi(page, "/summary?view=household&month=2025-06&scope=direct_plus_shared&summary_start=2025-06&summary_end=2025-06", "/api/summary-page", () => page.getByRole("heading", { name: "Spending Mix" }));
  expect(await page.evaluate(() => window.__firstFrame)).toEqual({ palette: "code", accent: "#56d4dd", background: "#0d1117" });
  await expect(page.locator('link[data-palette-sheet="code"]')).toHaveCount(1);

  // Category colours follow the preset: a donut segment's drawn fill is the
  // preset's, while its fill attribute keeps the stored 70s colour.
  const segment = page.locator(".recharts-pie-sector path, .recharts-sector").first();
  await expect(segment).toBeVisible();
  const { attribute, drawn } = await segment.evaluate((element) => ({ attribute: element.getAttribute("fill"), drawn: getComputedStyle(element).fill }));
  expect(attribute).toMatch(/^#[0-9A-F]{6}$/i);
  const presetColour = await rootToken(page, `--cat-${attribute.slice(1).toLowerCase()}`);
  expect(presetColour).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(presetColour.slice(index, index + 2), 16));
  expect(drawn).toBe(`rgb(${r}, ${g}, ${b})`);
});

test("blocked storage keeps the 70s default and a choice still applies to the page", async ({ page }) => {
  await page.addInitScript((key) => {
    // As in a locked-down browser: reading or writing the preset throws.
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function guarded(name, ...rest) {
        if (name === key) throw new DOMException("The operation is insecure.", "SecurityError");
        return original.call(this, name, ...rest);
      };
    }
  }, PALETTE_KEY);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSettings(page);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-palette"))).toBe(false);
  await expect(coloursRow(page)).toContainText("70s Warm");
  await coloursRow(page).click();
  await page.getByRole("group", { name: "Colour scheme" }).getByRole("button", { name: "80s Pop" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "80s");
  await expect.poll(() => rootToken(page, "--accent-strong")).toBe("#b0198a");
  expect(errors).toEqual([]);
  // Not remembered: a reload is back on the default.
  await openSettings(page);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-palette"))).toBe(false);
});
