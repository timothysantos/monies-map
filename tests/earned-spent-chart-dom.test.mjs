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
const FOUR = [month("2026-01"), month("2026-02"), month("2026-03", { estimatedExpensesMinor: 0 }), month("2026-04")];

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

test("Plan draws the planned spending line and breaks it where a month has no plan", () => {
  const html = render({ mode: "plan", page: { months: FOUR } });
  assert.match(html, /Planned spending/);
  assert.doesNotMatch(html, /aria-label="[^"]* kept /);
  // March has no plan: three points, two runs of the line, none through March.
  assert.equal(count(html, /class="ec-point is-line"/g), 3);
  assert.equal(count(html, /class="ec-line is-plan"/g), 2);
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
  const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, "");
  assert.doesNotMatch(outside.replace(/@keyframes[\s\S]*?\n\}\n/g, ""), /animation\s*:/);
});
