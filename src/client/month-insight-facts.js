import { effectiveScopeForView, filterEntriesForView } from "../domain/person-view-scope";

// The Month money check-in's entries. The page DTO's `entries` holds every
// household entry of the month (adjusted for the view) because plan linking
// needs them all, so the check-in first keeps the entries the Actual spend
// card counts: every entry for the household, and for a person only their
// own entries in the selected scope, each at their own amount (the same
// filter the Worker applies in month-page.ts). Its signals therefore count
// what the card counts in every view and scope.
export function selectMonthInsightEntries(monthPage, viewId) {
  return filterEntriesForView(
    monthPage?.entries ?? [],
    viewId,
    effectiveScopeForView(viewId, monthPage?.selectedScope)
  );
}
