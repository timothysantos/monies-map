// Ledger check-up writes (DOMAIN.md "Ledger Check-up"): "This is fine" and its
// undo. The report itself is the read-only GET /api/ledger-checkup, served as
// a page response from index.ts. Nothing here runs a check, calls AI or changes
// a ledger, split, plan or statement row.
//
// - POST /api/ledger-checkup/dismiss        { id, evidenceKey }
// - POST /api/ledger-checkup/undo-dismiss   { id }
//
// A cross-site write never reaches here (cross-site-guard.ts).
//
// Link clear pairs (docs/audits/ledger-checkup.md "Clear pairs"):
// - GET  /api/ledger-checkup/clear-pairs   the preview, served from index.ts
// - POST /api/ledger-checkup/clear-pairs   { pairs: [{ fromEntryId, toEntryId }] }
//   links those of the shown pairs that are still clear (at most 100), in one
//   batch, then learns their transfer purposes in date order like the single
//   link does. The answer names every pair it linked and every one it skipped.
import {
  CheckupDismissalError,
  dismissCheckupFinding,
  undoCheckupDismissal
} from "../domain/app-repository-ledger-checkup";
import { applyRememberedTransferPurposes } from "../domain/app-repository-transfer-purpose";
import { BulkTransferLinkError, linkClearTransferPairs, readRequestedPairs } from "../domain/app-repository-transfer-bulk-link";
import { loadClearTransferPairs } from "../domain/pages/ledger-checkup-clear-pairs";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const LEDGER_CHECKUP_DISMISS_PATH = "/api/ledger-checkup/dismiss";
export const LEDGER_CHECKUP_UNDO_PATH = "/api/ledger-checkup/undo-dismiss";
export const LEDGER_CHECKUP_CLEAR_PAIRS_PATH = "/api/ledger-checkup/clear-pairs";

export function isLedgerCheckupWritePath(pathname: string) {
  return pathname === LEDGER_CHECKUP_DISMISS_PATH || pathname === LEDGER_CHECKUP_UNDO_PATH || pathname === LEDGER_CHECKUP_CLEAR_PAIRS_PATH;
}

async function linkClearPairs(body: Record<string, unknown>, env: { DB: D1Database }): Promise<Response> {
  let requested;
  try {
    requested = readRequestedPairs(body.pairs);
  } catch (error) {
    if (error instanceof BulkTransferLinkError) {
      return json({ ok: false, error: error.message }, 400);
    }
    throw error;
  }
  let result;
  try {
    // The clear pairs are judged now, on the ledger as it is, not as it was
    // when the person looked.
    const { pairs } = await loadClearTransferPairs(env.DB);
    result = await linkClearTransferPairs(env.DB, { requested, clearPairs: pairs });
  } catch (error) {
    console.error("Linking clear transfer pairs failed", error);
    return json({ ok: false, error: "Nothing was linked. Try again." }, 500);
  }
  // Like the single link: the receivers are known now, so a monthly transfer
  // gets the purpose of the one before it. Best effort and in date order.
  let purposesLearned = 0;
  let purposesFailed = false;
  try {
    purposesLearned = (await applyRememberedTransferPurposes(env.DB, result.linked.map((pair) => pair.fromEntryId), { chronological: true })).length;
  } catch (error) {
    purposesFailed = true;
    console.error("Remembered transfer purposes failed", error);
  }
  return json({ ok: true, ...result, purposesLearned, purposesFailed });
}

export async function handleLedgerCheckupWrite(request: Request, url: URL, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
  if (url.pathname === LEDGER_CHECKUP_CLEAR_PAIRS_PATH) {
    return linkClearPairs(body, env);
  }
  try {
    if (url.pathname === LEDGER_CHECKUP_DISMISS_PATH) {
      return json({ ok: true, ...(await dismissCheckupFinding(env.DB, { id: String(body.id ?? ""), evidenceKey: String(body.evidenceKey ?? "") })) });
    }
    return json({ ok: true, ...(await undoCheckupDismissal(env.DB, { id: String(body.id ?? "") })) });
  } catch (error) {
    if (error instanceof CheckupDismissalError) {
      return json({ ok: false, error: error.message }, 400);
    }
    throw error;
  }
}
