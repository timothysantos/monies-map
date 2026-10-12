import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getPersonColour, getPersonColourVars } from "../src/client/person-colour.js";
import { getSplitGroupChipStyle } from "../src/client/entry-row-display.js";

// Every text-on-surface pair the tokens make meets WCAG AA (4.5:1), read
// from the live :root of public/styles.css so a token change is checked
// here (design.md, "Pastel palette": the 1970s warm direction). The fills
// stay soft (faded print), and the warning ink is a dark mustard because
// a mid harvest gold as text on the cream would fail.

const root = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(root, "public/styles.css"), "utf8");
const rootBlock = css.match(/:root\s*\{([^}]*)\}/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = Object.fromEntries([...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

function parse(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: [0, 2, 4].map((index) => parseInt(hex[1].slice(index, index + 2), 16)), alpha: 1 };
  const rgba = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (rgba) return { rgb: rgba.slice(1, 4).map(Number), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`not a plain colour: ${value}`);
}
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (colour) => { const [r, g, b] = colour.map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (colour, share, base) => colour.map((value, index) => value * share + base[index] * (1 - share));
const hexRgb = (hex) => parse(hex).rgb;
function lab(colour) {
  const [r, g, b] = colour.map(channel);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const token = (name) => {
  const { rgb, alpha } = parse(TOKENS[name]);
  // A translucent surface sits on the page background.
  return alpha === 1 ? rgb : mix(rgb, alpha, parse(TOKENS["--bg"]).rgb);
};
const WHITE = [255, 255, 255];
const BG = token("--bg");
const PANEL = token("--panel");
const CHROME = token("--chrome-surface");
const NEUTRAL = token("--pastel-neutral");
const TEXT = token("--text");
const MUTED = token("--muted");
// The darker end of the Splits orange panel (.panel-splits).
const SPLITS_DARK = [155, 74, 33];
const HUES = ["mint", "rose", "sky", "lavender", "butter"];
const AA = 4.5;

function assertAA(ink, surface, label) {
  const ratio = contrast(ink, surface);
  assert.ok(ratio >= AA, `${label} is ${ratio.toFixed(2)}:1`);
}

test("the 70s tokens are in :root with the same names", () => {
  for (const name of ["--bg", "--panel", "--text", "--muted", "--line", "--accent", "--accent-strong", "--pastel-neutral", ...HUES.flatMap((hue) => [`--pastel-${hue}`, `--pastel-${hue}-ink`])]) {
    assert.ok(TOKENS[name], `${name} is defined`);
  }
  // The terracotta accent the Splits theme is built on stays.
  assert.equal(TOKENS["--accent"], "#934923");
  assert.equal(TOKENS["--accent-strong"], "#b15e2f");
  // Chocolate ink and cream paper, not near-black and grey.
  assert.equal(TOKENS["--text"], "#3b2a1f");
  assert.equal(TOKENS["--bg"], "#eee4cf");
  assert.deepEqual(
    Object.fromEntries(HUES.map((hue) => [hue, [TOKENS[`--pastel-${hue}`], TOKENS[`--pastel-${hue}-ink`]]])),
    {
      mint: ["#e8ebd0", "#4c5e1a"], // avocado
      rose: ["#f5ded4", "#973223"], // brick red
      sky: ["#d6e7e2", "#2c5f5f"], // dusty teal
      lavender: ["#eedce6", "#6b4360"], // faded plum
      butter: ["#f5e4b8", "#664a0b"] // harvest gold, dark mustard ink
    }
  );
});

test("every pastel ink reads AA on the panel, its soft tint, its full fill and the Splits wash", () => {
  for (const hue of HUES) {
    const fill = token(`--pastel-${hue}`);
    const ink = token(`--pastel-${hue}-ink`);
    assertAA(ink, PANEL, `${hue} ink on the panel`);
    assertAA(ink, WHITE, `${hue} ink on white`);
    assertAA(ink, NEUTRAL, `${hue} ink on the neutral fill`);
    assertAA(ink, mix(fill, 0.6, PANEL), `${hue} ink on its soft tint`);
    assertAA(ink, fill, `${hue} ink on its full fill`);
    assertAA(ink, mix(fill, 0.94, SPLITS_DARK), `${hue} ink on the Splits wash`);
    // The 85% sky surfaces (Ask, the Summary month sheet) and the
    // check-in chip's 9% tint use the same ink.
    assertAA(ink, mix(fill, 0.85, WHITE), `${hue} ink on its 85% fill`);
    assertAA(ink, mix(ink, 0.09, PANEL), `${hue} ink on a 9% chip tint`);
  }
  // Import review puts the plum ink on the harvest gold fill.
  assertAA(token("--pastel-lavender-ink"), token("--pastel-butter"), "plum ink on harvest gold");
});

test("the chocolate text and the warm muted grey read AA on every neutral surface", () => {
  for (const [name, surface] of Object.entries({ bg: BG, panel: PANEL, chrome: CHROME, neutral: NEUTRAL, white: WHITE })) {
    assertAA(TEXT, surface, `text on ${name}`);
    assertAA(MUTED, surface, `muted on ${name}`);
  }
  for (const hue of HUES) assertAA(TEXT, token(`--pastel-${hue}`), `text on the ${hue} fill`);
  // The accent stays readable as text on the cream panel.
  assertAA(token("--accent"), PANEL, "accent on the panel");
  assertAA(token("--accent-strong"), PANEL, "accent-strong on the panel");
});

test("fills stay soft: light, low-chroma tints, never a saturated fill", () => {
  for (const name of [...HUES.map((hue) => `--pastel-${hue}`), "--pastel-neutral", "--bg"]) {
    const [lightness, a, b] = lab(token(name));
    assert.ok(lightness >= 88, `${name} lightness ${lightness.toFixed(0)}`);
    assert.ok(Math.hypot(a, b) <= 26, `${name} chroma ${Math.hypot(a, b).toFixed(0)}`);
  }
});

test("the guard catches a failing pair: a mid harvest gold as text on cream fails AA", () => {
  // Why the warning ink is a dark mustard and not the gold itself.
  assert.ok(contrast(hexRgb("#B48639"), PANEL) < AA);
  assert.ok(contrast(token("--pastel-butter"), PANEL) < 1.5, "the gold fill is a surface, never text");
});

// --person-ink and the split group chip ink are the colour 55% into --text.
const inkOf = (colour) => mix(colour, 0.55, TEXT);

test("person chips, bands and washes read AA with --person-ink", () => {
  const owners = ["Tim", "Joyce", "linked-splits", "Shared", "household", "Ethan", "Serene", "Dana", "Alex", "Kim"];
  const colours = new Set(owners.map((owner) => getPersonColour(owner)));
  assert.ok(colours.size >= 6, "the other-owner picks spread over the palette");
  assert.equal(getPersonColour("Tim"), "#46788E", "Tim is dusty teal");
  assert.equal(getPersonColour("Joyce"), "#B97680", "Joyce is mauve");
  assert.equal(getPersonColour("linked-splits"), "#BF7D51", "rows linked to Splits keep the terracotta");
  for (const owner of owners) {
    const colour = hexRgb(getPersonColour(owner));
    assert.match(getPersonColourVars(owner)["--person-ink"], /55%, var\(--text\)/);
    assertAA(inkOf(colour), mix(colour, 0.16, WHITE), `${owner} ink on the chip`);
    assertAA(inkOf(colour), mix(colour, 0.1, WHITE), `${owner} ink on the band`);
    assertAA(inkOf(colour), mix(colour, 0.06, WHITE), `${owner} ink on the wash`);
  }
});

test("split group chips read AA for every group colour", () => {
  const seen = new Set();
  for (let index = 0; index < 200 && seen.size < 8; index += 1) {
    const style = getSplitGroupChipStyle(`Group ${index}`);
    seen.add(style["--split-group-chip-bg"].match(/#[0-9A-F]{6}/i)[0]);
  }
  assert.equal(seen.size, 8);
  for (const hex of seen) {
    const colour = hexRgb(hex);
    assertAA(inkOf(colour), mix(colour, 0.16, WHITE), `group ${hex} ink on its chip`);
  }
});
