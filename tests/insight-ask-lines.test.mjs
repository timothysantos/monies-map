// "Ask about this" on the Money insights (financial-insight.jsx,
// insight-ask-event.js): the headline and each Also line with a signal
// behind it get one, the folded teaser gets one on its eyebrow row (apart
// from the fold's own button), and none shows while money is hidden or on
// a line with no signal (calm, quiet, sorted). The tap hands the shell the
// line and its signal's basis, nothing else of the page. Also pins the
// Ask-side pieces that keep it: the conversation store keeps an insight
// answer across a reload, and an insight's entries by id round-trip
// through the Entries URL with the From Ask chip.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { phrase } from "../src/domain/money-signals/format.ts";
import { statementGapSignal, triviaSignal } from "../src/domain/money-signals/shared-signals.ts";
import { SUMMARY_COPY } from "../src/domain/money-signals/summary-signals.ts";
import { uncategorizedSignal } from "../src/domain/money-signals/entries-signals.ts";
import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { ASK_INSIGHT_EVENT, askAboutInsight } from "../src/client/insight-ask-event.js";
import { createAskConversationStore } from "../src/client/ask-conversation-store.js";
import { buildEntriesFilterSearch, clearAskFilterParams, hasAskFilterChip, readAskFilterFromParams } from "../src/client/entry-filter-params.js";
import { describeFilterParts } from "../src/client/copy/entry-filter-copy.js";
import { buildInsightAnswer, readInsightHandoff } from "../src/client/ask-insight-answer.js";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;
const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { FinancialInsight } = await import("../src/client/financial-insight.jsx");

const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
const gap = statementGapSignal({
  accountPills: [{ accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "mismatch", latestCheckpointMonth: "2026-09", latestCheckpointDeltaMinor: -4_280 }],
  audience: "household",
  viewLabel: "Household",
  formatMoney: sgd
});
const other = uncategorizedSignal({
  audience: "household",
  month: "2026-10",
  today: "2026-10-13",
  entries: [{ id: "t1", date: "2026-10-03", description: "SHOPEE SG", amountMinor: 3_990, categoryName: "Other", entryType: "expense" }],
  formatMoney: sgd
});

// A Fun fact (the average month) and the Big picture runway, each with no
// headline signal beside them being needed.
const funFact = triviaSignal("average-month", "2026-09", SUMMARY_COPY.averageMonth, { amount: "$8,020", span: "November 2025 to September 2026" });
const runway = {
  key: "cushion",
  kind: "long_view",
  weight: 1_200_000,
  numbers: { primaryMinor: 1_200_000, count: 1 },
  phrasings: phrase(SUMMARY_COPY.cushion, { months: "1 month", usual: "$8,020", balance: "$9,000" }),
  basis: { lines: [{ label: "Bank balances", amountMinor: 900_000 }, { label: "Usual spending a month", amountMinor: 802_000 }, { label: "Months it would cover", text: "1" }] },
  topic: "enough"
};
const FUN_ROTATION = { columns: [["average-month"]] };

function checkIn(signals, extra = {}) {
  return {
    memoryKey: "summary|household",
    contextKey: "2026-10|direct_plus_shared",
    signals,
    page: "summary",
    period: "2026-10",
    calmLines: ["Nothing needs a look this month."],
    ...extra,
    clock: { nowMs: Date.parse("2026-10-13T10:00:00+08:00"), today: "2026-10-13" }
  };
}

