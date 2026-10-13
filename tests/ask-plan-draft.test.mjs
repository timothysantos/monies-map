// Planning by chat on the Ask page (docs/flows/ask-flow.md "Planning by
// chat"), client side: what the page keeps of the plan-draft route's answer,
// the chips a draft's question shows, the card's head line for each kind of
// draft, Save and Undo through the plan-change route, and the conversation
// store keeping a draft across a reload (one caught mid-save comes back as a
// draft, never saved twice).
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { applyPlanChanges, readMoneyAnswerResponse, readPlanDraftResponse, requestPlanDraft } from "../src/client/ask-api.js";
import { buildChipRow, buildPlanQuestionChips, findActiveItem } from "../src/client/ask-chips.js";
import { createAskConversationStore } from "../src/client/ask-conversation-store.js";

// Components import their stylesheets (as Vite expects); load CSS as empty.
register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;
const { MoneyPrivacyProvider } = await import("../src/client/money-privacy.jsx");
const { AskPlanDraftCard, planDraftHead } = await import("../src/client/ask-plan-draft-card.jsx");
const { AskMoneyAnswerCard } = await import("../src/client/ask-money-answer-card.jsx");
const h = React.createElement;

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
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const totals = { before: { plannedIncomeMinor: 800_000, plannedSpendMinor: 595_000, remainingMinor: 205_000 }, after: { plannedIncomeMinor: 800_000, plannedSpendMinor: 600_000, remainingMinor: 200_000 } };
const DRAFT = {
  month: "2026-11",
  viewId: "person-tim",
  kind: "set",
  copyFrom: null,
  lead: { label: "Groceries", categoryName: "Groceries", amountMinor: 70_000, beforeMinor: 65_000 },
  changes: [{ rowId: "groc", action: "update", section: "budget_buckets", label: "Groceries", categoryName: "Groceries", ownerLabel: "Tim", beforeMinor: 65_000, afterMinor: 70_000 }],
  totals,
  warning: null,
  apply: [{ action: "update", rowId: "groc", expectedMinor: 65_000, plannedMinor: 70_000 }]
};

test("the page keeps a draft only whole, a question with options, or a known note", () => {
  assert.deepEqual(readPlanDraftResponse({ ok: true, supported: false }), { supported: false });
  assert.deepEqual(readPlanDraftResponse({ ok: true, supported: true, source: "rules", draft: DRAFT }), { supported: true, source: "rules", draft: DRAFT });
  assert.deepEqual(readPlanDraftResponse({ ok: true, supported: true, source: "ai", question: { field: "month", options: ["2026-10", "2026-11"] } }), { supported: true, source: "ai", question: { field: "month", options: ["2026-10", "2026-11"] } });
  assert.deepEqual(readPlanDraftResponse({ ok: true, supported: true, note: { reason: "unknown_line", name: "yacht", month: "2026-10" } }), { supported: true, source: "rules", note: { reason: "unknown_line", name: "yacht", month: "2026-10" } });
  for (const bad of [
    null,
    { ok: false },
    { ok: true, supported: true },
    { ok: true, supported: true, draft: { ...DRAFT, apply: [] } },
    { ok: true, supported: true, draft: { ...DRAFT, totals: { before: totals.before, after: { ...totals.after, remainingMinor: "lots" } } } },
    { ok: true, supported: true, draft: { ...DRAFT, changes: [] } },
    { ok: true, supported: true, question: { field: "colour", options: ["red"] } },
    { ok: true, supported: true, note: { reason: "made_up" } }
  ]) {
    assert.equal(readPlanDraftResponse(bad), null, JSON.stringify(bad));
  }
});

test("the plan answer keeps its savings-bar figures only when the four Month figures are numbers; the money jobs' three default to zero", () => {
  const body = (outcome) => ({
    ok: true, supported: true, intent: "plan", viewId: "household", scope: "direct_plus_shared", months: ["2026-09"], needsConfirmation: false,
    answer: { title: "September against plan", lead: { label: "Spent", amountMinor: 1, currency: "SGD", tone: "neutral" }, support: [], lines: [], links: [], outcome },
    wording: { text: "x", source: "template" }
  });
  const outcome = { incomeMinor: 830_000, spentMinor: 136_901, plannedSpendMinor: 300_896, savingsTargetMinor: 150_000 };
  assert.deepEqual(readMoneyAnswerResponse(body(outcome)).answer.outcome, { ...outcome, investedMinor: 0, savedMovedMinor: 0, plannedInvestMinor: 0, movedIntoInvestmentsMinor: 0, takenFromInvestmentsMinor: 0 });
  const withJobs = { ...outcome, investedMinor: 120_000, savedMovedMinor: 50_000, plannedInvestMinor: 150_000, movedIntoInvestmentsMinor: 40_000, takenFromInvestmentsMinor: 10_000 };
  assert.deepEqual(readMoneyAnswerResponse(body(withJobs)).answer.outcome, withJobs);
  assert.equal("outcome" in readMoneyAnswerResponse(body({ ...outcome, spentMinor: null })).answer, false);
});

