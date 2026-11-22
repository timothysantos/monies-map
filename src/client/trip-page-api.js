// The trip page's two reads (GET /api/trip-page; src/domain/trip-page-projection.ts):
// the page itself, and one day's entries when the page opens that day. No
// writes, no AI. Each answer is checked into the shape the page reads; an
// answer that is not one throws, so the page shows its retry.

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isText = (value) => typeof value === "string";
const ids = (value) => (Array.isArray(value) ? value.filter(isText) : []);

function readEntry(item) {
  if (!isObject(item) || !isText(item.id) || !isText(item.date) || !isText(item.name) || !isFiniteNumber(item.amountMinor)) return null;
  return {
    id: item.id,
    date: item.date,
    name: item.name,
    amountMinor: item.amountMinor,
    entryType: item.entryType === "income" ? "income" : "expense",
    categoryName: isText(item.categoryName) ? item.categoryName : "Other",
    payerName: isText(item.payerName) ? item.payerName : "",
    estimate: isObject(item.estimate) && isFiniteNumber(item.estimate.amountMinor) && isText(item.estimate.currency)
      ? { amountMinor: item.estimate.amountMinor, currency: item.estimate.currency }
      : null
  };
}

const readEntries = (list) => (Array.isArray(list) ? list.map(readEntry).filter((entry) => entry !== null) : []);

/**
 * The page as it reads it; null for a trip that is gone (or not this
 * household's). Throws when the answer is not one.
 */
export function readTripPage(body) {
  if (!isObject(body) || body.ok !== true || !("tripPage" in body)) throw new Error("The trip page answer was not one.");
  const page = body.tripPage;
  if (page === null) return null;
  if (!isObject(page) || !isObject(page.tripEvent) || !isText(page.tripEvent.id) || !isText(page.tripEvent.name) || !isFiniteNumber(page.spentMinor)) {
    throw new Error("The trip page answer was not one.");
  }
  const trip = page.tripEvent;
  return {
    tripEvent: {
      id: trip.id,
      name: trip.name,
      iconKey: isText(trip.iconKey) ? trip.iconKey : "star",
      startDate: isText(trip.startDate) ? trip.startDate : undefined,
      endDate: isText(trip.endDate) ? trip.endDate : undefined,
      currency: isText(trip.currency) ? trip.currency : undefined,
      splitGroupId: isText(trip.splitGroupId) ? trip.splitGroupId : undefined,
      splitGroupName: isText(trip.splitGroupName) ? trip.splitGroupName : undefined
    },
    firstDate: isText(page.firstDate) ? page.firstDate : "",
    lastDate: isText(page.lastDate) ? page.lastDate : "",
    entryCount: isFiniteNumber(page.entryCount) ? page.entryCount : 0,
    spentMinor: page.spentMinor,
    estimateCount: isFiniteNumber(page.estimateCount) ? page.estimateCount : 0,
    days: (Array.isArray(page.days) ? page.days : [])
      .filter((row) => isObject(row) && isText(row.day) && isFiniteNumber(row.amountMinor))
      .map((row) => ({ day: row.day, amountMinor: row.amountMinor, entryIds: ids(row.entryIds) })),
    categories: (Array.isArray(page.categories) ? page.categories : [])
      .filter((row) => isObject(row) && isText(row.categoryName) && isFiniteNumber(row.amountMinor))
      .map((row) => ({ categoryName: row.categoryName, categoryId: isText(row.categoryId) ? row.categoryId : undefined, amountMinor: row.amountMinor, entryCount: isFiniteNumber(row.entryCount) ? row.entryCount : 0 })),
    payers: (Array.isArray(page.payers) ? page.payers : [])
      .filter((row) => isObject(row) && isFiniteNumber(row.amountMinor))
      .map((row) => ({ personId: isText(row.personId) ? row.personId : "", name: isText(row.name) ? row.name : "", amountMinor: row.amountMinor, entryIds: ids(row.entryIds) })),
    biggest: readEntries(page.biggest),
    owed: isObject(page.owed)
      ? {
        splitGroupId: isText(page.owed.splitGroupId) ? page.owed.splitGroupId : "",
        onSplitsCount: isFiniteNumber(page.owed.onSplitsCount) ? page.owed.onSplitsCount : 0,
        debts: (Array.isArray(page.owed.debts) ? page.owed.debts : [])
          .filter((debt) => isObject(debt) && isText(debt.fromName) && isText(debt.toName) && isFiniteNumber(debt.amountMinor))
          .map((debt) => ({ fromName: debt.fromName, toName: debt.toName, amountMinor: debt.amountMinor }))
      }
      : null,
    firmness: readFirmness(page.firmness),
    needsLook: (Array.isArray(page.needsLook) ? page.needsLook : []).map(readLookItem).filter((item) => item !== null)
  };
}

const FIRMNESS_PARTS = new Set(["confirmed", "waiting", "estimate"]);
const LOOK_REASONS = new Set(["no_amount", "maybe_copy", "shared_not_on_splits", "splits_no_group", "old_estimate", "other_category"]);

// How firm Spent is: the parts the server sent (the one without ids is
// worked out by trip-page-model.js), and the payments with no amount yet.
function readFirmness(value) {
  if (!isObject(value)) return { parts: [], noAmountCount: 0 };
  return {
    parts: (Array.isArray(value.parts) ? value.parts : [])
      .filter((part) => isObject(part) && FIRMNESS_PARTS.has(part.part) && isFiniteNumber(part.amountMinor))
      .map((part) => ({ part: part.part, amountMinor: part.amountMinor, ...(Array.isArray(part.entryIds) ? { entryIds: ids(part.entryIds) } : {}) })),
    noAmountCount: isFiniteNumber(value.noAmountCount) ? value.noAmountCount : 0
  };
}

// One "Needs a look" line; a reason the page has no words for is dropped.
function readLookItem(item) {
  if (!isObject(item) || !LOOK_REASONS.has(item.reason) || !isText(item.id) || !isText(item.date) || !isText(item.name)) return null;
  if (item.reason === "maybe_copy" && (!isText(item.otherId) || !isText(item.otherName))) return null;
  return {
    reason: item.reason,
    id: item.id,
    date: item.date,
    name: item.name,
    ...(isText(item.otherId) ? { otherId: item.otherId, otherName: item.otherName } : {}),
    ...(isFiniteNumber(item.days) ? { days: item.days } : {}),
    ...(isText(item.personName) ? { personName: item.personName } : {})
  };
}

/** One day's entries, or null for a trip or day that is not one. */
export function readTripDay(body) {
  if (!isObject(body) || body.ok !== true || !("tripDay" in body)) throw new Error("The trip day answer was not one.");
  if (body.tripDay === null) return null;
  if (!isObject(body.tripDay) || !isText(body.tripDay.day)) throw new Error("The trip day answer was not one.");
  return { day: body.tripDay.day, entries: readEntries(body.tripDay.entries) };
}

async function getJson(path, { signal, fetchImpl }) {
  const response = await fetchImpl(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`The trip page answered ${response.status}.`);
  return response.json();
}

export async function requestTripPage({ tripId, signal = undefined, fetchImpl = fetch }) {
  return readTripPage(await getJson(`/api/trip-page?${new URLSearchParams({ trip: tripId }).toString()}`, { signal, fetchImpl }));
}

export async function requestTripDay({ tripId, day, signal = undefined, fetchImpl = fetch }) {
  return readTripDay(await getJson(`/api/trip-page?${new URLSearchParams({ trip: tripId, day }).toString()}`, { signal, fetchImpl }));
}
