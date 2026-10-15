// The Lead · Support · Detail blocks (design.md, "Lead · Support · Detail"):
// one implementation shared by the Summary lead, the Month plan-row sheet,
// the Entries edit sheet and inline editor, New split expense and the Ask
// card. One lead card (a head line or an eyebrow over a figure, the amount
// in its money tone, the actual-vs-plan bar), Support chips, quiet Detail
// rows with empty, action and locked states, the More details fold that
// names what it holds, and the bottom bar with the primary action last.
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
const count = (html, pattern) => (html.match(pattern) ?? []).length;

// Money privacy is a browser preference read from localStorage. `visible`
// sets it before the render; without it there is no window, so money starts
// hidden as on a new browser.
function render(element, { visible = undefined } = {}) {
  if (visible === undefined) {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, element));
  }
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

test("a lead card shows one bubble, the title, the category line and the amount in its money tone", () => {
  const html = render(h(LeadCard, {
    category: { colorHex: "#519ABD", iconKey: "bus" },
    title: "BUS/MRT SIMPLYGO",
    subtitle: "Public Transport",
    amount: h("span", null, "−$27.13"),
    tone: "out",
    chips: [h(MetaChip, { key: "d" }, "Mon 28 Sep")]
  }));

  assert.match(html, /^<section class="lsd-card"/);
  assert.equal(count(html, /class="lsd-bubble"/g), 1);
  assert.match(html, /style="--cat:var\(--cat-519abd, #519ABD\)"/);
  assert.match(html, /<strong class="lsd-title">BUS\/MRT SIMPLYGO<\/strong>/);
  assert.match(html, /<span class="lsd-subtitle" style="--cat:var\(--cat-519abd, #519ABD\)">Public Transport<\/span>/);
  assert.match(html, /<span class="lsd-amount money-out"><span>−\$27\.13<\/span><\/span>/);
  assert.match(html, /<div class="lsd-chips"><span class="lsd-chip">Mon 28 Sep<\/span><\/div>/);
  // No caption: the amount is not wrapped in a column; no bar without progress.
  assert.doesNotMatch(html, /lsd-amount-column|lsd-bar/);
});

test("a string amount goes through money privacy, and an editable amount is underlined", () => {
  const hidden = render(h(LeadCard, { title: "Lunch", amount: "$12.50", tone: "out" }));
  assert.match(hidden, /<span class="private-money">••••<\/span>/);
  assert.doesNotMatch(hidden, /12\.50/);

  const editable = render(h(LeadCard, { title: "Lunch", amount: h("input", { "aria-label": "Amount" }), tone: "neutral", editable: true }));
  assert.match(editable, /class="lsd-amount money-neutral is-editable"/);
});

test("a lead without a tone or category keeps the plain ink and a neutral bubble", () => {
  const html = render(h(LeadCard, { title: "What was it?", amount: h("b", null, "0") }));
  assert.match(html, /class="lsd-amount"/);
  assert.doesNotMatch(html, /money-/);
  assert.match(html, /class="lsd-bubble" style="--cat:var\(--cat-7c8791, #7C8791\)"/);
});

test("a caller's bubble, accent colour, editable amount with caption, the bar and the chips (the Month plan sheet)", () => {
  const html = render(h(LeadCard, {
    title: "Food & Drinks",
    subtitle: "Monthly budget",
    accentColor: "#B88A3D",
    bubble: h("span", { className: "probe-bubble" }),
    amount: h("input", { "aria-label": "Planned", defaultValue: "320.00" }),
    amountCaption: "planned",
    editable: true,
    progress: { valueMinor: 29_754, planMinor: 32_000 },
    progressStart: "spent",
    progressEnd: "left",
    chips: h(MetaChip, null, "Sep 2026")
  }), { visible: true });
  assert.match(html, /<span class="lsd-bubble-slot"><span class="probe-bubble"><\/span><\/span>/);
  assert.doesNotMatch(html, /class="lsd-bubble"/);
  assert.match(html, /<strong class="lsd-title">Food &amp; Drinks<\/strong>/);
  assert.match(html, /<span class="lsd-subtitle" style="--cat:var\(--cat-b88a3d, #B88A3D\)">Monthly budget<\/span>/);
  // The editable amount and its caption are one label.
  assert.match(html, /<label class="lsd-amount-column"><span class="lsd-amount is-editable"><input aria-label="Planned"/);
  assert.match(html, /<small class="lsd-amount-caption">planned<\/small><\/label>/);
  // A bar 93% full in the plain grey fill, under plan.
  assert.match(html, /<span class="lsd-bar" aria-hidden="true"><span class="lsd-bar-fill money-neutral" style="width:93%"><\/span><\/span>/);
  assert.match(html, /<div class="lsd-progress-line"><span>spent<\/span><span>left<\/span><\/div>/);
  // Chips come after the bar.
  assert.match(html, /<\/div><\/div><div class="lsd-chips"><span class="lsd-chip">Sep 2026<\/span><\/div><\/section>$/);
});

