import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  applyColourPreset,
  COLOUR_PRESETS,
  DEFAULT_PRESET_ID,
  findColourPreset,
  PALETTE_STORAGE_KEY,
  readStoredPresetId
} from "../src/client/colour-presets.js";
import { paletteColour } from "../src/client/palette-colour.js";
import { CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR } from "../src/domain/category-palette.ts";
import { contrast, deltaE, hexRgb, loadPresets, mix, readPresetSheet, readRootTokens, ROOT } from "./support/colour-presets.mjs";

// Colour presets (design.md, "Colour presets"): each one is a whole scheme,
// so it sets every colour token the default sets, every token the
// stylesheets read only from a preset, and a colour for every palette colour
// the client draws. Its category colours read and stay apart as the 70s
// ones do.

const PRESETS = loadPresets();
const ROOT_TOKENS = readRootTokens();

function walk(dir, extensions) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return walk(file, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [file] : [];
  });
}
const STYLESHEETS = [path.join(ROOT, "public/styles.css"), ...walk(path.join(ROOT, "src"), [".css"])];
// The preset list's own swatch dots are not palette colours.
const CLIENT_CODE = walk(path.join(ROOT, "src/client"), [".js", ".jsx"]).filter((file) => !file.endsWith("colour-presets.js"));

// Layout tokens, and tokens built from other tokens, are the same in every preset.
const NOT_COLOUR = new Set([
  "--chrome-edge", "--chrome-radius", "--sheet-radius",
  // The desktop chrome's radii and type scale (design.md, "Desktop Chrome").
  "--radius-control", "--radius-group", "--type-title", "--type-control", "--type-small"
]);
const COLOUR_TOKENS = Object.entries(ROOT_TOKENS)
  .filter(([name, value]) => !NOT_COLOUR.has(name) && !value.includes("var("))
  .map(([name]) => name);
// Rules write these as var(--name-rgb, r g b): the 70s shade is the
// fallback, and only a preset sets the token.
const PRESET_ONLY_TOKENS = [...new Set(STYLESHEETS.flatMap((file) => (
  [...readFileSync(file, "utf8").matchAll(/var\((--[\w-]+),\s*\d+ \d+ \d+\)/g)].map(([, name]) => name)
)))].sort();
// Every palette colour the client draws: the category palette and the
// person, group and bubble colours written in client code.
const PALETTE_COLOURS = [...new Set([
  ...CATEGORY_COLOURS,
  FALLBACK_CATEGORY_COLOUR,
  ...CLIENT_CODE.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map(([, hex]) => hex.toUpperCase()))
])];

test("the presets are 70s Warm (the default), 60s Mod, 80s Pop, Modern, Black & White and Code", () => {
  assert.deepEqual(COLOUR_PRESETS.map((preset) => [preset.id, preset.name]), [
    ["70s", "70s Warm"],
    ["60s", "60s Mod"],
    ["80s", "80s Pop"],
    ["modern", "Modern"],
    ["mono", "Black & White"],
    ["code", "Code"]
  ]);
  assert.equal(DEFAULT_PRESET_ID, "70s");
  assert.equal(findColourPreset("nope").id, "70s", "an unknown id falls back to the default");
});

test("the default keeps every colour in :root of the first-screen stylesheet and ships no preset sheet", () => {
  assert.ok(COLOUR_TOKENS.length >= 28, `found ${COLOUR_TOKENS.length} colour tokens`);
  assert.ok(PRESET_ONLY_TOKENS.length >= 5, `found ${PRESET_ONLY_TOKENS.join(", ")}`);
  for (const name of PRESET_ONLY_TOKENS) assert.equal(ROOT_TOKENS[name], undefined, `${name} is set only by a preset`);
  assert.throws(() => readPresetSheet(DEFAULT_PRESET_ID));
  // No preset rules ride along in the first-screen stylesheet.
  assert.doesNotMatch(readFileSync(path.join(ROOT, "public/styles.css"), "utf8"), /data-palette/);
});

for (const preset of PRESETS.slice(1)) {
  test(`${preset.id}: sets every token of a whole scheme`, () => {
    for (const name of [...COLOUR_TOKENS, ...PRESET_ONLY_TOKENS]) {
      assert.ok(preset.own[name], `${preset.id} sets ${name}`);
    }
    for (const hex of PALETTE_COLOURS) {
      assert.match(preset.own[`--cat-${hex.slice(1).toLowerCase()}`] ?? "", /^#[0-9a-f]{6}$/, `${preset.id} re-colours ${hex}`);
    }
    // Only its own attribute: a preset never changes another one.
    const selectors = [...readPresetSheet(preset.id).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map(([, selector]) => selector.trim());
    for (const selector of selectors) assert.match(selector, new RegExp(`^:root\\[data-palette="${preset.id}"\\]`), selector);
    // Its own accent, not the 70s terracotta.
    assert.notEqual(preset.own["--accent"], ROOT_TOKENS["--accent"]);
    assert.notEqual(preset.own["--splits-rgb"], ROOT_TOKENS["--splits-rgb"]);
  });
}

for (const preset of PRESETS) {
  test(`${preset.id}: category colours read on the panel, their glyphs and labels on their tints`, () => {
    const PANEL = preset.rgb("--panel");
    const PAPER = preset.rgb("--paper-rgb");
    const TEXT = preset.rgb("--text");
    for (const hex of PALETTE_COLOURS) {
      const colour = hexRgb(preset.cat(hex));
      const label = `${preset.id} ${hex} as ${preset.cat(hex)}`;
      assert.ok(contrast(colour, PANEL) >= 3, `${label} is ${contrast(colour, PANEL).toFixed(2)}:1 on the panel`);
      assert.ok(contrast(colour, PAPER) >= 3, `${label} on the paper`);
      // The icon glyph (70% with the text ink) on the strongest icon tint (34%).
      assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, PAPER)) >= 3, `${label} glyph`);
      assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, PANEL)) >= 3, `${label} glyph on the panel tint`);
      // A percentage label (62% with the text ink) on the panel is text: 4.5:1.
      assert.ok(contrast(mix(colour, 0.62, TEXT), PANEL) >= 4.5, `${label} label`);
    }
  });

  test(`${preset.id}: the 31 category colours stay ${preset.id === "mono" ? "greys" : "distinguishable"}`, () => {
    const palette = [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].map((hex) => hexRgb(preset.cat(hex)));
    if (preset.id === "mono") {
      // Black & White tells categories apart by icon and name, not hue.
      for (const colour of palette) assert.equal(new Set(colour).size, 1, `${colour} is a grey`);
      return;
    }
    let closest = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      for (let j = i + 1; j < palette.length; j += 1) closest = Math.min(closest, deltaE(palette[i], palette[j]));
    }
    assert.ok(closest >= 8, `closest pair is only ${closest.toFixed(1)} apart`);
  });
}

