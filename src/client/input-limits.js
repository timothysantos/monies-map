// The Worker's size caps as the page sees them (design.md, "Size limits"):
// from NEAR_LIMIT of a cap a field shows a quiet count, and past the cap the
// page says so in plain words and does not send the request. The numbers
// come from the same modules the routes read, so the two cannot drift.

import {
  ASK_MESSAGE_MAX_LENGTH,
  IMPORT_PREVIEW_MAX_BYTES,
  RECEIPT_IMAGE_MAX_BYTES as RECEIPT_MAX,
  STATEMENT_TEXT_MAX_BYTES as STATEMENT_MAX
} from "../domain/request-limits";
import { SHORTCUT_DESCRIPTION_MAX_LENGTH, SHORTCUT_NOTE_MAX_LENGTH } from "../domain/shortcut-entry-contract";

export const ASK_MESSAGE_MAX = ASK_MESSAGE_MAX_LENGTH;
export const ENTRY_DESCRIPTION_MAX = SHORTCUT_DESCRIPTION_MAX_LENGTH;
export const ENTRY_NOTE_MAX = SHORTCUT_NOTE_MAX_LENGTH;
export const RECEIPT_IMAGE_MAX_BYTES = RECEIPT_MAX;
export const STATEMENT_TEXT_MAX_BYTES = STATEMENT_MAX;
export const IMPORT_EXPLAIN_MAX_BYTES = IMPORT_PREVIEW_MAX_BYTES;
export const NEAR_LIMIT = 0.8;

export function limitState(size, max) {
  return { size, max, near: size >= max * NEAR_LIMIT, over: size > max };
}

// The Ask routes collapse spaces and trim before they measure a message.
export function askMessageLength(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().length;
}

// "description" or "note" when that field is past what /api/entries/create
// accepts, else "".
export function entryTextOverLimit({ description, note }) {
  if (String(description ?? "").length > ENTRY_DESCRIPTION_MAX) return "description";
  if (String(note ?? "").length > ENTRY_NOTE_MAX) return "note";
  return "";
}

export function jsonBodyBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// The statement-text fallback reads only the start of a statement (its first
// 12,000 characters after redaction), so a longer text is cut to fit the
// route's cap rather than refused: what the reader sees does not change.
export function fitStatementText(fileName, text) {
  const value = String(text ?? "");
  if (jsonBodyBytes({ fileName, text: value }) <= STATEMENT_TEXT_MAX_BYTES) {
    return { text: value, trimmed: false };
  }
  // Escaped JSON can take up to six bytes a character; halve until it fits.
  let length = Math.floor(STATEMENT_TEXT_MAX_BYTES / 2);
  while (length > 0 && jsonBodyBytes({ fileName, text: value.slice(0, length) }) > STATEMENT_TEXT_MAX_BYTES) {
    length = Math.floor(length / 2);
  }
  return { text: value.slice(0, length), trimmed: true };
}

// A receipt photo is always made smaller on the device; `large` says the
// chosen photo is near or past the cap (so the person is told), `tooBig`
// that even the smaller copy is past it and is not sent.
export function receiptSizePlan(fileBytes, preparedBytes) {
  return {
    large: limitState(fileBytes, RECEIPT_IMAGE_MAX_BYTES).near,
    tooBig: limitState(preparedBytes, RECEIPT_IMAGE_MAX_BYTES).over
  };
}
