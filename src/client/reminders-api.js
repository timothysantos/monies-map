// GET /api/reminders on the client: the request, and a reader that keeps only
// what it understands. The answer is read-only facts (kinds, dates, minor
// amounts, names); the words come from copy/reminders-copy.js.

const KINDS = new Set(["card_bill", "statement_missing", "splits_waiting", "price_change", "month_close", "tax_relief"]);

export function remindersEndpoint(viewId) {
  return `/api/reminders?view=${encodeURIComponent(viewId || "household")}`;
}

// The answer as the client keeps it, or null for a body that is not one (the
// caller treats it as a failed read and shows nothing). A reminder of a kind
// this build does not know is left out, so a newer server never breaks an
// older page.
export function readReminders(body) {
  if (!body || typeof body !== "object" || typeof body.today !== "string" || !Array.isArray(body.reminders)) {
    return null;
  }
  const reminders = body.reminders.filter((item) => (
    item && typeof item === "object" && typeof item.key === "string" && KINDS.has(item.kind)
  ));
  return { viewId: typeof body.viewId === "string" ? body.viewId : "household", today: body.today, reminders };
}

// Throws on any failure, so a failed read is never kept as an answer.
export async function requestReminders(viewId, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(remindersEndpoint(viewId), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Reminders request failed (${response.status}).`);
  }
  const answer = readReminders(await response.json().catch(() => null));
  if (!answer) {
    throw new Error("Reminders answer was unreadable.");
  }
  return answer;
}
