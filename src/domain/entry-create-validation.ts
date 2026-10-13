// The last check on a new entry before /api/entries/create saves it. The
// editors and Ask's entry card already send clean values; this is the
// server's own gate, so a draft built from AI output, a client bug or any
// other caller can never store a made-up date, a fractional or absurd amount
// or an unbounded text (AGENTS.md "Optional AI Assistance": constrain and
// validate every input). Limits match the Apple Pay Shortcut's
// (shortcut-entry-contract.ts).

import { SHORTCUT_DESCRIPTION_MAX_LENGTH, SHORTCUT_NOTE_MAX_LENGTH } from "./shortcut-entry-contract";

// Far above any household amount (SGD 10 billion in cents), well inside a
// safe integer.
export const ENTRY_AMOUNT_MAX_MINOR = 1_000_000_000_000;

function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateEntryCreateFields(input: {
  date?: unknown;
  postDate?: unknown;
  description?: unknown;
  amountMinor?: unknown;
  note?: unknown;
}): string | null {
  if (!isRealIsoDate(input.date)) {
    return "Enter the date as YYYY-MM-DD.";
  }
  if (input.postDate !== undefined && input.postDate !== null && !isRealIsoDate(input.postDate)) {
    return "Enter the posted date as YYYY-MM-DD.";
  }
  if (typeof input.description !== "string" || input.description.length > SHORTCUT_DESCRIPTION_MAX_LENGTH) {
    return `The description must be text of at most ${SHORTCUT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > SHORTCUT_NOTE_MAX_LENGTH)) {
    return `The note must be text of at most ${SHORTCUT_NOTE_MAX_LENGTH} characters.`;
  }
  if (!Number.isSafeInteger(input.amountMinor) || (input.amountMinor as number) > ENTRY_AMOUNT_MAX_MINOR) {
    return "The amount must be a whole number of cents within a sensible limit.";
  }
  return null;
}
