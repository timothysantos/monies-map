// Shared entry state helpers stay dependency-free so they can be tested without
// pulling in the full React hook or browser-only runtime.

function getComparableSplitBasisPoints(entry) {
  return entry.ownershipType === "shared"
    ? Number(entry.splits?.[0]?.ratioBasisPoints ?? 5000)
    : null;
}

export function mergeEntriesById(
  currentEntries,
  serverEntries,
  editingEntryId,
  excludedEntryIds = new Set(),
  { preferServerEntries = false } = {}
) {
  const visibleServerEntries = serverEntries.filter((entry) => !excludedEntryIds.has(entry.id));
  const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const serverIds = new Set(visibleServerEntries.map((entry) => entry.id));
  const localTransientEntries = preferServerEntries
    ? []
    : currentEntries.filter((entry) => (
        entry.isPendingDerived
        && !excludedEntryIds.has(entry.id)
        && !serverIds.has(entry.id)
      ));

  return [
    ...localTransientEntries,
    ...visibleServerEntries.map((serverEntry) => {
      const currentEntry = currentById.get(serverEntry.id);
      if (!currentEntry) {
        return serverEntry;
      }

      if (serverEntry.id === editingEntryId) {
        return {
          ...currentEntry,
          linkedTransfer: serverEntry.linkedTransfer,
          linkedSplitExpenseId: serverEntry.linkedSplitExpenseId,
          isPendingDerived: false
        };
      }

      if (
        !preferServerEntries
        && (
        currentEntry.isPendingDerived
        && JSON.stringify(buildComparableEntryState(currentEntry)) !== JSON.stringify(buildComparableEntryState(serverEntry))
        )
      ) {
        return currentEntry;
      }

      return keepUnchangedEntry(currentEntry, {
        ...currentEntry,
        ...serverEntry,
        isPendingDerived: false
      });
    })
  ];
}

// Returns the current object when a merge changed no field, so entry
// identity survives a refresh or editor close and memoized rows can skip it.
function keepUnchangedEntry(currentEntry, mergedEntry) {
  const keys = Object.keys(mergedEntry);
  if (keys.length !== Object.keys(currentEntry).length) {
    return mergedEntry;
  }
  return keys.every((key) => Object.is(mergedEntry[key], currentEntry[key])) ? currentEntry : mergedEntry;
}

export function buildComparableEntryState(entry) {
  return {
    date: entry.date,
    postDate: entry.postDate ?? null,
    description: entry.description,
    accountId: entry.accountId ?? null,
    accountName: entry.accountName ?? "",
    categoryName: entry.categoryName,
    // Shared and split-linked rows hold the viewer's share as amountMinor;
    // the saved ledger amount is the total.
    amountMinor: Number(
      entry.ownershipType === "shared" || entry.linkedSplitExpenseId
        ? Number(entry.totalAmountMinor ?? entry.amountMinor ?? 0)
        : (entry.amountMinor ?? 0)
    ),
    entryType: entry.entryType,
    transferDirection: entry.transferDirection ?? null,
    ownershipType: entry.ownershipType,
    ownerName: entry.ownerName ?? null,
    note: entry.note ?? "",
    splitBasisPoints: getComparableSplitBasisPoints(entry)
  };
}
