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

// The category palette is a faded 1970s print: every colour belongs to one of
// the 70s families, reads 3:1 on the cream panel (a donut segment or icon),
// its glyph and label read on their tints, and it stays distinguishable from
// every other one.

const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (colour) => { const [r, g, b] = colour.map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (colour, share, base) => colour.map((value, index) => value * share + base[index] * (1 - share));
const WHITE = [255, 255, 255];
// --panel (rgba(255, 253, 248, 0.92)) over --bg (#eee4cf), and --text.
const PANEL = mix([255, 253, 248], 0.92, rgb("#eee4cf"));
const TEXT = rgb("#3b2a1f");
function lab(colour) {
  const [r, g, b] = colour.map(channel);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => { const p = lab(a); const q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const lch = (colour) => { const [l, a, b] = lab(colour); return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }; };

// The 70s families as CIELAB hue bands: rust and burnt orange (35-65), tan,
// brown, harvest gold and mustard (45-95), avocado and olive (95-125), dusty
// teal from sea green to denim (165-250) and mauve from lilac through plum to
// dusty rose (290-360 and 0-15). Greys (chroma under 12) are warm or teal greys.
const SEVENTIES_HUES = [[0, 15], [35, 125], [165, 250], [290, 360]];

test("the picker offers the 31 colours, in the former order", () => {
  assert.equal(CATEGORY_COLOURS.length, 31);
  assert.deepEqual(COLOR_OPTIONS, CATEGORY_COLOURS);
  assert.equal(new Set(CATEGORY_COLOURS).size, 31);
  assert.equal(FALLBACK_THEME.colorHex, FALLBACK_CATEGORY_COLOUR);
  assert.equal(CATEGORY_COLOURS[0], "#566432", "Income is avocado");
  assert.equal(CATEGORY_COLOURS_BY_FORMER["#F7A21B"], "#C67D3F", "Food & Drinks is burnt orange");
});

test("every colour reads on the cream panel and its glyph and label on their tints", () => {
  for (const hex of [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR]) {
    const colour = rgb(hex);
    assert.ok(contrast(colour, PANEL) >= 3, `${hex} is ${contrast(colour, PANEL).toFixed(2)}:1 on the panel`);
    assert.ok(contrast(colour, WHITE) >= 3, `${hex} on white`);
    // The icon glyph (70% with the text ink) on the strongest icon tint (34%).
    assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, WHITE)) >= 3, `${hex} glyph`);
    assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, PANEL)) >= 3, `${hex} glyph on the panel tint`);
    // A percentage label (62% with the text ink) on the panel is text: 4.5:1.
    assert.ok(contrast(mix(colour, 0.62, TEXT), PANEL) >= 4.5, `${hex} label`);
  }
});

test("each colour is a faded 70s hue and all stay distinguishable", () => {
  for (const hex of [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR]) {
    const { c, h } = lch(rgb(hex));
    // Faded print: no saturated fills.
    assert.ok(c <= 52, `${hex} chroma ${c.toFixed(0)} is too saturated`);
    if (c < 12) continue;
    assert.ok(SEVENTIES_HUES.some(([from, to]) => h >= from && h <= to), `${hex} hue ${h.toFixed(0)} is outside the 70s families`);
  }
  let closest = Infinity;
  const palette = [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR];
  for (let i = 0; i < palette.length; i += 1) {
    for (let j = i + 1; j < palette.length; j += 1) {
      closest = Math.min(closest, deltaE(rgb(palette[i]), rgb(palette[j])));
    }
  }
  // The original palette's closest pair was 3.0 apart (two near-identical oranges).
  assert.ok(closest >= 8, `closest pair is only ${closest.toFixed(1)} apart`);
});

test("a stored former or pastel-era colour shows as its 70s one; a 70s or custom colour is kept", () => {
  assert.equal(categoryDisplayColour("#F7A21B"), "#C67D3F");
  assert.equal(categoryDisplayColour("#f7a21b"), "#C67D3F");
  // The calm pastel colour the picker saved for Food & Drinks before.
  assert.equal(categoryDisplayColour("#C0862A"), "#C67D3F");
  assert.equal(categoryDisplayColour("#c0862a"), "#C67D3F");
  // Every pastel-era colour lands on a 70s one.
  for (const pastel of ["#27725F", "#BF7D51", "#33A471", "#5C90C9", "#DE726D", "#9385D9", "#879930"]) {
    assert.ok(CATEGORY_COLOURS.includes(categoryDisplayColour(pastel)), pastel);
  }
  assert.equal(categoryDisplayColour("#C67D3F"), "#C67D3F");
  assert.equal(categoryDisplayColour("#123456"), "#123456");
  assert.equal(categoryDisplayColour(undefined), FALLBACK_CATEGORY_COLOUR);
  assert.equal(categoryDisplayColour("not a colour"), FALLBACK_CATEGORY_COLOUR);
  // A custom colour too light for the panel is darkened just enough.
  const custom = categoryDisplayColour("#9FE3D8");
  assert.notEqual(custom, "#9FE3D8");
  assert.ok(contrast(rgb(custom), PANEL) >= 3);
  assert.equal(categoryDisplayColour(custom), custom, "showing a shown colour again changes nothing");
  // Every seeded demo category shows a legible colour; former ones from the palette.
  for (const category of [...DEMO_CATEGORIES, ...SHOWCASE_CATEGORIES]) {
    const shown = categoryDisplayColour(category.colorHex);
    assert.ok(contrast(rgb(shown), PANEL) >= 3, category.name);
    if (CATEGORY_COLOURS_BY_FORMER[category.colorHex.toUpperCase()]) {
      assert.ok([...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].includes(shown), category.name);
    }
  }
});

test("categories reach every page in their shown colour", async () => {
  const { loadCategories } = await import("../src/domain/app-repository-categories.ts");
  const rows = [
    { id: "c1", name: "Food & Drinks", slug: "food-drinks", icon_key: "utensils", color_hex: "#F7A21B", sort_order: 1, is_system: 1 },
    { id: "c2", name: "Custom", slug: "custom", icon_key: "receipt", color_hex: "#C0862A", sort_order: 2, is_system: 0 },
    { id: "c3", name: "Seventies", slug: "seventies", icon_key: "receipt", color_hex: "#C67D3F", sort_order: 3, is_system: 0 }
  ];
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }), all: async () => ({ results: rows }) }) };
  const categories = await loadCategories(db);
  assert.deepEqual(categories.map((category) => category.colorHex), ["#C67D3F", "#C67D3F", "#C67D3F"]);
});
