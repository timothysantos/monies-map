// Waiting files (DOMAIN.md "Waiting File"): the store of files sent from a
// share sheet that wait for Imports. Every read and delete is scoped to the
// household. Commands read and check first, then write the file's row, its
// byte chunks, the daily count and the audit event in one db.batch(), so a
// file is either all there or not there at all. The tables are additive
// (schema.sql "waiting_files"): a reader treats them missing as no files,
// and a command refuses with WaitingFilesUnavailableError.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import { isoDateInAppTimeZone } from "../lib/app-calendar";
import {
  WAITING_FILE_RETENTION_DAYS,
  WAITING_FILES_DAILY_LIMIT,
  WAITING_FILES_MAX_WAITING,
  type WaitingFileArrival
} from "./waiting-files-config";
import { joinChunks, splitIntoChunks, type WaitingFileKind } from "./waiting-files";
import {
  buildWaitingFileImportedStatements,
  deleteWaitingFileStatements,
  WAITING_FILE_KIND_WORDS
} from "./waiting-file-statements";

export interface WaitingFileRecord {
  id: string;
  fileName: string;
  fileKind: WaitingFileKind;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  arrivedVia: string;
  receivedAt: string;
  expiresAt: string;
}

export interface IncomingWaitingFile {
  fileName: string;
  fileKind: WaitingFileKind;
  contentType: string;
  sha256: string;
  bytes: Uint8Array;
}

export type ReceiveResult =
  | { ok: true; files: Array<{ fileName: string; status: "received" | "already_received"; id: string }> }
  | { ok: false; reason: "daily_limit" | "too_many_waiting" };

export class WaitingFilesUnavailableError extends Error {
  constructor() {
    super("Waiting files are not set up.");
  }
}

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

const FILE_COLUMNS = "id, file_name, file_kind, content_type, size_bytes, sha256, arrived_via, received_at, expires_at";

type FileRow = {
  id: string;
  file_name: string;
  file_kind: WaitingFileKind;
  content_type: string;
  size_bytes: number;
  sha256: string;
  arrived_via: string;
  received_at: string;
  expires_at: string;
};

function toRecord(row: FileRow): WaitingFileRecord {
  return {
    id: row.id,
    fileName: row.file_name,
    fileKind: row.file_kind,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    arrivedVia: row.arrived_via,
    receivedAt: row.received_at,
    expiresAt: row.expires_at
  };
}

const KIND_WORDS = WAITING_FILE_KIND_WORDS;
const deleteFileStatements = deleteWaitingFileStatements;

async function readWaitingRows(db: D1Database) {
  const result = await db
    .prepare(`SELECT ${FILE_COLUMNS} FROM waiting_files WHERE household_id = ? AND status = 'waiting' ORDER BY received_at, id`)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<FileRow>();
  return result.results.map(toRecord);
}

// Deletes the files that waited past their 30 days, bytes and all, with one
// audit event. Runs opportunistically when the store is read or written;
// there is no scheduled job.
export async function sweepExpiredWaitingFiles(db: D1Database, expired: WaitingFileRecord[]) {
  if (!expired.length) {
    return 0;
  }
  await db.batch([
    ...expired.flatMap((file) => deleteFileStatements(db, file.id)),
    buildAuditEventStatement(db, {
      entityType: "waiting_file",
      entityId: expired.length === 1 ? expired[0].id : "waiting_files",
      action: "waiting_files_expired",
      detail: `${expired.length} file${expired.length === 1 ? "" : "s"} sent to Monies Map waited ${WAITING_FILE_RETENTION_DAYS} days unopened and ${expired.length === 1 ? "was" : "were"} deleted.`
    })
  ]);
  return expired.length;
}

function splitExpired(files: WaitingFileRecord[], now: Date) {
  const nowIso = now.toISOString();
  return {
    live: files.filter((file) => file.expiresAt > nowIso),
    expired: files.filter((file) => file.expiresAt <= nowIso)
  };
}

// The files waiting for review, oldest first. No tables means no files. A
// file past its 30 days is never listed; deleting it is attempted here and
// a failed delete is retried on the next read.
export async function listWaitingFiles(db: D1Database, now = new Date()): Promise<WaitingFileRecord[]> {
  let files: WaitingFileRecord[];
  try {
    files = await readWaitingRows(db);
  } catch (error) {
    if (isMissingTable(error)) {
      return [];
    }
    throw error;
  }
  const { live, expired } = splitExpired(files, now);
  await sweepExpiredWaitingFiles(db, expired).catch((error) => {
    console.error("Waiting files sweep failed", error instanceof Error ? error.message : "unknown");
  });
  return live;
}

