// The column + line chart's markup (earned-spent-chart.js): what it draws,
// what it must not draw (hidden money, one month), its reduced-motion state
// and its lazy loading. Behaviour in a browser (hover, tap, keyboard, the
// legend, the menus) is tests/e2e/earned-spent-chart.spec.js.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { createEarnedSpentChart } = await import("../src/client/earned-spent-chart.js");
const EarnedSpentChart = createEarnedSpentChart(React);

const h = React.createElement;
const count = (html, pattern) => (html.match(pattern) ?? []).length;

const month = (key, over = {}) => ({
  month: key,
  plannedIncomeMinor: 500000,
  actualIncomeMinor: 480000,
  estimatedExpensesMinor: 300000,
  realExpensesMinor: 250000,
  savingsGoalMinor: 100000,
  realizedSavingsMinor: 230000,
  estimatedDiffMinor: 0,
  realDiffMinor: 0,
  note: "",
  ...over
});
// March has no plan at all (no plan rows, so no savings target either).
const FOUR = [month("2026-01"), month("2026-02"), month("2026-03", { estimatedExpensesMinor: 0, savingsGoalMinor: 0 }), month("2026-04")];

// A browser stand-in: money shown or hidden, reduced motion on or off.
function render(props, { visible = true, reducedMotion = false } = {}) {
  globalThis.window = {
    localStorage: { getItem: () => String(visible), setItem() {} },
    matchMedia: () => ({ matches: reducedMotion })
  };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, h(EarnedSpentChart, props)));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("Simple draws two columns and a Kept point per month, each an openable figure with a label", () => {
  const html = render({ mode: "simple", page: { months: FOUR } });
  assert.equal(count(html, /class="ec-point is-bar"/g), 8);
  assert.equal(count(html, /class="ec-point is-line"/g), 4);
  assert.match(html, /aria-label="Jan 2026 earned \$4,800\.00"/);
  assert.match(html, /aria-label="Apr 2026 spent \$2,500\.00"/);
  assert.match(html, /aria-label="Feb 2026 kept \$2,300\.00"/);
  assert.equal(count(html, /data-fig="earned"/g), 4);
  assert.equal(count(html, /data-fig="spending"/g), 4);
  assert.equal(count(html, /data-fig="kept"/g), 4);
  assert.match(html, /data-fig-period="2026-02:2026-02"/);
  assert.equal(count(html, /role="button"/g), 12);
  // One roving stop in the tab order.
  assert.equal(count(html, /tabindex="0"/g), 1);
  // The legend: three chips, all showing.
  assert.equal(count(html, /class="ec-chip"/g), 3);
  assert.equal(count(html, /aria-pressed="true"/g), 3);
  assert.match(html, />Kept</);
  assert.doesNotMatch(html, /Planned spending/);
});

test("Plan draws Spent so far and Planned so far on their own axis, and breaks only the planned line where a month has no plan", () => {
  const html = render({ mode: "plan", page: { months: FOUR } });
  assert.match(html, /Planned spending/);
  assert.match(html, />Spent so far</);
  assert.match(html, />Planned so far</);
  assert.doesNotMatch(html, /adding up/);
  assert.doesNotMatch(html, /Actual spending/);
  assert.doesNotMatch(html, /aria-label="[^"]* kept /);
  // March has no plan: three planned points in two runs; each running total
  // has all four, adding up month by month (each month's spending, and its
  // plan less the savings target: $3,000 less $1,000).
  assert.equal(count(html, /class="ec-point is-line"/g), 11);
  assert.equal(count(html, /class="ec-line is-plan"/g), 2);
  assert.equal(count(html, /class="ec-line is-spentSoFar is-running"/g), 1);
  assert.equal(count(html, /class="ec-line is-plannedSoFar is-running"/g), 1);
  assert.match(html, /aria-label="Jan 2026 spent so far \$2,500\.00"/);
  assert.match(html, /aria-label="Apr 2026 spent so far \$10,000\.00"/);
  assert.match(html, /aria-label="Mar 2026 planned so far \$4,000\.00"/);
  assert.match(html, /aria-label="Apr 2026 planned so far \$6,000\.00"/);
  assert.match(html, /data-ec-series="spentSoFar"[^>]*data-fig="spending" data-fig-period="2026-01:2026-04"/);
  assert.match(html, /data-ec-series="plannedSoFar"[^>]*data-fig="spending" data-fig-period="2026-01:2026-04"/);
  // Their axis is on the right; the left axis stays the columns' ($5k top, not $10k).
  assert.equal(count(html, /class="ec-axis is-right"/g), 1);
  assert.match(html, /class="ec-axis is-right"[\s\S]*>\$10k</);
  assert.doesNotMatch(html.split('class="ec-axis is-right"')[0], />\$10k</);
  assert.doesNotMatch(html, /aria-label="Mar 2026 planned spending/);
  assert.match(html, /aria-label="Feb 2026 planned spending \$3,000\.00"/);
  // Spent opens the plan too, so the menu offers Open plan.
  assert.match(html, /data-fig="spent"[^>]*data-fig-plan=""/);
});

