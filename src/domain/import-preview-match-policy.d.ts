export const LOW_VALUE_DUPLICATE_WINDOW_THRESHOLD_MINOR: number;
export const LOW_VALUE_DUPLICATE_MAX_DAY_DISTANCE: number;
export const STANDARD_DUPLICATE_MAX_DAY_DISTANCE: number;

export function getDuplicateCandidateMaxDayDistance(amountMinor: number): number;

export function canSuppressCertifiedStatementDuplicate(input: {
  candidateSourceType?: "csv" | "pdf" | "manual";
  candidateBankCertificationStatus?: "provisional" | "statement_certified";
  incomingSourceType?: "csv" | "pdf" | "manual";
  dayDistance: number;
  amountMinor: number;
}): boolean;
