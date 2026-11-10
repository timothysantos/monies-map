import { getCurrentMonthKey } from "../../lib/month";
import { buildEntriesContextView } from "../app-shell";
import { adjustEntriesForList } from "../month-projection";
import { buildPersonScopes } from "../person-view-scope";
import {
  loadEntries,
  loadSplitGroups
} from "../app-repository";
import { loadEntriesForMonths } from "../app-repository-entries";
import { getMonthBounds } from "../app-repository-helpers";
import { loadSplitGroupCash, loadTripEventEntrySpan, loadTripEventLinksForDateRange, loadTripEventRowFacts, loadTripEvents } from "../app-repository-trip-events";
import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadEntriesForDateRange } from "../app-repository-entries";
import type { EntriesPageDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth,
  resolvePageViewId
} from "../route-context";
import { resolvePageLabel } from "../page-labels";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
// The longest period Entries lists at once (MAX_ENTRY_RANGE_MONTHS in
// src/client/entry-filter-params.js).
export const MAX_ENTRIES_RANGE_MONTHS = 24;

// The months from `fromMonth` to `month`, oldest first, or [] when that is
// not a period Entries lists (no start, a start not before the month, or
// longer than MAX_ENTRIES_RANGE_MONTHS).
export function entriesRangeMonths(fromMonth: string | null | undefined, month: string): string[] {
  if (!fromMonth || !MONTH_KEY.test(fromMonth) || !MONTH_KEY.test(month) || fromMonth >= month) {
    return [];
  }
  const months: string[] = [];
  let [year, monthNumber] = fromMonth.split("-").map(Number);
  for (let key = fromMonth; key <= month; key = `${year}-${String(monthNumber).padStart(2, "0")}`) {
    months.push(key);
    if (months.length > MAX_ENTRIES_RANGE_MONTHS) {
      return [];
    }
    monthNumber += 1;
    if (monthNumber > 12) {
      monthNumber = 1;
      year += 1;
    }
  }
  return months;
}

// Build the route-owned Entries page DTO without pulling shell-only shape into
// the page module. `fromMonth` (the page's entry_from) lists every month
// from it to the selected month, so a Summary range's figure opens on the
// whole range (design.md "Openable figures"); the DTO then names the
// range's first month as `monthPage.rangeStartMonth`.
export async function buildEntriesPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  fromMonth: string | null = null,
  tripEventId: string | null = null
): Promise<EntriesPageDto> {
  if (tripEventId) {
    return buildTripEventEntriesPageDto(db, selectedViewId, selectedMonth, tripEventId);
  }
  const { household, trackedMonths } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const rangeMonths = entriesRangeMonths(fromMonth, effectiveSelectedMonth);
  // The entries, the split groups and the entries' trips (with the dashed
  // chip's suggestions for new Apple Pay entries on a trip) are read
  // together.
  const [rangeStart] = getMonthBounds(rangeMonths[0] ?? effectiveSelectedMonth);
  const [, rangeEnd] = getMonthBounds(rangeMonths.at(-1) ?? effectiveSelectedMonth);
  const [monthEntries, splitGroups, trips] = await Promise.all([
    rangeMonths.length
      ? loadEntriesForMonths(db, rangeMonths, { withTime: true })
      : loadEntries(db, effectiveSelectedMonth, { withTime: true }),
    loadSplitGroups(db),
    loadTripEventRowFacts(db, rangeStart, rangeEnd, todayInAppTimeZone())
  ]);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = resolvePageViewId(selectedViewId, household.people);
  const label = resolvePageLabel(viewId, personNameById);

  return {
    viewId,
    label,
    splitGroups: [
      { id: "split-group-none", name: "Non-group expenses" },
      ...splitGroups.map((group) => ({
        id: group.id,
        name: group.name
      }))
    ],
    monthPage: {
      month: effectiveSelectedMonth,
      ...(rangeMonths.length ? { rangeStartMonth: rangeMonths[0] } : {}),
      selectedPersonId: viewId,
      selectedScope: viewId === "household" ? "direct_plus_shared" : "direct_plus_shared",
      scopes: buildPersonScopes(viewId),
      entries: withTripEvents(adjustEntriesForList(monthEntries, viewId), trips.links, trips.suggestions)
    },
    ...(Object.keys(trips.chips).length ? { tripEvents: trips.chips } : {})
  };
}

