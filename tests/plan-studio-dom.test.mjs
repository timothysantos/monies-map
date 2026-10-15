// Plan Studio's markup (design.md "Plan Studio"): what a row, the bar, the
// amount popover's body and the what-if card draw, what they must not draw
// (hidden money, a locked row's controls) and how a screen reader reads them.
// Behaviour in a browser (dragging, keys, the popover opening, saving) is
// tests/e2e/plan-studio.spec.js.
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
const { BigPicture } = await import("../src/client/plan-studio-bar.jsx");
const { AmountBody } = await import("../src/client/plan-studio-amount.jsx");
const { WhatIfCard } = await import("../src/client/plan-studio-whatif.jsx");
const { makeStudioFormat } = await import("../src/client/plan-studio-format.js");
const { buildSegments } = await import("../src/client/plan-studio-edit.js");
const { buildStudioRows, planTotals } = await import("../src/client/plan-studio-model.js");

const h = React.createElement;
const d = (dollars) => Math.round(dollars * 100);
const noop = () => {};
const shown = makeStudioFormat(false);
const hidden = makeStudioFormat(true);
const render = (element) => renderToStaticMarkup(h(MoneyPrivacyProvider, null, element));
const count = (html, pattern) => (html.match(pattern) ?? []).length;

const food = {
  key: "food", ids: ["food"], sourceMinors: [d(1300)], job: "spend", section: "budget_buckets", label: "Food & Drinks",
  categoryName: "Food & Drinks", ownerName: "", ownershipType: "shared", savedMinor: d(1300), actualMinor: d(910),
  actualEntryIds: ["e1", "e2"], dueDay: null, editable: true,
  splits: [{ personId: "p1", personName: "Tim", ratioBasisPoints: 5000, amountMinor: d(650) }, { personId: "p2", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: d(650) }]
};

function row(overrides = {}, fmt = shown) {
  return render(h(StudioRow, {
    row: { ...food, ...(overrides.row ?? {}) }, plannedMinor: overrides.plannedMinor ?? d(1300), savedMinor: d(1300), locked: Boolean(overrides.locked), fmt,
    status: { kind: "spend_left", tone: "in", amountMinor: d(390) }, paceMinor: d(800), scale: { maxMinor: d(2000), stepMinor: d(50) },
    halves: [{ personName: "Tim", amountMinor: d(650) }, { personName: "Joyce", amountMinor: d(650) }], dotColour: "var(--cat-c67d3f, #C67D3F)",
    readOnlyReason: "Change this one in the plan list below.",
    onSet: noop, onNudge: noop, onGestureStart: noop, onGestureEnd: noop, onToggleLock: noop
  }));
}

test("a row's slider is a slider: named, with its range, value and the amount in words", () => {
  const html = row();
  assert.match(html, /role="slider"[^>]*aria-label="Planned amount for Food &amp; Drinks"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="2000"/);
  assert.match(html, /aria-valuenow="1300"/);
  assert.match(html, /aria-valuetext="\$1,300 planned"/);
  assert.match(html, /tabindex="0"/);
});

test("the amount is a button that names what typing it does, and the nudges name their step", () => {
  const html = row();
  assert.match(html, /aria-label="Type the planned amount for Food &amp; Drinks"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /aria-label="Lower Food &amp; Drinks by 50 dollars"/);
  assert.match(html, /aria-label="Raise Food &amp; Drinks by 50 dollars"/);
  assert.match(html, />−50</);
  assert.match(html, />\+50</);
});

test("a row shows where it stands and each person's half of a shared row", () => {
  const html = row();
  assert.match(html, /On track, \$390 left/);
  assert.match(html, /Shared · \$650 each/);
  const odd = row({ plannedMinor: 130_001 });
  assert.match(odd, /from saved/);
});

test("a changed row says how far it is from saved, with a true minus sign", () => {
  const html = row({ plannedMinor: d(1250) });
  assert.match(html, /−\$50 from saved/);
  assert.match(html, /ps-row is-changed/);
  assert.equal(count(row(), /from saved/g), 0);
});

