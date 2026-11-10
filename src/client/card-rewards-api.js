// Cards and rewards on the client (DOMAIN.md "Card reward rule"): Summary's
// "Miles and cashback" read, Settings' card list, and the changes. Answers
// are facts (names, rates, cents, entry ids); the words come from
// copy/card-rewards-copy.js. No AI.

export function cardRewardsEndpoint(viewId) {
  return `/api/card-rewards?${new URLSearchParams({ view: viewId || "household" }).toString()}`;
}

const isList = (value) => Array.isArray(value);

// The answer as the client keeps it, or null for a body that is not one
// (the caller treats it as a failed read and shows nothing).
export function readCardRewards(body) {
  if (!body || typeof body !== "object" || typeof body.today !== "string" || !isList(body.people)) {
    return null;
  }
  const people = body.people.filter((person) => person && typeof person.personId === "string" && isList(person.cards)).map((person) => ({
    personId: person.personId,
    name: typeof person.name === "string" ? person.name : "",
    cards: person.cards.filter((card) => card && typeof card.accountId === "string" && Number.isFinite(card.earned) && isList(card.ids) && isList(card.bonuses)),
    best: isList(person.best) ? person.best : [],
    notices: isList(person.notices) ? person.notices : [],
    lookingBack: isList(person.lookingBack) ? person.lookingBack : []
  }));
  return {
    viewId: typeof body.viewId === "string" ? body.viewId : "household",
    today: body.today,
    suggestFrom: body.suggestFrom === "own" ? "own" : "household",
    people,
    notSetUp: Number.isFinite(body.notSetUp) ? body.notSetUp : 0
  };
}

// Throws on any failure, so a failed read is never kept as an answer.
export async function requestCardRewards(viewId, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(cardRewardsEndpoint(viewId), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Miles and cashback request failed (${response.status}).`);
  }
  const answer = readCardRewards(await response.json().catch(() => null));
  if (!answer) {
    throw new Error("Miles and cashback answer was unreadable.");
  }
  return answer;
}

// Settings' list: { suggestFrom, cards }, or null.
export async function requestCardRewardRules({ signal = undefined, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl("/api/card-rewards/rules", { cache: "no-store", signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body && isList(body.cards) ? { suggestFrom: body.suggestFrom === "own" ? "own" : "household", cards: body.cards } : null;
  } catch {
    return null;
  }
}

async function post(path, body, fetchImpl) {
  const fallbackError = "That didn't save. Try again.";
  try {
    const response = await fetchImpl(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    return response.ok && data?.ok ? data : { ok: false, error: data?.error || fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

// { action: save | reset | restore, accountId, rules? } -> { ok, previous, current } or { ok: false, error }; never throws.
export function saveCardRewardRules(body, { fetchImpl = fetch } = {}) {
  return post("/api/card-rewards/rules", body, fetchImpl);
}

// "household" | "own" -> { ok, previous, current } or { ok: false, error }.
export function saveCardRewardSuggestFrom(from, { fetchImpl = fetch } = {}) {
  return post("/api/card-rewards/suggest-from", { from }, fetchImpl);
}
