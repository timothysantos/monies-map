// A transaction link returns to the entry's own month and opens its editor.
// It is still protected by the household's normal sign-in and permissions.
export function buildEntryDeepLink(location, { entryId, month, viewId = "household" }) {
  const url = new URL("/entries", location?.origin ?? "https://monies-map.local");
  url.searchParams.set("view", viewId);
  url.searchParams.set("month", month);
  url.searchParams.set("editing_entry", entryId);
  return url.toString();
}
