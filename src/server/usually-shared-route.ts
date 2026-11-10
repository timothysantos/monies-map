// Usually shared (DOMAIN.md "Usually Shared"; usually-shared.ts).
//
// - GET  /api/splits/usually-shared          the list, grouped by shop (read-only)
// - POST /api/splits/expenses/add-usual      put entries on Splits with each shop's usual split
//                                            ({ groups: [{ splitGroupId, payerShareBasisPoints, entryIds }], confirmedCount })
// - POST /api/splits/expenses/remove-added   Undo: take those splits back off ({ splitExpenseIds })
//
// Both writes are one all-or-nothing command (app-repository-splits.ts) and
// reuse the rows "Add to splits" writes for one entry. A cross-site write
// never reaches here (cross-site-guard.ts).

import { addEntriesToSplitsRecord, removeSplitExpensesRecord, type AddEntriesToSplitsItem } from "../domain/app-repository-splits";
import { buildUsuallySharedDto } from "../domain/pages/usually-shared";
import { SplitSettlementLockedError } from "../domain/split-settlement-lock";
import { USUALLY_SHARED_POLICY } from "../domain/usually-shared";
import { todayInAppTimeZone } from "../lib/app-calendar";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const USUALLY_SHARED_PATH = "/api/splits/usually-shared";
const ADD_PATH = "/api/splits/expenses/add-usual";
const REMOVE_PATH = "/api/splits/expenses/remove-added";
// 200 ids with room to spare.
const MAX_BODY_BYTES = 64 * 1024;

export function isUsuallySharedPath(pathname: string) {
  return pathname === USUALLY_SHARED_PATH || pathname === ADD_PATH || pathname === REMOVE_PATH;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// The body's groups as one item per entry; a malformed group gives an item
// the command refuses (an empty id, a share out of range), never a guess.
export function readUsualAddItems(body: { groups?: unknown }): AddEntriesToSplitsItem[] {
  if (!Array.isArray(body.groups)) return [];
  const items: AddEntriesToSplitsItem[] = [];
  for (const group of body.groups.slice(0, USUALLY_SHARED_POLICY.maxEntriesPerAdd + 1)) {
    const fields = (group ?? {}) as { splitGroupId?: unknown; payerShareBasisPoints?: unknown; entryIds?: unknown };
    const splitGroupId = typeof fields.splitGroupId === "string" && fields.splitGroupId && fields.splitGroupId !== "split-group-none" ? fields.splitGroupId : null;
    const payerShareBasisPoints = typeof fields.payerShareBasisPoints === "number" ? fields.payerShareBasisPoints : Number.NaN;
    const entryIds = Array.isArray(fields.entryIds) ? fields.entryIds : [];
    for (const entryId of entryIds.slice(0, USUALLY_SHARED_POLICY.maxEntriesPerAdd + 1)) {
      items.push({ entryId: text(entryId), splitGroupId, payerShareBasisPoints });
    }
  }
  return items;
}

export async function handleUsuallySharedRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response | null> {
  if (url.pathname === USUALLY_SHARED_PATH) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "This route only answers GET." }, 405, { Allow: "GET" });
    }
    const days = Number(url.searchParams.get("days"));
    return json({
      ok: true,
      ...(await buildUsuallySharedDto(env.DB, { today: todayInAppTimeZone(), ...(Number.isInteger(days) && days > 0 ? { days } : {}) }))
    });
  }
  if (url.pathname !== ADD_PATH && url.pathname !== REMOVE_PATH) {
    return null;
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
  try {
    if (url.pathname === ADD_PATH) {
      const result = await addEntriesToSplitsRecord(env.DB, {
        items: readUsualAddItems(body),
        confirmedCount: typeof body.confirmedCount === "number" ? body.confirmedCount : undefined
      });
      return json({
        ok: true,
        ...result,
        // What Undo posts back.
        undoSplitExpenseIds: result.added.map((row) => row.splitExpenseId)
      });
    }
    const ids = Array.isArray(body.splitExpenseIds) ? body.splitExpenseIds.slice(0, USUALLY_SHARED_POLICY.maxEntriesPerAdd + 1).map(text) : [];
    return json({ ok: true, ...(await removeSplitExpensesRecord(env.DB, { splitExpenseIds: ids })) });
  } catch (error) {
    if (error instanceof SplitSettlementLockedError) {
      return json({ ok: false, error: error.message, code: error.code, checkpointId: error.checkpointId, batchId: error.batchId }, 409);
    }
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not change Splits." }, 400);
  }
}
