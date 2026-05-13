export function buildLinkedSplitRefreshOptions(linkedTransactionId, overrides = {}) {
  // Split-to-ledger links only fan out to ledger caches when the split is
  // actually tied to an imported transaction.
  const affectsLinkedLedgerEntry = Boolean(linkedTransactionId);
  return {
    broadcast: true,
    invalidateEntries: affectsLinkedLedgerEntry,
    invalidateMonth: affectsLinkedLedgerEntry,
    invalidateSummary: affectsLinkedLedgerEntry,
    ...overrides
  };
}

export function buildSplitArchiveRefreshPlan() {
  // The archive view remains part of the main splits page response for now.
  // We keep the refresh exception explicit so it can be removed once a
  // separate archive query is justified by payload or freshness behavior.
  return {
    refreshShell: true,
    reason: "archive content still rides the main splits page payload"
  };
}

export function createSplitRefreshGuard() {
  let generation = 0;

  return {
    next() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return generation === token;
    }
  };
}
