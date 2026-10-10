// Signals and builders every page shares. The statement gap reads the
// view's wallet health (the account pills Summary and Month already load).
import { addDays, daysBetween, joinWithAnd, phrase, monthName, shortDay, sortedLine, type CopyCatalogue, type CopyEntry, type FormatMoney } from "./format";
import type { Audience, MoneySignal } from "./types";

// A Just for fun line of one trivia type: one computed sentence, no think
// line. `detail` makes the key unique to what it says.
export function triviaSignal(type: string, detail: string, copy: CopyEntry, values: Record<string, string | number>, { weight = 0, moment = false } = {}): MoneySignal {
  return {
    key: detail ? `${type}:${detail}` : type,
    kind: "just_for_fun",
    triviaType: type,
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
    think: [
      "Small gaps are usually one missing or doubled entry. Sorting it keeps every total here trustworthy.",
      "A gap this size usually comes down to one entry. Finding it keeps the totals here honest.",
      "The statement is the checkpoint for everything else here. One quick comparison usually closes it."
    ],
    sorted: {
      fact: "Sorted: {whose} {account} now matches its statement.",
      think: "That's the part that makes every other number here trustworthy."
    },
    action: "Review statement"
  },
  cardBillDue: {
    phrasings: [
      "{whose} {account} bill of {amount} is due {when}, and no payment to it is in the app yet.",
      "{amount} on {whose} {account} is due {when}.",
      "{whose} {account} statement asks for {amount}, due {when}.",
      "Coming up: {whose} {account} bill of {amount}, due {when}."
    ],
    think: [
      "If it's already paid, the payment shows here once that bank account's activity is imported.",
      "Paying the statement in full by the due date keeps interest off the card.",
      "Paying at least the minimum by the due date avoids a late charge."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "The payment is in the app."
    }
  },
  cardBillPart: {
    phrasings: [
      "{amount} of {whose} {account} bill is still to pay, due {when}.",
      "{whose} {account} has {amount} left to pay on its statement, due {when}.",
      "Part of {whose} {account} bill is paid; {amount} is left, due {when}.",
      "{whose} {account} statement still has {amount} to pay, due {when}."
    ],
    think: [
      "{paid} is paid so far. Paying the rest by the due date keeps interest off the card.",
      "If the rest is already paid, it shows here once that bank account's activity is imported.",
      "{paid} is in the app as paid since the statement closed."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "The payment is in the app."
    }
  },
  cardBillOverdue: {
    phrasings: [
      "{whose} {account} bill of {amount} was due on {date}, and no payment to it is in the app yet.",
      "No payment to {whose} {account} is in the app since its {amount} bill fell due on {date}.",
      "{whose} {account} statement asked for {amount} by {date}; no payment is in the app yet.",
      "The {amount} bill on {whose} {account} was due {date}, and the app hasn't seen a payment."
    ],
    think: [
      "If it's paid, the payment shows once that bank account's activity is imported. If not, the bank adds a late charge and interest until it is.",
      "Card statements add a late charge when the minimum isn't paid by the due date.",
      "If the payment came from an account the app doesn't track, this clears once the next statement is imported."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "The payment is in the app."
    }
  },
  penaltyInterest: {
    phrasings: [
      "{whose} {account} is charged penalty interest of {rate}% a year, says its {month} statement, with {amount} owed.",
      "{whose} {account} {month} statement owes {amount} at a penalty interest rate of {rate}% a year.",
      "The bank moved {whose} {account} to penalty interest of {rate}% a year; its {month} statement owes {amount}.",
      "{amount} owed on {whose} {account}, at penalty interest of {rate}% a year, per its {month} statement."
    ],
    think: [
      "Banks raise a card's rate after a missed minimum payment. Paying each statement in full by its due date keeps interest off the card.",
      "The rate only costs money on a balance carried past the due date, so paying the {amount} in full by then means no interest at all.",
      "Each statement says whether the penalty rate still applies; this line goes once a statement no longer does."
    ]
  },
  bankCharges: {
    phrasingsOne: [
      "{whose} {account} was charged {charges} on {date}, and no reversal of it is in the app yet.",
      "{charges} on {whose} {account} from {date} hasn't been reversed in the app.",
      "The bank charged {whose} {account} {charges} on {date}; no reversal is in the app.",
      "No reversal yet for {charges} on {whose} {account} from {date}."
    ],
    phrasings: [
      "{whose} {account} was charged {charges} since {date}, and no reversal of them is in the app yet.",
      "{total} in bank charges on {whose} {account} hasn't been reversed in the app: {charges}.",
      "The bank charged {whose} {account} {charges} since {date}; no reversal is in the app.",
      "No reversal yet for {total} in bank charges on {whose} {account}: {charges}."
    ],
    think: [
      "Banks sometimes reverse these when asked. A reversal shows on the next statement.",
      "If the bank has agreed to reverse it, the reversal shows on the next statement.",
      "These are the bank's own charges, filed under Fees, not spending on anything."
    ]
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
  cardBill?: {
    statementMonth: string;
    statementEndDate: string;
    paymentDueDate: string;
    owedMinor: number;
    minimumMinor?: number;
    paidSinceMinor: number;
  };
  unreversedCharges?: Array<{ date: string; kind: "late_fee" | "interest" | "annual_fee" | "other_fee"; amountMinor: number }>;
  cardNotices?: {
    statementMonth: string;
    owedMinor: number;
    notices: Array<{ code: string; annualRatePercent?: number }>;
  };
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
    sorted: sortedLine(copy.sorted, values),
    action: { id: "review-statement", label: copy.action },
    topic: "later"
  };
}

