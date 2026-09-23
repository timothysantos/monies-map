const START_YEAR = 2024;
const START_MONTH = 6;
const MONTH_COUNT = 24;
const LARGE_MONTH = "2026-05";

function monthKeys() {
  return Array.from({ length: MONTH_COUNT }, (_, index) => {
    const absoluteMonth = START_YEAR * 12 + START_MONTH - 1 + index;
    return `${Math.floor(absoluteMonth / 12)}-${String((absoluteMonth % 12) + 1).padStart(2, "0")}`;
  });
}

function monthDistribution(rowCount, months) {
  const counts = new Map(months.map((month) => [month, 0]));
  if (rowCount === 10_000) {
    counts.set(LARGE_MONTH, 2_000);
    const remainingMonths = months.filter((month) => month !== LARGE_MONTH);
    const remainingRows = rowCount - 2_000;
    remainingMonths.forEach((month, index) => {
      counts.set(month, Math.floor(remainingRows / remainingMonths.length) + (index < remainingRows % remainingMonths.length ? 1 : 0));
    });
    return counts;
  }
  months.forEach((month, index) => counts.set(month, Math.floor(rowCount / months.length) + (index < rowCount % months.length ? 1 : 0)));
  return counts;
}

export function createScaleFixture(rowCount) {
  if (![1_000, 10_000].includes(rowCount)) throw new RangeError("Scale fixture size must be 1000 or 10000 rows.");
  const months = monthKeys();
  const countsByMonth = monthDistribution(rowCount, months);
  const rows = [];
  let sequence = 0;
  for (const month of months) {
    for (let offset = 0; offset < countsByMonth.get(month); offset += 1) {
      const index = sequence++;
      const transfer = index % 100 < 2;
      const transferPairIndex = transfer ? Math.floor(index / 100) : null;
      rows.push({
        id: `perf-${rowCount}-transaction-${String(index + 1).padStart(5, "0")}`,
        importRowId: `perf-${rowCount}-import-row-${String(index + 1).padStart(5, "0")}`,
        importId: `perf-${rowCount}-import-batch`,
        month,
        date: `${month}-${String((transfer ? Math.floor(offset / 2) : offset) % 28 + 1).padStart(2, "0")}`,
        amountMinor: transfer ? 125 + ((Math.floor(index / 100) * 100 * 379) % 49_876) : 125 + ((index * 379) % 49_876),
        entryType: transfer ? "transfer" : "expense",
        transferDirection: transfer ? (index % 2 === 0 ? "out" : "in") : null,
        transferGroupId: transfer ? `perf-${rowCount}-transfer-${String(transferPairIndex).padStart(4, "0")}` : null,
        ownerRole: index % 3 === 0 ? null : index % 2 === 0 ? "person-a" : "person-b",
        accountRole: index % 3 === 0 ? "joint" : "individual",
        categoryRole: index % 2 === 0 ? "groceries" : "transport",
        description: `Performance fixture ${index + 1}`,
        bankCertificationStatus: "provisional",
        certificationReference: null
      });
    }
  }
  const expenseRows = rows.filter((row) => row.entryType === "expense");
  const monthTotals = Object.fromEntries(months.map((month) => [month, rows.filter((row) => row.month === month && row.entryType === "expense").reduce((sum, row) => sum + row.amountMinor, 0)]));
  const transferPairs = new Map();
  for (const row of rows.filter((item) => item.transferGroupId)) {
    const pair = transferPairs.get(row.transferGroupId) ?? [];
    pair.push(row);
    transferPairs.set(row.transferGroupId, pair);
  }
  const expected = {
    rowCount: rows.length,
    uniqueIdCount: new Set(rows.map((row) => row.id)).size,
    importRowCount: new Set(rows.map((row) => row.importRowId)).size,
    monthCount: new Set(rows.map((row) => row.month)).size,
    largeMonthCount: rows.filter((row) => row.month === LARGE_MONTH).length,
    expenseCount: expenseRows.length,
    expenseTotalMinor: expenseRows.reduce((sum, row) => sum + row.amountMinor, 0),
    monthTotals,
    transferRowCount: rows.length - expenseRows.length,
    transferPairCount: transferPairs.size,
    transferPairsValid: [...transferPairs.values()].every((pair) => pair.length === 2 && pair[0].amountMinor === pair[1].amountMinor && new Set(pair.map((row) => row.transferDirection)).size === 2),
  };
  const splitGroups = [
    { id: `perf-${rowCount}-split-usd`, currency: "USD", totalAmountMinor: 12_345, homeAmountMinor: 16_789, fxRateBasisPoints: 13_600, shares: [{ personRole: "person-a", ratioBasisPoints: 5_000, amountMinor: 6_173 }, { personRole: "person-b", ratioBasisPoints: 5_000, amountMinor: 6_172 }] },
    { id: `perf-${rowCount}-split-eur`, currency: "EUR", totalAmountMinor: 9_876, homeAmountMinor: 14_320, fxRateBasisPoints: 14_500, shares: [{ personRole: "person-a", ratioBasisPoints: 5_000, amountMinor: 4_938 }, { personRole: "person-b", ratioBasisPoints: 5_000, amountMinor: 4_938 }] }
  ];
  return {
    rowCount,
    months,
    rows,
    splitGroups,
    expected,
    sourceNote: "Synthetic benchmark ledger rows are provisional and never statement-certified. Balanced USD/EUR split groups are supplemental. Preserve the seeded demo's near-real import, checkpoint, and reconciliation scenarios alongside this fixture."
  };
}

export function validateScaleFixture(fixture) {
  const { rows, expected, splitGroups } = fixture ?? {};
  if (!Array.isArray(rows) || !expected || rows.length !== expected.rowCount) return false;
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  if (new Set(rows.map((row) => row.importRowId)).size !== rows.length) return false;
  if (new Set(rows.map((row) => row.month)).size !== 24) return false;
  if (rows.some((row) => row.bankCertificationStatus !== "provisional" || row.certificationReference != null || (row.accountRole === "joint" && row.ownerRole != null))) return false;
  const expenseTotalMinor = rows.filter((row) => row.entryType === "expense").reduce((sum, row) => sum + row.amountMinor, 0);
  if (expenseTotalMinor !== expected.expenseTotalMinor) return false;
  const actualMonthTotals = Object.fromEntries(fixture.months.map((month) => [month, rows.filter((row) => row.month === month && row.entryType === "expense").reduce((sum, row) => sum + row.amountMinor, 0)]));
  if (JSON.stringify(actualMonthTotals) !== JSON.stringify(expected.monthTotals)) return false;
  if (rows.length === 10_000 && rows.filter((row) => row.month === LARGE_MONTH).length !== 2_000) return false;
  return splitGroups?.every((group) => (
    ["USD", "EUR"].includes(group.currency)
    && group.shares.reduce((sum, share) => sum + share.amountMinor, 0) === group.totalAmountMinor
    && group.shares.reduce((sum, share) => sum + share.ratioBasisPoints, 0) === 10_000
  )) ?? false;
}
