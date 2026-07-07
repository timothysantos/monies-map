export function normalizeEntryFilterValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)));
}

export function categoryMatchesEntryFilter(categoryName, categoryFilters) {
  return !categoryFilters?.length || categoryFilters.includes(categoryName);
}

export function countActiveEntryFilters(entryFilters) {
  return (entryFilters.wallets?.length ? 1 : 0)
    + (entryFilters.categories?.length ? 1 : 0)
    + (entryFilters.entryIds?.length ? 1 : 0)
    + (entryFilters.type ? 1 : 0);
}
