import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// Settings > Colours (design.md, "Colour presets"): choosing a preset or a
// Light / Dark / Auto mode re-colours the page at once, the choice survives
// a reload on this device without a flash of the default, Auto follows the
// phone (also while the app is open), and blocked storage keeps 70s Warm in
// Auto.

const PALETTE_KEY = "monies-map:palette";
const MODE_KEY = "monies-map:colour-mode";
const SUMMARY_URL = "/summary?view=household&month=2025-06&scope=direct_plus_shared&summary_start=2025-06&summary_end=2025-06";

async function openSettings(page) {
  await gotoPageAfterApi(page, "/settings?view=household", "/api/settings-page", () => page.getByRole("heading", { name: "Settings", exact: true }));
}

async function openSummary(page) {
  await gotoPageAfterApi(page, SUMMARY_URL, "/api/summary-page", () => page.getByRole("heading", { name: "Spending Mix" }));
}

function coloursRow(page) {
  return page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: "Colours", exact: true }) });
}

const presetChoices = (page) => page.getByRole("group", { name: "Colour scheme" });
const modeChoices = (page) => page.getByRole("group", { name: "Light or dark" });
const rootToken = (page, name) => page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
const rootAttributes = (page) => page.evaluate(() => ({
  palette: document.documentElement.getAttribute("data-palette"),
  mode: document.documentElement.getAttribute("data-mode")
}));
const stored = (page) => page.evaluate(([paletteKey, modeKey]) => ({
  palette: localStorage.getItem(paletteKey),
  mode: localStorage.getItem(modeKey)
}), [PALETTE_KEY, MODE_KEY]);

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
});

test("choosing a preset re-colours the page at once and the row names it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  await expect(coloursRow(page)).toContainText("70s Warm · Auto");
  expect(await rootAttributes(page)).toEqual({ palette: null, mode: "light" });
  expect(await rootToken(page, "--accent-strong")).toBe("#b15e2f");

  await coloursRow(page).click();
  await expect(presetChoices(page).getByRole("button")).toHaveText(["70s Warm", "60s Mod", "80s Pop", "Modern", "Black & White", "Code", "Midnight Calm", "Gen Z 2026", "Futuristic"]);
  await expect(presetChoices(page).getByRole("button", { name: "70s Warm" })).toHaveAttribute("aria-pressed", "true");

  await presetChoices(page).getByRole("button", { name: "Modern" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "modern");
  await expect.poll(() => rootToken(page, "--accent-strong")).toBe("#4f46e5");
  // The page itself changes, not just a token: the route's page surface and
  // the selected chip's ring take the new colours.
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(230, 235, 242)");
  await expect(presetChoices(page).getByRole("button", { name: "Modern" })).toHaveAttribute("aria-pressed", "true");
  await expect(presetChoices(page).getByRole("button", { name: "Modern" })).toHaveCSS("border-top-color", "rgb(79, 70, 229)");
  await expect(coloursRow(page)).toContainText("Modern · Auto");
  expect(await stored(page)).toEqual({ palette: "modern", mode: null });

  // Back to the default clears the attribute and the stored choice.
  await presetChoices(page).getByRole("button", { name: "70s Warm" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-palette", /.+/);
  expect(await rootToken(page, "--accent-strong")).toBe("#b15e2f");
  expect(await stored(page)).toEqual({ palette: null, mode: null });
});

test("Light and Dark switch the mode attribute and the page tokens, and persist across a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  await coloursRow(page).click();
  await expect(modeChoices(page).getByRole("button")).toHaveText(["Light", "Dark", "Auto"]);
  await expect(modeChoices(page).getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
  const lightPage = await rootToken(page, "--page");
  expect(lightPage).toBe("#e9e4da");

  await modeChoices(page).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect.poll(() => rootToken(page, "--page")).toBe("#1b1916");
  await expect(page.locator('link[data-palette-sheet="70s-dark"]')).toHaveCount(1);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await expect(modeChoices(page).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(coloursRow(page)).toContainText("70s Warm · Dark");
  expect(await stored(page)).toEqual({ palette: null, mode: "dark" });

  // A preset keeps the mode: 60s Mod in dark.
  await presetChoices(page).getByRole("button", { name: "60s Mod" }).click();
  await expect.poll(() => rootAttributes(page)).toEqual({ palette: "60s", mode: "dark" });
  await expect.poll(() => rootToken(page, "--page")).toBe("#0e2321");

  // Light, chosen, holds even on a dark phone.
  await modeChoices(page).getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect.poll(() => rootToken(page, "--page")).toBe("#dfece8");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  expect(await rootAttributes(page)).toEqual({ palette: "60s", mode: "light" });

  // Persists: a reload on the dark phone is still 60s Mod light.
  await openSummary(page);
  expect(await rootAttributes(page)).toEqual({ palette: "60s", mode: "light" });
  expect(await rootToken(page, "--page")).toBe("#dfece8");
  await expect(page.locator('link[data-palette-sheet="60s-dark"]')).toHaveCount(0);
});

test("Auto follows the phone at load and while the app is open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSummary(page);
  // Nothing stored: 70s Warm in Auto, dark on a dark phone.
  expect(await rootAttributes(page)).toEqual({ palette: null, mode: "dark" });
  expect(await rootToken(page, "--page")).toBe("#1b1916");

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => rootAttributes(page)).toEqual({ palette: null, mode: "light" });
  expect(await rootToken(page, "--page")).toBe("#e9e4da");

  // A chosen preset in Auto follows too, loading its other sheet on the switch.
  await page.evaluate((key) => localStorage.setItem(key, "code"), PALETTE_KEY);
  await openSummary(page);
  expect(await rootAttributes(page)).toEqual({ palette: "code", mode: "light" });
  expect(await rootToken(page, "--accent-strong")).toBe("#1f6aa5");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => rootAttributes(page)).toEqual({ palette: "code", mode: "dark" });
  // Code's earlier look is Code Dark.
  expect(await rootToken(page, "--accent-strong")).toBe("#56d4dd");
  expect(await rootToken(page, "--bg")).toBe("#0d1117");
});

