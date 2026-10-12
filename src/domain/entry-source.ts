// Added by (DOMAIN.md "Added by"): which in-app tool created an entry, read
// from the entry's external reference. The Apple Pay Shortcut saves with
// `shortcut:<request id>` and the Ask card with `ask:<card id>`; both keep
// the reference so a retried save is never a second entry. Pages get only
// this derived word, never the reference itself. Anything else (a manual
// entry, an import, a reference written by something else) has no source.
import type { EntryAddedBy } from "../types/dto";

const SOURCE_PREFIXES: ReadonlyArray<readonly [string, EntryAddedBy]> = [
  ["shortcut:", "apple_pay_shortcut"],
  ["ask:", "ask"]
];

export function entryAddedByFromReference(externalReference: string | null | undefined): EntryAddedBy | null {
  if (typeof externalReference !== "string") {
    return null;
  }
  for (const [prefix, addedBy] of SOURCE_PREFIXES) {
    // A bare prefix carries no request, so it is not a saved source.
    if (externalReference.startsWith(prefix) && externalReference.length > prefix.length) {
      return addedBy;
    }
  }
  return null;
}
