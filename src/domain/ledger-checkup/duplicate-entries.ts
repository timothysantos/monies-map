// Detector 2b: the same ledger entry twice.
//
// Two entries on one account with the same day, amount, direction and wording
// (the loader's SQL also made sure there are exactly two, neither certified by
// a statement, neither an Apple Pay or Ask entry, neither in a transfer pair or
// linked to a split or plan line). Here the pair is judged:
//
// - two rows of one import are the bank's own repeat (two coffees), silent;
// - the same bank row loaded by two different imports (identical row hash) is
//   `high`: the importer normally skips it, so one copy is a leftover;
// - anything else that passes (a typed entry and an imported one, rows whose
//   hashes differ) is `check`: two real purchases are possible.
import { accountLabel, accountPeople, clip, entryLink, finding, money, shortDate, shortId } from "./helpers";
import type { CheckupContext, DetectedFinding } from "./types";

export interface DuplicateEntryFact {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  entryType: "expense" | "income" | "transfer";
  importId: string | null;
  // The bank-row hash of the import row that made the entry; null for a typed one.
  rowHash: string | null;
  importedAt: string | null;
  createdAt: string;
  ownerPersonId: string | null;
}

export interface DuplicateEntryPair {
  a: DuplicateEntryFact;
  b: DuplicateEntryFact;
}

export interface DuplicateEntryFacts {
  pairs: DuplicateEntryPair[];
}

export function detectDuplicateEntries(facts: DuplicateEntryFacts, context: CheckupContext): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const { a, b } of facts.pairs) {
    if (a.importId && a.importId === b.importId) {
      continue;
    }
    const sameBankRow = Boolean(a.importId && b.importId && a.rowHash && a.rowHash === b.rowHash);
    // The newer copy is the one to look at first.
    const [extra, kept] = (a.importedAt ?? a.createdAt) >= (b.importedAt ?? b.createdAt) ? [a, b] : [b, a];
    const account = accountLabel(context, extra.accountId);
    const amount = money(extra.amountMinor, extra.currency);
    const tier = sameBankRow ? "high" : "check";
    const kindWord = extra.entryType === "income" ? "money in" : extra.entryType === "transfer" ? "transfer" : "purchase";
    findings.push(finding({
      kind: "duplicate_entry",
      subject: [a.id, b.id].sort().join("+"),
      tier,
      title: tier === "high" ? "The same bank record was added twice" : "Two entries look the same",
      summary: tier === "high"
        ? `${clip(extra.description, 40)}, ${amount} on ${shortDate(extra.date, context.today)}, is on ${account} twice and both came from the same line of the bank's file, so ${account} shows ${amount} too ${extra.entryType === "income" ? "much money in" : "much spent"}.`
        : `Two ${kindWord}s of ${amount} for ${clip(extra.description, 40)} on ${shortDate(extra.date, context.today)} are on ${account}. They may be one ${kindWord} entered twice, or two real ones.`,
      evidence: [kept, extra].map((entry, index) => ({
        role: "entry" as const,
        label: clip(entry.description),
        shortId: shortId(entry.id),
        date: entry.date,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        accountName: account,
        note: `${index === 0 ? "older copy" : "newer copy"}; ${entry.importId ? "from a bank file" : "typed in by hand"}`
      })),
      amountMinor: extra.amountMinor,
      currency: extra.currency,
      occurredOn: extra.date,
      personIds: [...accountPeople(context.accounts.get(extra.accountId)), ...(extra.ownerPersonId ? [extra.ownerPersonId] : [])],
      fix: entryLink(extra.id, extra.date, "Open the newer entry"),
      facts: [a.id, b.id, a.amountMinor, a.date, a.rowHash, b.rowHash]
    }));
  }
  return findings;
}
