// Shared entry state helpers stay dependency-free so they can be tested without
// pulling in the full React hook or browser-only runtime.

function getComparableSplitBasisPoints(entry) {
  return entry.ownershipType === "shared"
    ? Number(entry.splits?.[0]?.ratioBasisPoints ?? 5000)
    : null;
}

// Fields an entry carries only while it is linked to a split expense; in a
// person view amountMinor is then the viewer's share and totalAmountMinor the
// ledger amount.
const SPLIT_LINK_FIELDS = [
  "linkedSplitExpenseId",
  "linkedSplitGroupName",
  "linkedSplitCategoryName",
  "linkedSplitNote",
  "linkedSplitShares",
  "totalAmountMinor",
  "viewerSplitRatioBasisPoints"
];

// The entry once its split is gone: the ledger amount, no split fields.
export function withoutSplitLink(entry) {
  if (!entry.linkedSplitExpenseId) {
    return entry;
  }

  const next = { ...entry, amountMinor: Number(entry.totalAmountMinor ?? entry.amountMinor ?? 0) };
  for (const field of SPLIT_LINK_FIELDS) {
    delete next[field];
  }
  return next;
}

// A server row omits the split fields once the split is deleted, so a merge
// over a locally linked row must drop them instead of keeping the old link.
function mergeServerEntry(currentEntry, serverEntry) {
  const merged = { ...currentEntry, ...serverEntry, isPendingDerived: false };
  return currentEntry.linkedSplitExpenseId && !serverEntry.linkedSplitExpenseId
    ? { ...withoutSplitLink(merged), amountMinor: serverEntry.amountMinor }
    : merged;
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

      return keepUnchangedEntry(currentEntry, mergeServerEntry(currentEntry, serverEntry));
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
