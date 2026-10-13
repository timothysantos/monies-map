import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { contrast, loadPresets, mix, ROOT } from "./support/colour-presets.mjs";

// Accessibility contrast beyond colour-contrast.test.mjs (docs/audits/
// a11y-pass.md): the pairs axe-core found failing in the browser, held for
// the 70s default and every colour preset.
// - Accent text (links, quiet buttons, the active tab, "Done" actions) is
//   `--accent`, the preset's darker accent, never `--accent-strong`, which
//   only reaches 3.4:1 to 4.7:1 on the tinted surfaces text sits on.
// - Focus rings are the solid accent, 3:1 against every surface (WCAG 1.4.11).
// - The check-in fold's second line is mixed from the pastel ink, and on
//   Splits the fold is the panel's deep end, so its words and chips read.

const PRESETS = loadPresets();
const HUES = ["mint", "rose", "sky", "lavender", "butter"];
const AA = 4.5;
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const stylesheets = ["public/styles.css", ...[
  "src/client/ask-route.css", "src/client/ui/lead-support-detail.css", "src/client/money-checkin.css", "src/client/splits-panel.css"
]];

function assertRatio(a, b, label, min = AA) {
  const ratio = contrast(a, b);
  assert.ok(ratio >= min, `${label} is ${ratio.toFixed(2)}:1 (needs ${min}:1)`);
}

// The share of the ink the check-in's second line keeps, read from the CSS
// so the test follows the stylesheet.
function thinkShare() {
  const match = read("src/client/money-checkin.css").match(/\.financial-insight-think\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--fold-ink\) (\d+)%, var\(--fold-fill\)\)/);
  assert.ok(match, "the check-in second line is a mix of the fold ink and fill");
  return Number(match[1]) / 100;
}

test("no stylesheet colours text with --accent-strong (it is a fill and border colour)", () => {
  for (const file of stylesheets) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders = [...css.matchAll(/(?<![-\w])color:\s*var\(--accent-strong\)/g)];
    assert.equal(offenders.length, 0, `${file} sets text to --accent-strong ${offenders.length} times`);
  }
});

// A `var(--x)` with no fallback and no `--x` anywhere is invalid when the
// page is drawn, and a declaration like `outline: 2px solid var(--x)` then
// draws no focus ring at all (the Money insights "See all insights" toggle
// had none for this reason).
test("every var(--token) with no fallback is defined by a stylesheet, a preset or the client", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (/\.(css|js|jsx)$/.test(entry.name)) files.push(relative);
    }
  };
  for (const dir of ["public", "src/client"]) walk(dir);
  const sources = files.map((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, ""));
  const defined = new Set(sources.flatMap((source) => [...source.matchAll(/(--[\w-]+)\s*[:"']/g)].map(([, name]) => name)));
  const used = new Set(files
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) => [...read(file).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/var\((--[\w-]+)\s*\)/g)].map(([, name]) => name)));
  const undefinedTokens = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(undefinedTokens, []);
});

for (const preset of PRESETS) {
  const { id, rgb } = preset;
  const PAPER = rgb("--paper-rgb");

  test(`${id}: accent text reads AA on the page, the panel, the tab bar and the accent tints it sits on`, () => {
    const accent = rgb("--accent");
    const surfaces = {
      bg: rgb("--bg"),
      panel: rgb("--panel"),
      chrome: rgb("--chrome-surface"),
      neutral: rgb("--pastel-neutral"),
      paper: PAPER,
      // The active tab and the selected month chip: the accent at 8% and 14%.
      "accent 8% on the page": mix(rgb("--accent-strong"), 0.08, rgb("--bg")),
      "accent 14% on the chrome": mix(rgb("--accent-strong"), 0.14, rgb("--chrome-surface"))
    };
    for (const [name, surface] of Object.entries(surfaces)) assertRatio(accent, surface, `accent text on ${name}`);
  });

  test(`${id}: the focus ring (the solid accent) reads 3:1 on the page, the panel and the paper`, () => {
    const accent = rgb("--accent");
    for (const [name, surface] of Object.entries({ bg: rgb("--bg"), panel: rgb("--panel"), paper: PAPER })) {
      assertRatio(accent, surface, `focus ring on ${name}`, 3);
    }
  });

  test(`${id}: the check-in's second line reads AA on every hue's fill`, () => {
    const share = thinkShare();
    for (const hue of HUES) {
      const fill = rgb(`--pastel-${hue}`);
      assertRatio(mix(rgb(`--pastel-${hue}-ink`), share, fill), fill, `${hue} second line on its fill`);
    }
    const neutral = rgb("--pastel-neutral");
    assertRatio(mix(rgb("--text"), share, neutral), neutral, "second line on the neutral fold");
  });

  test(`${id}: the Splits check-in fold (the panel's deep end) reads AA for its words, second line and chips`, () => {
    const css = read("src/client/splits-panel.css");
    assert.match(css, /\.panel-splits \.financial-insight-fold\[aria-expanded="false"\]\s*\{[^}]*--fold-fill:\s*rgb\(var\(--splits-deep-rgb\)\)/);
    const fill = rgb("--splits-deep-rgb");
    const ink = preset.tokens["--on-strong-tint-rgb"] ? rgb("--on-strong-tint-rgb") : [255, 248, 243];
    assertRatio(ink, fill, "fold words");
    assertRatio(mix(ink, thinkShare(), fill), fill, "fold second line");
    // "To do" and "+2 more": the ink at 12% over the fold.
    assertRatio(ink, mix(ink, 0.12, fill), "chip on the fold");
  });
}

test("the guard catches a failing pair: the accent-strong terracotta on the selected tab tint is under AA", () => {
  const default70s = PRESETS[0];
  const tint = mix(default70s.rgb("--accent-strong"), 0.08, default70s.rgb("--bg"));
  assert.ok(contrast(default70s.rgb("--accent-strong"), tint) < AA);
  assert.ok(contrast(default70s.rgb("--accent"), tint) >= AA);
});
