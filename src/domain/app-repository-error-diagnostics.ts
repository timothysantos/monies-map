import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

const MAX_FIELD_LENGTH = 4000;
const MAX_BODY_LENGTH = 20000;
const DEFAULT_LIMIT = 50;
const DEFAULT_RETAIN_COUNT = 50;

export interface RecordAppErrorDiagnosticInput {
  source: string;
  action: string;
  previousAction?: string;
  method?: string;
  route?: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  errorMessage: string;
  possibleReason?: string;
  requestContextJson?: string;
  responseExcerpt?: string;
  responseBody?: string;
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export async function recordAppErrorDiagnostic(db: D1Database, input: RecordAppErrorDiagnosticInput) {
  const id = `diagnostic-${crypto.randomUUID()}`;

  await db
    .prepare(`
      INSERT INTO app_error_diagnostics (
        id,
        household_id,
        source,
        action,
        previous_action,
        method,
        route,
        status,
        status_text,
        content_type,
        error_message,
        possible_reason,
        request_context_json,
        response_excerpt,
        response_body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEFAULT_HOUSEHOLD_ID,
      truncate(input.source, 120),
      truncate(input.action, 500),
      truncate(input.previousAction, 500),
      truncate(input.method, 16),
      truncate(input.route, 500),
      Number.isFinite(input.status) ? input.status : null,
      truncate(input.statusText, 120),
      truncate(input.contentType, 200),
      truncate(input.errorMessage, MAX_FIELD_LENGTH),
      truncate(input.possibleReason, MAX_FIELD_LENGTH),
      truncate(input.requestContextJson, MAX_FIELD_LENGTH),
      truncate(input.responseExcerpt, MAX_FIELD_LENGTH),
      truncate(input.responseBody, MAX_BODY_LENGTH)
    )
    .run();

  return { diagnosticId: id };
}

export async function loadAppErrorDiagnostics(db: D1Database, limit = DEFAULT_LIMIT) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db
    .prepare(`
      SELECT
        id,
        source,
        action,
        previous_action,
        method,
        route,
        status,
        status_text,
        content_type,
        error_message,
        possible_reason,
        request_context_json,
        response_excerpt,
        response_body,
        created_at
      FROM app_error_diagnostics
      WHERE household_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, safeLimit)
    .all<{
      id: string;
      source: string;
      action: string;
      previous_action: string | null;
      method: string | null;
      route: string | null;
      status: number | null;
      status_text: string | null;
      content_type: string | null;
      error_message: string;
      possible_reason: string | null;
      request_context_json: string | null;
      response_excerpt: string | null;
      response_body: string | null;
      created_at: string;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    source: row.source,
    action: row.action,
    previousAction: row.previous_action ?? "",
    method: row.method ?? "",
    route: row.route ?? "",
    status: row.status ?? undefined,
    statusText: row.status_text ?? "",
    contentType: row.content_type ?? "",
    errorMessage: row.error_message,
    possibleReason: row.possible_reason ?? "",
    requestContextJson: row.request_context_json ?? "",
    responseExcerpt: row.response_excerpt ?? "",
    responseBody: row.response_body ?? "",
    createdAt: row.created_at
  }));
}

export async function retainLatestAppErrorDiagnostics(db: D1Database, keep = DEFAULT_RETAIN_COUNT) {
  const safeKeep = Math.max(1, Math.min(200, Math.trunc(keep)));
  const result = await db
    .prepare(`
      DELETE FROM app_error_diagnostics
      WHERE household_id = ?
        AND id NOT IN (
          SELECT id
          FROM app_error_diagnostics
          WHERE household_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID, safeKeep)
    .run();

  return { deletedCount: result.meta.changes ?? 0, retainedCount: safeKeep };
}
