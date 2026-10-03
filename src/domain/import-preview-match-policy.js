// The velocity rule (DOMAIN.md, "Velocity Rule"): a charge that repeats on
// its account (another charge of the same signed amount with lookalike
// wording within a week; createRepetitionIndex in statement-row-matching.ts)
// is matched only within 2 days, so daily fares, coffees or top-ups at one
// price stay separate purchases. A one-off charge keeps 7 days, whatever its
// amount, so a late-posted fee or fare still meets its entry. Until
// 2026-10-03 the test was the amount (under $5); docs/audits/velocity-rule.md
// measured why repetition is the better test.
export const REPEATING_DUPLICATE_MAX_DAY_DISTANCE = 2;
export const STANDARD_DUPLICATE_MAX_DAY_DISTANCE = 7;

export function getDuplicateCandidateMaxDayDistance(input) {
  return input.repeats ? REPEATING_DUPLICATE_MAX_DAY_DISTANCE : STANDARD_DUPLICATE_MAX_DAY_DISTANCE;
}

export function canSuppressCertifiedStatementDuplicate(input) {
  return input.candidateSourceType === "pdf"
    && input.candidateBankCertificationStatus === "statement_certified"
    && input.incomingSourceType !== "pdf"
    && input.dayDistance <= getDuplicateCandidateMaxDayDistance({ repeats: input.repeats });
}

// A repeating entry with no posted date, dated in the last two days of a
// statement period, may still post on the next statement (a commute ride on
// the closing day often posts the day after). It answers a statement row
// only from its own purchase day or later, never an earlier ride's row:
// pairing two rides a day apart would hide both the missing ride and the one
// waiting for the next statement. A one-off charge is left to the usual
// rules: the day before is most likely the same purchase.
export function isRowBeforeLateUnpostedEntry(input) {
  if (!input.repeats || input.entryPostDate || !input.statementEndDate || input.entryDate > input.statementEndDate) {
    return false;
  }
  const daysBeforeClose = (Date.parse(`${input.statementEndDate}T00:00:00Z`) - Date.parse(`${input.entryDate}T00:00:00Z`)) / 86_400_000;
  return daysBeforeClose < REPEATING_DUPLICATE_MAX_DAY_DISTANCE && input.rowPurchaseDate < input.entryDate;
}