// A bill is mentioned from a week before it is due; an overdue one while
// less than its minimum has been paid, for a few weeks.
const BILL_DUE_SOON_DAYS = 7;
const BILL_OVERDUE_DAYS = 30;

// Quick fix: a card bill due within a week with something still to pay, or
// one past due with less than its minimum paid. Overdue first, then the
// soonest. Payments come from the ledger, so a payment from a bank account
// not imported yet is not seen; the think lines say so.
export function cardBillSignal(input: {
  accountPills: WalletHealthPill[] | null | undefined;
  audience: Audience;
  viewLabel: string;
  today: string;
  formatMoney: FormatMoney;
}): MoneySignal | null {
  const candidates = (input.accountPills ?? []).flatMap((pill) => {
    const bill = pill.cardBill;
    if (!bill) {
      return [];
    }
    const leftMinor = bill.owedMinor - bill.paidSinceMinor;
    const daysUntil = daysBetween(input.today, bill.paymentDueDate);
    if (leftMinor <= 0) {
      return [];
    }
    if (daysUntil < 0) {
      const isShortOfMinimum = bill.paidSinceMinor < (bill.minimumMinor ?? bill.owedMinor);
      return isShortOfMinimum && -daysUntil <= BILL_OVERDUE_DAYS ? [{ pill, bill, leftMinor, daysUntil, isOverdue: true }] : [];
    }
    return daysUntil <= BILL_DUE_SOON_DAYS ? [{ pill, bill, leftMinor, daysUntil, isOverdue: false }] : [];
  }).sort((left, right) => Number(right.isOverdue) - Number(left.isOverdue)
    || left.daysUntil - right.daysUntil
    || right.leftMinor - left.leftMinor);
  const pick = candidates[0];
  if (!pick) {
    return null;
  }
  const amount = input.formatMoney(pick.leftMinor);
  const date = shortDay(pick.bill.paymentDueDate);
  const when = pick.daysUntil === 0 ? "today" : pick.daysUntil === 1 ? "tomorrow" : `in ${pick.daysUntil} days (${date})`;
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    amount,
    paid: input.formatMoney(pick.bill.paidSinceMinor),
    date,
    when
  };
  const copy = pick.isOverdue
    ? SHARED_COPY.cardBillOverdue
    : pick.bill.paidSinceMinor > 0 ? SHARED_COPY.cardBillPart : SHARED_COPY.cardBillDue;
  return {
    key: `card-bill:${pick.pill.accountId}:${pick.bill.statementMonth}`,
    kind: "quick_fix",
    weight: pick.leftMinor,
    numbers: { primaryMinor: pick.leftMinor },
    primaryText: amount,
    phrasings: phrase(copy, values),
    sorted: sortedLine(copy.sorted, values),
    topic: "later"
  };
}

