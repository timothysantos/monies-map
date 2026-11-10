// GET /api/summary-changed on the client (DOMAIN.md "What Changed Card"): the
// request, and a reader that keeps only what it understands. The answer is
// read-only facts (names, minor amounts, entry ids); the words come from
// copy/summary-changed-copy.js.

export function summaryChangedEndpoint(viewId, scope) {
  const params = new URLSearchParams({ view: viewId || "household" });
  if (scope && viewId && viewId !== "household") {
    params.set("scope", scope);
  }
  return `/api/summary-changed?${params.toString()}`;
}

const isIds = (value) => Array.isArray(value) && value.every((id) => typeof id === "string");

function readShop(shop) {
  if (!shop || typeof shop.name !== "string" || !Number.isFinite(shop.diffMinor) || !Number.isFinite(shop.amountMinor) || !isIds(shop.ids)) {
    return null;
  }
  return { name: shop.name, diffMinor: shop.diffMinor, amountMinor: shop.amountMinor, ids: shop.ids };
}

function readRow(row) {
  if (!row || typeof row.category !== "string" || (row.direction !== "up" && row.direction !== "down")
    || !Number.isFinite(row.diffMinor) || !Number.isFinite(row.amountMinor) || !Number.isFinite(row.baseMinor)
    || !isIds(row.ids) || !isIds(row.baseIds)) {
    return null;
  }
  return {
    category: row.category,
    direction: row.direction,
    diffMinor: row.diffMinor,
    amountMinor: row.amountMinor,
    ids: row.ids,
    baseMinor: row.baseMinor,
    baseIds: row.baseIds,
    moreThanUsual: row.moreThanUsual === true,
    shops: Array.isArray(row.shops) ? row.shops.map(readShop).filter(Boolean) : []
  };
}

// The answer as the client keeps it: { changed: null } when there is nothing
// to compare, or null for a body that is not an answer (a failed read).
export function readSummaryChanged(body) {
  if (!body || typeof body !== "object" || !("changed" in body)) {
    return null;
  }
  const changed = body.changed;
  if (changed === null) {
    return { changed: null };
  }
  if (!changed || typeof changed.month !== "string" || typeof changed.baseMonth !== "string" || !Number.isFinite(changed.day) || !Array.isArray(changed.rows)) {
    return null;
  }
  return { changed: { month: changed.month, baseMonth: changed.baseMonth, day: changed.day, rows: changed.rows.map(readRow).filter(Boolean) } };
}

// Throws on any failure, so a failed read is never kept as an answer.
export async function requestSummaryChanged(viewId, scope, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(summaryChangedEndpoint(viewId, scope), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`What changed request failed (${response.status}).`);
  }
  const answer = readSummaryChanged(await response.json().catch(() => null));
  if (!answer) {
    throw new Error("What changed answer was unreadable.");
  }
  return answer;
}
