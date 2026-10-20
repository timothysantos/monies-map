// The shared hover and press motion of list rows and cards
// (src/client/row-motion.js and row-motion.css, design.md "Motion"): which
// move each category's icon makes, the tint a row carries, that the motion
// is one shared implementation the row components apply, and that it moves
// only where the person has a pointer and has not asked for reduced motion.
// The browser behaviour is tests/e2e/hover-and-chart-motion.spec.js; the
// tint's contrast is tests/colour-contrast.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));

const { glyphMotion, rowMotionProps } = await import("../src/client/row-motion.js");
const { ICON_OPTIONS } = await import("../src/client/ui-options.jsx");

const client = (name) => readFileSync(path.resolve(import.meta.dirname, "../src/client", name), "utf8");
const css = client("row-motion.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("each common category's icon has its own move; the rest pop", () => {
  const byName = (name, iconKey) => glyphMotion({ name, iconKey });
  assert.equal(byName("Food & Drinks", "utensils"), "tilt");
  assert.equal(byName("Travel", "plane"), "fly");
  assert.equal(byName("Public Transport", "bus"), "drive");
  assert.equal(byName("Taxi", "car-front"), "drive");
  assert.equal(byName("Groceries", "shopping-cart"), "bounce");
  assert.equal(byName("Shopping", "shopping-bag"), "bounce");
  assert.equal(byName("Bills", "lightbulb"), "shake");
  assert.equal(byName("Subscriptions MO", "washing-machine"), "shake");
  assert.equal(byName("Salary", "badge-dollar-sign"), "rise");
  // Investments wears the Bills banknote and Savings the plain receipt: they
  // go by name, money put away nudges up.
  assert.equal(byName("Investments", "banknote"), "rise");
  assert.equal(byName("Savings", "receipt"), "rise");
  assert.equal(byName("Tax", "banknote"), "shake");
  assert.equal(byName("Church", "church"), "pop");
  assert.equal(byName("Gifts", "gift"), "pop");
  assert.equal(glyphMotion(null), "pop");
  assert.equal(glyphMotion({ name: "Mystery", iconKey: "not-an-icon" }), "pop");
  // Every icon the app offers has a move.
  for (const option of ICON_OPTIONS) {
    assert.match(glyphMotion({ iconKey: option.key }), /^(tilt|fly|drive|bounce|shake|rise|pop)$/);
  }
});

test("a row with a category carries its glyph move and its colour as the tint, keeping its own style", () => {
  const props = rowMotionProps({ name: "Travel", iconKey: "plane", colorHex: "#567CC9" }, { "--entry-owner-border-color": "red" });
  assert.deepEqual(props, {
    "data-glyph": "fly",
    style: { "--entry-owner-border-color": "red", "--row-tint": "var(--cat-567cc9, #567CC9)" }
  });
  // A theme's `color` works too; no colour keeps the style as it was (the
  // row takes the accent wash).
  assert.equal(rowMotionProps({ iconKey: "gift", color: "#C98A5A" }).style["--row-tint"], "var(--cat-c98a5a, #C98A5A)");
  assert.deepEqual(rowMotionProps(null), { "data-glyph": "pop", style: undefined });
});

