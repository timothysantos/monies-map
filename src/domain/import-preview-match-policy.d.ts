export const REPEATING_DUPLICATE_MAX_DAY_DISTANCE: number;
export const STANDARD_DUPLICATE_MAX_DAY_DISTANCE: number;

export function getDuplicateCandidateMaxDayDistance(input: { repeats: boolean }): number;

export function canSuppressCertifiedStatementDuplicate(input: {
  candidateSourceType?: "csv" | "pdf" | "manual";
  candidateBankCertificationStatus?: "provisional" | "statement_certified";
  incomingSourceType?: "csv" | "pdf" | "manual";
  dayDistance: number;
  repeats: boolean;
}): boolean;

export function isRowBeforeLateUnpostedEntry(input: {
  repeats: boolean;
  entryDate: string;
  entryPostDate?: string | null;
  statementEndDate?: string;
  rowPurchaseDate: string;
}): boolean;
