// The runner: runs every registered detector over the shared facts, applies the
// stored dismissals, orders and caps the findings. Pure: facts and dismissals
// in, the report out (loader.ts reads, the route sends).
//
// Order: tier (needs fixing, worth checking, good to know), then money size
// (largest first), then recency (newest first), then id. At most 50 findings
// of each kind are returned; `moreByKind` counts the rest and `tierCounts`
// counts every finding that is not dismissed, shown or not.
import { hashFacts } from "./helpers";
import { CHECKUP_DETECTORS, type CheckupDetector, type CheckupFacts } from "./registry";
import {
  FINDINGS_PER_KIND_LIMIT,
  TIER_ORDER,
  type CheckupFinding,
  type DetectedFinding,
  type FindingKind,
  type FindingTier
} from "./types";

export interface CheckupReport {
  tierCounts: Record<FindingTier, number>;
  // The same count for each kind that has a finding (not dismissed), so a screen can
  // say "137 unlinked transfers" beside the three that change a figure.
  kindCounts: Partial<Record<FindingKind, Record<FindingTier, number>>>;
  dismissedCount: number;
  findings: CheckupFinding[];
  moreByKind: Partial<Record<FindingKind, number>>;
  // Kinds whose read hit its row limit (the list may be longer than shown).
  incompleteKinds: FindingKind[];
  // Kinds a detector could not be run for (a bug, never data): shown as "could not be checked".
  unavailableKinds: FindingKind[];
}

export interface CheckupOptions {
  // A person id keeps the findings that touch that person and the ones that touch
  // no one in particular; "household" (or nothing) keeps all.
  view?: string | null;
  // Dismissed findings come back flagged instead of hidden.
  includeDismissed?: boolean;
  detectors?: readonly CheckupDetector[];
}

export function compareFindings(left: CheckupFinding, right: CheckupFinding) {
  return TIER_ORDER[left.tier] - TIER_ORDER[right.tier]
    || (right.amountMinor ?? -1) - (left.amountMinor ?? -1)
    || (right.occurredOn ?? "").localeCompare(left.occurredOn ?? "")
    || left.id.localeCompare(right.id);
}

// dismissals: finding id -> the evidence key it was dismissed for.
export function runLedgerCheckup(facts: CheckupFacts, dismissals: ReadonlyMap<string, string>, options: CheckupOptions = {}): CheckupReport {
  const seen = new Set<string>();
  const detected: DetectedFinding[] = [];
  const unavailable = new Set<FindingKind>();
  for (const detector of options.detectors ?? CHECKUP_DETECTORS) {
    try {
      for (const result of detector.run(facts)) {
        if (!seen.has(result.id)) {
          seen.add(result.id);
          detected.push(result);
        }
      }
    } catch (error) {
      // One broken rule never blanks the report; it says what could not be checked.
      console.error("Ledger check-up detector failed", { detector: detector.id, error: error instanceof Error ? error.message : String(error) });
      detector.kinds.forEach((kind) => unavailable.add(kind));
    }
  }

  const view = options.view && options.view !== "household" ? options.view : null;
  const all: CheckupFinding[] = detected
    .filter((item) => !view || item.personIds.length === 0 || item.personIds.includes(view))
    .map(({ evidenceFacts, ...item }) => {
      const evidenceKey = hashFacts(evidenceFacts);
      return { ...item, evidenceKey, dismissed: dismissals.get(item.id) === evidenceKey };
    });

  const tierCounts: Record<FindingTier, number> = { high: 0, check: 0, note: 0 };
  const kindCounts: CheckupReport["kindCounts"] = {};
  let dismissedCount = 0;
  for (const item of all) {
    if (item.dismissed) {
      dismissedCount += 1;
    } else {
      tierCounts[item.tier] += 1;
      const counts = kindCounts[item.kind] ?? { high: 0, check: 0, note: 0 };
      counts[item.tier] += 1;
      kindCounts[item.kind] = counts;
    }
  }

  const included = all.filter((item) => options.includeDismissed || !item.dismissed).sort(compareFindings);
  const perKind = new Map<FindingKind, number>();
  const findings: CheckupFinding[] = [];
  const moreByKind: Partial<Record<FindingKind, number>> = {};
  for (const item of included) {
    const count = perKind.get(item.kind) ?? 0;
    perKind.set(item.kind, count + 1);
    if (count < FINDINGS_PER_KIND_LIMIT) {
      findings.push(item);
    } else {
      moreByKind[item.kind] = (moreByKind[item.kind] ?? 0) + 1;
    }
  }
  return {
    tierCounts,
    kindCounts,
    dismissedCount,
    findings,
    moreByKind,
    incompleteKinds: facts.incomplete,
    unavailableKinds: [...unavailable]
  };
}
