// GET /api/repeating-charges on the client (DOMAIN.md "Repeating Charge"):
// the request, and a reader that keeps only what it understands. The answer
// is read-only facts (names, dates, minor amounts, entry ids); the words come
// from copy/subscriptions-copy.js.

const STATUSES = new Set(["active", "late", "stopped", "might_repeat", "taken_off"]);

export function repeatingChargesEndpoint(viewId, scope) {
  const params = new URLSearchParams({ view: viewId || "household" });
  if (scope && viewId && viewId !== "household") {
    params.set("scope", scope);
  }
  return `/api/repeating-charges?${params.toString()}`;
}

const isAmount = (value) => value && typeof value === "object" && Number.isFinite(value.amountMinor) && Array.isArray(value.ids);

function readSeries(item) {
  if (!item || typeof item !== "object" || typeof item.key !== "string" || typeof item.name !== "string"
    || !STATUSES.has(item.status) || !isAmount(item.latest) || !isAmount(item.year) || !isAmount(item.focus)) {
    return null;
  }
  return item;
}

const readList = (list) => (Array.isArray(list) ? list.map(readSeries).filter(Boolean) : []);

// The answer as the client keeps it, or null for a body that is not one (the
// caller treats it as a failed read and shows nothing).
export function readRepeatingCharges(body) {
  if (!body || typeof body !== "object" || typeof body.today !== "string" || typeof body.focusMonth !== "string" || !Array.isArray(body.series)) {
    return null;
  }
  return {
    viewId: typeof body.viewId === "string" ? body.viewId : "household",
    scope: typeof body.scope === "string" ? body.scope : "direct_plus_shared",
    today: body.today,
    focusMonth: body.focusMonth,
    yearStartMonth: typeof body.yearStartMonth === "string" ? body.yearStartMonth : body.focusMonth,
    // The month before the focus month, for the change note; null without it.
    focusBeforeMinor: Number.isFinite(body.focusBeforeMinor) ? body.focusBeforeMinor : null,
    series: readList(body.series),
    mightRepeat: readList(body.mightRepeat),
    takenOff: readList(body.takenOff),
    pace: body.pace && typeof body.pace === "object" && typeof body.pace.month === "string" ? body.pace : null
  };
}

// Throws on any failure, so a failed read is never kept as an answer.
export async function requestRepeatingCharges(viewId, scope, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(repeatingChargesEndpoint(viewId, scope), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Subscriptions request failed (${response.status}).`);
  }
  const answer = readRepeatingCharges(await response.json().catch(() => null));
  if (!answer) {
    throw new Error("Subscriptions answer was unreadable.");
  }
  return answer;
}

// POST /api/repeating-charges/choice: keep, take off, show again, rename or
// restore (Undo) one charge. Answers { ok: true, previous, current } or
// { ok: false, error }; never throws.
export async function saveRepeatingChoice(body, { fetchImpl = fetch } = {}) {
  const fallbackError = "That didn't save. Try again.";
  try {
    const response = await fetchImpl("/api/repeating-charges/choice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    return response.ok && data?.ok ? data : { ok: false, error: data?.error || fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}
