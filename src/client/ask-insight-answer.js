// An insight question in Ask (DOMAIN.md "Insight Question"; docs/flows/
// ask-flow.md "Insight questions"): "Ask about this" on a Money insights
// line hands Ask the line, its think line and what its signal is based on
// (money-signals/types.ts, SignalBasis). This turns that hand-off into the
// question the person sees and the answer card's model: the line, the
// figure it is about, the basis lines, the Entries filter that shows its
// entries, and the follow-up chips that fit its kind of insight. Pure, and
// nothing here asks the server or AI.

import { insightQuestionText } from "../domain/ask-insight";
import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { formatMonthYear } from "./copy/ask-plan-copy";

const KINDS = new Set(["quick_fix", "bigger_question", "worth_a_look", "going_well"]);
const MAX_LINES = 12;
const MAX_ENTRY_IDS = 50;
const MONTH = /^\d{4}-\d{2}$/;
const SCOPES = new Set(["direct", "shared", "direct_plus_shared"]);

function text(value, max = 400) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function month(value) {
  return typeof value === "string" && MONTH.test(value) ? value : "";
}

function readLine(value) {
  if (!value || typeof value !== "object") return null;
  const label = text(value.label, 90);
  if (!label) return null;
  if (Number.isSafeInteger(value.amountMinor)) {
    const currency = typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency) && value.currency !== "SGD" ? value.currency : undefined;
    return currency ? { label, amountMinor: value.amountMinor, currency } : { label, amountMinor: value.amountMinor };
  }
  const shown = text(value.text, 120);
  return shown ? { label, text: shown } : null;
}

function readEntries(value) {
  if (!value || typeof value !== "object") return null;
  const entryIds = Array.isArray(value.entryIds)
    ? value.entryIds.filter((id) => typeof id === "string" && id && id.length <= 200).slice(0, MAX_ENTRY_IDS)
    : [];
  const entries = {
    month: month(value.month),
    entryIds,
    categoryName: text(value.categoryName, 120),
    accountId: text(value.accountId, 200),
    type: value.type === "expense" || value.type === "income" ? value.type : ""
  };
  return entries.entryIds.length || entries.categoryName || entries.accountId || entries.type ? entries : null;
}

/**
 * The hand-off from a Money insights line (insight-ask-event.js, through
 * App.jsx), read and bounded: it rides in history state on a phone and in
 * memory in the desktop panel, and is kept in the conversation. Null when it
 * is not one.
 */
export function readInsightHandoff(value) {
  if (!value || typeof value !== "object") return null;
  const fact = text(value.fact);
  const lines = Array.isArray(value.basis?.lines) ? value.basis.lines.slice(0, MAX_LINES).map(readLine).filter(Boolean) : [];
  if (!KINDS.has(value.kind) || !fact || typeof value.key !== "string" || !value.key) return null;
  const context = value.context && typeof value.context === "object" ? value.context : {};
  return {
    key: text(value.key, 200),
    kind: value.kind,
    fact,
    think: text(value.think),
    primaryMinor: Number.isSafeInteger(value.primaryMinor) ? value.primaryMinor : null,
    basis: {
      lines,
      entries: readEntries(value.basis?.entries),
      month: month(value.basis?.month),
      groupId: text(value.basis?.groupId, 200)
    },
    context: {
      viewId: text(context.viewId, 200) || "household",
      scope: SCOPES.has(context.scope) ? context.scope : "direct_plus_shared",
      month: month(context.month)
    }
  };
}

// The kind of insight, from its signal key ("statement-gap:acct-ocbc").
export function insightType(key) {
  return String(key ?? "").split(":")[0];
}

// The follow-ups each kind of insight offers after Open in Entries: a page
// that shows more ("Open Month", "Open Splits", the statement) or a money
// question Ask already answers (with its own check before any figure), or
// "Change my plan" for a plan that doesn't add up: planning by chat, with
// the month already in the message box for the person to finish ("cut
// shopping by $100 in October 2026") and send; nothing changes until Save
// plan on the draft.
const FOLLOW_UPS = {
  "statement-gap": ["statement"],
  "plan-shortfall": ["change-plan", "month"],
  "unlinked-bills": ["month"],
  "upcoming-bills": ["month"],
  "savings-on-plan": ["month"],
  "plan-left": ["month", "plan"],
  "plan-pace": ["month", "plan"],
  "category-over-plan": ["month", "plan"],
  "one-off-over-plan": ["month", "plan"],
  "income-above-plan": ["month", "income"],
  "income-arrived": ["income"],
  "split-balance": ["splits", "owed"],
  "split-match": ["splits"],
  "settlement-payment": ["splits", "owed"],
  "spending-above-income": ["month", "spending"],
  "category-creep": ["spending"],
  "months-under-plan": ["plan"],
  "top-five": ["biggest"]
};

