// POST /api/ask/receipt-match (DOMAIN.md "Receipt Match";
// docs/flows/ask-flow.md "Many receipts at once").
//
// Takes the fields a receipt read validated (shop, day, total, currency and
// the lines for a note) and answers with the entry, or waiting Apple Pay tap,
// that is probably the same purchase: { ok, match } where match is
// { kind: "none" }, { kind: "one", option } or { kind: "several", options }.
// Each option carries the change card Save would make, through the existing
// commands in ASK_CHANGE_PATHS. No AI call and no allowance use; household
// rows only, bounded by date in SQL; nothing is written here. No image ever
// reaches this route.

import { todayInAppTimeZone } from "../lib/app-calendar";
import { RECEIPT_CURRENCY_ALLOWLIST } from "../domain/receipt-read";
import { findReceiptMatch } from "../domain/receipt-match-projection";
import type { ReceiptMatchReceipt } from "../domain/receipt-match";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const RECEIPT_MATCH_PATH = "/api/ask/receipt-match";

const MAX_MERCHANT = 80;
const MAX_NOTE_LINES = 40;
const MAX_NOTE_LINE = 120;
// The receipt reader's own cap (receipt-read.ts), in minor units.
const MAX_TOTAL_MINOR = 100_000_000 * 100;

export function readReceiptMatchBody(body: unknown): ReceiptMatchReceipt | null {
  const raw = body && typeof body === "object" ? (body as { receipt?: unknown }).receipt : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const merchant = typeof value.merchant === "string" ? value.merchant.replace(/\s+/g, " ").trim().slice(0, MAX_MERCHANT) : "";
  const date = typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && !Number.isNaN(Date.parse(`${value.date}T00:00:00Z`)) ? value.date : "";
  const totalMinor = Number.isSafeInteger(value.totalMinor) && (value.totalMinor as number) > 0 && (value.totalMinor as number) <= MAX_TOTAL_MINOR ? value.totalMinor as number : 0;
  const currency = typeof value.currency === "string" ? value.currency.trim().toUpperCase() : "";
  if (!merchant || !date || !totalMinor || !(RECEIPT_CURRENCY_ALLOWLIST as readonly string[]).includes(currency)) return null;
  const lines = Array.isArray(value.noteLines) ? value.noteLines : [];
  if (lines.length > MAX_NOTE_LINES || lines.some((line) => typeof line !== "string" || line.length > MAX_NOTE_LINE)) return null;
  return { merchant, date, totalMinor, currency, noteLines: lines.map((line) => String(line).replace(/[\u0000-\u001f\u007f]+/g, " ").trim()).filter(Boolean) };
}

export async function handleReceiptMatch(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: unknown;
  try {
    body = await readJsonObject(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "Request is too large." }, 413);
    }
    return json({ ok: false, error: "Request body must be valid JSON." }, 400);
  }
  const receipt = readReceiptMatchBody(body);
  if (!receipt) {
    return json({ ok: false, error: "The receipt needs a shop, a day, a total and its currency." }, 400);
  }
  const match = await findReceiptMatch(env.DB, receipt, { today: todayInAppTimeZone() });
  return json({ ok: true, match });
}