test("requests go to the plan routes with the view, month and answers, and fail soft", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url === "/api/month-plan/apply-changes") {
      return new Response(JSON.stringify({ ok: false, error: "The plan changed since this draft was made. Ask again to see it as it is now." }), { status: 409 });
    }
    return new Response(JSON.stringify({ ok: true, supported: true, source: "rules", draft: DRAFT }), { status: 200 });
  };
  const drafted = await requestPlanDraft({ text: "set groceries to 700 for november", viewId: "person-tim", month: "2026-10", answers: { month: "2026-11" }, fetchImpl });
  assert.deepEqual(drafted, { ok: true, reading: { supported: true, source: "rules", draft: DRAFT } });
  const refused = await applyPlanChanges({ month: "2026-11", changes: DRAFT.apply }, { fetchImpl });
  assert.deepEqual(refused, { ok: false, conflict: true, error: "The plan changed since this draft was made. Ask again to see it as it is now." });
  assert.deepEqual(calls, [
    { url: "/api/ai-assist/plan-draft", body: { text: "set groceries to 700 for november", viewId: "person-tim", month: "2026-10", answers: { month: "2026-11" } } },
    { url: "/api/month-plan/apply-changes", body: { month: "2026-11", changes: DRAFT.apply } }
  ]);
  const offline = await applyPlanChanges({ month: "2026-11", changes: DRAFT.apply }, { fetchImpl: async () => { throw new Error("offline"); }, fallbackError: "Try again." });
  assert.deepEqual(offline, { ok: false, error: "Try again." });
  assert.deepEqual(await requestPlanDraft({ text: "x", viewId: "household", month: "2026-10", fetchImpl: async () => new Response("nope", { status: 500 }) }), { ok: false, reason: "failed" });
});

