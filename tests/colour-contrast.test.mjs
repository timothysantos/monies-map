import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPersonColour, getPersonColourVars } from "../src/client/person-colour.js";
import { getSplitGroupChipStyle } from "../src/client/entry-row-display.js";
import { CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR } from "../src/domain/category-palette.ts";
import { contrast, deltaE, hexRgb, lab, loadPresets, mix, WHITE } from "./support/colour-presets.mjs";

// Every text-on-surface pair the tokens make meets WCAG AA (4.5:1; 3:1 for
// large text and for edges and marks that are not text), in the 70s Warm
// light default (:root of public/styles.css) and in every colour preset in
// both modes (public/palettes/<id>-<mode>.css over it), so a token change is
// checked here (design.md, "Pastel palette" and "Colour presets"). Light
// fills stay soft, dark ones stay dark. A mid harvest gold as text on the
// cream would fail, which is why the 70s warning ink is a dark mustard.

const PRESETS = loadPresets();
const DEFAULT = PRESETS[0];
const HUES = ["mint", "rose", "sky", "lavender", "butter"];
const AA = 4.5;
const LARGE = 3;

function assertAA(ink, surface, label, min = AA) {
  const ratio = contrast(ink, surface);
  assert.ok(ratio >= min, `${label} is ${ratio.toFixed(2)}:1`);
}

test("every preset is checked in a light and a dark mode", () => {
  assert.equal(PRESETS.length, 18);
  assert.equal(DEFAULT.id, "70s-light");
  assert.deepEqual(PRESETS.map((preset) => preset.id), [
    "70s-light", "70s-dark", "60s-light", "60s-dark", "80s-light", "80s-dark",
    "modern-light", "modern-dark", "mono-light", "mono-dark", "code-light", "code-dark",
    "midnight-light", "midnight-dark", "genz-light", "genz-dark", "future-light", "future-dark"
  ]);
});

test("the 70s tokens are in :root with the same names", () => {
  const TOKENS = DEFAULT.tokens;
  for (const name of ["--bg", "--page", "--card", "--card-border", "--card-shadow", "--eyebrow", "--chip", "--panel", "--text", "--muted", "--line", "--accent", "--accent-strong", "--pastel-neutral", ...HUES.flatMap((hue) => [`--pastel-${hue}`, `--pastel-${hue}-ink`])]) {
    assert.ok(TOKENS[name], `${name} is defined`);
  }
  // The terracotta accent the Splits theme is built on stays.
  assert.equal(TOKENS["--accent"], "#934923");
  assert.equal(TOKENS["--accent-strong"], "#b15e2f");
  // Soft chocolate ink on an oat page, not near-black on grey or white.
  assert.equal(TOKENS["--text"], "#352b24");
  assert.deepEqual(
    Object.fromEntries(HUES.map((hue) => [hue, [TOKENS[`--pastel-${hue}`], TOKENS[`--pastel-${hue}-ink`]]])),
    {
      mint: ["#e5e9d5", "#4a5c22"], // avocado
      rose: ["#f3e0d9", "#933629"], // brick red
      sky: ["#d8e6e3", "#2d5d5e"], // dusty teal
      lavender: ["#ebdfe6", "#674562"], // faded plum
      butter: ["#f1e6c6", "#63490f"] // harvest gold, dark mustard ink
    }
  );
  // The text on a strong fill and the Splits panel keep the shipped white
  // and terracotta.
  assert.equal(TOKENS["--on-strong-rgb"], "255 255 255");
  assert.equal(TOKENS["--splits-rgb"], "177 94 47");
  assert.equal(TOKENS["--splits-deep-rgb"], "155 74 33");
});

