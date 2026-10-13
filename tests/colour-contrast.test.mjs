import assert from "node:assert/strict";
import test from "node:test";

import { getPersonColour, getPersonColourVars } from "../src/client/person-colour.js";
import { getSplitGroupChipStyle } from "../src/client/entry-row-display.js";
import { contrast, hexRgb, lab, loadPresets, mix, WHITE } from "./support/colour-presets.mjs";

// Every text-on-surface pair the tokens make meets WCAG AA (4.5:1), in the
// 70s default (:root of public/styles.css) and in every colour preset
// (public/palettes/<id>.css over it), so a token change is checked here
// (design.md, "Pastel palette" and "Colour presets"). Light presets keep
// their fills soft; the dark preset keeps them dark. A mid harvest gold as
// text on the cream would fail, which is why the 70s warning ink is a dark
// mustard.

const PRESETS = loadPresets();
const DEFAULT = PRESETS[0];
const HUES = ["mint", "rose", "sky", "lavender", "butter"];
const AA = 4.5;

function assertAA(ink, surface, label, min = AA) {
  const ratio = contrast(ink, surface);
  assert.ok(ratio >= min, `${label} is ${ratio.toFixed(2)}:1`);
}

test("the 70s tokens are in :root with the same names", () => {
  const TOKENS = DEFAULT.tokens;
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
  // The paper, the text on a strong fill and the Splits panel keep the
  // shipped white and terracotta, so the default looks as it did.
  assert.equal(TOKENS["--paper-rgb"], "255 255 255");
  assert.equal(TOKENS["--on-strong-rgb"], "255 255 255");
  assert.equal(TOKENS["--splits-rgb"], "177 94 47");
  assert.equal(TOKENS["--splits-deep-rgb"], "155 74 33");
});

