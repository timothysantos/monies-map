// The trip page (DOMAIN.md "Trip or Event", "Trip page"): one trip or event
// on a page of its own, what it cost the household. Its figures come from
// `tripPageFigures` (money-figures.ts); the rules here are the page's other
// readings, pure so they are tested without a database:
// - an entry's readable name: the first line of its note when it has one
//   (the owner writes "what and where" there), else its description;
// - a foreign currency estimate (DOMAIN.md "Foreign Currency Estimate"): a
//   Wallet amount kept in another currency on an entry no statement has
//   confirmed yet;
// - what is still owed between people for the trip's own entries on Splits:
//   each split not yet settled (its batch still open and no active
//   settle-up covering it), each person's share of an expense someone else
//   paid, in the ledger's money, netted between each two people.

export const TRIP_PAGE_TOP_COUNT = 5;
// The first line of a note is at most this long on the page.
export const TRIP_PAGE_NAME_MAX = 80;

/** The first line of a note, trimmed and bounded; "" when there is none. */
export function noteFirstLine(note: string | null | undefined): string {
  const line = String(note ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > TRIP_PAGE_NAME_MAX ? `${line.slice(0, TRIP_PAGE_NAME_MAX - 1).trimEnd()}…` : line;
}

/** What the page calls an entry: its note's first line, else its description. */
export function tripEntryName(entry: { description: string; note?: string | null }): string {
  return noteFirstLine(entry.note) || entry.description.trim();
}

/** Whether an entry is still a foreign currency estimate. */
export function isOpenForeignEstimate(row: {
  original_amount_minor: number | null;
  original_currency: string | null;
  currency: string | null;
  bank_certification_status: string | null;
}): boolean {
  return row.original_amount_minor !== null
    && Boolean(row.original_currency)
    && row.original_currency !== (row.currency ?? "SGD")
    && row.bank_certification_status !== "statement_certified";
}

export interface TripOwedShare {
  transactionId: string;
  payerId: string;
  payerName: string;
  personId: string;
  personName: string;
  // The share in the ledger's money (buildLinkedSplitShareMap).
  amountMinor: number;
  settled: boolean;
}

export interface TripDebt {
  fromPersonId: string;
  fromName: string;
  toPersonId: string;
  toName: string;
  amountMinor: number;
}

/**
 * What is still owed between people for these shares: every share of an
 * open split that someone other than its payer carries is owed to the
 * payer; two people's debts to each other cancel. Largest first; nothing
 * owed is an empty list.
 */
export function tripStillOwed(shares: TripOwedShare[]): TripDebt[] {
  const names = new Map<string, string>();
  // pairKey "a|b" (a < b): what b owes a, less what a owes b.
  const net = new Map<string, number>();
  for (const share of shares) {
    names.set(share.payerId, share.payerName);
    names.set(share.personId, share.personName);
    if (share.settled || share.personId === share.payerId || share.amountMinor === 0) continue;
    const [low, high] = share.payerId < share.personId ? [share.payerId, share.personId] : [share.personId, share.payerId];
    const key = `${low}|${high}`;
    // The share's person owes its payer.
    const owedToLow = share.payerId === low ? share.amountMinor : -share.amountMinor;
    net.set(key, (net.get(key) ?? 0) + owedToLow);
  }
  const debts: TripDebt[] = [];
  for (const [key, amount] of net) {
    if (amount === 0) continue;
    const [low, high] = key.split("|");
    const [from, to] = amount > 0 ? [high, low] : [low, high];
    debts.push({ fromPersonId: from, fromName: names.get(from) ?? "", toPersonId: to, toName: names.get(to) ?? "", amountMinor: Math.abs(amount) });
  }
  return debts.sort((left, right) => right.amountMinor - left.amountMinor || left.fromName.localeCompare(right.fromName));
}
