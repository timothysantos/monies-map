export const SETTINGS_TRANSFER_PAGE_SIZE = 6;

export function buildSettingsTransferReviewModel(transfers, selectedMonth, requestedPage, pageSize = SETTINGS_TRANSFER_PAGE_SIZE) {
  const monthGroups = groupTransfersByMonth(transfers);
  const activeMonth = monthGroups.some((group) => group.month === selectedMonth)
    ? selectedMonth
    : monthGroups[0]?.month;
  const activeTransfers = activeMonth
    ? transfers.filter((item) => getTransferMonth(item) === activeMonth)
    : transfers;
  const pageCount = Math.max(1, Math.ceil(activeTransfers.length / pageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), pageCount);
  const pageStart = (currentPage - 1) * pageSize;

  return {
    monthGroups,
    activeMonth,
    activeTransfers,
    visibleTransfers: activeTransfers.slice(pageStart, pageStart + pageSize),
    currentPage,
    pageCount,
    truncatedDescriptionCount: transfers.filter((item) => item.descriptionTruncated).length
  };
}

function groupTransfersByMonth(transfers) {
  const groups = new Map();
  for (const item of transfers) {
    const month = getTransferMonth(item);
    groups.set(month, (groups.get(month) ?? 0) + 1);
  }

  return Array.from(groups.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((first, second) => second.month.localeCompare(first.month));
}

function getTransferMonth(item) {
  return item.date.slice(0, 7);
}
