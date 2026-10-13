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
const { buildAnswerCard, buildTemplateWording } = await import("../src/domain/ask-answer-wording.ts");
const h = React.createElement;

const answer = {
  title: "March spending",
  lead: { label: "Spent · 52 expenses", amountMinor: 1039123, currency: "SGD", tone: "short", planMinor: 726309 },
  support: [{ label: "Plan", amountMinor: 726309, currency: "SGD" }],
  lines: [{ label: "Courts Megastore Tampines", detail: "11 Mar · Home", amountMinor: 328000, currency: "SGD", tone: "out" }],
  links: []
};

function render(wording, { visible = true, card = answer, intent = "spending" } = {}) {
  globalThis.window = { localStorage: { getItem: () => String(visible), setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(h(MoneyPrivacyProvider, null, h(AskMoneyAnswerCard, { answer: card, wording, intent })));
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

// September for one person: more went out than came in. Built by the
// route's own card and wording builders from Month-shaped facts.
const overspentMonth = {
  month: "2026-09", viewId: "person-tim", scope: "direct_plus_shared",
  spentMinor: 620_000, plannedMinor: 500_000, incomeMinor: 500_000, plannedIncomeMinor: 500_000,
  savingsTargetMinor: 50_000, investedMinor: 30_000, savedMovedMinor: 0, plannedInvestMinor: 50_000,
  entryCount: 12, expenseCount: 11,
  categories: [], allCategories: [
    { name: "Home", amountMinor: 400_000, sharePercent: 65, entryCount: 3 },
    { name: "Groceries", amountMinor: 190_000, sharePercent: 31, entryCount: 7 },
    { name: "Investments", amountMinor: 30_000, sharePercent: 5, entryCount: 1 }
  ],
  biggest: [], investments: [{ id: "e-1", description: "iFAST GIRO", date: "2026-09-03", categoryName: "Investments", amountMinor: 30_000 }],
  savingsMoves: [], planRows: [], incomeSources: []
};

test("spending against income: the part from savings and the categories, and hidden money shows neither", () => {
  const facts = { kind: "spentVsEarned", current: overspentMonth };
  const card = buildAnswerCard(facts, { today: "2026-10-12" });
  const wording = { text: buildTemplateWording(facts, { today: "2026-10-12" }), source: "template" };
  assert.equal(wording.text, "In September you earned $5,000.00, spent $5,900.00 and invested $300.00, so $1,200.00 came out of savings. Most of the spending went to home ($4,000.00) and groceries ($1,900.00). Spending was $1,900.00 more than the $4,000.00 you planned.");
  const shown = render(wording, { card, intent: "spentVsEarned" });
  assert.match(shown, /data-ask-money-answer="spentVsEarned"/);
  assert.match(shown, /Came out of savings/);
  assert.match(shown, /data-savings-bar/);

  const hidden = render(wording, { card, intent: "spentVsEarned", visible: false });
  assert.match(hidden, /September spending and income/);
  assert.match(hidden, /Reveal money totals to read these insights\./);
  // The savings bar is the Month lead's own in its hidden form: shares of
  // income and no amount, as on the lead. Everything else on the card (the
  // title, lead, chips, words and lines) has no amount and no word that
  // says which side of income the money fell.
  const bar = hidden.match(/<div class="savings-bar".*?<p class="savings-bar-sentence"[^>]*>([^<]*)<\/p><\/div>/);
  assert.equal(bar?.[1], "Spent, invested and kept, as shares of income");
  assert.doesNotMatch(bar[0], /\$\d/);
  assert.doesNotMatch(hidden.replace(bar[0], ""), /\$\d|came out of savings|more than|short of|over plan/i);
});

test("saved below zero leaves the plan bar empty, and hidden money masks the lead", () => {
  const facts = { kind: "saved", current: overspentMonth };
  const card = buildAnswerCard(facts, { today: "2026-10-12" });
  assert.deepEqual(card.lead, { label: "Saved", amountMinor: -120_000, currency: "SGD", tone: "short", planMinor: 50_000, overIsShort: false });
  const shown = render({ text: buildTemplateWording(facts, { today: "2026-10-12" }), source: "template" }, { card, intent: "saved" });
  assert.match(shown, /class="lsd-bar-fill[^"]*" style="width:0%"/);
  assert.match(shown, /That&#x27;s \$1,700\.00 short of your \$500\.00 savings target\./);
  const hidden = render({ text: "x", source: "template" }, { card, intent: "saved", visible: false });
  assert.doesNotMatch(hidden, /\$\d|-\$|short of/);
});
