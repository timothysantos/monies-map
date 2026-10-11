import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The blocks import their own stylesheet (as Vite expects); Node has no CSS
// loader, so a CSS import loads as an empty module here.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
// tsx compiles .jsx with the classic runtime (React.createElement).
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const {
  BottomActions,
  DetailRow,
  DetailRows,
  LeadCard,
  MetaChip,
  MoreDetails,
  leadProgress
} = await import("../src/client/ui/lead-support-detail.jsx");

const h = React.createElement;

// Money privacy is a browser preference read from localStorage; each render
// sets it first so a test can show the visible and the hidden page.
function render(element, { visible = true } = {}) {
  globalThis.window = { localStorage: { getItem: () => String(visible), setItem() {} } };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, element));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("leadProgress fills against the plan, caps at 100 and is over only past the plan", () => {
  assert.deepEqual(leadProgress(29_754, 32_000), { percent: 93, isOver: false });
  assert.deepEqual(leadProgress(32_000, 32_000), { percent: 100, isOver: false });
  assert.deepEqual(leadProgress(40_000, 32_000), { percent: 100, isOver: true });
  // Spending with no plan is over; nothing against nothing is an empty bar.
  assert.deepEqual(leadProgress(1_500, 0), { percent: 100, isOver: true });
  assert.deepEqual(leadProgress(0, 0), { percent: 0, isOver: false });
  // A caller can say over plan is not bad (income above its plan).
  assert.deepEqual(leadProgress(40_000, 32_000, { overIsShort: false }), { percent: 100, isOver: false });
});

test("LeadCard renders the lead line, an editable amount, the bar and the chips", () => {
  const html = render(h(LeadCard, {
    title: "Food & Drinks",
    subtitle: "Budget bucket",
    accentColor: "#B88A3D",
    bubble: h("span", { className: "probe-bubble" }),
    amount: h("input", { "aria-label": "Planned", defaultValue: "320.00" }),
    amountCaption: "planned",
    editable: true,
    progress: { valueMinor: 29_754, planMinor: 32_000 },
    progressStart: "spent",
    progressEnd: "left",
    chips: h(MetaChip, null, "Sep 2026")
  }));
  assert.match(html, /^<section class="lead-card"/);
  assert.match(html, /style="--lead-accent:#B88A3D"/);
  assert.match(html, /<span class="probe-bubble"><\/span>/);
  assert.match(html, /<strong class="lead-card-title">Food &amp; Drinks<\/strong>/);
  assert.match(html, /<span class="lead-card-subtitle">Budget bucket<\/span>/);
  // The editable amount and its caption are one label.
  assert.match(html, /<label class="lead-card-amount-column"><span class="lead-card-amount is-editable"><input aria-label="Planned"/);
  assert.match(html, /<small class="lead-card-amount-caption">planned<\/small>/);
  // A bar 93% full in the plain grey fill, under plan.
  assert.match(html, /<span class="lead-card-bar" aria-hidden="true"><span class="lead-card-bar-fill money-neutral" style="width:93%"><\/span><\/span>/);
  assert.match(html, /<div class="lead-card-progress-line"><span>spent<\/span><span>left<\/span><\/div>/);
  assert.match(html, /<div class="lead-card-chips"><span class="meta-chip">Sep 2026<\/span><\/div>/);
});

