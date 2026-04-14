import { RECENT_IMPORTS_PAGE_SIZE } from "./import-history";

export function buildRecentImportModel(recentImports, recentImportPage) {
  const pageCount = Math.max(1, Math.ceil(recentImports.length / RECENT_IMPORTS_PAGE_SIZE));
  const startIndex = (recentImportPage - 1) * RECENT_IMPORTS_PAGE_SIZE;
  const paginatedRecentImports = recentImports.slice(startIndex, startIndex + RECENT_IMPORTS_PAGE_SIZE);
  const start = recentImports.length ? startIndex + 1 : 0;
  const end = Math.min(recentImportPage * RECENT_IMPORTS_PAGE_SIZE, recentImports.length);

  return {
    end,
    groups: groupRecentImportsByDate(paginatedRecentImports),
    pageCount,
    start
  };
}

function groupRecentImportsByDate(recentImports) {
  const grouped = new Map();
  for (const item of recentImports) {
    const dateKey = item.importedAt.slice(0, 10);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey).push(item);
  }
  return Array.from(grouped.entries()).map(([date, items]) => ({ date, items }));
}
