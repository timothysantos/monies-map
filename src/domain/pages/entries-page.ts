import { getCurrentMonthKey } from "../../lib/month";
import {
  adjustEntriesForView,
  buildEntriesContextView,
  buildPersonScopes,
} from "../app-shell";
import {
  loadEntries,
  loadSplitGroups
} from "../app-repository";
import type { EntriesPageDto } from "../../types/dto";
import {
  loadRoutePageContext,
  resolveEffectiveMonth,
  resolvePageLabel,
  resolvePageViewId
} from "../page-shared";

// Build the route-owned Entries page DTO without pulling shell-only shape into
// the page module.
export async function buildEntriesPageDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey()
): Promise<EntriesPageDto> {
  const { household, trackedMonths } = await loadRoutePageContext(db, selectedViewId);
  const effectiveSelectedMonth = resolveEffectiveMonth(trackedMonths, selectedMonth);
  const monthEntries = await loadEntries(db, effectiveSelectedMonth);
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
      selectedPersonId: viewId,
      selectedScope: viewId === "household" ? "direct_plus_shared" : "direct_plus_shared",
      scopes: buildPersonScopes(viewId),
      entries: adjustEntriesForView(monthEntries, viewId)
    }
  };
}