test("every move is a glyph keyframe of transforms only, a quarter of a second or less", () => {
  for (const move of ["pop", "tilt", "fly", "drive", "bounce", "shake", "rise"]) {
    const keyframes = css.match(new RegExp(`@keyframes glyph-${move} \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(keyframes, `glyph-${move} is defined`);
    for (const [, property] of keyframes[1].matchAll(/([\w-]+)\s*:/g)) assert.equal(property, "transform", `glyph-${move} changes ${property}`);
  }
  for (const [, ms] of css.matchAll(/animation:\s*glyph-[\w-]+ (\d+)ms/g)) {
    assert.ok(Number(ms) >= 150 && Number(ms) <= 250, `${ms}ms`);
  }
  for (const move of ["tilt", "fly", "drive", "bounce", "shake", "rise"]) {
    assert.match(css, new RegExp(`\\.motion-row\\[data-glyph="${move}"\\]:hover \\.category-icon svg \\{ animation: glyph-${move} `));
  }
});

test("the icon moves only under a mouse or trackpad with motion allowed; the wash never needs either", () => {
  const blocks = [...css.matchAll(/@media ([^{]+)\{([\s\S]*?)\n\}/g)].map(([, query, body]) => ({ query: query.trim(), body }));
  const outside = blocks.reduce((rest, block) => rest.replace(`@media ${block.query} {${block.body}\n}`, ""), css);
  // Nothing moves outside a media block.
  assert.doesNotMatch(outside, /animation|transition|[^-]transform\s*:/);
  for (const block of blocks) {
    if (/animation|[^-]transform\s*:/.test(block.body)) {
      assert.equal(block.query, "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    }
    if (/transition/.test(block.body)) assert.match(block.query, /prefers-reduced-motion: no-preference/);
  }
  // The wash: hover only where there is hover, a press on touch, and the
  // keyboard focus everywhere; colours are tokens, 6% of the row's tint.
  assert.match(css, /--row-wash: color-mix\(in srgb, var\(--row-tint, var\(--accent-strong\)\) 6%, var\(--row-base, transparent\)\)/);
  assert.ok(blocks.some((block) => block.query === "(hover: hover) and (pointer: fine)" && /\.motion-row:hover \{\s*background-color: var\(--row-wash\)/.test(block.body)));
  assert.ok(blocks.some((block) => block.query === "(hover: none)" && /\.motion-row:active \{\s*background-color: var\(--row-wash\)/.test(block.body)));
  assert.match(outside, /\.motion-row:focus-visible,\s*\.motion-row:has\(> :focus-visible\) \{\s*background-color: var\(--row-wash\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba\(/i);
  // A press on touch waits a moment, so a finger scrolling past does not flash rows.
  assert.ok(blocks.some((block) => /hover: none/.test(block.query) && /prefers-reduced-motion: no-preference/.test(block.query) && /transition-delay: \d+ms/.test(block.body)));
  // A plain :hover outside a hover-capable block would stick after a tap.
  assert.doesNotMatch(outside, /:hover/);
});

test("the rows share one implementation: each list applies motion-row and loads its styles from its own lazy chunk", () => {
  const rows = {
    "entries-list.jsx": /entry-row-main has-owner-cue motion-row[\s\S]{0,200}rowMotionProps\(category, ownerCue\.style\)/,
    "entries-overview.jsx": /summary-mix-row entries-mix-row motion-row[\s\S]{0,300}rowMotionProps\(/,
    "spending-mix-section.jsx": /summary-mix-row motion-row[\s\S]{0,200}rowMotionProps\(/,
    "summary-earned-spent.js": /"earned-spent-row motion-row"/,
    "summary-intent-outcome.jsx": /"summary-intent-month motion-row"/,
    "month-plan-tables.jsx": /className=\{`motion-row \$\{isEditing[\s\S]{0,200}rowMotionProps\(categoryService\.get\(categories, row\)\)/,
    "splits-activity.jsx": /split-activity-card motion-row[\s\S]{0,300}rowMotionProps\(/,
    "splits-breakdown-section.jsx": /category-row category-row-button motion-row[\s\S]{0,300}rowMotionProps\(/,
    "import-preview-row-list.jsx": /import-row-item motion-row/
  };
  for (const [file, pattern] of Object.entries(rows)) {
    const source = client(file);
    assert.match(source, pattern, file);
    assert.match(source, /from "\.\/row-motion"|import "\.\/row-motion\.css"/, `${file} loads the motion`);
  }
  assert.equal((client("month-plan-tables.jsx").match(/rowMotionProps\(/g) ?? []).length, 2, "income and plan rows");
  // Never the first screen's stylesheet or the Summary route itself.
  assert.doesNotMatch(readFileSync(path.resolve(import.meta.dirname, "../public/styles.css"), "utf8"), /motion-row|glyph-/);
  assert.doesNotMatch(client("summary-panel.jsx"), /row-motion/);
});
