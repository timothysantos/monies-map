import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  applyColours,
  COLOUR_MODES,
  COLOUR_PRESETS,
  DEFAULT_MODE,
  DEFAULT_PRESET_ID,
  findColourPreset,
  MODE_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  readStoredMode,
  readStoredPresetId,
  resolveMode,
  variantSheetId
} from "../src/client/colour-presets.js";
import { paletteColour } from "../src/client/palette-colour.js";
import { CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR } from "../src/domain/category-palette.ts";
import { contrast, deltaE, hexRgb, loadPresets, mix, readPresetSheet, readRootTokens, ROOT, variantSelector } from "./support/colour-presets.mjs";

// Colour presets (design.md, "Colour presets"): each one is a whole scheme
// in a light and a dark mode, so every mode sheet sets every colour token
// the default sets, every token the stylesheets read only from a preset, and
// a colour for every palette colour the client draws. Its category colours
// read and stay apart as the 70s ones do.

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
// The surface tokens every preset and mode shares the card rule through.
const SURFACE_TOKENS = ["--page", "--card", "--card-border", "--card-shadow", "--eyebrow", "--chip"];
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
const SHEET_IDS = PRESETS.filter((preset) => preset.sheetId).map((preset) => preset.sheetId);

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

test("each preset comes in Light and Dark, and the mode defaults to Auto (follow the phone)", () => {
  assert.deepEqual(COLOUR_MODES, ["light", "dark", "auto"]);
  assert.equal(DEFAULT_MODE, "auto");
  assert.equal(resolveMode("light", true), "light");
  assert.equal(resolveMode("dark", false), "dark");
  assert.equal(resolveMode("auto", true), "dark");
  assert.equal(resolveMode("auto", false), "light");
  assert.equal(resolveMode("sepia", true), "dark", "an unknown mode is Auto");
  // One sheet per preset and mode, except the default's light mode, which
  // is :root of the first-screen stylesheet. Code's old dark look is Code Dark.
  assert.equal(variantSheetId("70s", "light"), null);
  assert.equal(variantSheetId("70s", "dark"), "70s-dark");
  assert.equal(variantSheetId("code", "dark"), "code-dark");
  assert.equal(variantSheetId("code", "light"), "code-light");
  const onDisk = readdirSync(path.join(ROOT, "public/palettes")).filter((name) => name.endsWith(".css")).map((name) => name.replace(/\.css$/, "")).sort();
  assert.deepEqual(onDisk, [...SHEET_IDS].sort(), "no stale single-mode sheets left behind");
  assert.equal(SHEET_IDS.length, 11);
});

test("the default keeps every colour in :root of the first-screen stylesheet and ships no preset sheet", () => {
  assert.ok(COLOUR_TOKENS.length >= 34, `found ${COLOUR_TOKENS.length} colour tokens`);
  for (const name of SURFACE_TOKENS) assert.ok(ROOT_TOKENS[name], `:root sets ${name}`);
  assert.ok(PRESET_ONLY_TOKENS.length >= 5, `found ${PRESET_ONLY_TOKENS.join(", ")}`);
  for (const name of PRESET_ONLY_TOKENS) assert.equal(ROOT_TOKENS[name], undefined, `${name} is set only by a preset`);
  assert.throws(() => readPresetSheet("70s-light"));
  // No preset or mode rules ride along in the first-screen stylesheet.
  assert.doesNotMatch(readFileSync(path.join(ROOT, "public/styles.css"), "utf8"), /data-palette|data-mode/);
});

