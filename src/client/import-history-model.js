import { RECENT_IMPORTS_PAGE_SIZE } from "./recent-imports-page-size";
import { getAccountSelectOptions } from "./account-display";
import { importMessages } from "./copy/en-SG-imports";
import { formatDateOnly } from "./formatters";

const EARLIER_IMPORT_LIMIT = 5;

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

export function getRecentImportAccountOptions(recentImports, accounts = []) {
  const accountLabels = new Set();
  for (const option of getAccountSelectOptions(accounts)) {
    accountLabels.add(option.label);
  }

  for (const item of recentImports) {
    for (const accountName of item.accountNames ?? []) {
      accountLabels.add(accountName);
    }
  }

  return Array.from(accountLabels).sort((left, right) => left.localeCompare(right));
}

// Batch account names and dropdown values are both "Account - Owner"
// labels, so the match is exact: two people's accounts can share a name
// ("UOB One - Tim", "UOB One - Joyce") and must not match each other.
export function filterRecentImportsByAccount(recentImports, accountFilter) {
  if (!accountFilter) {
    return recentImports;
  }

  const filterKey = normalizeRecentImportAccountKey(accountFilter);
  return recentImports.filter((item) => (
    item.accountNames?.some((accountName) => normalizeRecentImportAccountKey(accountName) === filterKey)
  ));
}

function normalizeRecentImportAccountKey(value) {
  return String(value ?? "").trim().toLowerCase();
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

// The imports saved before the one just committed, newest first, so the
// commit notice can list them under the file it names: accounts, the dates
// their rows cover, and the file's label. Rolled-back imports are left out.
export function buildEarlierImportLines(recentImports, committedImportId, limit = EARLIER_IMPORT_LIMIT) {
  return recentImports
    .filter((item) => item.id !== committedImportId && item.status === "completed")
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      text: importMessages.recentEarlierItem({
        accountNames: item.accountNames ?? [],
        period: item.startDate && item.endDate
          ? item.startDate === item.endDate
            ? formatDateOnly(item.startDate)
            : importMessages.donePeriod(formatDateOnly(item.startDate), formatDateOnly(item.endDate))
          : "",
        sourceLabel: item.sourceLabel
      })
    }));
}
