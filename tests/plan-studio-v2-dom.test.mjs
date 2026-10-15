// Plan Studio v2's markup: the slider popover's body, the due tag, the row
// menu's trigger, the income strip and legend, the Studio | Tables switch, and
// what hidden money must never draw. Behaviour in a browser (hover, drag,
// pinning, toggling modes) is tests/e2e/plan-studio-v2.spec.js.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { StudioRow } = await import("../src/client/plan-studio-row.jsx");
const { InfoBody } = await import("../src/client/plan-studio-info.jsx");
const { BigPicture } = await import("../src/client/plan-studio-bar.jsx");
const { PlanModeSwitch } = await import("../src/client/plan-mode-switch.jsx");
const { makeStudioFormat } = await import("../src/client/plan-studio-format.js");
const { buildSegments } = await import("../src/client/plan-studio-edit.js");
const { buildStudioRows, dayOfMonthFor, planTotals } = await import("../src/client/plan-studio-model.js");
const { incomeSegments, rowInfo } = await import("../src/client/plan-studio-v2-model.js");

const h = React.createElement;
const d = (dollars) => Math.round(dollars * 100);
const noop = () => {};
const shown = makeStudioFormat(false);
const hidden = makeStudioFormat(true);
const render = (element) => renderToStaticMarkup(h(MoneyPrivacyProvider, null, element));

const rows = buildStudioRows({
  incomeRows: [
    { id: "sal", label: "Salary", categoryName: "Salary", plannedMinor: d(5400), actualMinor: d(5400), ownerName: "Tim", sourceRowIds: ["sal"] },
    { id: "bon", label: "Bonus", categoryName: "Salary", plannedMinor: d(600), actualMinor: 0, ownerName: "Joyce", sourceRowIds: ["bon"] }
  ],
  planSections: [{ key: "planned_items", rows: [
    { id: "loan", section: "planned_items", label: "House loan", categoryName: "Loans", plannedMinor: d(2200), actualMinor: d(2200), ownershipType: "shared", planDate: "2026-10-02", sourceRowIds: ["loan"], splits: [], actualEntryIds: ["e1"], history: [d(2200), d(2200), d(2200), 3] }
  ] }, { key: "budget_buckets", rows: [
    { id: "food", section: "budget_buckets", label: "Food", categoryName: "Food", plannedMinor: d(1300), actualMinor: d(910), ownershipType: "direct", ownerName: "Tim", sourceRowIds: ["food"], splits: [], actualEntryIds: [], history: [d(1200), d(1180), d(1100), 3] }
  ] }],
  month: "2026-10"
});
const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
const saved = Object.fromEntries(rows.map((row) => [row.key, row.savedMinor]));
const when = dayOfMonthFor("2026-10", "2026-10-19");

function rowHtml(key, { fmt = shown, plannedMinor = byKey[key].savedMinor, menuActions = undefined } = {}) {
  const row = byKey[key];
  const held = { ...saved, [key]: plannedMinor };
  return render(h(StudioRow, {
    row, plannedMinor, savedMinor: row.savedMinor, locked: false, fmt,
    status: { kind: "spend_left", tone: "in", amountMinor: d(390) }, paceMinor: null, scale: { maxMinor: d(3000), stepMinor: d(50) }, halves: [],
    dotColour: "var(--accent)", readOnlyReason: "", info: rowInfo({ row, plannedMinor, totals: planTotals(rows, held), when }), menuActions,
    onSet: noop, onNudge: noop, onGestureStart: noop, onGestureEnd: noop, onToggleLock: noop
  }));
}

test("a dated line carries a due tag under its name; an undated one has none", () => {
  assert.match(rowHtml("loan"), /<span class="ps-due"[^>]*>due 2 Oct<\/span>/);
  assert.doesNotMatch(rowHtml("food"), /ps-due/);
});

test("the info button names its row, and is the phone's way in", () => {
  assert.match(rowHtml("food"), /aria-label="Details for Food"[^>]*aria-pressed="false"/);
});

test("hidden money draws no info button and no figures at all", () => {
  const html = rowHtml("food", { fmt: hidden });
  assert.doesNotMatch(html, /data-ps-info-button/);
  assert.doesNotMatch(html, /\$\d/);
  // The popover body itself is never drawn for hidden money (InfoPopover), but its text must not leak if asked for.
  assert.match(html, /••••/);
});

test("the row menu appears only with actions, offers only what applies, and an income line has no match entries", () => {
  assert.doesNotMatch(rowHtml("food"), /data-ps-menu-button/, "no actions, no menu");
  const html = rowHtml("food", { menuActions: { editNote: noop, editDetails: noop, remove: noop } });
  assert.match(html, /aria-label="More for Food"[^>]*aria-haspopup="menu"/);
});

