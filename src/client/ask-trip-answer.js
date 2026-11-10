// "How much was the Seoul trip?" in Ask (docs/flows/ask-flow.md "Trips and
// events"; DOMAIN.md "Trip or Event"): the answer card built from the Entries
// trip view's own page read and its own code, so the figure is that view's
// Spent lead to the cent. The turn route only names the trip, the view,
// scope and month; every figure is the app's, never the model's.
//
// Pure: the page DTO (GET /api/entries-page?view&month&trip) comes in, the
// card the money answer card shows comes out. Lives in Ask's lazy chunk.
import { askCopy } from "./copy/ask-copy";
import { buildEntriesFilterSearch, readEntriesFilterParams } from "./entry-filter-params";
import { getEntryDerivedData, getInvestmentAccountIds } from "./entry-filtering";
import { projectEntriesForView } from "./entry-row-projection";
import { moneyWithCurrency } from "./formatters";
import { buildTripEventLeadModel } from "./trip-event-lead-model";

const copy = askCopy.money.trip;
const MAX_LINES = 5;

/**
 * The trip view a trip answer opens: Entries, that view and scope, the trip.
 * @param {{ tripEventId: string, viewId: string, scope: string, month: string }} reply
 */
export function tripAnswerFilter(reply) {
  return {
    month: reply.month,
    viewId: reply.viewId,
    scope: reply.scope,
    search: "",
    categories: [],
    wallets: [],
    type: "",
    minAmountMinor: null,
    maxAmountMinor: null,
    tripEventId: reply.tripEventId
  };
}

/** The page read the trip view makes for this reply. */
export function tripAnswerPageParams(reply) {
  return new URLSearchParams({ view: reply.viewId, month: reply.month, trip: reply.tripEventId });
}

/**
 * The answer card for a trip question, from the trip view's page DTO.
 * @param {{ reply: { tripEventId: string, name: string, viewId: string, scope: string, month: string }, page: any, accounts?: any[], people?: Array<{ id: string, name: string }> }} input
 */
export function buildTripAnswer({ reply, page, accounts = [], people = [] }) {
  const filter = tripAnswerFilter(reply);
  // Exactly what Entries reads from the link this answer opens.
  const { selectedScope, entryFilters } = readEntriesFilterParams(buildEntriesFilterSearch(filter));
  const investmentAccountIds = getInvestmentAccountIds(accounts);
  const viewId = page?.viewId ?? reply.viewId;
  const pageEntries = page?.monthPage?.entries ?? [];
  const derived = getEntryDerivedData({ entries: pageEntries, entryFilters, selectedScope, viewId, pinnedEntryIds: [], investmentAccountIds });
  const aggregateEntries = projectEntriesForView(derived.filteredEntries, viewId).aggregateEntries;
  const tripEvent = page?.tripView?.tripEvent ?? null;
  const lead = buildTripEventLeadModel({ tripEvent, aggregateEntries, pageEntries, entryFilters, viewId, people, investmentAccountIds });
  const name = tripEvent?.name ?? reply.name;
  const currency = "SGD";
  const count = derived.filteredEntries.length;
  const support = [
    ...lead.personPills.map((pill) => ({ label: pill.name, amountMinor: pill.amountMinor, currency })),
    ...(lead.beforeMinor ? [{ label: copy.before, amountMinor: lead.beforeMinor, currency }, { label: copy.whileAway, amountMinor: lead.whileAwayMinor ?? 0, currency }] : [])
  ];
  const lines = lead.byCategory.slice(0, MAX_LINES).map((row) => ({
    label: row.categoryName,
    detail: copy.entries(row.entryIds.length),
    amountMinor: row.amountMinor,
    currency,
    tone: "neutral"
  }));
  const money = (minor) => moneyWithCurrency(minor, currency);
  const text = count
    ? [copy.wording(name, money(lead.spentMinor), count), lead.beforeMinor ? copy.wordingBefore(money(lead.beforeMinor), money(lead.whileAwayMinor ?? 0)) : ""].filter(Boolean).join(" ")
    : copy.wordingNone(name);
  return {
    spentMinor: lead.spentMinor,
    answer: {
      title: name,
      lead: { label: copy.spent, amountMinor: lead.spentMinor, currency, tone: "neutral" },
      support,
      lines,
      links: [{ kind: "entries", label: copy.openEntries, filter }]
    },
    wording: { text, source: "template" }
  };
}
