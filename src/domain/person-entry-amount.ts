// A person's own part of a ledger entry: the one rule behind every person
// view figure (Summary months and charts, the Month actual spend, plan
// actuals and chart, and the stored person month totals), so those figures
// cannot drift apart.
//
// A split-linked entry is that person's share of it (a travel split's share
// already converted to the ledger amount in `linkedSplitShares`); any other
// entry is its owner's at the full amount. The scope narrows it: `direct`
// keeps entries that are not linked to a split, `shared` keeps split shares,
// and `direct_plus_shared` keeps both, so direct plus shared always adds up to
// direct plus shared.

import type { EntryDto, PersonScope } from "../types/dto";

// The person's amount of the entry in minor units, or null when the entry is
// not theirs in that scope. A split that gives the person no share row leaves
// the entry out even when the person owns the ledger row.
export function personEntryAmountMinor(
  entry: EntryDto,
  personId: string,
  scope: PersonScope = "direct_plus_shared"
): number | null {
  if (entry.linkedSplitExpenseId) {
    if (scope === "direct") {
      return null;
    }
    return entry.linkedSplitShares?.find((share) => share.personId === personId)?.amountMinor ?? null;
  }

  if (scope === "shared") {
    return null;
  }
  const ownerShare = entry.splits.find((split) => split.personId === personId);
  if (!ownerShare) {
    return null;
  }
  return entry.ownershipType === "direct" ? entry.amountMinor : ownerShare.amountMinor;
}

export function isEntryInPersonScope(entry: EntryDto, personId: string, scope: PersonScope) {
  return personEntryAmountMinor(entry, personId, scope) !== null;
}
