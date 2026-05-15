// Shared entry state helpers stay dependency-free so they can be tested without
// pulling in the full React hook or browser-only runtime.

function getComparableSplitBasisPoints(entry) {
  return entry.ownershipType === "shared"
    ? Number(entry.splits?.[0]?.ratioBasisPoints ?? 5000)
    : null;
}

export function mergeEntriesById(currentEntries, serverEntries, editingEntryId) {
  const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const serverIds = new Set(serverEntries.map((entry) => entry.id));
  const localTransientEntries = currentEntries.filter((entry) => entry.isPendingDerived && !serverIds.has(entry.id));

  return [
    ...localTransientEntries,
    ...serverEntries.map((serverEntry) => {
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
        currentEntry.isPendingDerived
        && JSON.stringify(buildComparableEntryState(currentEntry)) !== JSON.stringify(buildComparableEntryState(serverEntry))
      ) {
        return currentEntry;
      }

      return {
        ...currentEntry,
        ...serverEntry,
        isPendingDerived: false
      };
    })
  ];
}

export function buildComparableEntryState(entry) {
  return {
    date: entry.date,
    description: entry.description,
    accountId: entry.accountId ?? null,
    accountName: entry.accountName ?? "",
    categoryName: entry.categoryName,
    amountMinor: Number(
      entry.ownershipType === "shared"
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
