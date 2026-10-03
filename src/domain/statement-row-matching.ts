// Row-matching rules shared by the import preview (entry reconciliation)
// and the statement mismatch diagnosis, so both read dates and merchant text
// the same way. Pure functions only.
import {
  compareDescriptionSimilarity,
  countSharedTokens,
  daysBetween,
  extractTransactionDateHint,
  normalizeDateString,
  normalizeStatementDate
} from "./app-repository-helpers";
import { STANDARD_DUPLICATE_MAX_DAY_DISTANCE } from "./import-preview-match-policy";
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

export interface RepetitionCharge {
  accountId?: string;
  signedAmountMinor: number;
  description: string;
  postedDate: string;
  eventDate: string;
  hasEventDateHint: boolean;
}

// The velocity rule's test (import-preview-match-policy.js): a charge
// repeats when its account has another charge of the same signed amount
// whose wording would pass as the same purchase within a week, compared on
// the usual date lanes. Returns a lookup for the rows it was built from.
export function createRepetitionIndex<T>(rows: readonly T[], read: (row: T) => RepetitionCharge) {
  const groups = new Map<string, { row: T; charge: RepetitionCharge }[]>();
  const keyOf = (charge: RepetitionCharge) => `${charge.accountId ?? ""}|${charge.signedAmountMinor}`;
  for (const row of rows) {
    const charge = read(row);
    groups.set(keyOf(charge), [...(groups.get(keyOf(charge)) ?? []), { row, charge }]);
  }
  const cache = new Map<T, boolean>();
  return (row: T) => {
    const cached = cache.get(row);
    if (cached !== undefined) {
      return cached;
    }
    const charge = read(row);
    const repeats = (groups.get(keyOf(charge)) ?? []).some((other) => other.row !== row && isLookalikeWithinWeek(charge, other.charge));
    cache.set(row, repeats);
    return repeats;
  };
}

function isLookalikeWithinWeek(left: RepetitionCharge, right: RepetitionCharge) {
  const dayDistance = getDuplicateCandidateDayDistance({ previewRow: left, candidate: right });
  if (dayDistance > STANDARD_DUPLICATE_MAX_DAY_DISTANCE) {
    return false;
  }
  const leftWords = withoutReferenceNumbers(left.description);
  const rightWords = withoutReferenceNumbers(right.description);
  return Boolean(getDuplicateMatchKind({
    dayDistance,
    descriptionSimilarity: compareDescriptionSimilarity(leftWords, rightWords),
    tokenSimilarity: getTokenSimilarity(leftWords, rightWords)
  }));
}

// Banks print a trip, terminal or reference number on each charge
// ("BUS/MRT 830924733"); two fares on the same line differ only there.
function withoutReferenceNumbers(description: string) {
  return description.replace(/\b\d{4,}\b/g, " ").replace(/\s+/g, " ").trim();
}
