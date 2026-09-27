// Signals and builders every page shares. The statement gap reads the
// view's wallet health (the account pills Summary and Month already load).
import { phrase, monthName, type CopyCatalogue, type CopyEntry, type FormatMoney } from "./format";
import type { Audience, MoneySignal } from "./types";

// A Just for fun line: one computed sentence, no think line.
export function triviaSignal(key: string, copy: CopyEntry, values: Record<string, string | number>, { weight = 0, moment = false } = {}): MoneySignal {
  return {
    key,
    kind: "just_for_fun",
    weight,
    numbers: { primaryMinor: weight },
    phrasings: phrase(copy, values),
    moment
  };
}

export const SHARED_COPY = {
  statementGap: {
    phrasings: [
      "{whose} {account} statement is off by {amount}.",
      "{whose} {account} {month} statement is {amount} away from the app.",
      "One statement doesn't match yet: {whose} {account}, off by {amount}.",
      "{amount} separates {whose} {account} statement from the app."
    ],
    think: "Small gaps are usually one missing or doubled entry. Sorting it keeps every total here trustworthy.",
    sorted: {
      fact: "Sorted: {whose} {account} now matches its statement.",
      think: "That's the part that makes every other number here trustworthy."
    },
    action: "Review statement"
  }
} satisfies CopyCatalogue;

export interface WalletHealthPill {
  accountId: string;
  accountName: string;
  ownerLabel?: string;
  balanceMinor?: number;
  reconciliationStatus?: string;
  latestCheckpointMonth?: string;
  latestCheckpointDeltaMinor?: number;
}

// "Serene's" for the household, "your" for the person's own account, and
// "the" for a joint one.
function whoseAccount(pill: WalletHealthPill, audience: Audience, viewLabel: string) {
  const owner = String(pill.ownerLabel ?? "").trim();
  if (audience === "person" && owner === viewLabel) {
    return "your";
  }
  if (!owner || /joint|shared|household/i.test(owner)) {
    return "the";
  }
  return `${owner}'s`;
}

// Quick fix: the wallet whose latest statement is furthest from the ledger.
export function statementGapSignal(input: {
  accountPills: WalletHealthPill[] | null | undefined;
  audience: Audience;
  viewLabel: string;
  formatMoney: FormatMoney;
}): MoneySignal | null {
  const gaps = (input.accountPills ?? [])
    .filter((pill) => pill.reconciliationStatus === "mismatch" && Math.abs(pill.latestCheckpointDeltaMinor ?? 0) > 0)
    .sort((left, right) => Math.abs(right.latestCheckpointDeltaMinor ?? 0) - Math.abs(left.latestCheckpointDeltaMinor ?? 0)
      || left.accountName.localeCompare(right.accountName));
  const pill = gaps[0];
  if (!pill) {
    return null;
  }
  const gapMinor = Math.abs(pill.latestCheckpointDeltaMinor ?? 0);
  const amount = input.formatMoney(gapMinor);
  const values = {
    whose: whoseAccount(pill, input.audience, input.viewLabel),
    account: pill.accountName,
    amount,
    month: pill.latestCheckpointMonth ? monthName(pill.latestCheckpointMonth) : "latest"
  };
  const copy = SHARED_COPY.statementGap;
  return {
    key: `statement-gap:${pill.accountId}`,
    kind: "quick_fix",
    weight: gapMinor,
    numbers: { primaryMinor: gapMinor },
    primaryText: amount,
    phrasings: phrase(copy, values),
    sorted: phrase({ phrasings: [copy.sorted.fact], think: copy.sorted.think }, values)[0],
    action: { id: "review-statement", label: copy.action },
    topic: "later"
  };
}
