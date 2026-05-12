/**
 * @module QueryKeyManager
 * @purpose Deterministic React Query key generation.
 * @logic Sorts params alphabetically to ensure consistent cache IDs.
 * @prevents Duplicate fetches caused by object key reordering.
 */


function normalizeRecord(value) {
  // 1. Guard clause: If the value is null/undefined, return an empty object
  if (!value) {
    return {};
  }

  // 2. Handle URLSearchParams (e.g., ?name=tim&age=25)
  if (value instanceof URLSearchParams) {
    return Object.fromEntries(
      [...value.entries()] // Convert iterator to an array of [key, value] pairs
      .sort(([left], [right]) => left.localeCompare(right)) // Sort by key name
    );
  }

  // 3. Handle Standard Objects
  return Object.fromEntries(
    Object.entries(value) // Convert {b: 2, a: 1} into [['b', 2], ['a', 1]]
      // Filter out 'undefined' values so they don't affect the cache key
      .filter(([, entryValue]) => entryValue !== undefined) 
      // .sort(): Alphabetize the keys (e.g., 'a' comes before 'b')
      // .localeCompare(): A robust way to compare strings (handles accents/casing)
      .sort(([left], [right]) => left.localeCompare(right)) 
  );
}

function normalizeRouteRequest(request) {
  if (!request) {
    return { path: "", params: {} };
  }

  return {
    path: request.path ?? "",
    params: normalizeRecord(request.params)
  };
}

export const queryKeys = {
  appShell(params) {
    return ["app-shell", normalizeRecord(params)];
  },
  routePage(request) {
    return ["route-page", normalizeRouteRequest(request)];
  },
  entriesPage(params) {
    return ["entries-page", normalizeRecord(params)];
  },
  splitsPage(params) {
    return ["splits-page", normalizeRecord(params)];
  },
  importsPage() {
    return ["imports-page"];
  },
  monthPage({ viewId, month, scope }) {
    return ["month-page", normalizeRecord({ viewId, month, scope })];
  },
  summaryPage({ viewId, scope, startMonth, endMonth }) {
    return ["summary-page", normalizeRecord({ viewId, scope, startMonth, endMonth })];
  },
  summaryAccountPills({ viewId }) {
    return ["summary-account-pills", normalizeRecord({ viewId })];
  },
  importPreview({ accountId, fileName, fileHash }) {
    return ["import-preview", normalizeRecord({ accountId, fileName, fileHash })];
  },
  accountHealth({ accountId, month }) {
    return ["account-health", normalizeRecord({ accountId, month })];
  }
};
