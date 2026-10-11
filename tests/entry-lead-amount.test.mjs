// The Entries edit card's lead amount (entry-edit-card.jsx): while it is
// not being typed in it shows formatted money ("64.20", never the raw
// "64.2" a manual entry was saved with); while focused it is the raw text
// the person types.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Node has no loader for what Vite imports as assets: a stylesheet loads
// as an empty module and a `?url` import (the PDF worker) as an empty URL.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) {"
  + " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };"
  + " if (url.endsWith('?url')) return { format: 'module', source: 'export default \"\";', shortCircuit: true };"
  + " return next(url, context); }"
));
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { EntryLeadAmount, leadAmountFieldValue } = await import("../src/client/entry-edit-card.jsx");

const h = React.createElement;

function renderAmount(props) {
  globalThis.window = { localStorage: { getItem: () => "true", setItem() {} } };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, h(EntryLeadAmount, { locked: false, onChange() {}, ...props })));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("the editable lead amount shows money with two decimals until it is focused", () => {
  // A manual entry saved as "64.2": the card reads −$64.20, as the list does.
  const html = renderAmount({ entry: { id: "e1", entryType: "expense", amountMinor: 6420, amountInput: "64.2" } });
  assert.match(html, /<input[^>]* aria-label="Amount"[^>]* value="64.20"/);
  assert.match(html, /<span class="lsd-amount-sign" aria-hidden="true">−<\/span><span aria-hidden="true">\$<\/span>/);
  assert.doesNotMatch(html, /value="64.2"/);

  // Whole dollars and the amount passed in by the sheet read the same way.
  assert.match(renderAmount({ entry: { id: "e2", entryType: "income", amountMinor: 1200, amountInput: "12" } }), /value="12.00"/);
  assert.match(renderAmount({ entry: { id: "e3", entryType: "expense", amountMinor: 0 }, amountMinorValue: 50, amountInputValue: ".5" }), /value="0.50"/);
});

test("focused, the field is the raw text; empty stays empty for its placeholder", () => {
  assert.equal(leadAmountFieldValue({ focused: true, draft: "64.2", amountMinor: 6420 }), "64.2");
  assert.equal(leadAmountFieldValue({ focused: true, draft: "1,2", amountMinor: 120 }), "1,2");
  assert.equal(leadAmountFieldValue({ focused: false, draft: "64.2", amountMinor: 6420 }), "64.20");
  assert.equal(leadAmountFieldValue({ focused: false, draft: "1234.5", amountMinor: 123450 }), "1234.50");
  // A negative stored amount still shows its size: the sign is its own span.
  assert.equal(leadAmountFieldValue({ focused: false, draft: "-3", amountMinor: -300 }), "3.00");
  // Nothing typed: no "0.00" over the placeholder.
  assert.equal(leadAmountFieldValue({ focused: false, draft: "", amountMinor: 0 }), "");
  assert.equal(leadAmountFieldValue({ focused: false, draft: "  ", amountMinor: 0 }), "");
});