function render(signals, { visible = true, open = true, extra = {} } = {}) {
  const stored = { "monies-map:money-totals-visible": String(visible), "monies-map:money-insights-desktop": String(open) };
  globalThis.window = { localStorage: { getItem: (key) => stored[key] ?? null, setItem() {} } };
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    return renderToStaticMarkup(React.createElement(MoneyPrivacyProvider, null, React.createElement(FinancialInsight, { checkIn: checkIn(signals, extra) })));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

const askButtons = (markup) => [...markup.matchAll(/<button[^>]*class="checkin-ask([^"]*)"[^>]*aria-label="([^"]*)"[^>]*>Ask about this<\/button>/g)]
  .map((match) => ({ variant: match[1].trim(), label: match[2].replace(/&#x27;/g, "'") }));

test("the open insights: the headline has Ask about this, named for its line; no teaser link", () => {
  const markup = render([gap, other]);
  const buttons = askButtons(markup);
  assert.deepEqual(buttons.map((button) => button.variant), [""]);
  // The headline's wording rotates by period: the link names the one shown.
  const shown = gap.phrasings.map((phrasing) => phrasing.fact).find((fact) => markup.includes(fact.replace(/'/g, "&#x27;")));
  assert.ok(shown);
  assert.equal(buttons[0].label, `Ask about this: ${shown}`);
  // Also lines render only once See all insights is open (client state);
  // their link is in the component, pinned by the e2e spec.
});

test("folded, the teaser's link sits beside the fold button, not inside it", () => {
  const markup = render([gap, other], { open: false });
  // The teaser's, then the headline's inside the folded (hidden) content.
  assert.deepEqual(askButtons(markup).map((button) => button.variant), ["is-teaser", ""]);
  assert.match(markup, /class="financial-insight-content" hidden=""/);
  const fold = markup.match(/<button[^>]*class="financial-insight-fold"[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(fold, /Ask about this/);
  assert.ok(markup.indexOf("checkin-ask is-teaser") > markup.indexOf("financial-insight-fold"));
});

test("hidden money, or a calm line with no signal behind it: no Ask about this", () => {
  assert.deepEqual(askButtons(render([gap], { visible: false })), []);
  assert.deepEqual(askButtons(render([gap], { visible: false, open: false })), []);
  assert.doesNotMatch(render([], { open: true }), /Ask about this/);
  assert.doesNotMatch(render([], { open: false }), /Ask about this/);
});

test("the Fun fact and Big picture lines each have Ask about this, named for their line; none with money hidden", () => {
  const markup = render([gap, funFact, runway], { extra: { triviaRotation: FUN_ROTATION } });
  const buttons = askButtons(markup);
  assert.deepEqual(buttons.map((button) => button.variant), ["", "is-line", "is-line"]);
  const fun = "From November 2025 to September 2026, spending averaged about $8,020 a month.";
  assert.equal(buttons[1].label, `Ask about this: ${fun}`);
  // The Big picture is the runway's own wording, with no caveat after it.
  const shown = runway.phrasings.map((phrasing) => phrasing.fact).find((fact) => markup.includes(fact.replace(/'/g, "&#x27;")));
  assert.ok(shown, "the runway line is on the page");
  assert.equal(buttons[2].label, `Ask about this: ${shown}`);
  assert.match(markup, /<p class="checkin-long-view"><span class="checkin-line-label">Big picture<\/span>[^<]*<button/);
  assert.doesNotMatch(markup, /useful part|depends on your life/);
  // Hidden money: no figure, no Ask about this on any of them.
  const hidden = render([gap, funFact, runway], { visible: false, extra: { triviaRotation: FUN_ROTATION } });
  assert.deepEqual(askButtons(hidden), []);
  assert.doesNotMatch(hidden, /\$8,020|\$9,000|1 month/);
  // No runway data (no signal): no Big picture line and no link for it.
  const none = render([gap, funFact], { extra: { triviaRotation: FUN_ROTATION } });
  assert.deepEqual(askButtons(none).map((button) => button.variant), ["", "is-line"]);
  assert.doesNotMatch(none, /Big picture/);
});

test("the tap hands the shell a Fun fact or Big picture line with its basis, or an empty one", () => {
  const target = new EventTarget();
  const seen = [];
  target.addEventListener(ASK_INSIGHT_EVENT, (event) => seen.push(event.detail));
  globalThis.window = target;
  try {
    askAboutInsight(runway, { fact: runway.phrasings[0].fact, think: "" });
    askAboutInsight(funFact, { fact: funFact.phrasings[0].fact, think: "" });
  } finally {
    delete globalThis.window;
  }
  assert.equal(seen[0].insight.kind, "long_view");
  assert.equal(seen[0].insight.think, "");
  assert.deepEqual(seen[0].insight.basis, runway.basis);
  assert.equal(seen[1].insight.kind, "just_for_fun");
  assert.deepEqual(seen[1].insight.basis, { lines: [] });
  // Ask reads both, and builds a card with a line and no basis list for the fun fact.
  const handoff = (detail) => ({ ...detail.insight, context: { viewId: "household", scope: "direct_plus_shared", month: "2026-10" } });
  const long = readInsightHandoff(handoff(seen[0]));
  const fun = readInsightHandoff(handoff(seen[1]));
  assert.equal(long.kind, "long_view");
  assert.equal(fun.kind, "just_for_fun");
  assert.deepEqual(buildInsightAnswer(fun, { today: "2026-10-13" }).lines, []);
  assert.equal(buildInsightAnswer(long, { today: "2026-10-13" }).lines.length, 3);
  assert.equal(buildInsightAnswer(long, { today: "2026-10-13" }).question, `Explain: ${runway.phrasings[0].fact.replace(/[.!]+$/, "")}`);
  // A kind that is not an insight kind is still refused.
  assert.equal(readInsightHandoff({ ...handoff(seen[0]), kind: "calm" }), null);
});

test("the tap hands the shell the line and its signal's basis, nothing more", () => {
  const target = new EventTarget();
  const seen = [];
  target.addEventListener(ASK_INSIGHT_EVENT, (event) => seen.push(event.detail));
  globalThis.window = target;
  try {
    askAboutInsight(gap, { fact: "Down from $50.00 since your last visit. Serene's OCBC 365 Card statement differs from what's recorded here by $42.80.", think: "Worth a look." });
    askAboutInsight(other, { fact: other.phrasings[0].fact });
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(seen[0], {
    insight: {
      key: "statement-gap:acct-ocbc-365",
      kind: "quick_fix",
      fact: "Down from $50.00 since your last visit. Serene's OCBC 365 Card statement differs from what's recorded here by $42.80.",
      think: "Worth a look.",
      primaryMinor: 4_280,
      basis: gap.basis
    }
  });
  // An Also line has no think line of its own: its wording's first.
  assert.equal(seen[1].insight.think, other.phrasings[0].think);
});

test("an insight answer survives a reload in the conversation store; a malformed one is dropped", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  const intent = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };
  const handoff = { key: gap.key, kind: gap.kind, fact: gap.phrasings[0].fact, think: gap.phrasings[0].think, primaryMinor: 4_280, basis: gap.basis, context: { viewId: "household", scope: "direct_plus_shared", month: "2026-10" } };
  const answer = buildInsightAnswer(readInsightHandoff(handoff), { today: "2026-10-13" });
  const store = createAskConversationStore({ storage });
  store.begin("chat|||", () => ({ intent, thread: [], card: null, cardSlot: 0, composerText: "", pending: null, scrollFromBottom: 0 }));
  store.update("chat|||", (conversation) => ({
    ...conversation,
    thread: [
      { id: "ask-x-1", kind: "me", text: answer.question, hiddenText: "Explain this money insight" },
      { id: "ask-x-2", kind: "insight-answer", answer, explanation: { text: "The two are $42.80 apart.", source: "ai" } },
      { id: "ask-x-3", kind: "insight-answer", answer: { fact: 3 } }
    ]
  }));
  const reloaded = createAskConversationStore({ storage }).begin("chat|||", () => null);
  assert.deepEqual(reloaded.thread.map((item) => item.kind), ["me", "insight-answer"]);
  assert.deepEqual(reloaded.thread[1].answer, answer);
  assert.deepEqual(reloaded.thread[1].explanation, { text: "The two are $42.80 apart.", source: "ai" });
  assert.equal(reloaded.thread[0].hiddenText, "Explain this money insight");
});

test("an insight's entries by id ride the Entries URL, show the From Ask chip, and its clear drops them", () => {
  const filter = { month: "2026-08", viewId: "household", scope: "direct_plus_shared", search: "", categories: [], wallets: [], type: "", minAmountMinor: null, maxAmountMinor: null, entryIds: ["txn-joyce", "txn-tim"] };
  const params = buildEntriesFilterSearch(filter);
  assert.deepEqual([...params.entries()], [
    ["view", "household"],
    ["month", "2026-08"],
    ["scope", "direct_plus_shared"],
    ["entries_scope", "direct_plus_shared"],
    ["entry_id", "txn-joyce"],
    ["entry_id", "txn-tim"],
    ["from_ask", "1"]
  ]);
  assert.equal(hasAskFilterChip(params), true);
  assert.deepEqual(describeFilterParts(readAskFilterFromParams(params)).map((part) => part.label), ["2 entries"]);
  const cleared = clearAskFilterParams(params);
  assert.equal(cleared.getAll("entry_id").length, 0);
  assert.equal(hasAskFilterChip(cleared), false);
  // A check-in link's entry ids without from_ask are not "from Ask".
  assert.equal(hasAskFilterChip(new URLSearchParams("entry_id=txn-1")), false);
});

// The first screen keeps no Ask code: the insights only send an event, and
// the shell's launcher opens Ask through the dock it already has.
test("the insights and the shell's launcher import no Ask page code", async () => {
  const { readFileSync } = await import("node:fs");
  const importsOf = (file) => [...readFileSync(new URL(`../src/client/${file}`, import.meta.url), "utf8").matchAll(/^import[^;]*?from "([^"]+)"/gms)].map((match) => match[1]);
  for (const file of ["financial-insight.jsx", "insight-ask-event.js", "use-insight-ask-launcher.js"]) {
    const imports = importsOf(file);
    assert.deepEqual(imports.filter((path) => /ask-(panel|insight|api|chips|conversation|dock-panel|dock-state)/.test(path)), [], file);
  }
  assert.deepEqual(importsOf("use-insight-ask-launcher.js"), ["react", "./app-routing", "./ask-dock", "./insight-ask-event", "./use-viewport"]);
});
