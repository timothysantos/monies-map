// The detector registry: one small list of pure detectors, each reading its own
// slice of the shared facts (loader.ts builds them all from a few batched
// reads). Adding a detector is one fact slice, one module and one line here.
import { detectDuplicateEntries, type DuplicateEntryFacts } from "./duplicate-entries";
import { detectHygiene, type HygieneFacts } from "./hygiene";
import { detectPlanProblems, type PlanFacts } from "./plan-problems";
import { detectDuplicateSplits, detectSettledPeriodErrors, type SplitPairFacts } from "./split-duplicates";
import { detectStaleEstimates, type StaleEstimateFacts } from "./stale-estimates";
import { detectBalanceMismatches, detectStatementGaps, detectStatementJoins, type StatementFacts } from "./statements";
import type { CheckupContext, DetectedFinding, FindingKind } from "./types";
import { detectUnmatchedTransfers, type UnmatchedTransferFacts } from "./unmatched-transfers";
import { detectWrongCardDuplicates, type WrongCardFacts } from "./wrong-card";

// Everything the detectors read, built once by the loader.
export interface CheckupFacts {
  context: CheckupContext;
  wrongCard: WrongCardFacts;
  duplicateEntries: DuplicateEntryFacts;
  splitPairs: SplitPairFacts;
  transfers: UnmatchedTransferFacts;
  statements: StatementFacts;
  estimates: StaleEstimateFacts;
  plan: PlanFacts;
  hygiene: HygieneFacts;
  // Kinds whose read hit its row limit: the list may be longer than shown.
  incomplete: FindingKind[];
}

export interface CheckupDetector {
  id: string;
  kinds: FindingKind[];
  run: (facts: CheckupFacts) => DetectedFinding[];
}

export const CHECKUP_DETECTORS: readonly CheckupDetector[] = [
  { id: "wrong-card", kinds: ["wrong_card_duplicate"], run: (facts) => detectWrongCardDuplicates(facts.wrongCard, facts.context) },
  { id: "duplicate-splits", kinds: ["duplicate_split"], run: (facts) => detectDuplicateSplits(facts.splitPairs, facts.context) },
  { id: "duplicate-entries", kinds: ["duplicate_entry"], run: (facts) => detectDuplicateEntries(facts.duplicateEntries, facts.context) },
  { id: "unmatched-transfers", kinds: ["unmatched_transfer"], run: (facts) => detectUnmatchedTransfers(facts.transfers, facts.context) },
  { id: "statement-gaps", kinds: ["statement_gap"], run: (facts) => detectStatementGaps(facts.statements, facts.context) },
  { id: "statement-joins", kinds: ["statement_join"], run: (facts) => detectStatementJoins(facts.statements, facts.context) },
  { id: "stale-estimates", kinds: ["stale_estimate"], run: (facts) => detectStaleEstimates(facts.estimates, facts.context) },
  { id: "balance-mismatches", kinds: ["balance_mismatch"], run: (facts) => detectBalanceMismatches(facts.statements, facts.context) },
  { id: "plan-problems", kinds: ["plan_overspent", "plan_line_unpaid", "plan_line_no_category"], run: (facts) => detectPlanProblems(facts.plan, facts.context) },
  { id: "settled-period", kinds: ["settled_period_error"], run: (facts) => detectSettledPeriodErrors(facts.splitPairs, facts.context) },
  { id: "hygiene", kinds: ["other_category", "odd_entry", "quiet_account"], run: (facts) => detectHygiene(facts.hygiene, facts.context) }
];