// Keeps new files. A file whose bytes are already waiting (same SHA-256) is
// not stored again and reads "already received". Refuses the whole request
// when it would pass the daily limit or the number of files waiting.
export async function receiveWaitingFiles(
  db: D1Database,
  incoming: IncomingWaitingFile[],
  options: { arrivedVia: WaitingFileArrival; senderLabel?: string; now?: Date }
): Promise<ReceiveResult> {
  const now = options.now ?? new Date();
  const day = isoDateInAppTimeZone(now);
  let waiting: WaitingFileRecord[];
  let todayCount: number;
  try {
    const [rows, countRow] = await Promise.all([
      readWaitingRows(db),
      db
        .prepare("SELECT received_count FROM waiting_file_daily_counts WHERE household_id = ? AND day = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, day)
        .first<{ received_count: number }>()
    ]);
    waiting = rows;
    todayCount = Number(countRow?.received_count ?? 0);
  } catch (error) {
    if (isMissingTable(error)) {
      throw new WaitingFilesUnavailableError();
    }
    throw error;
  }

  const { live, expired } = splitExpired(waiting, now);
  await sweepExpiredWaitingFiles(db, expired);

  const idBySha = new Map(live.map((file) => [file.sha256, file.id]));
  const results: Array<{ fileName: string; status: "received" | "already_received"; id: string }> = [];
  const fresh: Array<IncomingWaitingFile & { id: string }> = [];
  for (const file of incoming) {
    const existingId = idBySha.get(file.sha256);
    if (existingId) {
      results.push({ fileName: file.fileName, status: "already_received", id: existingId });
      continue;
    }
    const id = `waiting-${crypto.randomUUID()}`;
    idBySha.set(file.sha256, id);
    fresh.push({ ...file, id });
    results.push({ fileName: file.fileName, status: "received", id });
  }
  if (!fresh.length) {
    return { ok: true, files: results };
  }
  if (todayCount + fresh.length > WAITING_FILES_DAILY_LIMIT) {
    return { ok: false, reason: "daily_limit" };
  }
  if (live.length + fresh.length > WAITING_FILES_MAX_WAITING) {
    return { ok: false, reason: "too_many_waiting" };
  }

  const receivedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + WAITING_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const senderLabel = (options.senderLabel ?? "").slice(0, 80);
  const statements: D1PreparedStatement[] = [];
  for (const file of fresh) {
    const chunks = splitIntoChunks(file.bytes);
    statements.push(
      db
        .prepare(`
          INSERT INTO waiting_files (id, household_id, file_name, file_kind, content_type, size_bytes, sha256, chunk_count, arrived_via, sender_label, status, received_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
        `)
        .bind(file.id, DEFAULT_HOUSEHOLD_ID, file.fileName, file.fileKind, file.contentType, file.bytes.byteLength, file.sha256, chunks.length, options.arrivedVia, senderLabel, receivedAt, expiresAt)
    );
    chunks.forEach((chunk, index) => {
      statements.push(
        db.prepare("INSERT INTO waiting_file_chunks (file_id, chunk_index, bytes) VALUES (?, ?, ?)").bind(file.id, index, chunk)
      );
    });
    // The audit line names the kind and size, never the file name: bank
    // file names can carry part of an account number.
    statements.push(buildAuditEventStatement(db, {
      entityType: "waiting_file",
      entityId: file.id,
      action: "waiting_file_received",
      detail: `A ${KIND_WORDS[file.fileKind]} file (${formatKilobytes(file.bytes.byteLength)}) was sent to Monies Map and waits for review in Imports.`
    }));
  }
  statements.push(
    db
      .prepare(`
        INSERT INTO waiting_file_daily_counts (household_id, day, received_count) VALUES (?, ?, ?)
        ON CONFLICT (household_id, day) DO UPDATE SET received_count = received_count + excluded.received_count
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, day, fresh.length)
  );
  await db.batch(statements);
  return { ok: true, files: results };
}

function formatKilobytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function readWaitingFileRecord(db: D1Database, id: string, now: Date) {
  try {
    const row = await db
      .prepare(`SELECT ${FILE_COLUMNS} FROM waiting_files WHERE household_id = ? AND id = ? AND status = 'waiting'`)
      .bind(DEFAULT_HOUSEHOLD_ID, id)
      .first<FileRow>();
    if (!row) {
      return null;
    }
    const record = toRecord(row);
    return record.expiresAt > now.toISOString() ? record : null;
  } catch (error) {
    if (isMissingTable(error)) {
      return null;
    }
    throw error;
  }
}

// One waiting file with its bytes, or null when it is not this household's,
// is gone, or waited past its 30 days.
export async function readWaitingFile(db: D1Database, id: string, now = new Date()) {
  const record = await readWaitingFileRecord(db, id, now);
  if (!record) {
    return null;
  }
  const chunks = await db
    .prepare(`
      SELECT c.bytes FROM waiting_file_chunks c
      JOIN waiting_files f ON f.id = c.file_id
      WHERE f.household_id = ? AND c.file_id = ?
      ORDER BY c.chunk_index
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, id)
    .all<{ bytes: ArrayBuffer | Uint8Array | number[] }>();
  const bytes = joinChunks(chunks.results.map((row) => toBytes(row.bytes)));
  return bytes.byteLength === record.sizeBytes ? { record, bytes } : null;
}

function toBytes(value: ArrayBuffer | Uint8Array | number[]) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

// The file the commit is about to import, when it is still waiting.
export async function findWaitingFile(db: D1Database, id: string, now = new Date()) {
  return readWaitingFileRecord(db, id, now);
}

// "Remove" on Imports: the file and its bytes are deleted for good.
export async function removeWaitingFile(db: D1Database, id: string) {
  const record = await readWaitingFileRecord(db, id, new Date(0));
  if (!record) {
    return { removed: false };
  }
  await db.batch([
    ...deleteFileStatements(db, id),
    buildAuditEventStatement(db, {
      entityType: "waiting_file",
      entityId: id,
      action: "waiting_file_removed",
      detail: `A ${KIND_WORDS[record.fileKind]} file sent to Monies Map was removed without importing it.`
    })
  ]);
  return { removed: true };
}

// The import was already saved before (the same file committed again):
// the waiting copy is no longer needed.
export async function settleWaitingFileAfterImport(db: D1Database, record: WaitingFileRecord, importId: string) {
  await db.batch(buildWaitingFileImportedStatements(db, record, importId));
}
