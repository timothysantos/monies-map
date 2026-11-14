// GET /api/month-wrap-up on the client (DOMAIN.md "Month Wrap-up"): the
// request, and a reader that keeps only what it understands. The answer is
// read-only facts (names, minor amounts, entry ids); the words come from
// copy/month-wrap-up-copy.js.

export function monthWrapUpEndpoint(viewId, scope, month) {
  const params = new URLSearchParams({ view: viewId || "household", month: month || "" });
  if (scope && viewId && viewId !== "household") {
    params.set("scope", scope);
  }
  return `/api/month-wrap-up?${params.toString()}`;
}

const isIds = (value) => Array.isArray(value) && value.every((id) => typeof id === "string");
const isMinor = (value) => Number.isFinite(value);

function readChangedRow(row) {
  if (!row || typeof row.category !== "string" || (row.direction !== "up" && row.direction !== "down") || !isMinor(row.diffMinor) || !isMinor(row.amountMinor) || !isIds(row.ids)) {
    return null;
  }
  return { category: row.category, direction: row.direction, diffMinor: row.diffMinor, amountMinor: row.amountMinor, ids: row.ids };
}

function readBalance(balance) {
  if (!balance || typeof balance.id !== "string" || typeof balance.name !== "string" || typeof balance.owes !== "string"
    || !isMinor(balance.balanceMinor) || balance.balanceMinor === 0 || !["owed_to_you", "you_owe", "between"].includes(balance.direction)) {
    return null;
  }
  return { id: balance.id, name: balance.name, currency: typeof balance.currency === "string" ? balance.currency : "SGD", balanceMinor: balance.balanceMinor, owes: balance.owes, direction: balance.direction };
}

const readIdsWithAmount = (value) => (value && isIds(value.ids) && isMinor(value.amountMinor) ? { ids: value.ids, amountMinor: value.amountMinor } : null);

// The answer as the client keeps it: { wrapUp: null } when the month has
// nothing to wrap up, or null for a body that is not an answer (a failed read).
export function readMonthWrapUp(body) {
  if (!body || typeof body !== "object" || !("wrapUp" in body)) {
    return null;
  }
  const wrapUp = body.wrapUp;
  if (wrapUp === null) {
    return { wrapUp: null };
  }
  const other = readIdsWithAmount(wrapUp?.other);
  const estimates = readIdsWithAmount(wrapUp?.estimates);
  const statements = wrapUp?.statements;
  const splits = wrapUp?.splits;
  if (typeof wrapUp?.month !== "string" || !other || !estimates
    || !statements || !Number.isInteger(statements.accountCount) || !Array.isArray(statements.missing)
    || !splits || !Array.isArray(splits.balances) || !isIds(splits.usuallySharedIds)) {
    return null;
  }
  const changed = wrapUp.changed && typeof wrapUp.changed.baseMonth === "string" && Array.isArray(wrapUp.changed.rows)
    ? { baseMonth: wrapUp.changed.baseMonth, rowCount: Number(wrapUp.changed.rowCount) || 0, rows: wrapUp.changed.rows.map(readChangedRow).filter(Boolean) }
    : null;
  return {
    wrapUp: {
      month: wrapUp.month,
      changed: changed?.rows.length ? changed : null,
      other,
      estimates,
      statements: {
        accountCount: statements.accountCount,
        missing: statements.missing.filter((file) => file && typeof file.id === "string" && typeof file.name === "string").map((file) => ({ id: file.id, name: file.name }))
      },
      splits: { balances: splits.balances.map(readBalance).filter(Boolean), usuallySharedIds: splits.usuallySharedIds }
    }
  };
}

// Throws on any failure, so a failed read is never kept as an answer.
export async function requestMonthWrapUp(viewId, scope, month, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(monthWrapUpEndpoint(viewId, scope, month), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Month wrap-up request failed (${response.status}).`);
  }
  const answer = readMonthWrapUp(await response.json().catch(() => null));
  if (!answer) {
    throw new Error("Month wrap-up answer was unreadable.");
  }
  return answer;
}