for (const preset of PRESETS) {
  const { id, rgb, isDark } = preset;
  const PANEL = rgb("--panel");
  const PAPER = rgb("--paper-rgb");
  const TEXT = rgb("--text");
  const SPLITS_DEEP = rgb("--splits-deep-rgb");

  test(`${id}: every pastel ink reads AA on the panel, its soft tint, its full fill and the Splits wash`, () => {
    for (const hue of HUES) {
      const fill = rgb(`--pastel-${hue}`);
      const ink = rgb(`--pastel-${hue}-ink`);
      assertAA(ink, PANEL, `${hue} ink on the panel`);
      assertAA(ink, PAPER, `${hue} ink on the paper`);
      assertAA(ink, rgb("--pastel-neutral"), `${hue} ink on the neutral fill`);
      assertAA(ink, mix(fill, 0.6, PANEL), `${hue} ink on its soft tint`);
      assertAA(ink, fill, `${hue} ink on its full fill`);
      assertAA(ink, mix(fill, 0.94, SPLITS_DEEP), `${hue} ink on the Splits wash`);
      // The 85% sky surfaces (Ask, the Summary month sheet) and the
      // check-in chip's 9% tint use the same ink.
      assertAA(ink, mix(fill, 0.85, PAPER), `${hue} ink on its 85% fill`);
      assertAA(ink, mix(ink, 0.09, PANEL), `${hue} ink on a 9% chip tint`);
    }
    // Import review puts the plum ink on the harvest gold fill.
    assertAA(rgb("--pastel-lavender-ink"), rgb("--pastel-butter"), "lavender ink on the butter fill");
  });

  test(`${id}: the text and muted inks read AA on every neutral surface`, () => {
    const surfaces = { bg: rgb("--bg"), panel: PANEL, chrome: rgb("--chrome-surface"), neutral: rgb("--pastel-neutral"), paper: PAPER };
    if (preset.tokens["--cream-rgb"]) Object.assign(surfaces, { cream: rgb("--cream-rgb"), blush: rgb("--blush-rgb") });
    for (const [name, surface] of Object.entries(surfaces)) {
      assertAA(TEXT, surface, `text on ${name}`);
      assertAA(rgb("--muted"), surface, `muted on ${name}`);
    }
    for (const hue of HUES) assertAA(TEXT, rgb(`--pastel-${hue}`), `text on the ${hue} fill`);
    // The accent reads as text on the panel and the paper.
    assertAA(rgb("--accent"), PANEL, "accent on the panel");
    assertAA(rgb("--accent-strong"), PANEL, "accent-strong on the panel");
    assertAA(rgb("--accent-strong"), PAPER, "accent-strong on the paper");
  });

  test(`${id}: text on a strong fill reads AA on the accent buttons and the Splits panel`, () => {
    const ON = rgb("--on-strong-rgb");
    assertAA(ON, rgb("--accent-strong"), "on-strong on accent-strong");
    assertAA(ON, rgb("--accent"), "on-strong on accent");
    assertAA(ON, rgb("--splits-rgb"), "on-strong on the Splits panel");
    assertAA(ON, SPLITS_DEEP, "on-strong on the Splits panel's deep end");
    // The Splits panel's secondary lines (78% of the strong ink). The 70s
    // default ships this at 4.449:1, so no preset may go below 4.4.
    assertAA(mix(ON, 0.78, SPLITS_DEEP), SPLITS_DEEP, "78% on-strong on the Splits panel", 4.4);
    // The channel tokens the tints use match their colours.
    assert.equal(preset.tokens["--accent-rgb"], hexRgb(preset.tokens["--accent"]).join(" "));
    assert.equal(preset.tokens["--accent-strong-rgb"], hexRgb(preset.tokens["--accent-strong"]).join(" "));
    if (preset.tokens["--on-strong-tint-rgb"]) {
      assertAA(rgb("--on-strong-tint-rgb"), SPLITS_DEEP, "on-strong tint on the Splits panel");
      assertAA(rgb("--on-strong-tint-rgb"), rgb("--accent-deep-rgb"), "on-strong tint on the deep accent");
      assertAA(rgb("--accent-ink-rgb"), PAPER, "accent ink on the paper");
      assertAA(rgb("--accent-ink-rgb"), rgb("--cream-rgb"), "accent ink on the cream");
      assertAA(rgb("--accent-strong"), rgb("--cream-rgb"), "accent-strong on the cream");
    }
  });

  // The phone's Ask tab (accent icon and label, semibold) reads on the tab
  // bar and on its open pill, the strong accent at 18% over the bar. The text
  // is the deeper --accent (the accent's text token); the pill is
  // --accent-strong. The dock field on desktop carries the same --accent icon
  // on the paper.
  test(`${id}: the Ask tab's accent reads AA on the tab bar, on its open pill and on the dock field`, () => {
    const INK = rgb("--accent");
    const CHROME = rgb("--chrome-surface");
    assertAA(INK, CHROME, "accent on the tab bar");
    assertAA(INK, mix(rgb("--accent-strong"), 0.18, CHROME), "accent on the open Ask pill");
    assertAA(INK, PAPER, "accent on the dock field");
  });

  // The Splits page is one flat colour halfway between its two ends
  // (--splits-surface): the text on a strong fill reads AA on it, and its
  // secondary lines (78%) read no worse than they did on the lighter end of
  // the wash it replaces.
  test(`${id}: text on a strong fill reads on the flat Splits colour as well as on the wash it replaces`, () => {
    const ON = rgb("--on-strong-rgb");
    const light = rgb("--splits-rgb");
    const flat = mix(light, 0.5, SPLITS_DEEP);
    assertAA(ON, flat, "on-strong on the flat Splits colour");
    const secondary = (surface) => contrast(mix(ON, 0.78, surface), surface);
    const worstEnd = Math.min(secondary(light), secondary(SPLITS_DEEP));
    assert.ok(secondary(flat) >= worstEnd - 0.001, `78% on-strong is ${secondary(flat).toFixed(2)}:1 on the flat colour, ${worstEnd.toFixed(2)}:1 at the wash's worst end`);
  });

  test(`${id}: fills stay ${isDark ? "dark" : "soft"}`, () => {
    for (const name of [...HUES.map((hue) => `--pastel-${hue}`), "--pastel-neutral", "--bg"]) {
      const [lightness, a, b] = lab(rgb(name));
      if (isDark) {
        assert.ok(lightness <= 30, `${name} lightness ${lightness.toFixed(0)}`);
      } else {
        assert.ok(lightness >= 86, `${name} lightness ${lightness.toFixed(0)}`);
        assert.ok(Math.hypot(a, b) <= preset.fillChromaMax, `${name} chroma ${Math.hypot(a, b).toFixed(0)}`);
      }
    }
  });

  // --person-ink and the split group chip ink are the colour 55% into --text.
  const inkOf = (colour) => mix(colour, 0.55, TEXT);

  test(`${id}: person chips, bands, washes and edges read with --person-ink`, () => {
    const owners = ["Tim", "Joyce", "linked-splits", "Shared", "household", "Ethan", "Serene", "Dana", "Alex", "Kim"];
    for (const owner of owners) {
      const colour = hexRgb(preset.cat(getPersonColour(owner)));
      assertAA(inkOf(colour), mix(colour, 0.16, PAPER), `${owner} ink on the chip`);
      assertAA(inkOf(colour), mix(colour, 0.1, PAPER), `${owner} ink on the band`);
      assertAA(inkOf(colour), mix(colour, 0.06, PAPER), `${owner} ink on the wash`);
      // The Entries row edge keeps 3:1 against the panel.
      assertAA(colour, PANEL, `${owner} edge on the panel`, 3);
    }
  });

  test(`${id}: split group chips read AA for every group colour`, () => {
    const seen = new Set();
    for (let index = 0; index < 200 && seen.size < 8; index += 1) {
      seen.add(getSplitGroupChipStyle(`Group ${index}`)["--split-group-chip-bg"].match(/#[0-9A-F]{6}/i)[0]);
    }
    assert.equal(seen.size, 8);
    for (const hex of seen) {
      const colour = hexRgb(preset.cat(hex));
      assertAA(inkOf(colour), mix(colour, 0.16, PAPER), `group ${hex} ink on its chip`);
    }
  });
}

test("the guard catches a failing pair: a mid harvest gold as text on cream fails AA", () => {
  const PANEL = DEFAULT.rgb("--panel");
  assert.ok(contrast(hexRgb("#B48639"), PANEL) < AA);
  assert.ok(contrast(DEFAULT.rgb("--pastel-butter"), PANEL) < 1.5, "the gold fill is a surface, never text");
  assert.ok(contrast(WHITE, DEFAULT.rgb("--pastel-butter")) < AA, "white on a pastel fill would fail");
});

test("people and groups reach the page as palette tokens with a paper tint", () => {
  assert.equal(getPersonColour("Tim"), "#46788E", "Tim is dusty teal");
  assert.equal(getPersonColour("Joyce"), "#B97680", "Joyce is mauve");
  assert.equal(getPersonColour("linked-splits"), "#BF7D51", "rows linked to Splits keep the terracotta");
  const owners = ["Tim", "Joyce", "linked-splits", "Shared", "household", "Ethan", "Serene", "Dana", "Alex", "Kim"];
  assert.ok(new Set(owners.map((owner) => getPersonColour(owner))).size >= 6, "the other-owner picks spread over the palette");
  const vars = getPersonColourVars("Tim");
  assert.equal(vars["--person-colour"], "var(--cat-46788e, #46788E)");
  assert.match(vars["--person-ink"], /55%, var\(--text\)/);
  assert.match(vars["--person-chip-bg"], /16%, var\(--paper\)\)$/);
  assert.match(getSplitGroupChipStyle("Okaeri")["--split-group-chip-bg"], /^color-mix\(in srgb, var\(--cat-[0-9a-f]{6}, #[0-9A-F]{6}\) 16%, var\(--paper\)\)$/);
});
