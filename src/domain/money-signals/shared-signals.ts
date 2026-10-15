// Signals and builders every page shares. The statement gap reads the
// view's wallet health (the account pills Summary and Month already load).
import { addDays, amountLine, daysBetween, joinWithAnd, phrase, monthName, monthYear, shortDay, sortedLine, textLine, walletText, type CopyCatalogue, type CopyEntry, type FormatMoney } from "./format";
import type { Audience, MoneySignal } from "./types";
import type { AccountChargeDto, IncomeMovedDto, MissedPaymentDto, OwnTransferIncomeDto, UpcomingShortfallDto } from "../../types/dto";

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
      "{whose} {account} statement differs from what's recorded here by {amount}.",
      "The {month} statement for {whose} {account} is {amount} different from what's recorded here.",
      "{whose} {account} doesn't match its bank statement yet: the two are {amount} apart.",
      "There's a {amount} difference between {whose} {account} statement and what's recorded here."
    ],
    think: [
      "The statement is the bank's own monthly list of payments. A gap like this is usually one payment missing here or recorded twice.",
      "Usually a single payment explains it, missing here or recorded twice. Comparing the bank's list with this one finds it.",
      "Until the two match, totals here for that account may be off. Comparing them line by line usually turns up the one payment that differs."
    ],
    sorted: {
      fact: "Sorted: {whose} {account} now matches its bank statement.",
      think: "The totals here for that account now agree with the bank."
    },
    action: "Compare with the statement"
  },
  cardBillDue: {
    phrasings: [
      "{whose} {account} bill of {amount} is due {when}, with no payment to it recorded here yet.",
      "{amount} on {whose} {account} is due {when}.",
      "{whose} {account} bill asks for {amount}, due {when}.",
      "Coming up: {whose} {account} bill of {amount}, due {when}."
    ],
    think: [
      "If you've already paid it, the payment will show once you add that account's latest transactions.",
      "Paying the full bill by the due date means no interest on the card.",
      "Paying at least the minimum by the due date avoids a late charge."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "Its payment now shows in your records."
    }
  },
  cardBillPart: {
    phrasings: [
      "{amount} of {whose} {account} bill is still to pay, due {when}.",
      "{whose} {account} still has {amount} left to pay on this bill, due {when}.",
      "Part of {whose} {account} bill is paid, with {amount} still due {when}.",
      "{whose} {account} bill still needs {amount}, due {when}."
    ],
    think: [
      "{paid} is paid so far. Paying the rest by the due date means no interest on the card.",
      "If you've paid the rest already, it will show once you add that account's latest transactions.",
      "Your records here show {paid} paid since the bill came out."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "Its payment now shows in your records."
    }
  },
  cardBillOverdue: {
    phrasings: [
      "{whose} {account} bill was due on {date}, and {amount} still shows as unpaid here.",
      "{amount} on {whose} {account} was due on {date}, and no payment for it is recorded here yet.",
      "{whose} {account} needed {amount} paid by {date}, and no payment for it shows here yet.",
      "The {amount} owed on {whose} {account} was due {date}, and your records here don't show it paid."
    ],
    think: [
      "If you've paid it, the payment will show once you add that account's latest transactions. If not, the bank adds a late charge and interest until it's paid.",
      "Banks add a late charge when a card's minimum isn't paid by the due date. Paying soon keeps the interest small.",
      "If you paid from an account that isn't recorded here, this clears once the card's next statement is added."
    ],
    sorted: {
      fact: "Paid: {whose} {account} bill.",
      think: "Its payment now shows in your records."
    }
  },
  penaltyInterest: {
    phrasings: [
      "{whose} {account} {month} bill shows {amount} owed at a penalty interest rate of {rate}% a year.",
      "{amount} is owed on {whose} {account}, and its {month} statement shows a penalty rate of {rate}% a year.",
      "The bank moved {whose} {account} to a higher penalty interest rate of {rate}% a year, with {amount} owed on the {month} bill.",
      "{amount} owed on {whose} {account} now costs penalty interest of {rate}% a year, says its {month} statement."
    ],
    think: [
      "Banks raise a card's rate after a missed minimum payment. Paying each bill in full by its due date means no interest at all.",
      "The rate only costs money on what's still owed after the due date. Paying the {amount} in full by then means no interest at all.",
      "Each monthly statement says whether the penalty rate still applies. This note goes away once one no longer shows it."
    ]
  },
  bankCharges: {
    phrasingsOne: [
      "{whose} {account} was charged {charges} on {date}, and no refund of it shows here yet.",
      "{charges} on {whose} {account} from {date} hasn't been refunded, going by your records.",
      "The bank charged {whose} {account} {charges} on {date}. No refund of it is recorded yet.",
      "No refund yet for {charges} on {whose} {account} from {date}."
    ],
    phrasings: [
      "{whose} {account} has been charged {charges} since {date}, and no refund shows here yet.",
      "{total} in bank charges on {whose} {account} hasn't been refunded yet: {charges}.",
      "The bank has charged {whose} {account} {charges} since {date}. None of it is refunded yet.",
      "No refund yet for {total} in bank charges on {whose} {account}: {charges}."
    ],
    think: [
      "Banks sometimes refund a charge like this when asked, which they call a \"reversal\". The refund shows on the next statement.",
      "If the bank has agreed to take the charge back, the refund shows on the card's next statement.",
      "Bank charges aren't purchases, so they're kept in their own category, \"Fees\"."
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
  // Bank accounts: what changed in the monthly routine (account-signals.ts).
  incomeMoved?: IncomeMovedDto;
  missedPayments?: MissedPaymentDto[];
  accountCharges?: AccountChargeDto[];
  ownTransfersAsIncome?: OwnTransferIncomeDto[];
  upcomingShortfall?: UpcomingShortfallDto;
}

// "Serene's" for the household, "your" for the person's own account, and
// "the" for a joint one.
export function whoseAccount(pill: WalletHealthPill, audience: Audience, viewLabel: string) {
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
    basis: {
      lines: [
        textLine("Account", walletText(pill.accountName, pill.ownerLabel)),
        textLine("Statement", pill.latestCheckpointMonth ? monthYear(pill.latestCheckpointMonth) : "The latest one"),
        amountLine("Statement and your records differ by", gapMinor)
      ],
      entries: { accountId: pill.accountId, ...(pill.latestCheckpointMonth ? { month: pill.latestCheckpointMonth } : {}) },
      ...(pill.latestCheckpointMonth ? { month: pill.latestCheckpointMonth } : {})
    },
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
    basis: {
      lines: [
        textLine("Card", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        textLine("Statement", monthYear(pick.bill.statementMonth)),
        amountLine("Bill", pick.bill.owedMinor),
        ...(pick.bill.minimumMinor ? [amountLine("Minimum payment", pick.bill.minimumMinor)] : []),
        amountLine("Paid since the statement", pick.bill.paidSinceMinor),
        amountLine("Still to pay", pick.leftMinor),
        textLine("Due", shortDay(pick.bill.paymentDueDate))
      ],
      entries: { accountId: pick.pill.accountId, month: pick.bill.paymentDueDate.slice(0, 7) }
    },
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
    basis: {
      lines: [
        textLine("Card", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        ...[...pick.charges]
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((charge) => amountLine(`${CHARGE_LABELS[charge.kind] ?? CHARGE_LABELS.other_fee} on ${shortDay(charge.date)}`, charge.amountMinor)),
        amountLine("Charges in all", pick.totalMinor)
      ],
      entries: { accountId: pick.pill.accountId, month: [...pick.charges].map((charge) => charge.date).sort().at(-1)!.slice(0, 7) }
    },
    topic: "small-costs"
  };
}

// A charge's kind, as its basis line names it.
const CHARGE_LABELS: Record<string, string> = {
  late_fee: "Late charge",
  interest: "Interest",
  annual_fee: "Annual fee",
  other_fee: "Bank fee"
};

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
    basis: {
      lines: [
        textLine("Card", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        textLine("Statement", monthYear(pick.month)),
        amountLine("Owed on that statement", pick.owedMinor),
        textLine("Penalty interest rate", `${pick.rate}% a year`)
      ],
      entries: { accountId: pick.pill.accountId, month: pick.month },
      month: pick.month
    },
    topic: "small-costs"
  };
}
