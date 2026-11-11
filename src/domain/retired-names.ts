// Names the owner retired because a non-technical reader stops on them
// (AGENTS.md, "Every visible name must be understandable to a non-technical
// person"; docs/audits/plain-names/README.md). They stay out of every
// visible string: Money insights copy (findAppJargon), Plan Studio copy, the
// in-app guides and the app's own source strings
// (tests/retired-names.test.mjs). Storage terms such as budget_buckets and
// planned_items are identifiers, not visible names, and do not match.
export const RETIRED_NAMES: ReadonlyArray<{ pattern: RegExp; retired: string; use: string }> = [
  { pattern: /overplanned/i, retired: "Overplanned", use: "Planned more than you earn" },
  { pattern: /\bto allocate\b/i, retired: "To allocate", use: "Not planned yet" },
  { pattern: /\bmoney jobs?\b/i, retired: "Money jobs", use: "Where your money goes" },
  { pattern: /\bwallets in view\b/i, retired: "Wallets in view", use: "Accounts" },
  { pattern: /\bintent (?:vs\.?|versus) outcome\b/i, retired: "Intent vs Outcome", use: "Plan vs actual" },
  { pattern: /\bbudget buckets?\b/i, retired: "Budget bucket", use: "Monthly budget" },
  { pattern: /\bplanned items?\b/i, retired: "Planned items", use: "Bills and dated payments" },
  { pattern: /\bfrom its statement\b/i, retired: "from its statement", use: "as the statement says" }
];

// Returns the retired names a line uses, each with its replacement.
export function findRetiredNames(text: string): string[] {
  return RETIRED_NAMES.filter(({ pattern }) => pattern.test(text)).map(({ retired, use }) => `uses retired name "${retired}" (say "${use}")`);
}
