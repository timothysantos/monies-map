function normalizeRecord(value) {
  if (!value) {
    return {};
  }

  if (value instanceof URLSearchParams) {
    return Object.fromEntries([...value.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
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
  bootstrap(params) {
    return ["bootstrap", normalizeRecord(params)];
  },
  routePage(request) {
    return ["route-page", normalizeRouteRequest(request)];
  },
  entriesPage(params) {
    return ["entries-page", normalizeRecord(params)];
  },
  monthPage({ viewId, month, scope }) {
    return ["month-page", normalizeRecord({ viewId, month, scope })];
  },
  summaryPage({ viewId, startMonth, endMonth }) {
    return ["summary-page", normalizeRecord({ viewId, startMonth, endMonth })];
  },
  importPreview({ accountId, fileName, fileHash }) {
    return ["import-preview", normalizeRecord({ accountId, fileName, fileHash })];
  },
  accountHealth({ accountId, month }) {
    return ["account-health", normalizeRecord({ accountId, month })];
  }
};
