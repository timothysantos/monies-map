// Card suggestion (DOMAIN.md "Card Suggestion"): when a new expense is at a
// shop the household has mostly paid for on another card, the card to ask
// about ("Past Grab entries were on Citi Rewards. Was this on that card
// too?"). Pure and deterministic (no AI, no reads, no writes);
// pages/card-suggestion.ts loads its inputs. It only ever asks: the card is
// changed by the person's tap, never here.
//
// The rule:
// - the history is the household's own expense entries of the 12 months up
//   to the entry's day, at the same shop (normalizeDescriptionForMatch),
//   never the entry itself, and never a transfer, a settle-up or an estimate
//   (an entry with an original amount in another currency);
// - one other card holds at least `minEntries` of them and at least
//   `minShare` of all of them (whatever card they were on);
// - that card is active and in the same currency as the chosen card, so
//   moving the entry to it changes no amount.

import { normalizeDescriptionForMatch } from "./app-repository-helpers";

export const CARD_HISTORY_POLICY = Object.freeze({ lookbackDays: 365, minEntries: 3, minShare: 0.7 });

export interface CardHistoryTarget {
  // A saved entry (the Apple Pay card) is left out of its own history.
  entryId?: string | null;
  description: string;
  accountId: string;
  // ISO YYYY-MM-DD, the entry's event date.
  date: string;
}

export interface CardHistoryEntry {
  entryId: string;
  date: string;
  entryType: string;
  description: string;
  accountId: string;
  originalCurrency: string | null;
}

export interface CardHistoryCard {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
}

export interface CardSuggestion {
  accountId: string;
  accountName: string;
  currentAccountId: string;
  currentAccountName: string;
  // The shop as the entry names it.
  merchant: string;
  // Past entries at the shop on the suggested card, and at the shop in all.
  entryCount: number;
  matchedCount: number;
}

export function suggestCardForEntry(input: {
  target: CardHistoryTarget;
  history: CardHistoryEntry[];
  accounts: CardHistoryCard[];
  policy?: typeof CARD_HISTORY_POLICY;
}): CardSuggestion | null {
  const { target, accounts } = input;
  const policy = input.policy ?? CARD_HISTORY_POLICY;
  const merchant = target.description.trim();
  const shopKey = normalizeDescriptionForMatch(merchant);
  const current = accounts.find((account) => account.id === target.accountId);
  if (!shopKey || !current || !isIsoDate(target.date)) {
    return null;
  }

  const windowStart = shiftIsoDate(target.date, -policy.lookbackDays);
  const matches = input.history.filter((entry) => (
    entry.entryType === "expense"
    && !entry.originalCurrency
    && entry.entryId !== target.entryId
    && entry.date >= windowStart
    && entry.date <= target.date
    && normalizeDescriptionForMatch(entry.description) === shopKey
  ));
  if (matches.length < policy.minEntries) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const entry of matches) {
    counts.set(entry.accountId, (counts.get(entry.accountId) ?? 0) + 1);
  }
  const [topAccountId, topCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  const suggested = accounts.find((account) => account.id === topAccountId);
  if (
    topAccountId === current.id
    || topCount < policy.minEntries
    || topCount / matches.length < policy.minShare
    || !suggested
    || !suggested.isActive
    || suggested.currency.toUpperCase() !== current.currency.toUpperCase()
  ) {
    return null;
  }
  return {
    accountId: suggested.id,
    accountName: suggested.name,
    currentAccountId: current.id,
    currentAccountName: current.name,
    merchant,
    entryCount: topCount,
    matchedCount: matches.length
  };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// Calendar arithmetic on the plain date, in UTC (never a local instant).
function shiftIsoDate(value: string, days: number) {
  const shifted = new Date(`${value}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