test("the popover body: last month, the average, so far, pace, and the live effect on Left over", () => {
  const row = byKey.food;
  const held = { ...saved, food: d(1340) };
  const info = rowInfo({ row, plannedMinor: d(1300), totals: planTotals(rows, saved), when });
  const changed = rowInfo({ row, plannedMinor: d(1340), totals: planTotals(rows, held), when });
  const html = render(h(InfoBody, { row, info: { ...info, effect: changed.effect }, fmt: shown, id: "x" }));
  assert.match(html, /Last month<\/dt><dd>Planned \$1,200, spent \$1,180<\/dd>/);
  assert.match(html, /Average<\/dt><dd>spent \$1,100 a month over 3 months<\/dd>/);
  assert.match(html, /So far<\/dt><dd>spent \$910, \$390 left<\/dd>/);
  assert.match(html, /Spending fast, \$113 more than expected by today/);
  assert.match(html, /\+\$40 → Left over \$/);
});

test("a row with no past says so, a dated row speaks of its due date, and no change means no effect line", () => {
  const fresh = { ...byKey.food, history: null };
  const info = rowInfo({ row: fresh, plannedMinor: d(1300), totals: planTotals(rows, saved), when });
  const html = render(h(InfoBody, { row: fresh, info, fmt: shown, id: "x" }));
  assert.match(html, /No earlier month had this line\./);
  assert.doesNotMatch(html, /If you save this/);
  const unpaid = { ...byKey.loan, actualMinor: 0 };
  const dated = render(h(InfoBody, { row: unpaid, info: rowInfo({ row: unpaid, plannedMinor: d(2200), totals: planTotals(rows, saved), when }), fmt: shown, id: "x" }));
  assert.match(dated, /Past its due date, \$2,200 not paid yet/);
});

test("planned in shows one strip segment and one legend item per income row; none inside a job's zoom", () => {
  const totals = planTotals(rows, saved);
  const props = {
    monthLine: "October", paceChip: null, balance: { tone: "in", kind: "covered", title: "t", text: "x" }, fix: null, onFix: noop,
    totals, zoom: null, onZoom: noop, fmt: shown, dotColours: { sal: "#111", bon: "#222" }, jobColours: { spend: "#333", save: "#444", invest: "#555" },
    incomeParts: incomeSegments(rows, saved), onMoveLine: noop, onGestureStart: noop, onGestureEnd: noop, dragging: false, readOnly: true,
    segments: buildSegments(rows, saved, null)
  };
  const html = render(h(BigPicture, props));
  assert.equal((html.match(/data-ps-income-seg=/g) ?? []).length, 2);
  assert.match(html, /data-ps-income-part="sal"[^>]*>.*Salary.*\$5,400/s);
  assert.match(html, /data-ps-income-part="bon"[^>]*>.*Bonus.*\$600/s);
  const zoomed = render(h(BigPicture, { ...props, zoom: "spend", segments: buildSegments(rows, saved, "spend") }));
  assert.doesNotMatch(zoomed, /data-ps-income-seg/);
  const hiddenHtml = render(h(BigPicture, { ...props, fmt: hidden }));
  assert.doesNotMatch(hiddenHtml, /\$5,400/);
});

test("Sliders | List is a two-option radio group that marks held changes with a dot on Sliders only, and says nothing technical", () => {
  const html = render(h(PlanModeSwitch, { mode: "studio", onChange: noop, studioDirty: false }));
  assert.match(html, /role="radiogroup"[^>]*aria-label="How to show the plan"/);
  assert.match(html, /data-plan-mode="studio"[^>]*\/>Sliders<\/label>/);
  assert.match(html, /data-plan-mode="tables"[^>]*\/>List<\/label>/);
  assert.doesNotMatch(html, /Studio|Tables/, "the stored values stay in data attributes, never in the words shown");
  assert.match(html, /data-plan-mode-bar/, "on its own row by default");
  const inline = render(h(PlanModeSwitch, { mode: "studio", onChange: noop, inline: true }));
  assert.doesNotMatch(inline, /data-plan-mode-bar/, "in the toolbar's row it is the switch alone");
  assert.match(inline, /plan-mode-inline/);
  assert.match(html, /data-plan-mode="studio"[^>]*checked=""/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /data-plan-mode-dirty/);
  const dirty = render(h(PlanModeSwitch, { mode: "tables", onChange: noop, studioDirty: true }));
  assert.equal((dirty.match(/data-plan-mode-dirty/g) ?? []).length, 1);
  assert.match(dirty, /Sliders<i[^>]*aria-label="Sliders, with changes not saved yet"/);
});
