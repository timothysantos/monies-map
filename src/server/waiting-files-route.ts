// Waiting files (DOMAIN.md "Waiting File", docs/flows/imports-flow.md
// "Waiting files"): the share-sheet way in and the Access-protected routes
// Imports and Settings use.
//
// POST WAITING_FILES_INTAKE_PATH is the only route here that Cloudflare
// Access lets through (src/server/access-jwt.ts, POST only); it answers to
// its own key, compared in constant time. The bytes are counted through
// limited-body, checked by their first bytes, hashed and stored. They are
// never parsed, rendered, logged or sent to AI; the browser reads them at
// review. No log line names a file or holds a key.

import {
  findWaitingFile,

  readWaitingFile,
  receiveWaitingFiles,
  removeWaitingFile,
  WaitingFilesUnavailableError,
  type IncomingWaitingFile
} from "../domain/app-repository-waiting-files";
import { loadFileIntakeKey, makeNewFileIntakeKey } from "../domain/app-repository-file-intake-key";
import {
  checkWaitingFile,
  describeRefusal,
  sha256Hex,
  WAITING_FILE_MESSAGES
} from "../domain/waiting-files";
import {
  WAITING_FILES_INTAKE_PATH,
  WAITING_FILES_PER_REQUEST_MAX,
  WAITING_FILES_REQUEST_MAX_BYTES
} from "../domain/waiting-files-config";
import { json } from "./json";
import { readFormBody, readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";
import { constantTimeEqual } from "./shortcut-gateway";

export interface WaitingFilesEnv {
  DB: D1Database;
  FILE_INTAKE_KEY?: string;
  SHORTCUT_PUBLIC_ENDPOINT?: string;
}

export const WAITING_FILE_PATHS = {
  file: "/api/waiting-files/file",
  remove: "/api/waiting-files/remove",
  intakeSettings: "/api/settings/file-intake",
  newKey: "/api/settings/file-intake/new-key"
} as const;

const WAITING_FILE_ID = /^waiting-[0-9a-f-]{36}$/;

type FileOutcome = { name: string; result: "received" | "already_received" | "refused"; message: string };

function intakeAnswer(status: number, message: string, files: FileOutcome[] = []) {
  return json({ ok: status === 200, message, files }, status, { "cache-control": "no-store" });
}

function readProvidedKey(request: Request) {
  return request.headers.get("X-Monies-Files-Key")?.trim()
    || request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    || "";
}

// One answer the Shortcut can show as it is: what was kept, then what was
// not and why.
function summarize(files: FileOutcome[]) {
  const received = files.filter((file) => file.result === "received").length;
  const lines: string[] = [];
  if (received) {
    lines.push(WAITING_FILE_MESSAGES.received(received));
  }
  for (const file of files) {
    if (file.result !== "received") {
      lines.push(`${file.name}: ${file.message}`);
    }
  }
  return lines.join("\n");
}

export async function handleWaitingFilesIntake(request: Request, env: WaitingFilesEnv): Promise<Response> {
  let expected: string;
  try {
    expected = (await loadFileIntakeKey(env.DB, env.FILE_INTAKE_KEY)).key;
  } catch {
    return intakeAnswer(503, WAITING_FILE_MESSAGES.notSetUp);
  }
  if (!expected) {
    return intakeAnswer(503, WAITING_FILE_MESSAGES.notSetUp);
  }
  const provided = readProvidedKey(request);
  if (!provided || !(await constantTimeEqual(expected, provided))) {
    return intakeAnswer(401, WAITING_FILE_MESSAGES.wrongKey);
  }
  if (!/^multipart\/form-data\b/i.test(request.headers.get("content-type") ?? "")) {
    return intakeAnswer(415, WAITING_FILE_MESSAGES.noFiles);
  }

  let form: FormData;
  try {
    form = await readFormBody(request, WAITING_FILES_REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? intakeAnswer(413, WAITING_FILE_MESSAGES.requestTooLarge)
      : intakeAnswer(400, WAITING_FILE_MESSAGES.noFiles);
  }
  const uploads: File[] = [];
  for (const [, value] of form.entries()) {
    if (typeof value !== "string") {
      uploads.push(value as File);
    }
  }
  if (!uploads.length) {
    return intakeAnswer(400, WAITING_FILE_MESSAGES.noFiles);
  }
  if (uploads.length > WAITING_FILES_PER_REQUEST_MAX) {
    return intakeAnswer(413, WAITING_FILE_MESSAGES.tooMany);
  }

  const outcomes: Array<FileOutcome | null> = [];
  const accepted: Array<IncomingWaitingFile & { slot: number }> = [];
  for (const upload of uploads) {
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const check = checkWaitingFile(bytes, upload.name);
    if (!check.ok) {
      outcomes.push({ name: displayName(upload.name), result: "refused", message: describeRefusal(check.reason) });
      continue;
    }
    accepted.push({ slot: outcomes.length, fileName: check.fileName, fileKind: check.kind, contentType: check.contentType, sha256: await sha256Hex(bytes), bytes });
    outcomes.push(null);
  }

  if (accepted.length) {
    try {
      const result = await receiveWaitingFiles(env.DB, accepted, { arrivedVia: "shortcut" });
      if (!result.ok) {
        return intakeAnswer(429, result.reason === "daily_limit" ? WAITING_FILE_MESSAGES.dailyLimit : WAITING_FILE_MESSAGES.tooManyWaiting);
      }
      result.files.forEach((file, index) => {
        outcomes[accepted[index].slot] = {
          name: file.fileName,
          result: file.status,
          message: file.status === "already_received" ? WAITING_FILE_MESSAGES.alreadyReceived : ""
        };
      });
    } catch (error) {
      if (error instanceof WaitingFilesUnavailableError) {
        return intakeAnswer(503, WAITING_FILE_MESSAGES.notSetUp);
      }
      console.error("Waiting files intake failed", { files: accepted.length, error: error instanceof Error ? error.name : "unknown" });
      return intakeAnswer(500, WAITING_FILE_MESSAGES.failed);
    }
  }

  const files = outcomes.filter((outcome): outcome is FileOutcome => Boolean(outcome));
  const anyKept = files.some((file) => file.result !== "refused");
  return intakeAnswer(anyKept ? 200 : 422, summarize(files), files);
}

// A refused file's name as the person sent it, made safe to echo back.
function displayName(name: string) {
  return String(name ?? "").split(/[\\/]/).pop()?.replace(/[^\p{L}\p{N} ._()\-+&,'#@]/gu, "_").slice(0, 120) || "file";
}

// The address the Shortcut posts to: the Shortcut Worker's (outside
// Access) when one is configured, else this Worker's.
export function buildFileIntakeEndpoint(request: Request, env: WaitingFilesEnv) {
  return new URL(WAITING_FILES_INTAKE_PATH, env.SHORTCUT_PUBLIC_ENDPOINT?.trim() || request.url).toString();
}

export function isWaitingFilesPath(pathname: string) {
  return Object.values(WAITING_FILE_PATHS).includes(pathname as never);
}

// The Access-protected routes: one file's bytes for Imports, Remove, and
// the Settings key row.
export async function handleWaitingFilesRoute(request: Request, env: WaitingFilesEnv, url: URL): Promise<Response | null> {
  if (url.pathname === WAITING_FILE_PATHS.file && request.method === "GET") {
    const id = url.searchParams.get("id") ?? "";
    if (!WAITING_FILE_ID.test(id)) {
      return json({ ok: false, error: "This file is no longer waiting." }, 404);
    }
    const file = await readWaitingFile(env.DB, id);
    if (!file) {
      return json({ ok: false, error: "This file is no longer waiting." }, 404);
    }
    // Opaque bytes for the page's own reader: never shown inline, never
    // guessed at by the browser, never cached.
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; sandbox"
      }
    });
  }

  if (url.pathname === WAITING_FILE_PATHS.remove && request.method === "POST") {
    const body = await readJsonObject<{ id: string }>(request, SMALL_JSON_MAX_BYTES).catch(() => ({} as { id?: string }));
    const id = typeof body.id === "string" ? body.id : "";
    if (!WAITING_FILE_ID.test(id)) {
      return json({ ok: false, error: "This file is no longer waiting." }, 404);
    }
    try {
      const result = await removeWaitingFile(env.DB, id);
      return result.removed ? json({ ok: true }) : json({ ok: false, error: "This file is no longer waiting." }, 404);
    } catch {
      return json({ ok: false, error: "Monies Map could not remove this file. Try again." }, 500);
    }
  }

  if (url.pathname === WAITING_FILE_PATHS.intakeSettings && request.method === "GET") {
    const key = await loadFileIntakeKey(env.DB, env.FILE_INTAKE_KEY);
    return json({ ok: true, endpoint: buildFileIntakeEndpoint(request, env), key: key.key, keySource: key.source }, 200, { "cache-control": "no-store" });
  }

  if (url.pathname === WAITING_FILE_PATHS.newKey && request.method === "POST") {
    try {
      const key = await makeNewFileIntakeKey(env.DB);
      return json({ ok: true, endpoint: buildFileIntakeEndpoint(request, env), key: key.key, keySource: key.source }, 200, { "cache-control": "no-store" });
    } catch {
      return json({ ok: false, error: "Monies Map could not make a new key. Try again." }, 500);
    }
  }

  return null;
}

export { findWaitingFile };
