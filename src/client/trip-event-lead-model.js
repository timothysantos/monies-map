// The trip view's lead (design.md "Trips and events on Entries"; DOMAIN.md
// "Trip or Event"): Spent, who it was for, before you went and while away,
// where it went and day by day. Pure, so tests/openable-figures.test.mjs
// runs it on the real Worker's page DTO. Every figure is a slice of the one
// rule in src/domain/money-figures.ts (`tripEventFigures`) over the rows the
// trip view lists, at the view's amounts, so each one's View entries leads
// with that figure to the cent.
import { getEntryDerivedData } from "./entry-filtering";
import { adjustEntriesForList } from "../domain/month-projection";
import { tripEventFigures } from "../domain/money-figures";

export { tripFigureSearch } from "./trip-figure-search";

const atViewAmounts = (entries) => entries.map((entry) => ({ ...entry, amountMinor: entry.visibleAmountMinor ?? entry.amountMinor }));

/**
 * @param {{ tripEvent: any, aggregateEntries: any[], pageEntries: any[], entryFilters: any, viewId: string, people?: Array<{ id: string, name: string }>, investmentAccountIds?: Set<string> }} input
 */
export function buildTripEventLeadModel({ tripEvent, aggregateEntries, pageEntries, entryFilters, viewId, people = [], investmentAccountIds = undefined }) {
  const figures = tripEventFigures(atViewAmounts(aggregateEntries), tripEvent);
  // Each person's share, in the household view only: what that person's own
  // view of the trip leads with (the household page's rows are the ledger
  // rows, which a person view reads through adjustEntriesForList).
  const personPills = viewId === "household"
    ? people.map((person) => {
      const derived = getEntryDerivedData({
        entries: adjustEntriesForList(pageEntries, person.id),
        entryFilters,
        selectedScope: "direct_plus_shared",
        viewId: person.id,
        pinnedEntryIds: [],
        investmentAccountIds
      });
      const amountMinor = derived.entryTotals.spendMinor;
      return {
        personId: person.id,
        name: person.name,
        amountMinor,
        percent: figures.spentMinor > 0 ? Math.round((amountMinor / figures.spentMinor) * 100) : null
      };
    }).filter((pill) => pill.amountMinor !== 0)
    : [];
  return { ...figures, personPills };
}
