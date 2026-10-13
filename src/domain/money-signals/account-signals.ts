// Signals about a bank account's monthly routine, read from the account pills
// (account-routines.ts builds the facts on the server): income that moved
// while payments stayed, a payment the bank could not make, the account's
// own charges, money between the owner's own accounts counted as income,
// and the scheduled check. Summary and Month show them.
import { addDays, amountLine, joinWithAnd, monthName, monthYear, numberWord, phrase, shortDay, sortedLine, textLine, walletText, type CopyCatalogue, type FormatMoney } from "./format";
import { whoseAccount, type WalletHealthPill } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

interface AccountSignalInput {
  accountPills: WalletHealthPill[] | null | undefined;
  audience: Audience;
  viewLabel: string;
  today: string;
  formatMoney: FormatMoney;
}

export const ACCOUNT_COPY = {
  incomeMoved: {
    phrasings: [
      "{whose} {income} has gone into {to} since {date}, but {account} still pays {payments}.{held}",
      "Since {date}, {whose} {income} goes into {to}, while {payments} still {leave} {account}.{held}",
      "{account} no longer gets {whose} {income}, which has gone to {to} since {date}, but it still pays {payments}.{held}",
      "{whose} {income} moved to {to} on {date}. {account} still pays {payments}.{held}"
    ],
    think: [
      "When a payment's account runs low, the bank can't make it and charges for trying. Moving the payment, or topping the account up, clears it.",
      "Payments set up on {account} don't follow the {income}. Each one moves on its own, with the bank or the company that collects it.",
      "Some accounts pay bonus interest only while a salary arrives in them, so the move may change {account}'s interest too."
    ],
    sorted: {
      fact: "Sorted: {whose} {account} no longer has payments waiting on {income} that moved.",
      think: "The payments now come from where the money arrives."
    }
  },
  missedPayments: {
    phrasingsOne: [
      "{whose} {amounts} payment to {payee} didn't go through on {date}. {account} charged {charge} instead.",
      "The bank couldn't make {whose} {amounts} payment to {payee} on {date}, and charged {charge} for trying.",
      "{amounts} to {payee} didn't leave {whose} {account} on {date}; the bank charged {charge} instead.",
      "On {date}, {whose} {account} couldn't pay {payee} {amounts}, and was charged {charge}."
    ],
    phrasings: [
      "{whose} {payee} payments ({amounts}) didn't go through on {date}. {account} charged {charge} for each instead.",
      "The bank couldn't make {whose} {payee} payments of {amounts} on {date}, and charged {charge} for each.",
      "{amounts} to {payee} didn't leave {whose} {account} on {date}; the bank charged {charges} instead.",
      "On {date}, {whose} {account} couldn't pay {payee} ({amounts}), and was charged {charge} for each."
    ],
    think: [
      "{month}'s {total} to {payee} didn't go out. Paying it by hand catches up, if it's still wanted.",
      "Banks try a GIRO once on its day. If the account is short then, that month's payment is skipped.",
      "Keeping a little more than {total} in {account} before the payment's day means it goes through."
    ],
    sorted: {
      fact: "Sorted: {whose} payment to {payee} went through.",
      think: "The latest one left {account} as usual."
    }
  },
  accountCharges: {
    phrasings: [
      "The bank charged {whose} {account} {total} in {month}: {charges}.",
      "{whose} {account} paid {total} in bank charges in {month}: {charges}.",
      "{total} of {whose} {account} went on bank charges in {month}: {charges}.",
      "In {month} the bank took {total} from {whose} {account}: {charges}."
    ],
    think: [
      "Charges for failed payments stop once there's enough in the account on the payment's day.",
      "{account}'s {fee} monthly fee has come every month since {since}. Banks usually waive it while the balance stays above a minimum.",
      "Bank charges aren't purchases, so they're kept in their own category, \"Fees\"."
    ]
  },
  accountFees: {
    phrasings: [
      "The bank has charged {whose} {account} a {fee} monthly fee every month since {since}.",
      "{whose} {account} has paid a {fee} monthly fee to the bank every month since {since}.",
      "Every month since {since}, {whose} {account} has been charged a {fee} fee.",
      "A {fee} monthly fee has come out of {whose} {account} every month since {since}."
    ],
    think: [
      "Banks usually waive a fee like this while the balance stays above a minimum.",
      "It's small, but it adds up to {yearly} a year.",
      "Bank charges aren't purchases, so they're kept in their own category, \"Fees\"."
    ]
  },
  ownTransferIncome: {
    phrasingsOne: [
      "{amount} into {whose} {account} on {date} is counted as {category}, but it left {whose} {from} {when}. It's money moving between {whose} own accounts.",
      "The {amount} that reached {whose} {account} on {date} came from {whose} {from}, yet it's counted as {category}.",
      "{whose} {account} got {amount} on {date}, counted as {category}, and the same amount left {whose} {from} {when}.",
      "{amount} counted as {category} on {date} is money {whose} {from} sent to {whose} {account}."
    ],
    phrasings: [
      "{count} payments into {whose} {account} ({total}) are counted as income, but each left {whose} {from} within a few days. They're money moving between {whose} own accounts.",
      "{total} counted as income in {whose} {account} came from {whose} {from}, in {count} payments.",
      "{count} payments ({total}) moved from {whose} {from} to {whose} {account}, and they're counted as income.",
      "{whose} {account} has {count} payments ({total}) counted as income that came from {whose} {from}."
    ],
    think: [
      "Counting it as income makes the month look richer than it was.",
      "Linking the two as a transfer takes it out of income and spending.",
      "A transfer between your own accounts is neither earned nor spent."
    ],
    sorted: {
      fact: "Sorted: money moved between {whose} own accounts no longer counts as income.",
      think: "Income now shows only what was earned."
    },
    action: "Show these entries"
  },
  upcomingShortfall: {
    phrasings: [
      "{whose} {account} had {balance} on {date}. Its {payee} payments take {monthly} around the {day}, so {story}.",
      "{whose} {account} won't cover {shortMonth}'s {payee} payments: it had {balance} on {date}, and {due} {is} due by {shortDate}.",
      "{due} in {payee} payments {is} due from {whose} {account} by {shortDate}, and it had {balance} on {date}: {short} short.",
      "Going by the {date} statement, {whose} {account} is {short} short for the {payee} payments due by {shortDate}."
    ],
    think: [
      "Based on the {date} statement and the payments that came from it each month before. A top-up, or moving the payments, clears it.",
      "This only counts payments that already repeat from {account}, so it can't see new ones.",
      "If money is already on its way in, this clears once it's recorded here."
    ],
    sorted: {
      fact: "Sorted: {whose} {account} has enough for its next payments.",
      think: "Going by its latest statement and what's recorded since."
    }
  }
} satisfies CopyCatalogue;

