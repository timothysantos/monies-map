// POST /api/shortcuts/alerts/bank (DOMAIN.md "Bank Alert"): the "Bank alert
// to Monies Map" Shortcut posts the text of a bank's notification, message
// or email with the person's Shortcut key. The reader (bank-alerts.ts) takes
// out the payment's amount, currency and shop; when exactly one of the
// person's waiting taps fits, the amount completes it through the one save
// path (completeWaitingTapWithAmount, completed_by "bank_alert").
//
// Privacy: the text is read in memory and dropped. Nothing of it is stored
// or logged; only the entry the tap becomes (the tap's own shop, the alert's
// amount) and the tap's usual audit line are written. A one-time code is
// dropped before anything is read. Anything else (no reading, no tap, two
// taps, the feature's table missing) changes nothing and answers ok: the
// Shortcut ends silently whatever the answer.

import { BANK_ALERT_CLOCK_TRUST_SECONDS, BANK_ALERT_MAX_BODY_BYTES } from "../domain/bank-alerts-config";
import { findTapForBankAlert, readBankAlert } from "../domain/bank-alerts";
import { loadWaitingTapRows } from "../domain/app-repository-waiting-taps";
import type { ShortcutConnectionRecord } from "../domain/app-repository-shortcuts";
import { normalizeShortcutRequestId } from "../domain/shortcut-entry-contract";
import { toWaitingTapFact } from "../domain/waiting-tap-statements";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";
import { completeWaitingTapWithAmount, type ShortcutEntryEnv } from "./shortcut-entry-route";

export { BANK_ALERT_PATH } from "../domain/bank-alerts-config";

type BankAlertBody = { text: unknown; receivedAt: unknown; requestId: unknown; clientVersion: unknown };

// The alert's time: the phone's receivedAt when it is close to the server's
// clock, else the server's own.
export function bankAlertTime(receivedAt: unknown, now: Date) {
  const parsed = typeof receivedAt === "string" ? Date.parse(receivedAt) : Number.NaN;
  if (Number.isFinite(parsed) && Math.abs(parsed - now.getTime()) <= BANK_ALERT_CLOCK_TRUST_SECONDS * 1000) {
    return new Date(parsed).toISOString();
  }
  return now.toISOString();
}

export async function handleBankAlert(
  env: ShortcutEntryEnv,
  request: Request,
  connection: ShortcutConnectionRecord,
  now = new Date()
): Promise<Response> {
  let body: Partial<BankAlertBody>;
  try {
    body = await readJsonObject<BankAlertBody>(request, BANK_ALERT_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "Request is too large." }, 413);
    }
    return json({ ok: false, error: "Shortcut request body must be valid JSON." }, 400);
  }
  const requestId = normalizeShortcutRequestId(typeof body.requestId === "string" ? body.requestId : undefined);
  if (!requestId) {
    return json({ ok: false, error: "Missing or invalid shortcut fields: requestId." }, 400);
  }

  const reading = readBankAlert(typeof body.text === "string" ? body.text : "");
  // The text is not used past this line.
  body.text = undefined;
  if (reading.kind === "nothing") {
    return json({ ok: true, completed: false, reason: reading.reason });
  }

  const taps = (await loadWaitingTapRows(env.DB)).filter((row) => row.person_id === connection.personId);
  const match = findTapForBankAlert(taps.map(toWaitingTapFact), {
    personId: connection.personId,
    merchant: reading.merchant,
    at: bankAlertTime(body.receivedAt, now)
  });
  if (match.outcome !== "one") {
    return json({ ok: true, completed: false, reason: match.outcome === "several" ? "several_taps" : "no_tap" });
  }
  const tap = taps.find((row) => row.id === match.tap.id)!;
  try {
    const saved = await completeWaitingTapWithAmount(env, request, tap, {
      currency: reading.currency,
      amountText: reading.amountText,
      completedBy: "bank_alert"
    });
    const payload = await saved.json<{ ok?: boolean; entryId?: string; created?: boolean }>();
    if (!saved.ok || !payload.ok) {
      return json({ ok: false, completed: false, reason: "not_saved" }, saved.status >= 400 ? saved.status : 500);
    }
    return json({ ok: true, completed: Boolean(payload.created), entryId: payload.entryId });
  } catch (error) {
    console.error("Bank alert completion failed", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, completed: false, reason: "not_saved" }, 500);
  }
}