test("hidden money draws nothing at all: no columns, no line, no axis, no legend", () => {
  const html = render({ mode: "simple", page: { months: FOUR } }, { visible: false });
  assert.equal(html, "");
  assert.equal(render({ mode: "plan", page: { months: FOUR } }, { visible: false }), "");
});

test("one month is not a chart", () => {
  assert.equal(render({ mode: "simple", page: { months: [month("2026-05")] } }), "");
  assert.equal(render({ mode: "plan", page: { months: [] } }), "");
});

test("reduced motion starts at rest: no armed or playing state to animate from", () => {
  const still = render({ mode: "simple", page: { months: FOUR } }, { reducedMotion: true });
  assert.match(still, /data-chart-motion="off"/);
  assert.doesNotMatch(still, /data-chart-motion="(armed|playing)"/);
  const moving = render({ mode: "simple", page: { months: FOUR } }, { reducedMotion: false });
  assert.match(moving, /data-chart-motion="armed"/);
});

test("the chart is its own lazy chunk: only the panel imports it, and only dynamically", () => {
  const clientDir = path.resolve(import.meta.dirname, "../src/client");
  const files = readdirSync(clientDir, { recursive: true }).map(String).filter((name) => /\.(jsx?|tsx?)$/.test(name));
  const importers = files.filter((name) => /from\s+["'][^"']*earned-spent-chart(\.js)?["']|^import\s+["'][^"']*earned-spent-chart["']/m.test(readFileSync(path.join(clientDir, name), "utf8")));
  assert.deepEqual(importers.filter((name) => name !== "earned-spent-chart.js"), [], "no static import of the chart");
  const panel = readFileSync(path.join(clientDir, "summary-panel.jsx"), "utf8");
  assert.match(panel, /lazy\(\(\) => import\("\.\/earned-spent-chart\.js"\)/);
  // The invisible placeholder keeps the cards under it from jumping.
  assert.match(panel, /earned-spent-chart-reserve/);
});

test("the chart's styles use tokens: no raw colours, animation only where motion is allowed", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../src/client/earned-spent-chart.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const outside = css.replace(/@media[^{]*\(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
  assert.doesNotMatch(outside.replace(/@keyframes[\s\S]*?\n\}\n/g, ""), /animation\s*:|transition\s*:|[^-]transform\s*:/);
  // The draw-on, the reveal and the pop change transforms, opacity, the dash
  // and the clip only: nothing that moves the layout.
  for (const [, body] of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) {
    for (const [, property] of body.matchAll(/([\w-]+)\s*:/g)) {
      assert.ok(["transform", "opacity", "stroke-dashoffset", "clip-path"].includes(property), `keyframes change ${property}`);
    }
  }
  // A pointer on a column widens it only once the chart has played.
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{\s*\[data-chart-motion="done"\] \.ec-point\.is-bar:hover \.ec-bar \{\s*transform: scaleX/);
});

test("the donut sweeps in only where motion is allowed, clips only the ring, and leaves no clip at rest", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../src/client/donut-motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const outside = css.replace(/@media[^{]*\(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
  assert.doesNotMatch(outside, /animation\s*:|transition\s*:|[^-]transform\s*:|clip-path|mask/);
  // The clip is only on the ring's own layer while armed or playing, never
  // on the labels' layer that takes the pointer: a mask or clip there would
  // keep a pointer or a tap from reaching a slice while it plays.
  const clipped = [...css.matchAll(/([^{}]*)\{\s*clip-path/g)].map(([, selector]) => selector.trim()).filter((selector) => !/^\d|%$/.test(selector));
  assert.deepEqual(clipped, ['[data-donut-motion="armed"] .recharts-pie']);
  assert.match(css, /\[data-donut-motion="playing"\] \.recharts-pie \{\s*animation: donut-sweep /);
  assert.doesNotMatch(css, /mask/);
  const chart = readFileSync(path.resolve(import.meta.dirname, "../src/client/spending-mix-recharts.jsx"), "utf8");
  assert.match(chart, /import "\.\/donut-motion\.css"/);
  assert.match(chart, /data-donut-motion=\{motion\}/);
});
