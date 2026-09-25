import { getTotalAmountMinor, getVisibleAmountMinor } from "./entry-helpers";

// One aggregate and one row projection per (entry object, view). Entries are
// replaced, never mutated, so an unchanged entry keeps the same projected
// objects across filter, draft and editor changes, and memoized Entries rows
// can skip it. The WeakMap lets replaced entries be collected.
const projectionCache = new WeakMap();

function projectEntry(entry, viewId) {
  let byView = projectionCache.get(entry);
  if (!byView) {
    byView = new Map();
    projectionCache.set(entry, byView);
  }
  let projection = byView.get(viewId);
  if (!projection) {
    const aggregate = {
      ...entry,
      visibleAmountMinor: getVisibleAmountMinor(entry, viewId),
      grossAmountMinor: getTotalAmountMinor(entry)
    };
    projection = { aggregate, row: { ...aggregate, amountMinor: aggregate.visibleAmountMinor } };
    byView.set(viewId, projection);
  }
  return projection;
}

// aggregateEntries feed totals; rowEntries carry the viewer's amount as
// amountMinor for the rendered rows.
export function projectEntriesForView(entries, viewId) {
  const projections = entries.map((entry) => projectEntry(entry, viewId));
  return {
    aggregateEntries: projections.map((projection) => projection.aggregate),
    rowEntries: projections.map((projection) => projection.row)
  };
}