const CHARGE_LOOKBACK_DAYS = 60;

// Worth a look: the card with the most in late charges, interest or annual
// fees from the last two months that no reversal has cancelled.
export function bankChargesSignal(input: {
  accountPills: WalletHealthPill[] | null | undefined;
  audience: Audience;
  viewLabel: string;
  today: string;
  formatMoney: FormatMoney;
}): MoneySignal | null {
  const cutoff = addDays(input.today, -CHARGE_LOOKBACK_DAYS);
  const cards = (input.accountPills ?? []).flatMap((pill) => {
    const charges = (pill.unreversedCharges ?? []).filter((charge) => charge.date >= cutoff && charge.date <= input.today);
    const totalMinor = charges.reduce((total, charge) => total + charge.amountMinor, 0);
    return charges.length ? [{ pill, charges, totalMinor }] : [];
  }).sort((left, right) => right.totalMinor - left.totalMinor || left.pill.accountName.localeCompare(right.pill.accountName));
  const pick = cards[0];
  if (!pick) {
    return null;
  }
  const kindTotals = new Map<string, number>();
  for (const charge of pick.charges) {
    kindTotals.set(charge.kind, (kindTotals.get(charge.kind) ?? 0) + charge.amountMinor);
  }
  const chargeWords = Array.from(kindTotals, ([kind, amountMinor]) => describeCharge(kind, input.formatMoney(amountMinor)));
  const firstDate = pick.charges.map((charge) => charge.date).sort()[0];
  const total = input.formatMoney(pick.totalMinor);
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    charges: joinWithAnd(chargeWords),
    total,
    date: shortDay(firstDate)
  };
  return {
    key: `bank-charges:${pick.pill.accountId}:${firstDate}`,
    kind: "worth_a_look",
    weight: pick.totalMinor,
    numbers: { primaryMinor: pick.totalMinor },
    primaryText: total,
    phrasings: phrase(SHARED_COPY.bankCharges, values, { one: pick.charges.length === 1 }),
    topic: "small-costs"
  };
}

function describeCharge(kind: string, amount: string) {
  switch (kind) {
    case "late_fee":
      return `a ${amount} late charge`;
    case "interest":
      return `${amount} interest`;
    case "annual_fee":
      return `a ${amount} annual fee`;
    default:
      return `${amount} in bank fees`;
  }
}

// Worth a look: a card whose latest statement says it is charged penalty
// interest, while that statement owes money (the rate costs nothing on a
// card paid in full). The highest balance first.
export function penaltyInterestSignal(input: {
  accountPills: WalletHealthPill[] | null | undefined;
  audience: Audience;
  viewLabel: string;
  formatMoney: FormatMoney;
}): MoneySignal | null {
  const cards = (input.accountPills ?? []).flatMap((pill) => {
    const notice = pill.cardNotices?.notices.find((item) => item.code === "penalty_interest" && Number(item.annualRatePercent) > 0);
    return notice && pill.cardNotices && pill.cardNotices.owedMinor > 0
      ? [{ pill, rate: Number(notice.annualRatePercent), owedMinor: pill.cardNotices.owedMinor, month: pill.cardNotices.statementMonth }]
      : [];
  }).sort((left, right) => right.owedMinor - left.owedMinor || left.pill.accountName.localeCompare(right.pill.accountName));
  const pick = cards[0];
  if (!pick) {
    return null;
  }
  const amount = input.formatMoney(pick.owedMinor);
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    rate: String(pick.rate),
    month: monthName(pick.month),
    amount
  };
  return {
    key: `penalty-interest:${pick.pill.accountId}:${pick.month}`,
    kind: "worth_a_look",
    weight: pick.owedMinor,
    numbers: { primaryMinor: pick.owedMinor },
    primaryText: amount,
    phrasings: phrase(SHARED_COPY.penaltyInterest, values),
    topic: "small-costs"
  };
}