// "3rd", "21st".
export function ordinalDay(day: number) {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}

// "$1,500 a month in payments to Ifast Financial", or a list across payees.
function paymentsPhrase(payments: Array<{ payee: string; amountMinor: number }>, formatMoney: FormatMoney) {
  const payees = [...new Set(payments.map((item) => item.payee))];
  const totalMinor = payments.reduce((total, item) => total + item.amountMinor, 0);
  if (payees.length === 1) {
    return `${formatMoney(totalMinor)} a month to ${payees[0]}`;
  }
  return `${joinWithAnd(payments.map((item) => `${formatMoney(item.amountMinor)} to ${item.payee}`))} a month`;
}

function payeeOf(payees: string[]) {
  const unique = [...new Set(payees)];
  return unique.length === 1 ? unique[0] : "regular";
}

// To do: regular income now goes to another account while payments are
// still scheduled on this one. The biggest payments first.
export function incomeMovedSignal(input: AccountSignalInput): MoneySignal | null {
  const pick = (input.accountPills ?? [])
    .filter((pill) => pill.incomeMoved?.payments.length)
    .map((pill) => ({ pill, moved: pill.incomeMoved!, totalMinor: pill.incomeMoved!.payments.reduce((total, item) => total + item.amountMinor, 0) }))
    .sort((left, right) => right.totalMinor - left.totalMinor || left.pill.accountName.localeCompare(right.pill.accountName))[0];
  if (!pick) {
    return null;
  }
  const { pill, moved } = pick;
  const whose = whoseAccount(pill, input.audience, input.viewLabel);
  const income = moved.isSalary ? "salary" : `income from ${moved.payer}`;
  const held = moved.statementEndDate && moved.statementBalanceMinor !== undefined
    ? ` It had ${input.formatMoney(moved.statementBalanceMinor)} on ${shortDay(moved.statementEndDate)}.`
    : "";
  const values = {
    whose,
    income,
    to: moved.toAccountName,
    date: shortDay(moved.movedSince),
    account: pill.accountName,
    payments: paymentsPhrase(moved.payments, input.formatMoney),
    // "$1,500 a month to Ifast Financial still leaves"; a list of payees reads plural.
    leave: new Set(moved.payments.map((item) => item.payee)).size === 1 ? "leaves" : "leave",
    held
  };
  return {
    key: `income-moved:${pill.accountId}:${moved.movedSince}`,
    kind: "quick_fix",
    weight: pick.totalMinor,
    numbers: { primaryMinor: pick.totalMinor },
    primaryText: input.formatMoney(pick.totalMinor),
    phrasings: phrase(ACCOUNT_COPY.incomeMoved, values),
    sorted: sortedLine(ACCOUNT_COPY.incomeMoved.sorted, values),
    basis: {
      lines: [
        textLine("Income", moved.isSalary ? "Salary" : `Income from ${moved.payer}`),
        textLine("Now paid into", `${moved.toAccountName} since ${shortDay(moved.movedSince)}`),
        textLine("Payments still made from", walletText(pill.accountName, pill.ownerLabel)),
        ...moved.payments.map((item) => amountLine(`Monthly payment to ${item.payee}`, item.amountMinor)),
        ...(moved.statementEndDate && moved.statementBalanceMinor !== undefined
          ? [amountLine(`Balance on ${shortDay(moved.statementEndDate)}`, moved.statementBalanceMinor)]
          : [])
      ],
      entries: { accountId: pill.accountId, month: moved.movedSince.slice(0, 7) }
    },
    topic: "plan"
  };
}

