// Split Correction routes (DOMAIN.md "Split Correction"): fix a mistake found
// inside a settled period without undoing the settle-up.
//
// - GET  /api/splits/corrections/preview?sourceRecordId=  what a correction would record
// - POST /api/splits/corrections          { sourceRecordId, alsoRemoveDuplicate?, reason? }
// - POST /api/splits/corrections/undo     { correctionId }
//
// The amount and the people are never in a request: the server works them out
// from the settled records and refuses what the Ledger check-up's settled-period
// detector does not report. A cross-site write never reaches here
// (cross-site-guard.ts).
import {
  createSplitCorrection,
  planSplitCorrection,
  SPLIT_CORRECTION_REASON_MAX_LENGTH,
  SplitCorrectionError,
  undoSplitCorrection
} from "../domain/app-repository-split-corrections";
import { SplitSettlementLockedError } from "../domain/split-settlement-lock";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const SPLIT_CORRECTION_PREVIEW_PATH = "/api/splits/corrections/preview";
export const SPLIT_CORRECTION_CREATE_PATH = "/api/splits/corrections";
export const SPLIT_CORRECTION_UNDO_PATH = "/api/splits/corrections/undo";

export function isSplitCorrectionPath(pathname: string) {
  return pathname === SPLIT_CORRECTION_PREVIEW_PATH || pathname === SPLIT_CORRECTION_CREATE_PATH || pathname === SPLIT_CORRECTION_UNDO_PATH;
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9:_.+-]{1,200}$/;

function recordId(value: unknown) {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value) ? value : null;
}

function errorResponse(error: unknown) {
  if (error instanceof SplitSettlementLockedError) {
    return json({ ok: false, error: error.message, code: error.code, checkpointId: error.checkpointId, batchId: error.batchId }, 409);
  }
  if (error instanceof SplitCorrectionError) {
    return json({ ok: false, error: error.message, code: error.code }, error.code === "correction_not_found" ? 404 : 400);
  }
  if (error instanceof RequestBodyTooLargeError) {
    return json({ ok: false, error: error.message }, 413);
  }
  return json({ ok: false, error: error instanceof Error ? error.message : "The correction could not be saved." }, 400);
}

export async function handleSplitCorrectionRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response> {
  if (url.pathname === SPLIT_CORRECTION_PREVIEW_PATH) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "This route only answers GET." }, 405, { Allow: "GET" });
    }
    const sourceRecordId = recordId(url.searchParams.get("sourceRecordId"));
    if (!sourceRecordId) {
      return json({ ok: false, error: "Missing shared cost id." }, 400);
    }
    const result = await planSplitCorrection(env.DB, sourceRecordId);
    return json({ ok: true, ...result });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    return errorResponse(error);
  }
  try {
    if (url.pathname === SPLIT_CORRECTION_UNDO_PATH) {
      const correctionId = recordId(body.correctionId);
      if (!correctionId) {
        return json({ ok: false, error: "Missing correction id." }, 400);
      }
      return json({ ok: true, ...(await undoSplitCorrection(env.DB, { correctionId })) });
    }
    const sourceRecordId = recordId(body.sourceRecordId);
    if (!sourceRecordId) {
      return json({ ok: false, error: "Missing shared cost id." }, 400);
    }
    if (body.alsoRemoveDuplicate !== undefined && typeof body.alsoRemoveDuplicate !== "boolean") {
      return json({ ok: false, error: "alsoRemoveDuplicate must be true or false." }, 400);
    }
    if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > SPLIT_CORRECTION_REASON_MAX_LENGTH * 2)) {
      return json({ ok: false, error: "The reason is too long." }, 400);
    }
    return json({
      ok: true,
      ...(await createSplitCorrection(env.DB, {
        sourceRecordId,
        alsoRemoveDuplicate: body.alsoRemoveDuplicate === true,
        reason: typeof body.reason === "string" ? body.reason : undefined
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
