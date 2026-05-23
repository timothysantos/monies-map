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