// To do: a payment that came every month didn't go through, and the bank
// charged for trying. The latest such day.
export function missedPaymentsSignal(input: AccountSignalInput): MoneySignal | null {
  const cutoff = addDays(input.today, -75);
  const pick = (input.accountPills ?? []).flatMap((pill) => {
    const recent = (pill.missedPayments ?? []).filter((item) => item.dueDate >= cutoff && item.dueDate <= input.today);
    const latestDate = recent.map((item) => item.dueDate).sort().at(-1);
    const sameDay = recent.filter((item) => item.dueDate === latestDate);
    return sameDay.length ? [{ pill, items: sameDay }] : [];
  }).sort((left, right) => right.items[0].dueDate.localeCompare(left.items[0].dueDate) || left.pill.accountName.localeCompare(right.pill.accountName))[0];
  if (!pick) {
    return null;
  }
  const totalMinor = pick.items.reduce((total, item) => total + item.amountMinor, 0);
  const chargesMinor = pick.items.reduce((total, item) => total + item.chargeMinor, 0);
  const sameCharge = pick.items.every((item) => item.chargeMinor === pick.items[0].chargeMinor);
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    payee: payeeOf(pick.items.map((item) => item.payee)),
    amounts: joinWithAnd(pick.items.map((item) => input.formatMoney(item.amountMinor))),
    total: input.formatMoney(totalMinor),
    charge: sameCharge ? input.formatMoney(pick.items[0].chargeMinor) : input.formatMoney(chargesMinor),
    charges: input.formatMoney(chargesMinor),
    date: shortDay(pick.items[0].dueDate),
    month: monthName(pick.items[0].dueDate.slice(0, 7))
  };
  return {
    key: `missed-payment:${pick.pill.accountId}:${pick.items[0].dueDate}`,
    kind: "quick_fix",
    weight: totalMinor,
    numbers: { primaryMinor: totalMinor, chargesMinor },
    primaryText: values.total,
    phrasings: phrase(ACCOUNT_COPY.missedPayments, values, { one: pick.items.length === 1 }),
    sorted: sortedLine(ACCOUNT_COPY.missedPayments.sorted, values),
    basis: {
      lines: [
        textLine("Account", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        ...pick.items.map((item) => amountLine(`Payment to ${item.payee} due ${shortDay(item.dueDate)}`, item.amountMinor)),
        amountLine(pick.items.length === 1 ? "Bank charge for the failed payment" : "Bank charges for the failed payments", chargesMinor)
      ],
      entries: { accountId: pick.pill.accountId, month: pick.items[0].dueDate.slice(0, 7) },
      month: pick.items[0].dueDate.slice(0, 7)
    },
    topic: "later"
  };
}