// Each listed entry's trip or event, only where it has one, and the trip a
// new Apple Pay entry might be on (the dashed chip), only where there is one.
function withTripEvents(entries: EntriesPageDto["monthPage"]["entries"], links: Map<string, string>, suggestions: Map<string, string> = new Map()) {
  if (!links.size && !suggestions.size) {
    return entries;
  }
  return entries.map((entry) => {
    const tripEventId = links.get(entry.id);
    if (tripEventId) return { ...entry, tripEventId };
    const suggestedTripEventId = suggestions.get(entry.id);
    return suggestedTripEventId ? { ...entry, suggestedTripEventId } : entry;
  });
}

function dayAfter(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// The trip view (DOMAIN.md "Trip or Event"; the URL's entry_trip): every
// entry on one trip or event, across its months, whatever the page's month
// (which the DTO still echoes, so the page's own month stays as it was).
// `tripEventId` "all" lists the entries of every trip with the whole list,
// for the Trips & events sheet's totals. Bounded by the link table.
async function buildTripEventEntriesPageDto(
  db: D1Database,
  selectedViewId: string,
  selectedMonth: string,
  tripEventId: string
): Promise<EntriesPageDto> {
  const all = tripEventId === "all";
  const [{ household, trackedMonths }, span, list] = await Promise.all([
    loadRoutePageContext(db, selectedViewId),
    loadTripEventEntrySpan(db, all ? "*" : tripEventId),
    loadTripEvents(db)
  ]);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const tripEvent = all ? null : list.tripEvents.find((trip) => trip.id === tripEventId) ?? null;
  // A trip linked to a split group names that group's cash (no entry) in
  // its lead; the sum rides on the links' round trip.
  const splitCashGroupId = tripEvent?.splitGroupId ?? null;
  const [entries, splitGroups, trips] = await Promise.all([
    span && (all || tripEvent)
      ? loadEntriesForDateRange(db, span.first, dayAfter(span.last), { withTime: true, tripEventId: all ? "*" : tripEventId })
      : Promise.resolve([]),
    loadSplitGroups(db),
    span
      ? loadTripEventLinksForDateRange(db, span.first, dayAfter(span.last), { splitCashGroupId })
      : splitCashGroupId
        ? loadSplitGroupCash(db, splitCashGroupId).then((splitCash) => ({ links: new Map<string, string>(), chips: {}, splitCash }))
        : Promise.resolve({ links: new Map<string, string>(), chips: {}, splitCash: [] })
  ]);
  const splitGroupName = splitCashGroupId ? splitGroups.find((group) => group.id === splitCashGroupId)?.name : undefined;
  const leadTrip = tripEvent
    ? { ...tripEvent, ...(trips.splitCash.length ? { splitCash: trips.splitCash } : {}), ...(splitGroupName ? { splitGroupName } : {}) }
    : null;
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = resolvePageViewId(selectedViewId, household.people);
  return {
    viewId,
    label: resolvePageLabel(viewId, personNameById),
    splitGroups: [
      { id: "split-group-none", name: "Non-group expenses" },
      ...splitGroups.map((group) => ({ id: group.id, name: group.name }))
    ],
    monthPage: {
      month: effectiveSelectedMonth,
      selectedPersonId: viewId,
      selectedScope: "direct_plus_shared",
      scopes: buildPersonScopes(viewId),
      entries: withTripEvents(adjustEntriesForList(entries, viewId), trips.links)
    },
    ...(Object.keys(trips.chips).length ? { tripEvents: trips.chips } : {}),
    tripView: all
      ? { all: true, tripEvents: list.tripEvents, ...(span ? { firstDate: span.first, lastDate: span.last } : {}) }
      : { tripEvent: leadTrip, ...(span ? { firstDate: span.first, lastDate: span.last } : {}) }
  };
}