test("a chosen preset and mode are in place at the first frame after a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  await coloursRow(page).click();
  await presetChoices(page).getByRole("button", { name: "80s Pop" }).click();
  await modeChoices(page).getByRole("button", { name: "Dark" }).click();
  await expect.poll(() => rootAttributes(page)).toEqual({ palette: "80s", mode: "dark" });

  // Hold the sheet back: if it did not block the first paint, the first
  // frame would show the 70s Warm light page.
  await page.route("**/palettes/80s-dark.css", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__firstFrame = new Promise((resolve) => {
      requestAnimationFrame(() => resolve({
        palette: document.documentElement.getAttribute("data-palette"),
        mode: document.documentElement.getAttribute("data-mode"),
        accent: getComputedStyle(document.documentElement).getPropertyValue("--accent-strong").trim(),
        page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim()
      }));
    });
  });
  await openSummary(page);
  expect(await page.evaluate(() => window.__firstFrame)).toEqual({ palette: "80s", mode: "dark", accent: "#ff7ad8", page: "#110c23" });
  await expect(page.locator('link[data-palette-sheet="80s-dark"]')).toHaveCount(1);

  // Category colours follow the preset and mode: a donut segment's drawn
  // fill is the preset's, while its fill attribute keeps the stored 70s colour.
  const segment = page.locator(".recharts-pie-sector path, .recharts-sector").first();
  await expect(segment).toBeVisible();
  const { attribute, drawn } = await segment.evaluate((element) => ({ attribute: element.getAttribute("fill"), drawn: getComputedStyle(element).fill }));
  expect(attribute).toMatch(/^#[0-9A-F]{6}$/i);
  const presetColour = await rootToken(page, `--cat-${attribute.slice(1).toLowerCase()}`);
  expect(presetColour).toMatch(/^#[0-9a-f]{6}$/);
  expect(presetColour.toLowerCase()).not.toBe(attribute.toLowerCase());
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(presetColour.slice(index, index + 2), 16));
  expect(drawn).toBe(`rgb(${r}, ${g}, ${b})`);

  // The lead card stands off the page: its own surface, hairline and shadow.
  const lead = page.locator(".lsd-card").first();
  await expect(lead).toHaveCSS("background-color", "rgb(31, 24, 57)");
  expect(await lead.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
});

