import { loadPageShell } from "./app-shell";

// Shared page fragments keep route modules from re-implementing shell view
// selection and month-selection rules in slightly different ways.
export async function loadRoutePageContext(db: D1Database, selectedViewId: string) {
  return loadPageShell(db, selectedViewId);
}

// Page routes all need the same fallback month behavior when the requested
// route month is not tracked yet.
export function resolveEffectiveMonth(trackedMonths: string[], selectedMonth: string) {
  return trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
}

// Route modules should agree on whether a person view is valid or should fall
// back to household.
export function resolvePageViewId(selectedViewId: string, householdPeople: Array<{ id: string; name: string }>) {
  return selectedViewId === "household" || householdPeople.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
}

// Route modules only need a display label, not the shell's full person map.
export function resolvePageLabel(viewId: string, personNameById: Record<string, string>) {
  return viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";
}