test("each preset's Settings chip shows its background, accent, money in and money out", () => {
  for (const preset of PRESETS) {
    const { swatches } = findColourPreset(preset.id);
    assert.deepEqual(swatches, ["--bg", "--accent-strong", "--pastel-mint-ink", "--pastel-rose-ink"].map((name) => preset.tokens[name]), preset.id);
  }
});

test("the inline script in index.html applies exactly the preset ids, before the first paint", () => {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(html.indexOf("<script>") > html.indexOf('href="/styles.css"'), "after the default stylesheet");
  assert.ok(html.indexOf("<script>") < html.indexOf("</head>"), "in the head, before the body paints");
  assert.match(script, new RegExp(`localStorage\\.getItem\\("${PALETTE_STORAGE_KEY}"\\)`));
  const ids = script.match(/\^\(([^)]*)\)\$/)[1].split("|");
  assert.deepEqual(ids, COLOUR_PRESETS.filter((preset) => preset.id !== DEFAULT_PRESET_ID).map((preset) => preset.id));
  assert.match(script, /try \{[\s\S]*\} catch/, "blocked storage keeps the default");
});

// A stand-in document and storage for the runtime helpers.
function fakePage({ blocked = false, stored = null } = {}) {
  const attributes = new Map();
  const links = [];
  const data = new Map(stored ? [[PALETTE_STORAGE_KEY, stored]] : []);
  const storage = {
    getItem: (key) => { if (blocked) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw new Error("blocked"); data.set(key, value); },
    removeItem: (key) => { if (blocked) throw new Error("blocked"); data.delete(key); }
  };
  const doc = {
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name)
    },
    querySelector: (selector) => links.find((link) => selector.includes(`"${link.dataset.paletteSheet}"`)) ?? null,
    createElement: () => {
      const listeners = {};
      return { dataset: {}, addEventListener: (type, listener) => { listeners[type] = listener; }, fire: (type) => listeners[type]?.() };
    },
    head: { append: (link) => { links.push(link); queueMicrotask(() => link.fire("load")); } }
  };
  return { attributes, links, data, storage, doc };
}

test("a stored preset is read back; blocked or unknown storage means the default", () => {
  assert.equal(readStoredPresetId(fakePage({ stored: "code" }).storage), "code");
  assert.equal(readStoredPresetId(fakePage({ stored: "neon" }).storage), "70s");
  assert.equal(readStoredPresetId(fakePage().storage), "70s");
  assert.equal(readStoredPresetId(fakePage({ blocked: true, stored: "code" }).storage), "70s");
});

test("choosing a preset loads its sheet once, sets the page attribute and remembers it; the default clears both", async () => {
  const page = fakePage();
  await applyColourPreset("80s", page);
  assert.equal(page.attributes.get("data-palette"), "80s");
  assert.equal(page.data.get(PALETTE_STORAGE_KEY), "80s");
  assert.deepEqual(page.links.map((link) => [link.href, link.rel]), [["/palettes/80s.css", "stylesheet"]]);
  await applyColourPreset("modern", page);
  await applyColourPreset("80s", page);
  assert.equal(page.links.length, 2, "a sheet already on the page is not fetched again");
  assert.equal(page.attributes.get("data-palette"), "80s");
  await applyColourPreset("70s", page);
  assert.equal(page.attributes.has("data-palette"), false);
  assert.equal(page.data.has(PALETTE_STORAGE_KEY), false);
});

test("a later choice wins over a sheet that loads late, and blocked storage still applies the preset", async () => {
  const page = fakePage({ blocked: true });
  const first = applyColourPreset("code", page);
  const second = applyColourPreset("60s", page);
  await Promise.all([first, second]);
  assert.equal(page.attributes.get("data-palette"), "60s");
});

test("a palette colour is drawn as the preset's token, falling back to the 70s colour", () => {
  assert.equal(paletteColour("#566432"), "var(--cat-566432, #566432)");
  assert.equal(paletteColour("var(--accent-strong)"), "var(--accent-strong)");
  assert.equal(paletteColour(undefined), undefined);
});