test("a locked row's controls are off and its lock says Unlock", () => {
  const html = row({ locked: true });
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Unlock Food &amp; Drinks"|aria-label="Unlock Food &amp; Drinks"[^>]*aria-pressed="true"/);
  assert.match(html, /aria-disabled="true"/);
  assert.equal(count(html, /class="ps-nudge" disabled/g), 2);
  assert.match(html, /<button[^>]*class="ps-amount"[^>]*disabled/);
});

test("a row the studio cannot save has no slider, only the reason", () => {
  const html = row({ row: { editable: false } });
  assert.doesNotMatch(html, /role="slider"/);
  assert.match(html, /Change this one in the plan list below\./);
  assert.match(html, /ps-amount is-static/);
});

test("the row opens its entries through the shared figure menu", () => {
  const html = row();
  assert.match(html, /data-fig="spent"/);
  assert.match(html, /data-fig-ids="e1 e2"/);
  assert.match(html, /data-fig-arg="Food &amp; Drinks"/);
  assert.equal(count(row({ row: { actualEntryIds: [] } }), /data-fig=/g), 0);
});

test("with money hidden the amount is dots, the track draws no spending and nothing says over or under", () => {
  const html = row({ plannedMinor: d(1250) }, hidden);
  assert.match(html, /aria-valuetext="Amount hidden"/);
  assert.doesNotMatch(html, /\$/);
  assert.equal(count(html, /ps-track-actual|ps-track-over|ps-track-pace/g), 0);
  assert.match(html, /<button type="button" class="ps-row-status\s+ps-row-figure"[^>]*><\/button>/, "the status says nothing, though it still opens the entries");
  assert.match(html, /••••/);
});

const rows = buildStudioRows({
  month: "2026-10",
  incomeRows: [{ id: "sal", label: "Salary", categoryName: "Salary", plannedMinor: d(9200), actualMinor: d(9200), sourceRowIds: ["sal"] }],
  planSections: [{ key: "planned_items", rows: [{ id: "food", section: "planned_items", label: "Food", categoryName: "Food", plannedMinor: d(6000), actualMinor: 0, ownershipType: "shared", sourceRowIds: ["food"], splits: [] }, { id: "save", section: "planned_items", label: "Savings", categoryName: "Savings", plannedMinor: d(1500), actualMinor: 0, ownershipType: "shared", sourceRowIds: ["save"], splits: [] }] }]
});
const jobColours = { spend: "var(--a)", save: "var(--b)", invest: "var(--c)", income: "var(--d)" };

function bar(plan, fmt = shown) {
  const totals = planTotals(rows, plan);
  return render(h(BigPicture, {
    monthLine: "October 2026 · day 19 of 31", paceChip: { tone: "in", text: "On track" },
    balance: { kind: totals.left < 0 ? "over" : "covered", tone: totals.left < 0 ? "short" : "in", title: "T", text: "X" },
    fix: null, onFix: noop, segments: buildSegments(rows, plan, null), totals, zoom: null, onZoom: noop, fmt,
    dotColours: {}, jobColours, onMoveLine: noop, onGestureStart: noop, onGestureEnd: noop, dragging: false
  }));
}

