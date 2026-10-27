// Ledger check-up writes (DOMAIN.md "Ledger Check-up"): "This is fine" and its
// undo. The report itself is the read-only GET /api/ledger-checkup, served as
// a page response from index.ts. Nothing here runs a check, calls AI or changes
// a ledger, split, plan or statement row.
//
// - POST /api/ledger-checkup/dismiss        { id, evidenceKey }
// - POST /api/ledger-checkup/undo-dismiss   { id }
//
// A cross-site write never reaches here (cross-site-guard.ts).
import {
  CheckupDismissalError,
  dismissCheckupFinding,
  undoCheckupDismissal
} from "../domain/app-repository-ledger-checkup";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const LEDGER_CHECKUP_DISMISS_PATH = "/api/ledger-checkup/dismiss";
export const LEDGER_CHECKUP_UNDO_PATH = "/api/ledger-checkup/undo-dismiss";

export function isLedgerCheckupWritePath(pathname: string) {
  return pathname === LEDGER_CHECKUP_DISMISS_PATH || pathname === LEDGER_CHECKUP_UNDO_PATH;
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
