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

// A rule that removes the focus outline must put something as visible in its
// place. These are the ones that may: a wrapper that draws the ring around
// the field (:focus-within), a row or chip that outlines itself, and
// containers that only take programmatic focus (a sheet, dialog or popover
// the page moved focus to, which is not a stop the eye follows).
const OUTLINE_REMOVED_OK = [
  ".ask-dock-field-input:focus-visible", ".ask-input:focus-visible",
  ".lsd-chip-native:focus-visible", ".lsd-row-input:focus", ".lsd-row.has-control > :is(input, textarea, select):not(.lsd-row-native, .lsd-row-input):focus-visible",
  ".lsd-row.has-control > .responsive-select-trigger:focus-visible",
  ".import-inbox-file-row:focus", ".import-row-sheet:focus-visible", ".mobile-context-dialog:focus", ".month-plan-sheet-dialog:focus-visible",
  ".lsd-chip-hit:focus-visible", ".entry-mobile-sheet.is-dialog-sheet:focus",
  ".note-dialog-content.sheet-dialog:focus", ".splits-groups-sheet:focus", ".split-list-sheet:focus", ".summary-month-sheet:focus"
];

// Splits a selector list on the commas outside parentheses.
function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of selector) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += character;
  }
  return [...parts, current.trim()].filter(Boolean);
}

function allStylesheets() {
  const files = ["public/styles.css"];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith(".css")) files.push(relative);
    }
  };
  walk("src/client");
  return files;
}

const rulesOf = (file) => [...read(file).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector, body }));

test("no control loses its focus outline without a replacement that shows", () => {
  const offenders = [];
  for (const file of allStylesheets()) {
    for (const { selector, body } of rulesOf(file)) {
      if (!/outline:\s*(none|0)\s*(;|$)/.test(body)) continue;
      for (const part of splitSelectors(selector)) {
        if (!/:focus(?!-within)/.test(part)) continue;
        if (OUTLINE_REMOVED_OK.includes(part)) continue;
        offenders.push(`${file}: ${part}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the Ask dock's field buttons and the Entries refresh button show a ring on keyboard focus", () => {
  const rules = ["public/styles.css", "src/client/ask-route.css"].flatMap(rulesOf);
  for (const selector of [".ask-dock-field-attach", ".ask-dock-close", ".ask-dock-expand", ".entries-date-refresh-button"]) {
    const rule = rules.find(({ selector: sel, body }) => sel.includes(`${selector}:focus-visible`) && /outline:\s*\d+px solid var\(--focus-ring\)/.test(body));
    assert.ok(rule, `${selector}:focus-visible draws the focus ring`);
  }
});

test("the guard catches a failing pair: the accent-strong terracotta on the selected tab tint is under AA", () => {
  const default70s = PRESETS[0];
  const tint = mix(default70s.rgb("--accent-strong"), 0.08, default70s.rgb("--bg"));
  assert.ok(contrast(default70s.rgb("--accent-strong"), tint) < AA);
  assert.ok(contrast(default70s.rgb("--accent"), tint) >= AA);
});
