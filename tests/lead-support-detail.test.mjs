// The Lead · Support · Detail blocks (design.md, "Lead · Support · Detail"):
// one lead card with the amount in its money tone, Support chips, quiet
// Detail rows with empty, action and locked states, the More details fold
// that names what it holds, and the bottom bar with the primary action last.
import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MoneyPrivacyProvider } from "../src/client/money-privacy.jsx";
import {
  BottomActions,
  DetailRow,
  DetailRows,
  LeadCard,
  MetaChip,
  MoreDetails
} from "../src/client/ui/lead-support-detail.jsx";

// tsx compiles JSX to React.createElement (the classic runtime) here.
globalThis.React = React;
const h = React.createElement;
const render = (element) => renderToStaticMarkup(h(MoneyPrivacyProvider, null, element));
const count = (html, pattern) => (html.match(pattern) ?? []).length;

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
  assert.match(html, /style="--cat:#519ABD"/);
  assert.match(html, /<strong class="lsd-title">BUS\/MRT SIMPLYGO<\/strong>/);
  assert.match(html, /<span class="lsd-subtitle" style="--cat:#519ABD">Public Transport<\/span>/);
  assert.match(html, /<div class="lsd-amount money-out"><span>−\$27\.13<\/span><\/div>/);
  assert.match(html, /<div class="lsd-chips"><span class="lsd-chip">Mon 28 Sep<\/span><\/div>/);
});

test("a string amount goes through money privacy, and an editable amount is underlined", () => {
  // No window in Node, so money starts hidden as on a new browser.
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
  assert.match(html, /class="lsd-bubble" style="--cat:#7C8791"/);
});

test("a person chip takes the person's colour and a state chip its pastel pair", () => {
  const person = render(h(MetaChip, { person: "Ethan" }, "Ethan"));
  assert.match(person, /class="lsd-chip is-person"/);
  assert.match(person, /--person-chip-bg:color-mix\(in srgb, #[0-9A-F]{6} 16%, white\)/);
  assert.match(person, /--person-ink:/);

  const state = render(h(MetaChip, { tone: "mint" }, "Statement certified"));
  assert.match(state, /^<span class="lsd-chip is-mint">/);

  // An unknown tone is ignored rather than inventing a colour class.
  const unknown = render(h(MetaChip, { tone: "green" }, "Paid"));
  assert.equal(unknown, '<span class="lsd-chip">Paid</span>');
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

test("a row with its own control is a label around it, so the control keeps the row's name", () => {
  const html = render(h(DetailRow, { label: "Type", value: "Expense", "data-row": "type" },
    h("select", { className: "lsd-row-native", "aria-label": "Type" }, h("option", null, "Expense"))
  ));
  assert.match(html, /^<label class="lsd-row has-control" data-row="type"><span class="lsd-row-label">Type<\/span>/);
  assert.match(html, /<select class="lsd-row-native" aria-label="Type">/);

  const lockedControl = render(h(DetailRow, { label: "Description", state: "locked" }, h("textarea", { readOnly: true })));
  assert.match(lockedControl, /^<label class="lsd-row has-control is-locked">/);
  assert.match(lockedControl, /lucide-lock/);
});

test("More details names what it holds while closed and shows its rows only when open", () => {
  const closed = render(h(MoreDetails, { summary: "Posted date, type", open: false, onOpenChange: () => {} }, h(DetailRow, { label: "Posted date", value: "Not set" })));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /<span class="lsd-row-label">More details<\/span>/);
  assert.match(closed, /<span class="lsd-row-hint">Posted date, type<\/span>/);
  assert.doesNotMatch(closed, />Not set</);

  const open = render(h(MoreDetails, { summary: "Posted date, type", open: true, onOpenChange: () => {} }, h(DetailRow, { label: "Posted date", value: "Not set" })));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<span class="lsd-row-label">Fewer details<\/span>/);
  assert.doesNotMatch(open, /lsd-row-hint/);
  assert.match(open, />Not set</);
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
