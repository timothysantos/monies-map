// Usually shared (DOMAIN.md "Usually Shared"): past expenses that look like
// the ones their payer usually puts on Splits but are not on Splits yet,
// grouped by shop. It is a sweep over the SAME rule that suggests the usual
// split for one entry (split-suggestion.ts, suggestSplitForEntry): every
// candidate is judged by that rule against the owner's own history, and one
// the rule would not suggest is left out. This file adds only the grouping,
// the ordering and the caps; it never decides a habit itself. Pure and
// deterministic (no AI, no reads, no writes); pages/usually-shared.ts loads
// the inputs.

import {
  NON_GROUP_SPLIT_ID,
  normalizeDescriptionForMatch,
  suggestSplitForEntry,
  type SplitSuggestionGroup,
  type SplitSuggestionHistoryEntry,
  type SplitSuggestionPerson
} from "./split-suggestion";
import type { UsuallySharedEntryDto, UsuallySharedGroupDto } from "../types/dto";

export const USUALLY_SHARED_POLICY = Object.freeze({
  // How far back a candidate entry may be.
  candidateDays: 90,
  // One Add takes at most this many entries (the command refuses more).
  maxEntriesPerAdd: 200,
  // The candidate read is bounded; the newest come first.
  maxCandidates: 500,
  // The history read is bounded the same way (a year and the candidate days).
  maxHistory: 6000
});

// Above this many entries one Add needs the person's "Yes, add all N".
export const USUALLY_SHARED_CONFIRM_ABOVE = 10;

export interface UsuallySharedCandidate {
  entryId: string;
  date: string;
  entryType: string;
  description: string;
  categoryName: string | null;
  ownerPersonId: string | null;
  currency: string;
  amountMinor: number;
}

export function suggestUsuallyShared(input: {
  candidates: UsuallySharedCandidate[];
  history: SplitSuggestionHistoryEntry[];
  groups: SplitSuggestionGroup[];
  sharePeople: SplitSuggestionPerson[];
  // Candidates older than this ISO date are left out.
  since?: string;
}): UsuallySharedGroupDto[] {
  const { candidates, history, groups, sharePeople } = input;
  const personName = new Map(sharePeople.map((person) => [person.id, person.name]));
  const byKey = new Map<string, { group: UsuallySharedGroupDto; latest: string }>();
  const index = indexHistory(history);

  for (const candidate of candidates) {
    if (input.since && candidate.date < input.since) continue;
    const suggestion = suggestSplitForEntry({
      target: {
        entryId: candidate.entryId,
        entryType: candidate.entryType,
        description: candidate.description,
        categoryName: candidate.categoryName,
        ownerPersonId: candidate.ownerPersonId,
        currency: candidate.currency,
        date: candidate.date,
        onSplits: false
      },
      // Only the owner's entries at this shop and in this category can
      // matter to the rule, so it is handed just those (it still applies its
      // own window and owner checks): the same answer, without scanning the
      // whole year for every candidate.
      history: index.relevantTo(candidate),
      groups: withNonGroup(groups, candidate.currency),
      sharePeople
    });
    if (!suggestion || !candidate.ownerPersonId) continue;

    const shop = normalizeDescriptionForMatch(candidate.description) || candidate.description.trim().toLowerCase();
    // One group per shop, payer, usual split and currency, so every entry in
    // a group takes the same Add and its amounts add up in one currency.
    const key = [shop, candidate.ownerPersonId, suggestion.groupId, suggestion.basisPoints, candidate.currency].join("|");
    const entry: UsuallySharedEntryDto = {
      id: candidate.entryId,
      date: candidate.date,
      description: candidate.description,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      ownerPersonId: candidate.ownerPersonId,
      ownerName: personName.get(candidate.ownerPersonId) ?? ""
    };
    const found = byKey.get(key);
    if (!found) {
      byKey.set(key, {
        latest: candidate.date,
        group: {
          key,
          shopName: candidate.description.trim(),
          groupId: suggestion.groupId,
          groupName: suggestion.groupName,
          basisPoints: suggestion.basisPoints,
          ownerPersonId: candidate.ownerPersonId,
          ownerName: entry.ownerName,
          otherPersonId: suggestion.otherPersonId,
          otherPersonName: suggestion.otherPersonName,
          evidenceCount: suggestion.evidenceCount,
          matchedCount: suggestion.matchedCount,
          matchedBy: suggestion.matchedBy,
          currency: candidate.currency,
          totalMinor: candidate.amountMinor,
          entries: [entry]
        }
      });
      continue;
    }
    found.group.entries.push(entry);
    // The evidence shown is the newest entry's: its window is the latest.
    if (candidate.date > found.latest) {
      found.latest = candidate.date;
      found.group.evidenceCount = suggestion.evidenceCount;
      found.group.matchedCount = suggestion.matchedCount;
      found.group.matchedBy = suggestion.matchedBy;
      found.group.shopName = candidate.description.trim();
    }
  }

  return [...byKey.values()]
    .map(({ group }) => {
      // Newest first; one Add takes at most the cap, the rest wait.
      const entries = group.entries
        .sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id))
        .slice(0, USUALLY_SHARED_POLICY.maxEntriesPerAdd);
      return { ...group, entries, totalMinor: entries.reduce((sum, entry) => sum + entry.amountMinor, 0) };
    })
    .sort((left, right) => right.entries.length - left.entries.length
      || right.entries[0].date.localeCompare(left.entries[0].date)
      || left.shopName.localeCompare(right.shopName)
      || left.key.localeCompare(right.key));
}

// The history by owner and shop, and by owner and category.
function indexHistory(history: SplitSuggestionHistoryEntry[]) {
  const byShop = new Map<string, SplitSuggestionHistoryEntry[]>();
  const byCategory = new Map<string, SplitSuggestionHistoryEntry[]>();
  const push = (map: Map<string, SplitSuggestionHistoryEntry[]>, key: string, entry: SplitSuggestionHistoryEntry) => {
    const list = map.get(key);
    if (list) list.push(entry); else map.set(key, [entry]);
  };
  for (const entry of history) {
    push(byShop, `${entry.ownerPersonId}|${normalizeDescriptionForMatch(entry.description ?? "")}`, entry);
    if (entry.categoryName) push(byCategory, `${entry.ownerPersonId}|${entry.categoryName}`, entry);
  }
  return {
    relevantTo(candidate: Pick<UsuallySharedCandidate, "description" | "categoryName" | "ownerPersonId">) {
      const shop = byShop.get(`${candidate.ownerPersonId}|${normalizeDescriptionForMatch(candidate.description ?? "")}`) ?? [];
      const category = candidate.categoryName ? byCategory.get(`${candidate.ownerPersonId}|${candidate.categoryName}`) ?? [] : [];
      return category.length ? [...new Set([...shop, ...category])] : shop;
    }
  };
}

// Non-group expenses take any currency (as the single-entry loader adds it).
function withNonGroup(groups: SplitSuggestionGroup[], currency: string): SplitSuggestionGroup[] {
  return [
    { id: NON_GROUP_SPLIT_ID, name: "Non-group expenses", currency },
    ...groups.filter((group) => group.id !== NON_GROUP_SPLIT_ID)
  ];
}