const ACCOUNT_CHARGE_LOOKBACK_DAYS = 60;

// Worth knowing: a bank account's own charges in their latest month. A
// charge for a failed payment always counts; a small monthly fee alone
// counts once it has come three months in a row.
export function accountChargesSignal(input: AccountSignalInput): MoneySignal | null {
  const cutoff = addDays(input.today, -ACCOUNT_CHARGE_LOOKBACK_DAYS);
  const candidates = (input.accountPills ?? []).flatMap((pill) => {
    const charges = (pill.accountCharges ?? []).filter((charge) => charge.date <= input.today);
    const feeMonths = [...new Set(charges.filter((charge) => charge.kind === "account_fee").map((charge) => charge.date.slice(0, 7)))].sort();
    const failed = charges.filter((charge) => charge.kind === "failed_payment" && charge.date >= cutoff);
    const feeRun = trailingRun(feeMonths);
    if (failed.length) {
      const month = failed.map((charge) => charge.date.slice(0, 7)).sort().at(-1)!;
      return [{ pill, month, inMonth: charges.filter((charge) => charge.date.slice(0, 7) === month), feeMonths, feeRun, feesOnly: false }];
    }
    const latestFee = feeMonths.at(-1);
    if (feeRun >= 3 && latestFee && `${latestFee}-31` >= cutoff) {
      return [{ pill, month: latestFee, inMonth: charges.filter((charge) => charge.date.slice(0, 7) === latestFee), feeMonths, feeRun, feesOnly: true }];
    }
    return [];
  });
  const pick = candidates
    .map((item) => ({ ...item, totalMinor: item.inMonth.reduce((total, charge) => total + charge.amountMinor, 0) }))
    .sort((left, right) => right.totalMinor - left.totalMinor || left.pill.accountName.localeCompare(right.pill.accountName))[0];
  if (!pick) {
    return null;
  }
  const fee = pick.inMonth.find((charge) => charge.kind === "account_fee");
  const failed = pick.inMonth.filter((charge) => charge.kind === "failed_payment");
  const sinceMonth = pick.feeMonths[pick.feeMonths.length - Math.max(pick.feeRun, 1)] ?? pick.month;
  const parts: string[] = [];
  if (failed.length) {
    const same = failed.every((charge) => charge.amountMinor === failed[0].amountMinor);
    parts.push(same
      ? `${failed.length === 1 ? "a" : numberWord(failed.length)} ${input.formatMoney(failed[0].amountMinor)} ${failed.length === 1 ? "charge" : "charges"} for ${failed.length === 1 ? "a failed payment" : "failed payments"}`
      : `${input.formatMoney(failed.reduce((total, charge) => total + charge.amountMinor, 0))} for failed payments`);
  }
  if (fee) {
    parts.push(`its ${input.formatMoney(fee.amountMinor)} monthly fee`);
  }
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    total: input.formatMoney(pick.totalMinor),
    month: monthName(pick.month),
    charges: joinWithAnd(parts),
    fee: fee ? input.formatMoney(fee.amountMinor) : "",
    yearly: fee ? input.formatMoney(fee.amountMinor * 12) : "",
    since: monthName(sinceMonth)
  };
  // Only the think lines that apply: the fee line needs a fee that repeats.
  const copy = pick.feesOnly ? ACCOUNT_COPY.accountFees : ACCOUNT_COPY.accountCharges;
  const thinks = pick.feesOnly
    ? copy.think
    : ACCOUNT_COPY.accountCharges.think.filter((line) => (fee && pick.feeRun >= 2) || !line.includes("{fee}"));
  return {
    key: `account-charges:${pick.pill.accountId}:${pick.month}`,
    kind: "worth_a_look",
    weight: pick.totalMinor,
    numbers: { primaryMinor: pick.totalMinor },
    primaryText: values.total,
    phrasings: phrase(copy, values, { think: thinks }),
    basis: {
      lines: [
        textLine("Account", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        ...[...pick.inMonth]
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((charge) => amountLine(`${ACCOUNT_CHARGE_LABELS[charge.kind] ?? "Bank charge"} on ${shortDay(charge.date)}`, charge.amountMinor)),
        amountLine(`Charges in ${monthYear(pick.month)}`, pick.totalMinor)
      ],
      entries: { accountId: pick.pill.accountId, month: pick.month },
      month: pick.month
    },
    topic: "small-costs"
  };
}

