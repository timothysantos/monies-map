export function entryBypassesFieldFilters(entryId, pinnedEntryIds = []) {
  return pinnedEntryIds.filter(Boolean).includes(entryId);
}
