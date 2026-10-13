// An insight question (DOMAIN.md "Insight Question"): "Ask about this" on a
// Money insights line opens Ask with the question "Explain: <the line>" and
// a card built from the insight's own facts (its signal's basis lines, see
// money-signals/types.ts). The card needs no server and no AI. With AI on,
// POST /api/ai-assist/insight-explain may add a short explanation, phrased
// only from these facts and checked like an Ask answer's wording
// (validateAiWording): every amount must be one of the facts'.
//
// Pure: the request is read and bounded here, and the fact lines an
// optional AI may see are built here, with long digit runs (phone, account,
// card or reference numbers) and NRIC / FIN shapes removed first.

import type { SignalBasisLine, SignalKind } from "./money-signals/types";
import { formatCurrencyMinor } from "./split-currency";

export const INSIGHT_QUESTION_PREFIX = "Explain: ";
export const MAX_INSIGHT_FACT_CHARS = 400;
export const MAX_INSIGHT_LINES = 12;
const MAX_LABEL_CHARS = 90;
const MAX_TEXT_CHARS = 120;
const MAX_AMOUNT_MINOR = 1_000_000_000_000;
const KINDS: SignalKind[] = ["quick_fix", "bigger_question", "worth_a_look", "going_well"];

// What the page sends: the line as it reads, its think line, and the basis.
export interface InsightExplainRequest {
  kind: SignalKind;
  fact: string;
  think: string;
  lines: SignalBasisLine[];
}

// "Explain: Serene's OCBC 365 statement differs by $42.80" (no closing full
// stop, so it reads as a request).
export function insightQuestionText(fact: string) {
  const text = oneLine(fact).replace(/[.!]+$/, "");
  return text ? `${INSIGHT_QUESTION_PREFIX}${text}` : "";
}

function oneLine(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// Text an optional AI may see: every digit run of six or more digits (also
// when split by spaces or dashes) and any Singapore NRIC / FIN shape removed.
export function stripPersonalNumbers(text: string) {
  return oneLine(text)
    .replace(/\b[STFGM]\d{7}[A-Z]\b/gi, " ")
    .replace(/\d[\d\s-]*\d/g, (run) => (run.replace(/\D/g, "").length >= 6 ? " " : run))
    .replace(/\s+/g, " ")
    .trim();
}

function readLine(value: unknown): SignalBasisLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const label = oneLine(item.label);
  if (!label || label.length > MAX_LABEL_CHARS) return null;
  if (item.amountMinor !== undefined) {
    const amountMinor = item.amountMinor;
    if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || Math.abs(amountMinor) > MAX_AMOUNT_MINOR) return null;
    const currency = item.currency === undefined ? undefined : String(item.currency);
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) return null;
    return currency && currency !== "SGD" ? { label, amountMinor, currency } : { label, amountMinor };
  }
  const text = oneLine(item.text);
  return text && text.length <= MAX_TEXT_CHARS ? { label, text } : null;
}

/**
 * The request body, read and bounded: a known kind, the line (at most 400
 * characters), its think line and at most 12 well-formed basis lines.
 * Anything else is null (a 400).
 */
export function readInsightExplainRequest(value: unknown): InsightExplainRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const kind = body.kind as SignalKind;
  const fact = oneLine(body.fact);
  const think = oneLine(body.think);
  if (!KINDS.includes(kind) || !fact || fact.length > MAX_INSIGHT_FACT_CHARS || think.length > MAX_INSIGHT_FACT_CHARS) return null;
  if (!Array.isArray(body.lines) || body.lines.length > MAX_INSIGHT_LINES) return null;
  const lines = body.lines.map(readLine);
  if (lines.some((line) => !line)) return null;
  return { kind, fact, think, lines: lines as SignalBasisLine[] };
}

/**
 * The facts an optional AI may phrase from: the line, its think line and
 * the basis lines with their amounts written as the card writes them.
 * Personal numbers are removed first; nothing else about the household is
 * added.
 */
export function buildInsightPromptFacts(request: InsightExplainRequest): string[] {
  const lines = [`The insight: ${stripPersonalNumbers(request.fact)}`];
  if (request.think) lines.push(`A way to think about it: ${stripPersonalNumbers(request.think)}`);
  for (const line of request.lines) {
    const value = line.amountMinor !== undefined
      ? formatCurrencyMinor(line.amountMinor, line.currency ?? "SGD")
      : stripPersonalNumbers(line.text ?? "");
    lines.push(`${stripPersonalNumbers(line.label)}: ${value}`);
  }
  return lines;
}

// The question an optional AI sees: the same words the person sees, with
// personal numbers removed.
export function insightPromptQuestion(request: InsightExplainRequest) {
  return insightQuestionText(stripPersonalNumbers(request.fact));
}
