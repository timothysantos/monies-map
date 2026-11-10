// GET /api/investments-over-time and GET /api/tax-reliefs on the client
// (DOMAIN.md "Investments Over Time" and "Tax Relief"): the requests, and
// readers that keep only what they understand. The answers are read-only
// facts (names, dates, minor amounts, entry ids); the words come from
// copy/summary-cards-copy.js.

const isAmount = (value) => value && typeof value === "object" && Number.isFinite(value.amountMinor) && Array.isArray(value.ids);
const isMonth = (value) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value);

function endpoint(path, viewId) {
  return `${path}?${new URLSearchParams({ view: viewId || "household" }).toString()}`;
}

async function request(path, viewId, read, label, { signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint(path, viewId), { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status}).`);
  }
  const answer = read(await response.json().catch(() => null));
  if (!answer) {
    throw new Error(`${label} answer was unreadable.`);
  }
  return answer;
}

function readInvestmentRow(row) {
  if (!row || typeof row !== "object" || typeof row.accountId !== "string" || typeof row.name !== "string"
    || !Number.isFinite(row.worthMinor) || !Number.isFinite(row.grewMinor) || !isAmount(row.putIn)) {
    return null;
  }
  return row;
}

// The answer as the client keeps it, or null for a body that is not one.
// No account means nothing to show (`accounts: []`).
export function readInvestmentsOverTime(body) {
  if (!body || typeof body !== "object" || typeof body.today !== "string" || !Array.isArray(body.accounts)) {
    return null;
  }
  const accounts = body.accounts.map(readInvestmentRow).filter(Boolean);
  if (!accounts.length || !isAmount(body.putIn) || !Array.isArray(body.months)) {
    return { viewId: typeof body.viewId === "string" ? body.viewId : "household", today: body.today, accounts: [] };
  }
  return {
    viewId: typeof body.viewId === "string" ? body.viewId : "household",
    today: body.today,
    year: String(body.year ?? body.today.slice(0, 4)),
    asOfDate: String(body.asOfDate ?? ""),
    worthMinor: Number(body.worthMinor) || 0,
    startWorthMinor: Number(body.startWorthMinor) || 0,
    putIn: body.putIn,
    grewMinor: Number(body.grewMinor) || 0,
    paidOutMinor: Number(body.paidOutMinor) || 0,
    months: body.months.filter((month) => month && isMonth(month.month) && Number.isFinite(month.putInMinor)),
    accounts
  };
}

export function requestInvestmentsOverTime(viewId, options = {}) {
  return request("/api/investments-over-time", viewId, readInvestmentsOverTime, "Investments", options);
}

const RELIEF_KEYS = new Set(["srs", "cpf_self", "cpf_family"]);

function readPerson(person) {
  if (!person || typeof person !== "object" || typeof person.personId !== "string" || typeof person.name !== "string" || !Array.isArray(person.reliefs)) {
    return null;
  }
  const reliefs = person.reliefs.filter((relief) => relief && RELIEF_KEYS.has(relief.key) && isAmount(relief) && Number.isFinite(relief.limitMinor));
  return { ...person, reliefs, charity: isAmount(person.charity) ? person.charity : { amountMinor: 0, ids: [], deductionMinor: 0 } };
}

export function readTaxReliefs(body) {
  if (!body || typeof body !== "object" || typeof body.today !== "string" || !Array.isArray(body.people)) {
    return null;
  }
  return {
    viewId: typeof body.viewId === "string" ? body.viewId : "household",
    today: body.today,
    year: String(body.year ?? body.today.slice(0, 4)),
    daysLeft: Number.isFinite(body.daysLeft) ? body.daysLeft : 0,
    limitsYear: String(body.limitsYear ?? ""),
    limitsFallback: body.limitsFallback === true,
    charityTimes: Number(body.charityTimes) || 0,
    people: body.people.map(readPerson).filter(Boolean)
  };
}

export function requestTaxReliefs(viewId, options = {}) {
  return request("/api/tax-reliefs", viewId, readTaxReliefs, "Tax reliefs", options);
}