// A bank account's charge, as its basis line names it.
const ACCOUNT_CHARGE_LABELS: Record<string, string> = {
  failed_payment: "Charge for a failed payment",
  account_fee: "Monthly fee"
};

function trailingRun(months: string[]) {
  let run = months.length ? 1 : 0;
  for (let index = months.length - 1; index > 0; index -= 1) {
    const [year, month] = months[index].split("-").map(Number);
    const [prevYear, prevMonth] = months[index - 1].split("-").map(Number);
    if ((year * 12 + month) - (prevYear * 12 + prevMonth) !== 1) {
      break;
    }
    run += 1;
  }
  return run;
}

// To do: income that is really money moved from another of the owner's
// accounts. The account with the most counted as income first.
export function ownTransferIncomeSignal(input: AccountSignalInput): MoneySignal | null {
  const pick = (input.accountPills ?? [])
    .filter((pill) => pill.ownTransfersAsIncome?.length)
    .map((pill) => ({ pill, items: pill.ownTransfersAsIncome!, totalMinor: pill.ownTransfersAsIncome!.reduce((total, item) => total + item.amountMinor, 0) }))
    .sort((left, right) => right.totalMinor - left.totalMinor || left.pill.accountName.localeCompare(right.pill.accountName))[0];
  if (!pick) {
    return null;
  }
  const largest = [...pick.items].sort((left, right) => right.amountMinor - left.amountMinor)[0];
  const fromAccounts = [...new Set(pick.items.map((item) => item.fromAccountName))];
  const values = {
    whose: whoseAccount(pick.pill, input.audience, input.viewLabel),
    account: pick.pill.accountName,
    from: fromAccounts.length === 1 ? fromAccounts[0] : "other accounts",
    amount: input.formatMoney(largest.amountMinor),
    total: input.formatMoney(pick.totalMinor),
    count: pick.items.length,
    date: shortDay(largest.date),
    when: largest.fromDate === largest.date ? "the same day" : `on ${shortDay(largest.fromDate)}`,
    category: incomeWord(largest.categoryName)
  };
  // The newest entries first, so the link opens the month of the latest one.
  const newest = [...pick.items].sort((left, right) => right.date.localeCompare(left.date));
  const linkMonth = newest[0].date.slice(0, 7);
  const linked = newest.filter((item) => item.date.slice(0, 7) === linkMonth);
  return {
    key: `own-transfer-income:${pick.pill.accountId}:${pick.items.length}:${pick.totalMinor}`,
    kind: "quick_fix",
    weight: pick.totalMinor,
    numbers: { primaryMinor: pick.totalMinor },
    primaryText: values.total,
    phrasings: phrase(ACCOUNT_COPY.ownTransferIncome, values, { one: pick.items.length === 1 }),
    sorted: sortedLine(ACCOUNT_COPY.ownTransferIncome.sorted, values),
    action: {
      id: "show-entries",
      label: ACCOUNT_COPY.ownTransferIncome.action,
      entryIds: linked.flatMap((item) => [item.entryId, item.fromEntryId]),
      month: linkMonth
    },
    basis: {
      lines: [
        textLine("Account", walletText(pick.pill.accountName, pick.pill.ownerLabel)),
        textLine("Moved in from", values.from),
        textLine("Moves counted as income", pick.items.length),
        amountLine(`Largest, on ${shortDay(largest.date)}`, largest.amountMinor),
        amountLine("Counted as income in all", pick.totalMinor)
      ],
      entries: { entryIds: linked.flatMap((item) => [item.entryId, item.fromEntryId]), month: linkMonth },
      month: linkMonth
    },
    topic: "steady"
  };
}

