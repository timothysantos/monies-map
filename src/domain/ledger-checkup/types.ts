// The Ledger check-up's finding model (docs/proposals/ledger-checkup.md,
// DOMAIN.md "Ledger Check-up"). Pure types: detectors build findings from
// bounded read models, the runner orders and caps them, the route sends them.

export type FindingTier = "high" | "check" | "note";

export const FINDING_KINDS = [
  "wrong_card_duplicate",
  "duplicate_split",
  "duplicate_entry",
  "unmatched_transfer",
  "statement_gap",
  "statement_join",
  "stale_estimate",
  "balance_mismatch",
  "plan_overspent",
  "plan_line_unpaid",
  "plan_line_no_category",
  "settled_period_error",
  "other_category",
  "odd_entry",
  "quiet_account"
] as const;
export type FindingKind = typeof FINDING_KINDS[number];

export const TIER_ORDER: Record<FindingTier, number> = { high: 0, check: 1, note: 2 };

// One record behind a finding. `shortId` is the 8 characters after the id's
// prefix, so a person can tell two entries apart and a developer can find one.
export interface CheckupEvidence {
  // "entry", "record" (a split expense or payment), "statement", "plan line",
  // "account", "fact": how a screen groups and marks the line.
  role: "entry" | "record" | "statement" | "plan line" | "account" | "fact";
  label: string;
  shortId?: string;
  date?: string;
  amountMinor?: number;
  currency?: string;
  accountName?: string;
  note?: string;
}

export interface CheckupFix {
  label: string;
  // An app path the screen can open (with its query), never an API route.
  path: string;
}

export interface CheckupFinding {
  // `${kind}:${subject}`: stable for the same subject; also the dismissal key.
  id: string;
  kind: FindingKind;
  tier: FindingTier;
  title: string;
  summary: string;
  evidence: CheckupEvidence[];
  // The money the finding is about (minor units, positive), or null.
  amountMinor: number | null;
  currency: string;
  // Newest evidence date, YYYY-MM-DD, for ordering by recency.
  occurredOn: string | null;
  // The people it touches; empty = the household or a shared account.
  personIds: string[];
  fix: CheckupFix | null;
  fixNote: string | null;
  // A hash of the facts that make the finding true: when the evidence changes
  // it changes, and a dismissed finding comes back.
  evidenceKey: string;
  dismissed: boolean;
}

// What a detector hands the runner: everything but the dismissal flag and the
// evidence key, which the runner derives from `evidenceFacts` and the stored
// dismissals.
export type DetectedFinding = Omit<CheckupFinding, "dismissed" | "evidenceKey"> & {
  evidenceFacts: ReadonlyArray<string | number | null>;
};

export interface AccountFact {
  id: string;
  name: string;
  kind: "bank" | "credit_card" | "loan" | "cash" | "investment";
  ownerPersonId: string | null;
  isJoint: boolean;
  isActive: boolean;
  currency: string;
  openingBalanceMinor: number;
  // The newest entry date on the account, null when it never had one.
  lastEntryDate: string | null;
}

// What every detector may read besides its own facts.
export interface CheckupContext {
  today: string;
  accounts: ReadonlyMap<string, AccountFact>;
  people: ReadonlyMap<string, string>;
}

export const FINDINGS_PER_KIND_LIMIT = 50;
