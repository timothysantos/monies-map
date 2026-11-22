// What to look at after an import, read from the "Check my books" report
// (GET /api/ledger-checkup): payments that may be recorded twice and
// transfers with no other side. The report's own detectors decide; this only
// counts the kinds an import can cause and words nothing itself.
const DOUBLE_KINDS = ["wrong_card_duplicate", "duplicate_entry"];
const TRANSFER_KINDS = ["unmatched_transfer"];

export function summarizeAfterImportCheck(report) {
  if (!report) {
    return null;
  }
  const doubleCount = countKinds(report.kindCounts, DOUBLE_KINDS);
  const transferCount = countKinds(report.kindCounts, TRANSFER_KINDS);
  if (!doubleCount && !transferCount) {
    return null;
  }
  return {
    doubleCount,
    transferCount,
    // Pairs clear enough to link in one step; never more than the transfers.
    clearPairCount: Math.min(Math.max(0, Number(report.clearTransferPairCount) || 0), Math.floor(transferCount / 2)),
    totalCount: doubleCount + transferCount
  };
}

function countKinds(kindCounts = {}, kinds) {
  return kinds.reduce((total, kind) => {
    const counts = kindCounts[kind] ?? {};
    // "note" findings are background, not something an import just caused.
    return total + (Number(counts.high) || 0) + (Number(counts.check) || 0);
  }, 0);
}
