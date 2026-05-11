import { getCurrentMonthKey } from "../../lib/month";
import {
  adjustEntriesForView,
  buildEntriesContextView,
  buildPersonScopes,
  loadPageShell
} from "../app-shell";
import {
  loadEntries,
  loadSplitGroups
} from "../app-repository";
import type { EntriesPageDto } from "../../types/dto";

// Build the route-owned Entries page DTO without pulling shell-only shape into
// the page module.
export async function buildEntriesPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<EntriesPageDto> {
  const { household, trackedMonths } = await loadPageShell(db, selectedViewId);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const monthEntries = await loadEntries(db, effectiveSelectedMonth);
  const splitGroups = await loadSplitGroups(db);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const label = viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";

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
      selectedPersonId: viewId,
      selectedScope: viewId === "household" ? "direct_plus_shared" : "direct_plus_shared",
      scopes: buildPersonScopes(viewId),
      entries: adjustEntriesForView(monthEntries, viewId)
    }
  };
}
