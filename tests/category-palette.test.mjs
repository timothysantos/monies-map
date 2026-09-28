import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORY_COLOURS,
  CATEGORY_COLOURS_BY_FORMER,
  FALLBACK_CATEGORY_COLOUR,
  categoryDisplayColour
} from "../src/domain/category-palette.ts";
import { COLOR_OPTIONS, FALLBACK_THEME } from "../src/client/ui-options.jsx";
import { categories as DEMO_CATEGORIES } from "../src/domain/demo-data.ts";
import { SHOWCASE_CATEGORIES } from "../src/domain/demo-showcase-data.ts";

// The category palette is calm but legible: every colour reads 3:1 on white
// (a donut segment or icon on the panel), keeps its former hue family, and
// stays distinguishable from every other one.

const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (colour) => { const [r, g, b] = colour.map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (colour, share, base) => colour.map((value, index) => value * share + base[index] * (1 - share));
const WHITE = [255, 255, 255];
const TEXT = [38, 35, 31];
function hue([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function lab(colour) {
  const [r, g, b] = colour.map(channel);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => { const p = lab(a); const q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

test("the picker offers the 31 calm colours, in the former order", () => {
  assert.equal(CATEGORY_COLOURS.length, 31);
  assert.deepEqual(COLOR_OPTIONS, CATEGORY_COLOURS);
  assert.equal(new Set(CATEGORY_COLOURS).size, 31);
  assert.equal(FALLBACK_THEME.colorHex, FALLBACK_CATEGORY_COLOUR);
});

test("every colour reads on the panel and its glyph and label on their tints", () => {
  for (const colour of [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].map(rgb)) {
    assert.ok(contrast(colour, WHITE) >= 3, `${colour} is ${contrast(colour, WHITE).toFixed(2)}:1 on white`);
    // The icon glyph (70% with the text ink) on the strongest icon tint (34%).
    assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, WHITE)) >= 3);
    // A percentage label (62% with the text ink) on white is text: 4.5:1.
    assert.ok(contrast(mix(colour, 0.62, TEXT), WHITE) >= 4.5);
  }
});

test("each colour keeps its former hue family and all stay distinguishable", () => {
  for (const [former, colour] of Object.entries(CATEGORY_COLOURS_BY_FORMER)) {
    const before = hue(rgb(former));
    const after = hue(rgb(colour));
    if (before === null || after === null) continue;
    const shift = Math.min(Math.abs(before - after), 360 - Math.abs(before - after));
    assert.ok(shift <= 12, `${former} -> ${colour} moved ${shift.toFixed(1)} degrees`);
  }
  let closest = Infinity;
  for (let i = 0; i < CATEGORY_COLOURS.length; i += 1) {
    for (let j = i + 1; j < CATEGORY_COLOURS.length; j += 1) {
      closest = Math.min(closest, deltaE(rgb(CATEGORY_COLOURS[i]), rgb(CATEGORY_COLOURS[j])));
    }
  }
  // The former palette's closest pair was 3.0 apart (two near-identical oranges).
  assert.ok(closest >= 6, `closest pair is only ${closest.toFixed(1)} apart`);
});

test("a stored former colour shows as its calm one; a calm or custom colour is kept", () => {
  assert.equal(categoryDisplayColour("#F7A21B"), "#C0862A");
  assert.equal(categoryDisplayColour("#f7a21b"), "#C0862A");
  assert.equal(categoryDisplayColour("#C0862A"), "#C0862A");
  assert.equal(categoryDisplayColour("#123456"), "#123456");
  assert.equal(categoryDisplayColour(undefined), FALLBACK_CATEGORY_COLOUR);
  // A custom colour too light for the panel is darkened just enough.
  const custom = categoryDisplayColour("#9FE3D8");
  assert.notEqual(custom, "#9FE3D8");
  assert.ok(contrast(rgb(custom), WHITE) >= 3);
  assert.equal(categoryDisplayColour(custom), custom, "showing a shown colour again changes nothing");
  // Every seeded demo category shows a legible colour; former ones from the palette.
  for (const category of [...DEMO_CATEGORIES, ...SHOWCASE_CATEGORIES]) {
    const shown = categoryDisplayColour(category.colorHex);
    assert.ok(contrast(rgb(shown), WHITE) >= 3, category.name);
    if (CATEGORY_COLOURS_BY_FORMER[category.colorHex.toUpperCase()]) {
      assert.ok([...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].includes(shown), category.name);
    }
  }
});

test("categories reach every page in their shown colour", async () => {
  const { loadCategories } = await import("../src/domain/app-repository-categories.ts");
  const rows = [
    { id: "c1", name: "Food & Drinks", slug: "food-drinks", icon_key: "utensils", color_hex: "#F7A21B", sort_order: 1, is_system: 1 },
    { id: "c2", name: "Custom", slug: "custom", icon_key: "receipt", color_hex: "#C0862A", sort_order: 2, is_system: 0 }
  ];
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }), all: async () => ({ results: rows }) }) };
  const categories = await loadCategories(db);
  assert.deepEqual(categories.map((category) => category.colorHex), ["#C0862A", "#C0862A"]);
});
