// The money answer card (src/client/ask-money-answer-card.jsx): words the
// optional AI phrased carry the entry card's butter "Worded by AI" tag; the
// computed wording carries none, and hidden money hides the tag with the
// words. Rendered to static markup.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Components import their stylesheets (as Vite expects); load CSS as empty.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { AskMoneyAnswerCard } = await import("../src/client/ask-money-answer-card.jsx");
const h = React.createElement;

const answer = {
  title: "March spending",
  lead: { label: "Spent · 52 expenses", amountMinor: 1039123, currency: "SGD", tone: "short", planMinor: 726309 },
  support: [{ label: "Plan", amountMinor: 726309, currency: "SGD" }],
  lines: [{ label: "Courts Megastore Tampines", detail: "11 Mar · Home", amountMinor: 328000, currency: "SGD", tone: "out" }],
  links: []
};

function render(wording, { visible = true } = {}) {
  globalThis.window = { localStorage: { getItem: () => String(visible), setItem() {} } };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, h(AskMoneyAnswerCard, { answer, wording, intent: "spending" })));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("AI wording shows the butter Worded by AI tag above the head line", () => {
  const html = render({ text: "March came to $10,391.23, $3,128.14 over plan.", source: "ai" });
  assert.match(html, /<span class="ask-card-tag is-filled ask-money-ai-tag"><svg[^>]*>.*?<\/svg>Worded by AI<\/span>/);
  assert.match(html, /data-wording-source="ai"/);
  assert.match(html, /March came to \$10,391\.23, \$3,128\.14 over plan\./);
});

test("the computed wording has no tag", () => {
  const html = render({ text: "March came to $10,391.23.", source: "template" });
  assert.doesNotMatch(html, /Worded by AI|ask-money-ai-tag/);
  assert.match(html, /data-wording-source="template"/);
  assert.match(html, /March came to \$10,391\.23\./);
});

test("with money hidden the tag goes with the words", () => {
  const html = render({ text: "March came to $10,391.23.", source: "ai" }, { visible: false });
  assert.doesNotMatch(html, /Worded by AI/);
  assert.match(html, /Reveal money totals to read these insights\./);
});