for (const preset of PRESETS.filter((variant) => variant.sheetId)) {
  test(`${preset.id}: sets every token of a whole scheme`, () => {
    for (const name of [...COLOUR_TOKENS, ...SURFACE_TOKENS, ...PRESET_ONLY_TOKENS]) {
      assert.ok(preset.own[name], `${preset.id} sets ${name}`);
    }
    for (const hex of PALETTE_COLOURS) {
      assert.match(preset.own[`--cat-${hex.slice(1).toLowerCase()}`] ?? "", /^#[0-9a-f]{6}$/, `${preset.id} re-colours ${hex}`);
    }
    // Only its own preset and mode: a sheet never changes another one.
    // Rules that hold in both modes (Black & White's type, Code's
    // monospace) may name just the preset.
    const css = readPresetSheet(preset.sheetId).replace(/\/\*[\s\S]*?\*\//g, "");
    const own = variantSelector(preset.presetId, preset.mode);
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(([, selector]) => selector.trim());
    assert.ok(selectors.includes(own), `${preset.sheetId} has a ${own} block`);
    for (const selector of selectors) {
      const allowed = selector.startsWith(own) || (preset.presetId !== DEFAULT_PRESET_ID && selector.startsWith(`:root[data-palette="${preset.presetId}"]:not([data-money-privacy`))
        || (preset.presetId !== DEFAULT_PRESET_ID && selector.startsWith(`:root[data-palette="${preset.presetId}"] `));
      assert.ok(allowed, `${preset.sheetId}: ${selector}`);
    }
    // A dark mode tells the browser, so form controls and scrollbars follow.
    if (preset.isDark) assert.match(css, /color-scheme:\s*dark/);
    else assert.doesNotMatch(css, /color-scheme:\s*dark/);
    // Its own accent, not the 70s terracotta (70s Dark lifts the terracotta
    // so it reads on the dark page).
    assert.notEqual(preset.own["--accent"], ROOT_TOKENS["--accent"]);
    assert.notEqual(preset.own["--splits-rgb"], ROOT_TOKENS["--splits-rgb"]);
  });
}

test("each preset's light and dark modes are different schemes with the same identity", () => {
  for (const { id } of COLOUR_PRESETS) {
    const light = PRESETS.find((preset) => preset.id === `${id}-light`);
    const dark = PRESETS.find((preset) => preset.id === `${id}-dark`);
    assert.notEqual(light.tokens["--page"], dark.tokens["--page"], id);
    assert.ok(contrast(light.rgb("--page"), dark.rgb("--page")) >= 8, `${id} light and dark pages differ`);
  }
  // Black & White Dark is white on black.
  const monoDark = PRESETS.find((preset) => preset.id === "mono-dark");
  for (const channel of monoDark.rgb("--text")) assert.ok(channel >= 245, `text ${monoDark.tokens["--text"]} is white`);
  for (const channel of monoDark.rgb("--page")) assert.ok(channel <= 16, `page ${monoDark.tokens["--page"]} is black`);
  assert.ok(contrast(monoDark.rgb("--text"), monoDark.rgb("--page")) >= 15, "white on black");
  // Code Dark keeps the old Code look.
  const codeDark = PRESETS.find((preset) => preset.id === "code-dark");
  assert.equal(codeDark.tokens["--accent-strong"], "#56d4dd");
  assert.equal(codeDark.tokens["--text"], "#e6edf3");
});

test("each preset's page carries its own colour: no two presets share a page in a mode", () => {
  for (const mode of ["light", "dark"]) {
    const pages = PRESETS.filter((preset) => preset.mode === mode && preset.presetId !== "mono").map((preset) => [preset.id, preset.rgb("--page")]);
    for (let i = 0; i < pages.length; i += 1) {
      for (let j = i + 1; j < pages.length; j += 1) {
        assert.ok(deltaE(pages[i][1], pages[j][1]) >= 4, `${pages[i][0]} and ${pages[j][0]} pages look alike`);
      }
    }
    // The eyebrow is the preset's second colour, not its accent.
    for (const preset of PRESETS.filter((variant) => variant.mode === mode && variant.presetId !== "mono")) {
      assert.ok(deltaE(preset.rgb("--eyebrow"), preset.rgb("--accent-strong")) >= 20, `${preset.id} eyebrow is a second colour`);
    }
  }
});

for (const preset of PRESETS) {
  test(`${preset.id}: category colours read on the panel, their glyphs and labels on their tints`, () => {
    const PANEL = preset.rgb("--panel");
    const PAPER = preset.rgb("--paper-rgb");
    const CARD = preset.rgb("--card");
    const TEXT = preset.rgb("--text");
    for (const hex of PALETTE_COLOURS) {
      const colour = hexRgb(preset.cat(hex));
      const label = `${preset.id} ${hex} as ${preset.cat(hex)}`;
      assert.ok(contrast(colour, PANEL) >= 3, `${label} is ${contrast(colour, PANEL).toFixed(2)}:1 on the panel`);
      assert.ok(contrast(colour, PAPER) >= 3, `${label} on the paper`);
      assert.ok(contrast(colour, CARD) >= 3, `${label} on a card`);
      // The icon glyph (70% with the text ink) on the strongest icon tint (34%).
      assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, PAPER)) >= 3, `${label} glyph`);
      assert.ok(contrast(mix(colour, 0.7, TEXT), mix(colour, 0.34, PANEL)) >= 3, `${label} glyph on the panel tint`);
      // A percentage label (62% with the text ink) on the panel is text: 4.5:1.
      assert.ok(contrast(mix(colour, 0.62, TEXT), PANEL) >= 4.5, `${label} label`);
    }
  });

  test(`${preset.id}: the 31 category colours stay ${preset.presetId === "mono" ? "greys" : "distinguishable"}`, () => {
    const palette = [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].map((hex) => hexRgb(preset.cat(hex)));
    if (preset.presetId === "mono") {
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

test("Black & White shows money direction in the type in both modes", () => {
  for (const mode of ["light", "dark"]) {
    const css = readPresetSheet(`mono-${mode}`);
    assert.match(css, /:root\[data-palette="mono"\]:not\(\[data-money-privacy="hidden"\]\) \.money-in \{ font-weight: 700; \}/, mode);
    assert.match(css, /\.money-plan \{ text-decoration: underline dotted/, mode);
  }
});

test("each preset's Settings chip shows its page, accent, money in and money out for the mode in use", () => {
  for (const preset of PRESETS) {
    const { swatches } = findColourPreset(preset.presetId);
    assert.deepEqual(swatches[preset.mode], ["--page", "--accent-strong", "--pastel-mint-ink", "--pastel-rose-ink"].map((name) => preset.tokens[name]), preset.id);
  }
});

// ---------------------------------------------------------------------------
// The inline script in index.html, run against a stand-in page.

const HTML = readFileSync(path.join(ROOT, "index.html"), "utf8");
const INLINE_SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function runInlineScript({ stored = {}, prefersDark = false, blocked = false } = {}) {
  const attributes = new Map();
  const written = [];
  const appended = [];
  const listeners = [];
  const media = { matches: prefersDark, addEventListener: (type, listener) => listeners.push(listener) };
  const data = new Map(Object.entries(stored));
  const context = {
    window: { matchMedia: () => media },
    localStorage: {
      getItem: (key) => { if (blocked) throw new Error("blocked"); return data.get(key) ?? null; }
    },
    document: {
      documentElement: {
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: (name) => attributes.delete(name)
      },
      write: (html) => written.push(html),
      querySelector: (selector) => [...written, ...appended.map((link) => `data-palette-sheet="${link.attributes["data-palette-sheet"]}"`)]
        .some((html) => html.includes(selector.match(/"([^"]+)"/)[1] + '"')) ? {} : null,
      createElement: () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
      head: { appendChild: (link) => appended.push(link) }
    }
  };
  context.window.localStorage = context.localStorage;
  vm.runInNewContext(INLINE_SCRIPT, context);
  return {
    attributes,
    written,
    appended,
    data,
    media,
    // The phone switches between light and dark while the app is open.
    flip(matches) {
      media.matches = matches;
      for (const listener of listeners) listener({ matches });
    }
  };
}

test("the inline script in index.html sits in the head after the default stylesheet and knows exactly the preset ids", () => {
  assert.ok(HTML.indexOf("<script>") > HTML.indexOf('href="/styles.css"'), "after the default stylesheet");
  assert.ok(HTML.indexOf("<script>") < HTML.indexOf("</head>"), "in the head, before the body paints");
  assert.match(INLINE_SCRIPT, new RegExp(`localStorage\\.getItem\\(`));
  assert.ok(INLINE_SCRIPT.includes(`"${PALETTE_STORAGE_KEY}"`) && INLINE_SCRIPT.includes(`"${MODE_STORAGE_KEY}"`));
  const ids = INLINE_SCRIPT.match(/\^\(([^)]*)\)\$/)[1].split("|");
  assert.deepEqual(ids, COLOUR_PRESETS.filter((preset) => preset.id !== DEFAULT_PRESET_ID).map((preset) => preset.id));
});

test("before the first paint: a stored preset and mode write that sheet and set both attributes", () => {
  const page = runInlineScript({ stored: { [PALETTE_STORAGE_KEY]: "60s", [MODE_STORAGE_KEY]: "dark" } });
  assert.deepEqual(page.written, ['<link rel="stylesheet" href="/palettes/60s-dark.css" data-palette-sheet="60s-dark" />']);
  assert.equal(page.attributes.get("data-palette"), "60s");
  assert.equal(page.attributes.get("data-mode"), "dark");
});

test("before the first paint: nothing stored is 70s Warm in Auto, light on a light phone with no sheet to fetch", () => {
  const page = runInlineScript();
  assert.deepEqual(page.written, []);
  assert.equal(page.attributes.has("data-palette"), false);
  assert.equal(page.attributes.get("data-mode"), "light");
});

test("before the first paint: Auto on a dark phone is the preset's dark sheet, even for the default", () => {
  const page = runInlineScript({ prefersDark: true });
  assert.deepEqual(page.written, ['<link rel="stylesheet" href="/palettes/70s-dark.css" data-palette-sheet="70s-dark" />']);
  assert.equal(page.attributes.has("data-palette"), false);
  assert.equal(page.attributes.get("data-mode"), "dark");
});

test("before the first paint: blocked storage or unknown values are 70s Warm in Auto", () => {
  const blocked = runInlineScript({ blocked: true, prefersDark: true, stored: { [PALETTE_STORAGE_KEY]: "code" } });
  assert.equal(blocked.attributes.has("data-palette"), false);
  assert.equal(blocked.attributes.get("data-mode"), "dark");
  const unknown = runInlineScript({ stored: { [PALETTE_STORAGE_KEY]: "neon", [MODE_STORAGE_KEY]: "sepia" } });
  assert.deepEqual(unknown.written, []);
  assert.equal(unknown.attributes.has("data-palette"), false);
  assert.equal(unknown.attributes.get("data-mode"), "light");
});

test("Auto follows the phone while the app is open; a chosen Light or Dark does not", () => {
  const auto = runInlineScript({ stored: { [PALETTE_STORAGE_KEY]: "modern" } });
  assert.equal(auto.attributes.get("data-mode"), "light");
  auto.flip(true);
  // The dark sheet loads first; the attribute switches once it is in.
  assert.equal(auto.appended.length, 1);
  assert.equal(auto.appended[0].href, "/palettes/modern-dark.css");
  assert.equal(auto.attributes.get("data-mode"), "light");
  auto.appended[0].onload();
  assert.equal(auto.attributes.get("data-mode"), "dark");
  assert.equal(auto.attributes.get("data-palette"), "modern");
  // Back to light: the first paint's light sheet is still in, so it switches at once.
  assert.deepEqual(auto.written, ['<link rel="stylesheet" href="/palettes/modern-light.css" data-palette-sheet="modern-light" />']);
  auto.flip(false);
  assert.equal(auto.appended.length, 1);
  assert.equal(auto.attributes.get("data-mode"), "light");
  // A default page on a phone that turns dark fetches 70s Warm's dark sheet.
  const warm = runInlineScript();
  warm.flip(true);
  assert.equal(warm.appended[0].href, "/palettes/70s-dark.css");
  warm.appended[0].onload();
  assert.equal(warm.attributes.get("data-mode"), "dark");
  assert.equal(warm.attributes.has("data-palette"), false);

  const chosen = runInlineScript({ stored: { [PALETTE_STORAGE_KEY]: "modern", [MODE_STORAGE_KEY]: "light" } });
  chosen.flip(true);
  assert.equal(chosen.appended.length, 0);
  assert.equal(chosen.attributes.get("data-mode"), "light");
});

// ---------------------------------------------------------------------------
// The runtime helpers, against a stand-in document and storage.

function fakePage({ blocked = false, stored = {} } = {}) {
  const attributes = new Map();
  const links = [];
  const data = new Map(Object.entries(stored));
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

test("a stored preset and mode are read back; blocked or unknown storage means 70s Warm in Auto", () => {
  assert.equal(readStoredPresetId(fakePage({ stored: { [PALETTE_STORAGE_KEY]: "code" } }).storage), "code");
  assert.equal(readStoredPresetId(fakePage({ stored: { [PALETTE_STORAGE_KEY]: "neon" } }).storage), "70s");
  assert.equal(readStoredPresetId(fakePage().storage), "70s");
  assert.equal(readStoredPresetId(fakePage({ blocked: true, stored: { [PALETTE_STORAGE_KEY]: "code" } }).storage), "70s");
  assert.equal(readStoredMode(fakePage({ stored: { [MODE_STORAGE_KEY]: "dark" } }).storage), "dark");
  assert.equal(readStoredMode(fakePage({ stored: { [MODE_STORAGE_KEY]: "sepia" } }).storage), "auto");
  assert.equal(readStoredMode(fakePage().storage), "auto");
  assert.equal(readStoredMode(fakePage({ blocked: true, stored: { [MODE_STORAGE_KEY]: "light" } }).storage), "auto");
});

test("choosing a preset and mode loads that sheet once, sets both attributes and remembers both; the defaults clear storage", async () => {
  const page = fakePage();
  await applyColours({ presetId: "80s", mode: "dark" }, { ...page, prefersDark: false });
  assert.equal(page.attributes.get("data-palette"), "80s");
  assert.equal(page.attributes.get("data-mode"), "dark");
  assert.equal(page.data.get(PALETTE_STORAGE_KEY), "80s");
  assert.equal(page.data.get(MODE_STORAGE_KEY), "dark");
  assert.deepEqual(page.links.map((link) => [link.href, link.rel]), [["/palettes/80s-dark.css", "stylesheet"]]);
  await applyColours({ presetId: "80s", mode: "light" }, { ...page, prefersDark: false });
  await applyColours({ presetId: "80s", mode: "dark" }, { ...page, prefersDark: false });
  assert.equal(page.links.length, 2, "a sheet already on the page is not fetched again");
  assert.equal(page.attributes.get("data-mode"), "dark");
  // Auto stores nothing and follows the phone.
  await applyColours({ presetId: "80s", mode: "auto" }, { ...page, prefersDark: false });
  assert.equal(page.data.has(MODE_STORAGE_KEY), false);
  assert.equal(page.attributes.get("data-mode"), "light");
  // 70s Warm light is the first-screen stylesheet: no sheet, no palette attribute.
  await applyColours({ presetId: "70s", mode: "light" }, { ...page, prefersDark: true });
  assert.equal(page.attributes.has("data-palette"), false);
  assert.equal(page.attributes.get("data-mode"), "light");
  assert.equal(page.data.has(PALETTE_STORAGE_KEY), false);
  assert.equal(page.links.length, 2);
  // 70s Warm dark has its own sheet.
  await applyColours({ presetId: "70s", mode: "auto" }, { ...page, prefersDark: true });
  assert.equal(page.links.at(-1).href, "/palettes/70s-dark.css");
  assert.equal(page.attributes.get("data-mode"), "dark");
});

test("a later choice wins over a sheet that loads late, and blocked storage still applies the choice", async () => {
  const page = fakePage({ blocked: true });
  const first = applyColours({ presetId: "code", mode: "dark" }, { ...page, prefersDark: false });
  const second = applyColours({ presetId: "60s", mode: "light" }, { ...page, prefersDark: false });
  await Promise.all([first, second]);
  assert.equal(page.attributes.get("data-palette"), "60s");
  assert.equal(page.attributes.get("data-mode"), "light");
});

test("a palette colour is drawn as the preset's token, falling back to the 70s colour", () => {
  assert.equal(paletteColour("#566432"), "var(--cat-566432, #566432)");
  assert.equal(paletteColour("var(--accent-strong)"), "var(--accent-strong)");
  assert.equal(paletteColour(undefined), undefined);
});