// "Salary" reads "salary"; "Other - Income" reads "other income".
function incomeWord(categoryName: string) {
  const name = String(categoryName ?? "").replace(/\s*-\s*Income$/i, " income").trim();
  return name ? name.toLowerCase() : "income";
}

// To do (the scheduled check): the account's latest statement balance
// can't cover payments that already repeat from it, due within a month.
export function upcomingShortfallSignal(input: AccountSignalInput): MoneySignal | null {
  const pick = (input.accountPills ?? [])
    .filter((pill) => pill.upcomingShortfall?.payments.length)
    .sort((left, right) => right.upcomingShortfall!.shortMinor - left.upcomingShortfall!.shortMinor || left.accountName.localeCompare(right.accountName))[0];
  if (!pick) {
    return null;
  }
  const shortfall = pick.upcomingShortfall!;
  const byMonth = new Map<string, number>();
  for (const payment of shortfall.payments) {
    const month = payment.dueDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + payment.amountMinor);
  }
  const shortMonth = shortfall.firstShortDate.slice(0, 7);
  let running = shortfall.balanceMinor;
  const story: string[] = [];
  for (const [month, amountMinor] of [...byMonth].sort(([left], [right]) => left.localeCompare(right))) {
    running -= amountMinor;
    story.push(month === shortMonth ? `${monthName(month)}'s won't fit` : `${monthName(month)}'s leaves about ${input.formatMoney(Math.max(0, running))}`);
    if (month === shortMonth) {
      break;
    }
  }
  const dueMinor = shortfall.payments.reduce((total, payment) => total + payment.amountMinor, 0);
  const monthlyMinor = byMonth.get(shortMonth) ?? dueMinor;
  const days = [...new Set(shortfall.payments.map((payment) => Number(payment.dueDate.slice(8))))];
  const sinceStatement = shortfall.balanceMinor !== shortfall.statementBalanceMinor;
  const values = {
    whose: whoseAccount(pick, input.audience, input.viewLabel),
    account: pick.accountName,
    balance: input.formatMoney(shortfall.balanceMinor),
    date: sinceStatement ? `${shortDay(shortfall.statementEndDate)} plus what's recorded since` : shortDay(shortfall.statementEndDate),
    payee: payeeOf(shortfall.payments.map((payment) => payment.payee)),
    monthly: input.formatMoney(monthlyMinor),
    day: days.length === 1 ? ordinalDay(days[0]) : `${ordinalDay(Math.min(...days))} to ${ordinalDay(Math.max(...days))}`,
    story: joinWithAnd(story),
    shortMonth: monthName(shortMonth),
    due: input.formatMoney(dueMinor),
    is: "is",
    shortDate: shortDay(shortfall.firstShortDate),
    short: input.formatMoney(shortfall.shortMinor)
  };
  return {
    key: `upcoming-shortfall:${pick.accountId}:${shortfall.firstShortDate}`,
    kind: "quick_fix",
    weight: shortfall.shortMinor,
    numbers: { primaryMinor: shortfall.shortMinor },
    primaryText: values.short,
    phrasings: phrase(ACCOUNT_COPY.upcomingShortfall, values),
    sorted: sortedLine(ACCOUNT_COPY.upcomingShortfall.sorted, values),
    basis: {
      lines: [
        textLine("Account", walletText(pick.accountName, pick.ownerLabel)),
        amountLine(sinceStatement
          ? `Balance on the ${shortDay(shortfall.statementEndDate)} statement, plus what's recorded since`
          : `Balance on the ${shortDay(shortfall.statementEndDate)} statement`, shortfall.balanceMinor),
        ...[...shortfall.payments]
          .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
          .slice(0, 6)
          .map((payment) => amountLine(`${payment.payee} due ${shortDay(payment.dueDate)}`, payment.amountMinor)),
        amountLine("Short by", shortfall.shortMinor)
      ],
      entries: { accountId: pick.accountId, month: shortfall.statementEndDate.slice(0, 7) }
    },
    topic: "plan"
  };
}

export function buildAccountSignals(input: AccountSignalInput): MoneySignal[] {
  return [
    upcomingShortfallSignal(input),
    missedPaymentsSignal(input),
    incomeMovedSignal(input),
    ownTransferIncomeSignal(input),
    accountChargesSignal(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