// The three newer presets, each in Light and Dark: the chip applies the
// scheme (attribute, its own sheet, page and accent tokens, the route's page
// surface), the row names it, and the choice is remembered.
const NEW_PRESETS = [
  { id: "midnight", name: "Midnight Calm", light: { page: "#cdd6e4", accent: "#3a5f8f" }, dark: { page: "#0f1729", accent: "#a6c4ea" } },
  { id: "genz", name: "Gen Z 2026", light: { page: "#eae1e8", accent: "#7652e0" }, dark: { page: "#18121f", accent: "#c4adff" } },
  { id: "future", name: "Futuristic", light: { page: "#d4dfe0", accent: "#00788f" }, dark: { page: "#0b0f10", accent: "#6ae0f7" } }
];
const firstSwatch = (chip) => chip.locator(".settings-colour-preset-dots > span").first().evaluate((dot) => dot.style.getPropertyValue("--swatch"));
const asRgb = (hex) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;

for (const preset of NEW_PRESETS) {
  test(`choosing ${preset.name} applies it in Light and in Dark and remembers it`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page);
    await coloursRow(page).click();
    const chip = presetChoices(page).getByRole("button", { name: preset.name, exact: true });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    // The chip's four dots are the scheme's light page, accent, money in and out.
    await expect.poll(() => firstSwatch(chip)).toBe(preset.light.page);

    await chip.click();
    await expect(page.locator("html")).toHaveAttribute("data-palette", preset.id);
    await expect(page.locator(`link[data-palette-sheet="${preset.id}-light"]`)).toHaveCount(1);
    await expect.poll(() => rootToken(page, "--page")).toBe(preset.light.page);
    expect(await rootToken(page, "--accent-strong")).toBe(preset.light.accent);
    await expect(page.locator(".panel").first()).toHaveCSS("background-color", asRgb(preset.light.page));
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toHaveCSS("border-top-color", asRgb(preset.light.accent));
    await expect(coloursRow(page)).toContainText(`${preset.name} · Auto`);
    expect(await stored(page)).toEqual({ palette: preset.id, mode: null });

    await modeChoices(page).getByRole("button", { name: "Dark" }).click();
    await expect.poll(() => rootAttributes(page)).toEqual({ palette: preset.id, mode: "dark" });
    await expect(page.locator(`link[data-palette-sheet="${preset.id}-dark"]`)).toHaveCount(1);
    await expect.poll(() => rootToken(page, "--page")).toBe(preset.dark.page);
    expect(await rootToken(page, "--accent-strong")).toBe(preset.dark.accent);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    await expect(page.locator(".panel").first()).toHaveCSS("background-color", asRgb(preset.dark.page));
    await expect.poll(() => firstSwatch(chip)).toBe(preset.dark.page);
    await expect(coloursRow(page)).toContainText(`${preset.name} · Dark`);
    expect(await stored(page)).toEqual({ palette: preset.id, mode: "dark" });

    // Remembered: a reload opens straight in the scheme and mode.
    await openSummary(page);
    expect(await rootAttributes(page)).toEqual({ palette: preset.id, mode: "dark" });
    expect(await rootToken(page, "--page")).toBe(preset.dark.page);
    await expect(page.locator(".lsd-card").first()).toBeVisible();
  });
}

test("blocked storage keeps 70s Warm in Auto and a choice still applies to the page", async ({ page }) => {
  await page.addInitScript(([paletteKey, modeKey]) => {
    // As in a locked-down browser: reading or writing the choice throws.
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function guarded(name, ...rest) {
        if (name === paletteKey || name === modeKey) throw new DOMException("The operation is insecure.", "SecurityError");
        return original.call(this, name, ...rest);
      };
    }
  }, [PALETTE_KEY, MODE_KEY]);
  await page.emulateMedia({ colorScheme: "light" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSettings(page);
  expect(await rootAttributes(page)).toEqual({ palette: null, mode: "light" });
  await expect(coloursRow(page)).toContainText("70s Warm · Auto");
  await coloursRow(page).click();
  await presetChoices(page).getByRole("button", { name: "80s Pop" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "80s");
  await expect.poll(() => rootToken(page, "--accent-strong")).toBe("#c2108f");
  await modeChoices(page).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect(errors).toEqual([]);
  // Not remembered: a reload is back on the default.
  await openSettings(page);
  expect(await rootAttributes(page)).toEqual({ palette: null, mode: "light" });
});
