// Row-matching rules shared by the import preview (entry reconciliation)
// and the statement mismatch diagnosis, so both read dates and merchant text
// the same way. Pure functions only.
import {
  countSharedTokens,
  daysBetween,
  extractTransactionDateHint,
  normalizeDateString,
  normalizeStatementDate
} from "./app-repository-helpers";
import type { ImportPreviewRowDto } from "../types/dto";

export function getPreviewRowDateCandidates(previewRow: ImportPreviewRowDto) {
  return Array.from(new Set(
    [
      previewRow.date,
      extractTransactionDateHint(previewRow.note),
      extractTransactionDateHint(previewRow.rawRow?.note),
      extractTransactionDateHint(previewRow.rawRow?.notes),
      extractTransactionDateHint(previewRow.rawRow?.remarks),
      previewRow.rawRow?.transactionDate,
      previewRow.rawRow?.["transaction date"]
    ]
      .map((value) => typeof value === "string" ? normalizeDateString(value) ?? normalizeStatementDate(value) : undefined)
      .filter((value): value is string => Boolean(value))
  ));
}

export function getPreviewRowDateContext(previewRow: ImportPreviewRowDto) {
  const originalDateCandidates = getPreviewRowDateCandidates(previewRow).filter((date) => date !== previewRow.date);
  const eventDateHint = originalDateCandidates[0];
  return {
    postedDate: previewRow.date,
    eventDate: eventDateHint ?? previewRow.date,
    hasEventDateHint: Boolean(eventDateHint)
  };
}

export function getExistingTransactionDateContext(candidate: {
  transaction_date: string;
  post_date: string | null;
  note: string | null;
}) {
  const noteEventDateHint = extractTransactionDateHint(candidate.note ?? undefined);
  const postedDate = candidate.post_date ?? candidate.transaction_date;
  return {
    postedDate,
    eventDate: candidate.transaction_date,
    hasEventDateHint: candidate.post_date == null
      || candidate.transaction_date !== postedDate
      || Boolean(noteEventDateHint)
  };
}

export function getDuplicateCandidateDayDistance(input: {
  previewRow: {
    postedDate: string;
    eventDate: string;
    hasEventDateHint: boolean;
  };
  candidate: {
    postedDate: string;
    eventDate: string;
    hasEventDateHint: boolean;
  };
}) {
  if (input.previewRow.hasEventDateHint && input.candidate.hasEventDateHint) {
    return Math.abs(daysBetween(input.previewRow.eventDate, input.candidate.eventDate));
  }

  return Math.abs(daysBetween(input.previewRow.postedDate, input.candidate.postedDate));
}

export function getDuplicateMatchKind(input: {
  dayDistance: number;
  descriptionSimilarity: number;
  tokenSimilarity: number;
}) {
  if (input.dayDistance === 0 && input.descriptionSimilarity >= 0.8) {
    return "exact" as const;
  }

  if (input.dayDistance <= 2 && input.descriptionSimilarity >= 0.6) {
    return "probable" as const;
  }

  if (input.dayDistance <= 7 && input.tokenSimilarity >= 0.5) {
    return "near" as const;
  }

  return undefined;
}

export function getTokenSimilarity(left: string, right: string) {
  const sharedTokenCount = countSharedTokens(left, right);
  const leftTokenCount = normalizeDescriptionTokenCount(left);
  const rightTokenCount = normalizeDescriptionTokenCount(right);
  if (!leftTokenCount || !rightTokenCount) {
    return 0;
  }

  return sharedTokenCount / Math.max(leftTokenCount, rightTokenCount);
}

function normalizeDescriptionTokenCount(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/gi, " ").split(" ").filter(Boolean)).size;
}
