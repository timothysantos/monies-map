// This module is only for shared route labels.
// Keep label shaping out of route interpretation and out of finance/business
// modules.
export function resolvePageLabel(viewId: string, personNameById: Record<string, string>) {
  return viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";
}
