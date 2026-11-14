// Waiting files (DOMAIN.md "Waiting File"): the pure checks a file passes
// before it is stored. The bytes are opaque to the server: it reads only
// the first bytes to tell the kind of file, never parses, renders, logs or
// sends them anywhere. The browser reads them at review, as it reads a
// dropped file.

import { WAITING_FILE_CHUNK_BYTES, WAITING_FILE_MAX_BYTES } from "./waiting-files-config";

export type WaitingFileKind = "pdf" | "csv" | "tsv" | "xls";

export type WaitingFileRefusal = "empty" | "too_large" | "not_a_bank_file";

export type WaitingFileCheck =
  | { ok: true; kind: WaitingFileKind; contentType: string; fileName: string }
  | { ok: false; reason: WaitingFileRefusal };

const CONTENT_TYPES: Record<WaitingFileKind, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xls: "application/vnd.ms-excel"
};

const EXTENSIONS: Record<WaitingFileKind, RegExp> = {
  pdf: /\.pdf$/i,
  csv: /\.csv$/i,
  tsv: /\.tsv$/i,
  xls: /\.xls$/i
};

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TEXT_SAMPLE_BYTES = 64 * 1024;
// The start of a page, a script, an image or another program's document
// dressed up as a CSV.
const MARKUP_START = /^\s*<(?:!doctype|html|head|body|script|\?xml|svg|table|div|meta|iframe|style)\b/i;

function startsWith(bytes: Uint8Array, magic: number[], offset = 0) {
  return magic.every((value, index) => bytes[offset + index] === value);
}

// "%PDF-" within the first 1024 bytes, where the PDF standard allows it.
function looksLikePdf(bytes: Uint8Array) {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46 && bytes[index + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

// Plain text: no NUL or other control byte (tab, line breaks and form feed
// aside) in the first 64 KiB, and not markup. Any 8-bit encoding passes, as
// bank exports are not always UTF-8.
function looksLikePlainText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, TEXT_SAMPLE_BYTES);
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
      return false;
    }
    if (byte === 0x7f) {
      return false;
    }
  }
  const text = new TextDecoder("utf-8").decode(sample).replace(/^﻿/, "");
  return !MARKUP_START.test(text) && !/<script\b/i.test(text);
}

// The kind of file from its bytes first, its name second: a PDF is a PDF
// whatever it is called; an XLS needs both the Office file signature and an
// .xls name (the same signature also starts Word and installer files); a
// CSV or TSV is plain text with that name. A zip (and so an .xlsx), an
// image, a web page or anything else is refused.
export function checkWaitingFile(bytes: Uint8Array, rawName: string): WaitingFileCheck {
  if (!bytes.length) {
    return { ok: false, reason: "empty" };
  }
  if (bytes.length > WAITING_FILE_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const name = sanitizeWaitingFileName(rawName);
  let kind: WaitingFileKind | null = null;
  if (looksLikePdf(bytes)) {
    kind = "pdf";
  } else if (startsWith(bytes, CFB_MAGIC)) {
    kind = EXTENSIONS.xls.test(name) ? "xls" : null;
  } else if (looksLikePlainText(bytes)) {
    kind = EXTENSIONS.csv.test(name) ? "csv" : EXTENSIONS.tsv.test(name) ? "tsv" : null;
  }
  if (!kind) {
    return { ok: false, reason: "not_a_bank_file" };
  }
  return { ok: true, kind, contentType: CONTENT_TYPES[kind], fileName: withExtension(name, kind) };
}

const NAME_MAX_LENGTH = 120;

// A name that is safe to store and show: the last path part only, no
// control or markup characters, at most 120 characters with its extension
// kept. Never empty.
export function sanitizeWaitingFileName(rawName: string) {
  const base = String(rawName ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[^\p{L}\p{N} ._()\-+&,'#@]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (!cleaned) {
    return "file";
  }
  if (cleaned.length <= NAME_MAX_LENGTH) {
    return cleaned;
  }
  const extension = cleaned.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
  return `${cleaned.slice(0, NAME_MAX_LENGTH - extension.length).trimEnd()}${extension}`;
}

function withExtension(name: string, kind: WaitingFileKind) {
  return EXTENSIONS[kind].test(name) ? name : `${name}.${kind}`;
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function splitIntoChunks(bytes: Uint8Array, chunkBytes = WAITING_FILE_CHUNK_BYTES) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    chunks.push(bytes.slice(offset, offset + chunkBytes));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// What the person reads for each refusal and for a repeat.
export const WAITING_FILE_MESSAGES = {
  received: (count: number) => count === 1
    ? "Got it. The file is waiting in Monies Map; open Imports to review it."
    : `Got it. ${count} files are waiting in Monies Map; open Imports to review them.`,
  alreadyReceived: "Already received. It is waiting in Monies Map.",
  empty: "This file is empty.",
  tooLarge: "This file is larger than 10 MB.",
  notABankFile: "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports.",
  noFiles: "No file came with this. Share a PDF, CSV, TSV or XLS file.",
  tooMany: "Send at most 10 files at a time.",
  requestTooLarge: "These files are larger than 25 MB together. Send fewer at a time.",
  dailyLimit: "Monies Map has taken as many files as it takes in one day. Try again tomorrow.",
  tooManyWaiting: "40 files are already waiting. Open Imports and review or remove some first.",
  notSetUp: "Sending files to Monies Map is not set up.",
  wrongKey: "Monies Map did not recognise this Shortcut's key. Copy the key again from Settings.",
  failed: "Monies Map could not keep this file. Try again."
} as const;

export function describeRefusal(reason: WaitingFileRefusal) {
  return reason === "empty" ? WAITING_FILE_MESSAGES.empty : reason === "too_large" ? WAITING_FILE_MESSAGES.tooLarge : WAITING_FILE_MESSAGES.notABankFile;
}
