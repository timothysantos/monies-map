export function isShortcutGatewayRequestAllowed(
  shortcutApiOnly: string | undefined,
  pathname: string,
  shortcutEndpointPath: string
) {
  return shortcutApiOnly !== "true" || pathname === shortcutEndpointPath;
}

export function isShortcutCreateRequestAllowed(
  pathname: string,
  method: string,
  shortcutEndpointPath: string
) {
  return pathname !== shortcutEndpointPath || method === "POST";
}

export function buildShortcutAppUrl(
  pathname: string,
  requestUrl: string,
  configuredAppOrigin?: string
) {
  return new URL(pathname, configuredAppOrigin?.trim() || requestUrl);
}

// Where the Apple Pay Shortcut's "open the new entry" goes: the Ask page
// with that saved entry's card and its follow-ups (a category when it
// landed in Other, Splits). Shortcuts installed before keep working: they
// open whatever URL this returns, and the Entries link they used before
// (/entries?editing_entry=<id>) still opens the entry in Entries.
export function buildShortcutEntryOpenUrl(
  request: Request,
  input: {
    entryId: string;
    date?: string;
    viewId?: string;
    accountId?: string;
    accountName?: string;
  },
  appOrigin?: string
) {
  const url = buildShortcutAppUrl("/ask", request.url, appOrigin);
  url.searchParams.set("saved_entry", input.entryId);
  if (input.date?.slice(0, 7)) {
    url.searchParams.set("month", input.date.slice(0, 7));
  }
  url.searchParams.set("view", input.viewId || "household");
  url.searchParams.set("from", "shortcut");
  return url.toString();
}
