// A view's scope: which scopes it offers, which one it uses, and which
// entries that scope counts. The Worker's page builders (Summary, Month,
// Entries) and the client's scope controls and money check-ins read these
// same rules, so a check-in and the figures beside it count the same entries.
//
// The household has one Combined view that counts every entry. A person view
// counts that person's own entries in the chosen scope (person-entry-amount.ts).

import { isEntryInPersonScope } from "./person-entry-amount";
import type { EntryDto, PersonScope } from "../types/dto";

const PERSON_SCOPE_KEYS: readonly PersonScope[] = ["direct", "shared", "direct_plus_shared"];

export function buildPersonScopes(selectedPersonId: string): Array<{ key: PersonScope; label: string }> {
  return selectedPersonId === "household"
    ? [{ key: "direct_plus_shared", label: "Combined" }]
    : [
        { key: "direct", label: "Direct ownership" },
        { key: "shared", label: "Shared" },
        { key: "direct_plus_shared", label: "Direct + Shared" }
      ];
}

// The scope a view uses: the household is always Combined, whatever scope
// the route carries over from a person view, and a scope the route does not
// know (a hand-edited URL) counts as Direct + Shared, as the entry rule does.
export function effectiveScopeForView(personId: string, scope: string | null | undefined): PersonScope {
  if (personId === "household") {
    return "direct_plus_shared";
  }
  return PERSON_SCOPE_KEYS.find((key) => key === scope) ?? "direct_plus_shared";
}

// The entries a view counts in its actuals, charts and check-ins. The
// household counts every entry; a person view keeps the entries that are
// theirs in the scope. Pass entries adjusted for the view
// (adjustEntriesForView) so a split-linked entry carries the person's share.
export function filterEntriesForView(entries: EntryDto[], personId: string, scope: PersonScope): EntryDto[] {
  if (personId === "household") {
    return entries;
  }

  return entries.filter((entry) => isEntryInPersonScope(entry, personId, scope));
}
