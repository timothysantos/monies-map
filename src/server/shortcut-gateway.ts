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

// SHA-256 both sides, then compare every byte, so the time taken does not
// depend on how much of a guess is right.
export async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

// The person's connection a Shortcut key belongs to, or none. Every key is
// compared (no early exit), so a response is not quicker for the first
// person's key. A connection with no key never matches.
export async function findShortcutConnectionByKey<T extends { apiKey: string }>(
  connections: T[],
  providedKey: string
): Promise<T | null> {
  let match: T | null = null;
  for (const connection of connections) {
    const equal = await constantTimeEqual(connection.apiKey, providedKey);
    if (equal && connection.apiKey) {
      match = connection;
    }
  }
  return match;
}