test("a draft's question owns the chip row: one chip per option, two same-named lines say whose", () => {
  const actions = new Proxy({}, { get: (_, name) => () => name });
  const month = buildPlanQuestionChips({ focus: { kind: "plan-question", question: { field: "month", options: ["2026-10", "2026-11"] } }, actions });
  assert.equal(month.prompt, "Which month's plan?");
  assert.deepEqual(month.items.map((item) => item.label), ["October 2026", "November 2026"]);
  const lines = buildPlanQuestionChips({
    focus: { kind: "plan-question", question: { field: "line", name: "groceries", options: [
      { rowId: "groc-tim", label: "Groceries", ownerLabel: "Tim", plannedMinor: 65_000 },
      { rowId: "groc-joyce", label: "Groceries", ownerLabel: "Joyce", plannedMinor: 40_000 },
      { rowId: "food", label: "Food & Drinks", ownerLabel: "Tim", plannedMinor: 32_000 }
    ] } },
    actions
  });
  assert.equal(lines.prompt, "Which line do you mean by “groceries”?");
  assert.deepEqual(lines.items.map((item) => item.label), ["Groceries · Tim", "Groceries · Joyce", "Food & Drinks"]);
  const owner = buildPlanQuestionChips({ focus: { kind: "plan-question", question: { field: "owner", line: "Travel", options: [{ key: "person-tim", label: "Tim" }, { key: "shared", label: "Shared" }] } }, actions });
  assert.equal(owner.prompt, "Whose Travel line is it?");
  assert.deepEqual(owner.items.map((item) => item.label), ["Tim", "Shared"]);
  // Through the row builder: an open plan question is the active item.
  const pending = { kind: "plan-question", question: { field: "month", options: ["2026-10"] } };
  const active = findActiveItem({ thread: [], card: null, cardSlot: 0, pending });
  assert.deepEqual(buildChipRow({ active, intent: { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" }, card: null, context: {}, actions }).items.map((item) => item.label), ["October 2026"]);
});

test("the head line names the line, the move or the copied month, as the mockups do", () => {
  assert.deepEqual(planDraftHead(DRAFT), { title: "Groceries plan", subtitle: "November 2026", caption: "was $650.00" });
  assert.deepEqual(planDraftHead({ ...DRAFT, lead: { ...DRAFT.lead, beforeMinor: null } }).caption, "New line");
  assert.deepEqual(planDraftHead({ ...DRAFT, kind: "move", lead: { label: "", categoryName: null, amountMinor: 20_000, beforeMinor: null, fromLabel: "Shopping", toLabel: "Travel" } }), { title: "Move $200.00", subtitle: "Shopping to Travel", caption: "Nov 2026" });
  assert.deepEqual(planDraftHead({ ...DRAFT, kind: "copy", copyFrom: "2026-09", lead: { label: "", categoryName: null, amountMinor: 440_000, beforeMinor: 0 } }), { title: "November 2026 plan", subtitle: "Like September 2026", caption: "was $0.00" });
});

const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
const categories = [{ name: "Groceries", colorHex: "#5B8C5A", iconKey: "shopping-basket" }];
const noop = () => {};
const card = (item, options) => render(h(AskPlanDraftCard, { item, people, categories, onSave: noop, onDiscard: noop, onUndo: noop, onOpenMonth: noop }), options);

test("the draft card shows each line and the view's totals before → after, then Discard and Save plan", () => {
  const html = card({ id: "p1", draft: DRAFT, source: "rules", status: "draft" });
  const words = text(html);
  assert.match(words, /^Draft Groceries plan November 2026 \$700\.00 was \$650\.00 Tim Nov 2026/);
  assert.match(words, /Groceries \$650\.00 → to \$700\.00/);
  assert.match(words, /Planned income \$8,000\.00 Planned spend \$5,950\.00 → to \$6,000\.00 Remaining budget \$2,050\.00 → to \$2,000\.00/);
  assert.match(words, /Discard Save plan$/);
  assert.doesNotMatch(words, /Read by AI|See it on Month/);
  // An AI-read draft says so; a warning shows under the rows.
  const ai = text(card({ id: "p2", draft: { ...DRAFT, warning: { text: "Your November plan spends $950.00 more than it expects to earn.", shortMinor: 95_000 } }, source: "ai", status: "draft" }));
  assert.match(ai, /^Draft Read by AI Groceries plan/);
  assert.match(ai, /Your November plan spends \$950\.00 more than it expects to earn\. Discard Save plan$/);
});

test("with money hidden the card shows no amount, no 'was' figure and no warning", () => {
  const html = card({ id: "p1", draft: { ...DRAFT, warning: { text: "Your November plan spends $950.00 more than it expects to earn.", shortMinor: 95_000 } }, source: "rules", status: "draft" }, { visible: false });
  assert.doesNotMatch(text(html), /\$|was |expects to earn/);
  assert.match(text(html), /Groceries •••• → to ••••/);
  assert.doesNotMatch(html, /money-plan|money-in|money-short/);
});

test("a saved draft keeps its head, marked Saved, with See it on Month and Undo this change", () => {
  const words = text(card({ id: "p1", draft: DRAFT, source: "rules", status: "saved", undo: [] }));
  assert.equal(words, "Saved Groceries plan November 2026 $700.00 planned See it on Month Undo this change");
});

test("the plan answer draws the Month lead's savings bar from its four figures", () => {
  const answer = {
    title: "September against plan",
    lead: { label: "Spent · 40 expenses", amountMinor: 136_901, currency: "SGD", tone: "neutral", planMinor: 300_896 },
    support: [{ label: "Plan", amountMinor: 300_896, currency: "SGD" }],
    lines: [],
    links: [],
    outcome: { incomeMinor: 830_000, spentMinor: 136_901, plannedSpendMinor: 300_896, savingsTargetMinor: 150_000 }
  };
  const html = render(h(AskMoneyAnswerCard, { answer, wording: { text: "September came to $1,369.01.", source: "template" }, intent: "plan" }));
  assert.match(html, /data-savings-bar/);
  assert.match(text(html), /You kept \$6,931 of the \$8,300 you earned/i);
  const without = render(h(AskMoneyAnswerCard, { answer: { ...answer, outcome: undefined }, wording: { text: "x", source: "template" }, intent: "plan" }));
  assert.doesNotMatch(without, /data-savings-bar/);
});

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

test("a plan draft survives a reload; one caught saving comes back as a draft, one caught undoing as saved", () => {
  const storage = memoryStorage();
  const store = createAskConversationStore({ storage });
  const key = "chat|||";
  store.begin(key, () => ({ intent: { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" }, thread: [], card: null, cardSlot: 0, composerText: "", pending: null, scrollFromBottom: 0 }));
  store.update(key, (conversation) => ({
    ...conversation,
    thread: [
      { id: "a", kind: "me", text: "set groceries to 700 for november" },
      { id: "b", kind: "plan-draft", text: "set groceries to 700 for november", request: { viewId: "person-tim", month: "2026-10" }, draft: DRAFT, source: "rules", status: "saving" },
      { id: "c", kind: "plan-draft", text: "x", request: {}, draft: DRAFT, source: "rules", status: "undoing", undo: [{ action: "update", rowId: "groc", expectedMinor: 70_000, plannedMinor: 65_000 }] },
      { id: "d", kind: "plan-draft", text: "broken", request: {}, draft: { month: "2026-11" }, status: "draft" }
    ]
  }));
  const reloaded = createAskConversationStore({ storage }).read(key);
  assert.deepEqual(reloaded.thread.map((item) => [item.id, item.status ?? ""]), [["a", ""], ["b", "draft"], ["c", "saved"]]);
  assert.deepEqual(reloaded.thread[1].draft, DRAFT);
});