for (const preset of PRESETS) {
  const { id, rgb, isDark } = preset;
  const PANEL = rgb("--panel");
  const PAPER = rgb("--paper-rgb");
  const PAGE = rgb("--page");
  const CARD = rgb("--card");
  const TEXT = rgb("--text");
  const SPLITS_DEEP = rgb("--splits-deep-rgb");

  test(`${id}: every pastel ink reads AA on the page, the cards, its soft tint, its full fill and the Splits wash`, () => {
    for (const hue of HUES) {
      const fill = rgb(`--pastel-${hue}`);
      const ink = rgb(`--pastel-${hue}-ink`);
      assertAA(ink, PAGE, `${hue} ink on the page`);
      assertAA(ink, CARD, `${hue} ink on a card`);
      assertAA(ink, PANEL, `${hue} ink on the panel`);
      assertAA(ink, PAPER, `${hue} ink on the paper`);
      assertAA(ink, rgb("--pastel-neutral"), `${hue} ink on the neutral fill`);
      assertAA(ink, rgb("--chip"), `${hue} ink on a chip`);
      // A soft tint is the fill at 60% over whatever it sits on: the page
      // (the Summary and Entries pills) or a card.
      assertAA(ink, mix(fill, 0.6, PAGE), `${hue} ink on its soft tint over the page`);
      assertAA(ink, mix(fill, 0.6, CARD), `${hue} ink on its soft tint over a card`);
      assertAA(ink, mix(fill, 0.6, PANEL), `${hue} ink on its soft tint over the panel`);
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

  test(`${id}: the text, muted and eyebrow inks read AA on every neutral surface`, () => {
    const surfaces = {
      bg: rgb("--bg"), page: PAGE, card: CARD, panel: PANEL, chrome: rgb("--chrome-surface"),
      neutral: rgb("--pastel-neutral"), paper: PAPER, chip: rgb("--chip")
    };
    if (preset.tokens["--cream-rgb"]) Object.assign(surfaces, { cream: rgb("--cream-rgb"), blush: rgb("--blush-rgb") });
    for (const [name, surface] of Object.entries(surfaces)) {
      assertAA(TEXT, surface, `text on ${name}`);
      assertAA(rgb("--muted"), surface, `muted on ${name}`);
    }
    // Section eyebrows sit on the page, on a card and on the bare chrome.
    for (const name of ["bg", "page", "card", "panel", "chrome"]) assertAA(rgb("--eyebrow"), surfaces[name], `eyebrow on ${name}`);
    for (const hue of HUES) assertAA(TEXT, rgb(`--pastel-${hue}`), `text on the ${hue} fill`);
    // The accent reads as text on the page, the cards, the panel and the
    // paper. The strong accent is text on the cards, the panel and the
    // paper; on the tinted page it is a mark (a ring, an icon, large text),
    // so 3:1 there, and small accent text on the page uses --accent.
    for (const [name, surface] of Object.entries({ page: PAGE, card: CARD, panel: PANEL, paper: PAPER })) {
      assertAA(rgb("--accent"), surface, `accent on the ${name}`);
      assertAA(rgb("--accent-strong"), surface, `accent-strong on the ${name}`, name === "page" ? LARGE : AA);
    }
  });

  // Small accent text that sits straight on the tinted page or on the bare
  // chrome (the text actions, the phone's month carets and steppers, the
  // Splits strip's New and All, the phone tab pill) uses --accent. The strong
  // accent on the page is 3.7:1 in 70s Warm Light, short of 4.5:1 for small
  // text; the phone tab pill is the strong accent at 12% over the tab bar.
  test(`${id}: small accent text on the page, the chrome and the phone tab pill reads AA`, () => {
    const CHROME = rgb("--chrome-surface");
    assertAA(rgb("--accent"), PAGE, "text actions on the page");
    assertAA(rgb("--accent"), CHROME, "carets and steppers on the chrome");
    // --tab-pill-ink: the deeper accent in a light mode, the strong one in a
    // dark mode (public/styles.css, public/palettes/*-dark.css).
    assert.equal(preset.tokens["--tab-pill-ink"], isDark ? "var(--accent-strong)" : "var(--accent)");
    assertAA(rgb(isDark ? "--accent-strong" : "--accent"), mix(rgb("--accent-strong"), 0.12, CHROME), "label on the phone tab pill");
  });

  test(`${id}: cards stand off the page by a soft step, a hairline and a shadow`, () => {
    const [pageLightness] = lab(PAGE);
    const [cardLightness] = lab(CARD);
    const [bgLightness] = lab(rgb("--bg"));
    // A step, not a wall: the card is lighter than the page (in both modes),
    // by enough to see and not so much that it glares.
    const step = cardLightness - pageLightness;
    assert.ok(step >= 3 && step <= 14, `card is ${step.toFixed(1)} lighter than the page`);
    // The page behind the header is never lighter than the page itself.
    assert.ok(bgLightness <= pageLightness + 0.5, `bg ${bgLightness.toFixed(1)} vs page ${pageLightness.toFixed(1)}`);
    // The hairline is translucent and visible, the shadow gentle.
    assert.match(preset.tokens["--card-border"], /^rgba\(/);
    const borderAlpha = Number(preset.tokens["--card-border"].match(/([\d.]+)\)$/)[1]);
    assert.ok(borderAlpha >= 0.06 && borderAlpha <= 0.22, `card border alpha ${borderAlpha}`);
    const shadowAlphas = [...preset.tokens["--card-shadow"].matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map(([, alpha]) => Number(alpha));
    assert.ok(shadowAlphas.length >= 1, `${preset.tokens["--card-shadow"]} is a shadow`);
    assert.ok(Math.max(...shadowAlphas) <= (isDark ? 0.45 : 0.12), `card shadow alphas ${shadowAlphas.join(", ")}`);
  });

  test(`${id}: the page is tinted, never plain white or near-white`, () => {
    for (const name of ["--page", "--bg"]) {
      const [lightness, a, b] = lab(rgb(name));
      if (isDark) {
        assert.ok(lightness <= 16, `${name} lightness ${lightness.toFixed(1)}`);
      } else {
        assert.ok(lightness <= 94.5, `${name} lightness ${lightness.toFixed(1)} is near-white`);
        assert.ok(lightness >= 84, `${name} lightness ${lightness.toFixed(1)} is too dark for a light page`);
        // Black & White is grey on purpose; every other page carries its hue.
        if (preset.presetId !== "mono") assert.ok(Math.hypot(a, b) >= 3, `${name} chroma ${Math.hypot(a, b).toFixed(1)}`);
      }
    }
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
    // The open pill's label is --tab-pill-ink: the deeper accent in a light
    // mode and the strong (lighter) accent in a dark one.
    assertAA(isDark ? rgb("--accent-strong") : INK, mix(rgb("--accent-strong"), 0.18, CHROME), "label on the open Ask pill");
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
    for (const name of [...HUES.map((hue) => `--pastel-${hue}`), "--pastel-neutral", "--bg", "--page", "--card", "--chip"]) {
      const [lightness, a, b] = lab(rgb(name));
      if (isDark) {
        assert.ok(lightness <= 30, `${name} lightness ${lightness.toFixed(0)}`);
      } else {
        assert.ok(lightness >= 84, `${name} lightness ${lightness.toFixed(0)}`);
        assert.ok(Math.hypot(a, b) <= preset.fillChromaMax, `${name} chroma ${Math.hypot(a, b).toFixed(0)}`);
      }
    }
  });

  test(`${id}: the money tones stay told apart`, () => {
    const inks = Object.fromEntries(["mint", "rose", "sky", "butter", "lavender"].map((hue) => [hue, rgb(`--pastel-${hue}-ink`)]));
    if (preset.presetId === "mono") {
      // Black & White tells them apart by type (bold, italic, underlines),
      // which its sheets set in both modes (tests/colour-presets.test.mjs).
      for (const ink of Object.values(inks)) assert.equal(new Set(ink.map(Math.round)).size, 1, `${ink} is a grey`);
      return;
    }
    // Money in and money out, and either against a plan, differ clearly in
    // hue and lightness; every pair at least noticeably.
    const pairs = [["mint", "rose", 30], ["mint", "sky", 15], ["rose", "sky", 30], ["mint", "butter", 12], ["rose", "butter", 15], ["sky", "lavender", 12], ["rose", "lavender", 12]];
    for (const [a, b, min] of pairs) {
      const distance = deltaE(inks[a], inks[b]);
      assert.ok(distance >= min, `${a} and ${b} inks are only ${distance.toFixed(1)} apart`);
    }
    // Each tone also reads apart from plain text.
    for (const [hue, ink] of Object.entries(inks)) assert.ok(deltaE(ink, TEXT) >= 12, `${hue} ink vs text ${deltaE(ink, TEXT).toFixed(1)}`);
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
      // The Entries row edge keeps 3:1 against the panel and a card.
      assertAA(colour, PANEL, `${owner} edge on the panel`, LARGE);
      assertAA(colour, CARD, `${owner} edge on a card`, LARGE);
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

  // The pinned Entries day header (entries-route.css, design.md "Entries
  // list"): its date, the daily net in its money tone and the refresh mark
  // sit on the full-width band, --page at DATE_BAND over the white rows
  // scrolling under it, over the page beside them, or solid --page where
  // a blur is not supported.
  test(`${id}: the pinned Entries date and daily net read AA on the full-width band`, () => {
    const inks = { text: TEXT, muted: rgb("--muted"), ...Object.fromEntries(["mint", "rose"].map((hue) => [`${hue} ink`, rgb(`--pastel-${hue}-ink`)])) };
    const bands = { "over the rows": mix(PAGE, DATE_BAND, PAPER), "over the page": PAGE, "over a card": mix(PAGE, DATE_BAND, CARD) };
    for (const [bandName, band] of Object.entries(bands)) {
      for (const [inkName, ink] of Object.entries(inks)) assertAA(ink, band, `${inkName} on the band ${bandName}`);
    }
  });

  // The pinned Splits day header (splits-activity-list.css): its date, count
  // and refresh mark (full on-strong while pinned) sit on the same full-width band in
  // the flat Splits colour, at SPLITS_DATE_BAND over the white rows scrolling
  // under it, or solid where a blur is not supported.
  test(`${id}: the pinned Splits date reads AA on its full-width band`, () => {
    const ON = rgb("--on-strong-rgb");
    const flat = mix(rgb("--splits-rgb"), 0.5, SPLITS_DEEP);
    for (const [bandName, band] of Object.entries({ "over the rows": mix(flat, SPLITS_DATE_BAND, PAPER), "over a card": mix(flat, SPLITS_DATE_BAND, CARD), "solid": flat })) {
      assertAA(ON, band, `the date on the Splits band ${bandName}`);
    }
  });

  // The hover, press and focus wash of rows and cards (row-motion.css): the
  // row's category colour, or the strong accent, at ROW_WASH over the page,
  // a card, the panel or the paper. The text, the muted lines and the money
  // inks on the row keep AA on it.
  test(`${id}: row hover washes keep every ink on the row AA, for every category colour`, () => {
    const tints = [...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].map((hex) => [hex, hexRgb(preset.cat(hex))]);
    tints.push(["accent-strong", rgb("--accent-strong")]);
    const inks = { text: TEXT, muted: rgb("--muted"), accent: rgb("--accent"), ...Object.fromEntries(["mint", "rose", "sky"].map((hue) => [`${hue} ink`, rgb(`--pastel-${hue}-ink`)])) };
    for (const [surfaceName, surface] of Object.entries({ page: PAGE, card: CARD, panel: PANEL, paper: PAPER })) {
      for (const [hex, tint] of tints) {
        const wash = mix(tint, ROW_WASH, surface);
        for (const [inkName, ink] of Object.entries(inks)) assertAA(ink, wash, `${inkName} on the ${hex} wash over the ${surfaceName}`);
      }
    }
  });
}

// The pinned Entries band's share of --page, as entries-route.css writes it.
const DATE_BAND = Number(readFileSync(new URL("../src/client/entries-route.css", import.meta.url), "utf8")
  .match(/--date-band-share: (\d+)%/)[1]) / 100;

// The pinned Splits band's share of the Splits colour, as splits-activity-list.css writes it.
const SPLITS_DATE_BAND = Number(readFileSync(new URL("../src/client/splits-activity-list.css", import.meta.url), "utf8")
  .match(/--date-band-share: (\d+)%/)[1]) / 100;

test("the pinned Entries band stays nearly solid: at least 85% of the page colour", () => {
  assert.ok(DATE_BAND >= 0.85 && DATE_BAND <= 1, `the band is ${DATE_BAND}`);
});

// The wash share as row-motion.css writes it.
const ROW_WASH = Number(readFileSync(new URL("../src/client/row-motion.css", import.meta.url), "utf8")
  .match(/--row-wash: color-mix\(in srgb, var\(--row-tint, var\(--accent-strong\)\) (\d+)%/)[1]) / 100;

test("the row wash stays faint: a tenth of the colour at most", () => {
  assert.ok(ROW_WASH > 0 && ROW_WASH <= 0.1, `${ROW_WASH}`);
  // The guard bites: a strong wash of a dark category colour fails muted text.
  const failing = PRESETS.some((preset) => [...CATEGORY_COLOURS].some((hex) => contrast(preset.rgb("--muted"), mix(hexRgb(preset.cat(hex)), 0.4, preset.rgb("--card"))) < AA));
  assert.ok(failing);
});

// The small accent text found on --page in 70s Warm Light (4.5:1 needed, the
// strong accent is 3.67:1 there) is written with --accent, not --accent-strong.
test("small accent text on the page is written with the darker accent", () => {
  const rule = (file, selector) => {
    const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const at = css.search(new RegExp(`\\n\\s*${selector.replace(/[.]/g, "\\.")} \\{`));
    assert.ok(at >= 0, `${selector} is in ${file}`);
    return css.slice(at, css.indexOf("}", at));
  };
  for (const [file, selector] of [
    ["public/styles.css", ".subtle-cancel"],
    ["public/styles.css", ".period-button"],
    ["public/styles.css", ".mobile-context-trigger-caret"],
    ["public/styles.css", ".mobile-month-choice-caret"],
    ["public/styles.css", ".mobile-month-choice-step"],
    ["public/styles.css", ".import-stage-label.is-current"],
    ["src/client/settings-add-row.css", ".settings-add-row .lsd-row-label"],
    ["src/client/ui/lead-support-detail.css", ".lsd-row-more .lsd-row-label"],
    ["src/client/ui/lead-support-detail.css", ".lsd-row-value.is-action"],
    ["src/client/ui/lead-support-detail.css", ".lsd-quiet"],
    ["src/client/splits-group-strip.css", ".splits-strip-half"]
  ]) {
    assert.match(rule(file, selector), /color: var\(--accent\);/, `${selector} uses --accent`);
    assert.doesNotMatch(rule(file, selector), /color: var\(--accent-strong\)/, `${selector} is not --accent-strong`);
  }
  const lead = DEFAULT.rgb("--accent-strong");
  assert.ok(contrast(lead, DEFAULT.rgb("--page")) < AA, "70s Warm Light's strong accent on the page is why");
});

test("the guard catches a failing pair: a mid harvest gold as text on cream fails AA", () => {
  const PANEL = DEFAULT.rgb("--panel");
  assert.ok(contrast(hexRgb("#B48639"), PANEL) < AA);
  assert.ok(contrast(DEFAULT.rgb("--pastel-butter"), PANEL) < 1.5, "the gold fill is a surface, never text");
  assert.ok(contrast(WHITE, DEFAULT.rgb("--pastel-butter")) < AA, "white on a pastel fill would fail");
  // A light preset's ink on a dark mode's page would fail: dark modes need
  // their own inks.
  const darkPage = PRESETS.find((preset) => preset.id === "70s-dark").rgb("--page");
  assert.ok(contrast(DEFAULT.rgb("--pastel-rose-ink"), darkPage) < AA);
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