function followUp(name, { insight, viewId, scope, month: answerMonth }) {
  const request = { viewId, scope, month: answerMonth };
  switch (name) {
    case "statement":
      return { kind: "imports", label: askCopy.insight.compareStatement };
    case "month":
      return { kind: "month", label: askCopy.insight.openMonth, month: answerMonth, viewId, scope };
    case "change-plan":
      return { kind: "compose", label: askCopy.insight.changePlan, text: askCopy.insight.changePlanText(formatMonthYear(answerMonth)) };
    case "splits":
      return { kind: "splits", label: askCopy.insight.openSplits, month: answerMonth, viewId, groupId: insight.basis.groupId || null };
    case "plan":
      return { kind: "question", label: askCopy.insight.questions.plan, text: askCopy.insight.questions.plan, request };
    case "income":
      return { kind: "question", label: askCopy.insight.questions.income, text: askCopy.insight.questions.income, request };
    case "owed":
      return { kind: "question", label: askCopy.insight.questions.owed, text: askCopy.insight.questions.owed, request };
    case "spending": {
      const question = askCopy.insight.questions.spending(answerMonth);
      return { kind: "question", label: question, text: question, request };
    }
    case "biggest":
      return { kind: "question", label: askCopy.insight.questions.biggest, text: askCopy.insight.questions.biggest, request };
    default:
      return null;
  }
}

/**
 * The question and the answer card for one insight. `today` (YYYY-MM-DD)
 * names a month when the insight and the page named none.
 * @param {NonNullable<ReturnType<typeof readInsightHandoff>>} insight
 * @param {{ today: string }} context
 */
export function buildInsightAnswer(insight, { today }) {
  const viewId = insight.context.viewId || "household";
  const scope = viewId === "household" ? "direct_plus_shared" : insight.context.scope;
  const answerMonth = insight.basis.month || insight.basis.entries?.month || insight.context.month || today.slice(0, 7);
  const entries = insight.basis.entries;
  const filter = entries ? {
    month: entries.month || answerMonth,
    viewId,
    scope,
    search: "",
    categories: entries.entryIds.length || !entries.categoryName ? [] : [entries.categoryName],
    wallets: entries.entryIds.length || !entries.accountId ? [] : [entries.accountId],
    type: entries.entryIds.length ? "" : entries.type,
    minAmountMinor: null,
    maxAmountMinor: null,
    entryIds: entries.entryIds
  } : null;
  // The figure the line is about: the basis line holding its primary
  // amount (the last one, so a total wins over a part).
  const lead = insight.primaryMinor === null
    ? null
    : [...insight.basis.lines].reverse().find((line) => line.amountMinor === insight.primaryMinor) ?? null;
  const links = [
    ...(filter ? [{ kind: "entries", label: askCopy.insight.openInEntries, filter }] : []),
    ...(FOLLOW_UPS[insightType(insight.key)] ?? []).map((name) => followUp(name, { insight, viewId, scope, month: answerMonth })).filter(Boolean)
  ];
  return {
    question: insightQuestionText(insight.fact),
    key: insight.key,
    type: insightType(insight.key),
    kind: insight.kind,
    fact: insight.fact,
    think: insight.think,
    lead: lead ? { label: lead.label, amountMinor: lead.amountMinor, currency: lead.currency ?? "SGD" } : null,
    lines: insight.basis.lines,
    entries: filter,
    month: answerMonth,
    monthLabel: formatShortMonth(answerMonth),
    viewId,
    scope,
    links
  };
}

// What the optional AI explanation is asked from: the line, its think line
// and the basis lines (POST /api/ai-assist/insight-explain).
export function insightExplainBody(insight) {
  return { kind: insight.kind, fact: insight.fact, think: insight.think, lines: insight.basis.lines };
}