test("the bar has a slice per job, a Planned in line and a draggable line between neighbours", () => {
  const html = bar({ sal: d(9200), food: d(6000), save: d(1500) });
  assert.equal(count(html, /data-ps-seg="/g), 4);
  assert.match(html, /Planned in \$9,200/);
  assert.equal(count(html, /role="slider"[^>]*class="ps-divider"/g), 3);
  assert.match(html, /aria-label="Move the line between Spend and Save"/);
  assert.match(html, /aria-label="Move the line between Invest and Left over"/);
  assert.doesNotMatch(html, /data-ps-over/);
  assert.match(html, /aria-label="Resize categories in Spend"/);
});

test("an over-allocated plan spills past the Planned in line, hatched, and says by how much", () => {
  const html = bar({ sal: d(9200), food: d(8000), save: d(1500) }, shown);
  assert.match(html, /data-ps-over/);
  const hiddenHtml = bar({ sal: d(9200), food: d(8000), save: d(1500) }, hidden);
  assert.match(hiddenHtml, /ps-bar-over is-neutral/);
  assert.doesNotMatch(hiddenHtml, /\$\d/);
});

test("the amount popover's field takes decimals, names its error and offers six chips and a reset", () => {
  const body = (props) => render(h(AmountBody, {
    inputId: "f", text: "137", error: "", parsed: { ok: true, minor: d(137) }, savedMinor: d(650), fmt: shown,
    onText: noop, onSubmit: noop, onChip: noop, onResetToSaved: noop, inputRef: { current: null }, ...props
  }));
  const ok = body({});
  assert.match(ok, /inputMode="decimal"|inputmode="decimal"/);
  assert.match(ok, /value="137"/);
  assert.match(ok, /−\$513 from saved/);
  assert.match(ok, /Saved: \$650/);
  assert.equal(count(ok, /class="ps-chip"/g), 6);
  for (const label of ["+$5", "+$10", "+$50", "−$5", "−$10", "−$50"]) assert.ok(ok.includes(`>${label}<`), label);
  assert.match(ok, /Reset to saved/);
  assert.doesNotMatch(ok, /role="alert"/);
  const bad = body({ text: "abc", error: "not_a_number", parsed: { ok: false, reason: "not_a_number" } });
  assert.match(bad, /role="alert"[^>]*>Use numbers only, like 137 or 137\.50\./);
  assert.match(bad, /aria-invalid="true"/);
  assert.match(body({ parsed: { ok: true, minor: d(650) } }), /Same as saved/);
  assert.match(body({ fmt: hidden }), /Saved: ••••/);
});

function whatIf(props) {
  return render(h(WhatIfCard, {
    fmt: shown, hasSaveRow: true, saveTotalMinor: d(1500), totals: planTotals(rows, { sal: d(9200), food: d(6000), save: d(1500) }), preview: null,
    targetMinor: d(1500), maxMinor: d(4000), stepMinor: d(50), takeOptions: [{ value: "auto", label: "Spread" }], takeFromKey: "auto",
    onTry: noop, onTakeFrom: noop, onApply: noop, onCancel: noop, ...props
  }));
}

test("What if I save more says it changes the plan only, and offers nothing to apply until a target is tried", () => {
  const html = whatIf({});
  assert.match(html, /What if I save more\?/);
  assert.match(html, /Changes the plan only\. Spending is not predicted\./);
  assert.match(html, /<button[^>]*disabled[^>]*data-ps-whatif-apply[^>]*>Apply to plan|<button[^>]*data-ps-whatif-apply[^>]*disabled/);
  assert.doesNotMatch(html, /Room to spend|safe to spend|forecast/i);
});

test("a tried target shows where the money would come from and what is short", () => {
  const html = whatIf({
    preview: { plan: {}, saveKey: "save", extraMinor: d(800), fromLeftMinor: d(300), givenBackMinor: 0, takenFrom: [{ key: "food", label: "Food", minor: d(400) }], shortfallMinor: d(100), totals: { income: d(9200), spend: d(5600), save: d(2300), invest: 0, out: d(7900), left: -d(100) } },
    targetMinor: d(2300)
  });
  assert.match(html, /\$300 from left over/);
  assert.match(html, /\$400 from Food/);
  assert.match(html, /\$100 is not available, so the plan would not add up\./);
  assert.match(html, /\$2,300 \(try\)/);
  assert.match(html, /Take the rest from/);
});

test("without a savings line the card says what to add instead of a slider", () => {
  const html = whatIf({ hasSaveRow: false });
  assert.match(html, /Add a Savings line to the plan to try this\./);
  assert.doesNotMatch(html, /role="slider"/);
});
