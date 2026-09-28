import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, reseedDemo } from "./helpers";

// The category palette as a person sees it (design.md, "Category palette"):
// donut segments read 3:1 on the panel and differ from each other, and each
// icon glyph reads 3:1 on its own tint.

function parse(value) {
  const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
  if (srgb) return [srgb[1], srgb[2], srgb[3]].map((channel) => Number(channel) * 255);
  if (value.startsWith("#")) return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  return value.match(/[\d.]+/g).slice(0, 3).map(Number);
}
function contrast(a, b) {
  const luminance = (rgb) => {
    const [r, g, b2] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("donut segments and category icons read on the panel and stay distinct", async ({ page }) => {
  await reseedDemo(page);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoPageAfterApi(page, "/summary?view=household&month=2025-06&scope=direct_plus_shared&summary_start=2025-06&summary_end=2025-06", "/api/summary-page", () => page.getByRole("heading", { name: "Spending Mix" }));
  const segments = page.locator(".recharts-pie-sector path, .recharts-sector");
  await expect(segments.first()).toBeVisible();

  const fills = await segments.evaluateAll((elements) => elements.map((element) => element.getAttribute("fill")).filter(Boolean));
  expect(fills.length).toBeGreaterThan(3);
  for (const fill of fills) {
    expect(contrast(parse(fill), [255, 255, 255]), `${fill} on white`).toBeGreaterThanOrEqual(3);
  }
  expect(new Set(fills.map((fill) => fill.toLowerCase())).size).toBe(fills.length);

  const icons = await page.locator(".category-icon").evaluateAll((elements) => elements.slice(0, 12).map((element) => {
    const style = getComputedStyle(element);
    return { glyph: style.color, tint: style.backgroundColor };
  }));
  expect(icons.length).toBeGreaterThan(3);
  for (const icon of icons) {
    expect(contrast(parse(icon.glyph), parse(icon.tint)), JSON.stringify(icon)).toBeGreaterThanOrEqual(3);
  }
});

test("status surfaces use the pastel fills and inks at AA", async ({ page }) => {
  await reseedDemo(page);
  await gotoPageAfterApi(page, "/entries?view=person-tim&month=2026-04&scope=direct_plus_shared", "/api/entries-page", () => page.getByRole("heading", { name: "Entries", exact: true }));
  // The stylesheet's status classes, drawn on the page: several only appear
  // on a deployment (the banners), with pending suggestions (the badge) or
  // after a failure (the errors).
  const looks = await page.evaluate(() => {
    const samples = {
      demoBanner: '<div class="environment-banner environment-banner-demo">demo</div>',
      localBanner: '<div class="environment-banner environment-banner-local">local</div>',
      tabBadge: '<span class="tab-badge">3</span>',
      danger: '<button class="dialog-danger">Delete</button>',
      pillSuccess: '<span class="pill success">Ready</span>',
      pillWarning: '<span class="pill warning">Blocked</span>',
      formError: '<p class="form-error">Could not save.</p>'
    };
    const host = document.createElement("div");
    document.querySelector("main").append(host);
    return Object.fromEntries(Object.entries(samples).map(([name, html]) => {
      host.innerHTML = html;
      const style = getComputedStyle(host.firstElementChild);
      return [name, { color: style.color, background: style.backgroundColor }];
    }));
  });
  const MINT = { background: "rgb(228, 242, 234)", color: "rgb(23, 104, 74)" };
  const ROSE = { background: "rgb(249, 229, 225)", color: "rgb(163, 53, 42)" };
  const SKY = { background: "rgb(227, 236, 246)", color: "rgb(47, 91, 134)" };
  expect(looks.demoBanner).toEqual(SKY);
  expect(looks.localBanner).toEqual(MINT);
  expect(looks.tabBadge).toEqual(ROSE);
  expect(looks.danger).toEqual(ROSE);
  expect(looks.pillSuccess).toEqual(MINT);
  expect(looks.pillWarning).toEqual(ROSE);
  expect(looks.formError.color).toBe(ROSE.color);
  for (const [name, { color, background }] of Object.entries(looks)) {
    if (background === "rgba(0, 0, 0, 0)") continue;
    expect(contrast(parse(color), parse(background)), name).toBeGreaterThanOrEqual(4.5);
  }
});
