// The waiting tap card's two writes (src/server/shortcut-entry-route.ts):
// Save runs the Apple Pay Shortcut's own save with the typed amount, and
// Not a payment removes the tap. Both answer { ok: true, ... } or
// { ok: false, error } and never throw.

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postJson(path, body, fallbackError) {
  try {
    const response = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    return response.ok && data?.ok !== false ? { ...(data ?? {}), ok: true } : { ok: false, error: data?.error || fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

export function completeWaitingTap({ tapId, amount, currency }, fallbackError) {
  return postJson("/api/waiting-taps/complete", { tapId, amount, currency }, fallbackError);
}

export function removeWaitingTap(tapId, fallbackError) {
  return postJson("/api/waiting-taps/remove", { tapId }, fallbackError);
}

// What the amount field holds, ready to send, or "" when it is not an
// amount: figures with at most one decimal point, commas allowed as
// thousands marks, never zero.
export function readTypedAmount(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?$/.test(text) || !/[1-9]/.test(text)) {
    return "";
  }
  return text;
}