test("LeadCard over plan fills the bar rose; hidden money keeps only the empty track and drops the line", () => {
  const over = render(h(LeadCard, { amount: "$400", progress: { valueMinor: 40_000, planMinor: 32_000 } }));
  assert.match(over, /lead-card-bar-fill money-short" style="width:100%"/);

  const hidden = render(h(LeadCard, {
    amount: "••••",
    progress: { valueMinor: 40_000, planMinor: 32_000 },
    progressStart: "spent",
    progressEnd: "over",
    hiddenProgressStart: "Spent ••••"
  }), { visible: false });
  assert.match(hidden, /<span class="lead-card-bar" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(hidden, /lead-card-bar-fill/);
  assert.doesNotMatch(hidden, />over</);
  assert.match(hidden, /<div class="lead-card-progress-line"><span>Spent ••••<\/span><\/div>/);
});

test("LeadCard without a title stacks an eyebrow over the amount and its aside", () => {
  const html = render(h(LeadCard, { eyebrow: "Spent · Oct 2025 – Sep 2026", amount: "$22,777.67", amountAside: "of $37,807.52 plan" }));
  assert.match(html, /<span class="lead-card-eyebrow">Spent · Oct 2025 – Sep 2026<\/span>/);
  assert.match(html, /<div class="lead-card-figure"><span class="lead-card-amount">\$22,777.67<\/span><span class="lead-card-amount-aside">of \$37,807.52 plan<\/span><\/div>/);
  assert.doesNotMatch(html, /lead-card-head/);
  assert.doesNotMatch(html, /lead-card-bar/);
});

test("MetaChip: a person chip takes that person's colour, a state chip its pastel pair", () => {
  const person = render(h(MetaChip, { person: "Tim" }, "Tim"));
  assert.match(person, /class="meta-chip meta-chip-person"/);
  assert.match(person, /--person-colour:#33A471/);
  assert.match(person, /--person-ink:color-mix\(in srgb, #33A471 55%, var\(--text\)\)/);
  assert.match(person, /<span class="meta-chip-dot" aria-hidden="true"><\/span>Tim/);

  const state = render(h(MetaChip, { tone: "mint" }, "Statement certified"));
  assert.match(state, /class="meta-chip meta-chip-mint"/);
  // An unknown tone is ignored rather than inventing a colour class.
  assert.equal(render(h(MetaChip, { tone: "neon" }, "x")), '<span class="meta-chip">x</span>');
});

test("DetailRow states: a field row labels its control, an action row is a button, empty and locked are muted", () => {
  const field = render(h(DetailRow, { label: "Item name" }, h("input", { defaultValue: "Food & Drinks" })));
  assert.match(field, /^<label class="detail-row is-field"><span class="detail-row-label">Item name<\/span><span class="detail-row-value"><input/);
  assert.match(field, /class="[^"]*detail-row-chevron"/);

  // A picker that is itself a button is named by the row label's id.
  const picker = render(h(DetailRow, { label: "Category", labelId: "category-label" }, h("button", { type: "button", "aria-labelledby": "category-label" }, "Savings")));
  assert.match(picker, /<span id="category-label" class="detail-row-label">Category<\/span>/);

  const action = render(h(DetailRow, { label: "Actual", value: "See the 10 entries", action: true, onClick: () => {} }));
  assert.match(action, /^<button type="button" class="detail-row is-button is-action">/);
  assert.match(action, /<span class="detail-row-value">See the 10 entries<\/span>/);

  const empty = render(h(DetailRow, { label: "Note", value: "", emptyLabel: "Add a note", onClick: () => {} }));
  assert.match(empty, /class="detail-row is-button is-empty"/);
  assert.match(empty, /<span class="detail-row-value">Add a note<\/span>/);

  const locked = render(h(DetailRow, { label: "Amount", value: "$12.00", locked: true, onClick: () => {} }));
  // Locked: not a button, a lock in place of the chevron, never clickable.
  assert.match(locked, /^<div class="detail-row is-locked">/);
  assert.match(locked, /detail-row-lock/);
  assert.doesNotMatch(locked, /detail-row-chevron|<button/);

  const disabled = render(h(DetailRow, { label: "Actual", value: "No contributing entries yet", onClick: () => {}, disabled: true }));
  assert.match(disabled, /<button type="button" class="detail-row is-button" disabled="">/);
});

test("DetailRows groups the rows and names the group", () => {
  const html = render(h(DetailRows, { label: "Plan details" }, h(DetailRow, { label: "A", value: "1" })));
  assert.match(html, /^<div class="detail-rows" role="group" aria-label="Plan details"><div class="detail-row">/);
});

test("MoreDetails lists what it holds, folds by default and never folds when forced open", () => {
  const closed = render(h(MoreDetails, { summary: "Posted date, type" }, h("p", null, "inside")));
  assert.match(closed, /<button type="button" class="more-details-toggle" aria-expanded="false"/);
  assert.match(closed, /<span class="more-details-summary">Posted date, type<\/span>/);
  assert.doesNotMatch(closed, /inside/);

  const forced = render(h(MoreDetails, { summary: "Posted date, type", forceOpen: true }, h("p", null, "inside")));
  assert.match(forced, /aria-expanded="true"/);
  assert.match(forced, /<p>inside<\/p>/);
});

test("BottomActions: the quiet action on the left, the primary submit on the right", () => {
  const html = render(h(BottomActions, { primaryLabel: "Done", quietLabel: "Cancel", onQuiet: () => {} }));
  assert.match(html, /^<div class="bottom-actions"><button type="button" class="bottom-actions-quiet">Cancel<\/button><button type="submit" class="dialog-primary bottom-actions-primary">Done<\/button><\/div>$/);

  const busy = render(h(BottomActions, { primaryLabel: "Saving...", primaryDisabled: true, quietLabel: "Delete", quietTone: "danger", onQuiet: () => {} }));
  assert.match(busy, /class="bottom-actions-quiet is-danger"/);
  assert.match(busy, /<button type="submit" class="dialog-primary bottom-actions-primary" disabled="">Saving...<\/button>/);

  // With no quiet action only the primary shows.
  assert.doesNotMatch(render(h(BottomActions, { primaryLabel: "Done" })), /bottom-actions-quiet/);
});
