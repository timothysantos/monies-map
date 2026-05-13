export function buildComparableEntryRefreshState(entry) {
  return {
    date: entry.date,
    description: entry.description,
    accountId: entry.accountId ?? null,
    accountName: entry.accountName ?? "",
    categoryName: entry.categoryName,
    amountMinor: Number(entry.amountMinor ?? 0),
    entryType: entry.entryType,
    transferDirection: entry.transferDirection ?? null,
    ownershipType: entry.ownershipType,
    ownerName: entry.ownerName ?? null,
    splitBasisPoints: entry.ownershipType === "shared"
      ? Number(entry.splits?.[0]?.ratioBasisPoints ?? 5000)
      : null
  };
}

export function hasLedgerAffectingEntryChange(nextEntry, previousEntry) {
  return JSON.stringify(buildComparableEntryRefreshState(nextEntry))
    !== JSON.stringify(buildComparableEntryRefreshState(previousEntry));
}

export function buildEntryMutationRefreshPlan({
  kind,
  nextEntry,
  previousEntry
}) {
  const changedLedgerEvidence = nextEntry && previousEntry
    ? hasLedgerAffectingEntryChange(nextEntry, previousEntry)
    : false;

  if (kind === "filter-only" || kind === "mobile-sheet") {
    return {
      invalidateEntries: false,
      invalidateMonth: false,
      invalidateSummary: false,
      invalidateSplits: false
    };
  }

  if (kind === "note-only-edit" && !changedLedgerEvidence) {
    return {
      invalidateEntries: true,
      invalidateMonth: false,
      invalidateSummary: false,
      invalidateSplits: false
    };
  }

  if (kind === "quick-entry-create" || kind === "entry-edit" || kind === "entry-delete") {
    return {
      invalidateEntries: true,
      invalidateMonth: true,
      invalidateSummary: true,
      invalidateSplits: false
    };
  }

  if (kind === "add-to-splits") {
    return {
      invalidateEntries: true,
      invalidateMonth: true,
      invalidateSummary: true,
      invalidateSplits: true
    };
  }

  if (kind === "transfer-link" || kind === "transfer-settle") {
    return {
      invalidateEntries: true,
      invalidateMonth: true,
      invalidateSummary: true,
      invalidateSplits: false
    };
  }

  return {
    invalidateEntries: changedLedgerEvidence,
    invalidateMonth: changedLedgerEvidence,
    invalidateSummary: changedLedgerEvidence,
    invalidateSplits: false
  };
}
