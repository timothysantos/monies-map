export const LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR = 500;
export const LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE = 2;
export const STANDARD_DUPLICATE_MAX_DAY_DISTANCE = 7;

export function getDuplicateCandidateMaxDayDistance(amountMinor) {
  // High-velocity low-value rows need a much tighter window so recurring
  // fares, coffee, or canteen charges are not treated as the same event.
  return Math.abs(amountMinor) < LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR
    ? LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE
    : STANDARD_DUPLICATE_MAX_DAY_DISTANCE;
}

export function canSuppressCertifiedStatementDuplicate(input) {
  return input.candidateSourceType === "pdf"
    && input.candidateBankCertificationStatus === "statement_certified"
    && input.incomingSourceType !== "pdf"
    && input.dayDistance <= getDuplicateCandidateMaxDayDistance(input.amountMinor);
}

// A low-value entry with no posted date, dated in the last two days of a
// statement period, may still post on the next statement (a ride on the
// closing day often posts the day after). It answers a statement row only
// from its own purchase day or later, never an earlier ride's row: two $1.99
// fares a day apart are two rides, and pairing them would hide both the
// missing ride and the one waiting for the next statement.
export function isRowBeforeLateUnpostedEntry(input) {
  if (
    Math.abs(input.amountMinor) >= LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR
    || input.entryPostDate
    || !input.statementEndDate
    || input.entryDate > input.statementEndDate
  ) {
    return false;
  }
  const daysBeforeClose = (Date.parse(`${input.statementEndDate}T00:00:00Z`) - Date.parse(`${input.entryDate}T00:00:00Z`)) / 86_400_000;
  return daysBeforeClose < LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE && input.rowPurchaseDate < input.entryDate;
}