test("over plan fills the bar rose; hidden money keeps only the empty track and drops the line", () => {
  const over = render(h(LeadCard, { amount: "$400", progress: { valueMinor: 40_000, planMinor: 32_000 } }), { visible: true });
  assert.match(over, /lsd-bar-fill money-short" style="width:100%"/);

  const hidden = render(h(LeadCard, {
    amount: "$400",
    progress: { valueMinor: 40_000, planMinor: 32_000 },
    progressStart: "spent",
    progressEnd: "over",
    hiddenProgressStart: "Spent ••••"
  }), { visible: false });
  assert.match(hidden, /<span class="lsd-bar" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(hidden, /lsd-bar-fill/);
  assert.doesNotMatch(hidden, />over</);
  assert.doesNotMatch(hidden, /\$400/);
  assert.match(hidden, /<div class="lsd-progress-line"><span>Spent ••••<\/span><\/div>/);
});

test("without a title the eyebrow stacks over the figure and its aside (the Summary lead)", () => {
  const html = render(h(LeadCard, { eyebrow: "Spent · Oct 2025 – Sep 2026", amount: h("b", null, "$22,777.67"), amountAside: "of $37,807.52 plan" }));
  assert.match(html, /<span class="lsd-eyebrow">Spent · Oct 2025 – Sep 2026<\/span>/);
  assert.match(html, /<div class="lsd-figure"><span class="lsd-amount"><b>\$22,777.67<\/b><\/span><span class="lsd-amount-aside">of \$37,807.52 plan<\/span><\/div>/);
  assert.doesNotMatch(html, /lsd-hero|lsd-bubble|lsd-bar/);
});

test("a tag sits above the head line and children come after the chips", () => {
  const html = render(h(LeadCard, {
    title: "Lunch",
    tag: h("span", { className: "probe-tag" }, "Saved"),
    chips: h(MetaChip, null, "Today")
  }, h("p", { className: "probe-child" }, "after")));
  assert.match(html, /^<section class="lsd-card"><span class="probe-tag">Saved<\/span><div class="lsd-hero">/);
  assert.match(html, /<div class="lsd-chips">.*<\/div><p class="probe-child">after<\/p><\/section>$/);
  // An array of chips that are all left out shows no empty chip row.
  assert.doesNotMatch(render(h(LeadCard, { title: "x", chips: [null, false] })), /lsd-chips/);
});

test("a person chip takes the person's colour and a state chip its pastel pair", () => {
  const person = render(h(MetaChip, { person: "Tim" }, "Tim"));
  assert.match(person, /class="lsd-chip is-person"/);
  assert.match(person, /--person-colour:var\(--cat-46788e, #46788E\)/);
  assert.match(person, /--person-ink:color-mix\(in srgb, var\(--cat-46788e, #46788E\) 55%, var\(--text\)\)/);
  assert.match(person, /--person-chip-bg:color-mix\(in srgb, var\(--cat-[0-9a-f]{6}, #[0-9A-F]{6}\) 16%, var\(--paper\)\)/);

  const state = render(h(MetaChip, { tone: "mint" }, "Statement certified"));
  assert.match(state, /^<span class="lsd-chip is-mint">/);

  // An unknown tone is ignored rather than inventing a colour class, and an
  // empty person name is not a person chip.
  assert.equal(render(h(MetaChip, { tone: "green" }, "Paid")), '<span class="lsd-chip">Paid</span>');
  assert.equal(render(h(MetaChip, { person: "" }, "x")), '<span class="lsd-chip">x</span>');
});

test("detail rows are buttons with a chevron, and their value states read as empty, action or locked", () => {
  const html = render(h(DetailRows, { label: "Entry details" },
    h(DetailRow, { label: "Category", value: "Groceries", onClick: () => {} }),
    h(DetailRow, { label: "Splits", value: "Add to splits", state: "action", onClick: () => {} }),
    h(DetailRow, { label: "Note", value: "Add a note", state: "empty", onClick: () => {} }),
    h(DetailRow, { label: "Posted date", value: "Tue 29 Sep 2026", state: "locked" })
  ));

  assert.match(html, /^<div class="lsd-rows" role="group" aria-label="Entry details">/);
  assert.equal(count(html, /<button type="button" class="lsd-row/g), 3);
  assert.match(html, /class="lsd-row-value is-action"><span class="lsd-row-text">Add to splits<\/span>/);
  assert.match(html, /class="lsd-row-value is-empty"><span class="lsd-row-text">Add a note<\/span>/);
  // A locked row is not a button and shows a lock instead of the chevron.
  assert.match(html, /<div class="lsd-row is-locked"><span class="lsd-row-label">Posted date<\/span><span class="lsd-row-value is-locked">/);
  assert.equal(count(html, /lucide-chevron-right/g), 3);
  assert.equal(count(html, /lucide-lock/g), 1);
});

test("the flag forms: action, an empty value with its empty label, locked and disabled", () => {
  const action = render(h(DetailRow, { label: "Actual", value: "See the 10 entries", action: true, onClick: () => {} }));
  assert.match(action, /^<button type="button" class="lsd-row is-action">/);
  assert.match(action, /<span class="lsd-row-value is-action"><span class="lsd-row-text">See the 10 entries<\/span>/);

  const empty = render(h(DetailRow, { label: "Note", value: "", emptyLabel: "Add a note", onClick: () => {} }));
  assert.match(empty, /^<button type="button" class="lsd-row is-empty">/);
  assert.match(empty, /<span class="lsd-row-value is-empty"><span class="lsd-row-text">Add a note<\/span>/);

  const locked = render(h(DetailRow, { label: "Amount", value: "$12.00", locked: true, onClick: () => {} }));
  // Locked: not a button, a lock in place of the chevron, never clickable.
  assert.match(locked, /^<div class="lsd-row is-locked">/);
  assert.match(locked, /lsd-row-lock/);
  assert.doesNotMatch(locked, /lsd-row-chevron|<button/);
  // A locked action is not an action.
  assert.doesNotMatch(render(h(DetailRow, { label: "Splits", value: "View split", state: "action", locked: true })), /is-action/);

  const disabled = render(h(DetailRow, { label: "Actual", value: "No contributing entries yet", onClick: () => {}, disabled: true }));
  assert.match(disabled, /^<button type="button" class="lsd-row" disabled="">/);
});

test("a row with its own control is a label around it, so the control keeps the row's name", () => {
  const html = render(h(DetailRow, { label: "Type", value: "Expense", "data-row": "type" },
    h("select", { className: "lsd-row-native", "aria-label": "Type" }, h("option", null, "Expense"))
  ));
  assert.match(html, /^<label class="lsd-row has-control" data-row="type"><span class="lsd-row-label">Type<\/span>/);
  assert.match(html, /<select class="lsd-row-native" aria-label="Type">/);

  // A plain input straight in the row, as the Month plan sheet writes it.
  const field = render(h(DetailRow, { label: "Item name" }, h("input", { defaultValue: "Food & Drinks" })));
  assert.match(field, /^<label class="lsd-row has-control"><span class="lsd-row-label">Item name<\/span><input value="Food &amp; Drinks"\/><\/label>$/);

  // A picker that is itself a button is named by the row label's id.
  const picker = render(h(DetailRow, { label: "Category", labelId: "category-label" }, h("button", { type: "button", "aria-labelledby": "category-label" }, "Savings")));
  assert.match(picker, /<span id="category-label" class="lsd-row-label">Category<\/span>/);

  const lockedControl = render(h(DetailRow, { label: "Description", state: "locked" }, h("textarea", { readOnly: true })));
  assert.match(lockedControl, /^<label class="lsd-row has-control is-locked">/);
  assert.match(lockedControl, /lucide-lock/);
});

test("More details names what it holds while closed and shows its rows only when open", () => {
  const closed = render(h(MoreDetails, { summary: "Time, posted date, type", open: false, onOpenChange: () => {} }, h(DetailRow, { label: "Posted date", value: "Not set" })));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /<span class="lsd-row-label">More details<\/span>/);
  assert.match(closed, /<span class="lsd-row-hint">Time, posted date, type<\/span>/);
  assert.doesNotMatch(closed, />Not set</);

  const open = render(h(MoreDetails, { summary: "Time, posted date, type", open: true, onOpenChange: () => {} }, h(DetailRow, { label: "Posted date", value: "Not set" })));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<span class="lsd-row-label">Fewer details<\/span>/);
  assert.doesNotMatch(open, /lsd-row-hint/);
  assert.match(open, />Not set</);
});

test("More details on its own folds by default, opens from defaultOpen and never folds when forced open", () => {
  const closed = render(h(MoreDetails, { summary: "Time, posted date, type" }, h("p", null, "inside")));
  assert.match(closed, /^<button type="button" class="lsd-row lsd-row-more" aria-expanded="false"/);
  assert.doesNotMatch(closed, /inside/);

  assert.match(render(h(MoreDetails, { defaultOpen: true }, h("p", null, "inside"))), /<p>inside<\/p>/);

  const forced = render(h(MoreDetails, { summary: "Time, posted date, type", forceOpen: true }, h("p", null, "inside")));
  assert.match(forced, /aria-expanded="true" disabled=""/);
  // Forced open keeps its plain name: there is nothing to fold.
  assert.match(forced, /<span class="lsd-row-label">More details<\/span>/);
  assert.match(forced, /<p>inside<\/p>/);
});

test("the bottom bar keeps a destructive action apart and the primary action last", () => {
  const html = render(h(BottomActions, {
    destructive: h("button", { type: "button", className: "lsd-quiet is-danger" }, "Delete entry"),
    secondary: h("button", { type: "button", className: "lsd-quiet" }, "Cancel"),
    primary: h("button", { type: "submit", className: "lsd-primary" }, "Save")
  }));
  assert.equal(
    html,
    '<div class="lsd-bottom"><div class="lsd-bottom-start"><button type="button" class="lsd-quiet is-danger">Delete entry</button></div>'
      + '<div class="lsd-bottom-end"><button type="button" class="lsd-quiet">Cancel</button><button type="submit" class="lsd-primary">Save</button></div></div>'
  );

  // Without a destructive action there is no empty start group.
  const plain = render(h(BottomActions, { primary: h("button", { type: "submit" }, "Save expense") }));
  assert.equal(plain, '<div class="lsd-bottom"><div class="lsd-bottom-end"><button type="submit">Save expense</button></div></div>');
});

test("the bar builds its own buttons from labels: the quiet action at the start, the primary submit at the end", () => {
  const html = render(h(BottomActions, { primaryLabel: "Done", quietLabel: "Cancel", onQuiet: () => {}, className: "is-sheet-bar" }));
  assert.equal(
    html,
    '<div class="lsd-bottom is-sheet-bar"><div class="lsd-bottom-start"><button type="button" class="lsd-quiet">Cancel</button></div>'
      + '<div class="lsd-bottom-end"><button type="submit" class="lsd-primary dialog-primary">Done</button></div></div>'
  );

  const busy = render(h(BottomActions, { primaryLabel: "Saving...", primaryDisabled: true, quietLabel: "Delete", quietTone: "danger", onQuiet: () => {} }));
  assert.match(busy, /class="lsd-quiet is-danger"/);
  assert.match(busy, /<button type="submit" class="lsd-primary dialog-primary" disabled="">Saving...<\/button>/);

  // A primary with its own handler is a plain button, not a submit.
  assert.match(render(h(BottomActions, { primaryLabel: "Next", onPrimary: () => {} })), /<button type="button" class="lsd-primary dialog-primary">Next<\/button>/);
  // With no quiet action only the primary shows.
  assert.doesNotMatch(render(h(BottomActions, { primaryLabel: "Done" })), /lsd-quiet|lsd-bottom-start/);
});
