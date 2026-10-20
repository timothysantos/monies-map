import { getCurrentMonthKey } from "../../lib/month";
import { buildEntriesContextView } from "../app-shell";
import { adjustEntriesForList } from "../month-projection";
import { buildPersonScopes } from "../person-view-scope";
import {
  loadEntries,
  loadSplitGroups
} from "../app-repository";
import { loadEntriesForMonths } from "../app-repository-entries";
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
  fromMonth: string | null = null
): Promise<EntriesPageDto> {
  const { household, trackedMonths } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const rangeMonths = entriesRangeMonths(fromMonth, effectiveSelectedMonth);
  const monthEntries = rangeMonths.length
    ? await loadEntriesForMonths(db, rangeMonths, { withTime: true })
    : await loadEntries(db, effectiveSelectedMonth, { withTime: true });
  const splitGroups = await loadSplitGroups(db);
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
      entries: adjustEntriesForList(monthEntries, viewId)
    }
  };
}
