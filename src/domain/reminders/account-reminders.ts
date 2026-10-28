// Two reminder kinds read from an account's statements: a card bill coming
// due, and a statement that should be out but is not imported yet.
import { buildCardBillFacts } from "../card-bill-projection";
import { addMonths, daysBetween, daysInMonth } from "../money-signals/format";
import type { CardBillReminderDto, StatementMissingReminderDto } from "../../types/dto";
import { accountInView, type ReminderAccount, type ReminderInputs } from "./facts";
import { REMINDER_THRESHOLDS } from "./thresholds";

// Card bill due: a statement that owes money and carries a due date, from a
// week before the due date, and for 30 days after it while less than the
// minimum is paid. It is the check-in's cardBillSignal rule, one reminder
// per card. Payments are the ledger's transfers into the card, so one made
// from a bank not imported yet is not seen (the snooze sheet's "Paid from
// another account" covers that).
export function cardBillReminders(input: Pick<ReminderInputs, "today" | "viewId" | "accounts" | "cardPayments">): CardBillReminderDto[] {
  const cards = input.accounts.filter((account) => account.kind === "credit_card" && accountInView(account, input.viewId));
  const facts = buildCardBillFacts({
    accounts: cards.map((card) => ({
      id: card.id,
      kind: card.kind,
      checkpointHistory: card.checkpoints.map((checkpoint) => ({
        month: checkpoint.month,
        statementEndDate: checkpoint.statementEndDate,
        statementBalanceMinor: checkpoint.statementBalanceMinor,
        paymentDueDate: checkpoint.paymentDueDate,
        minimumPaymentMinor: checkpoint.minimumPaymentMinor,
        computedBalanceMinor: 0,
        deltaMinor: 0
      }))
    })),
    transactions: input.cardPayments,
    today: input.today
  });

  const { daysBeforeDue, daysOverdue } = REMINDER_THRESHOLDS.cardBill;
  const reminders: CardBillReminderDto[] = [];
  for (const card of cards) {
    const bill = facts.get(card.id)?.cardBill;
    if (!bill) {
      continue;
    }
    const leftMinor = bill.owedMinor - bill.paidSinceMinor;
    const daysUntilDue = daysBetween(input.today, bill.paymentDueDate);
    if (leftMinor <= 0) {
      continue;
    }
    if (daysUntilDue < 0) {
      const shortOfMinimum = bill.paidSinceMinor < (bill.minimumMinor ?? bill.owedMinor);
      if (!shortOfMinimum || -daysUntilDue > daysOverdue) {
        continue;
      }
    } else if (daysUntilDue > daysBeforeDue) {
      continue;
    }
    reminders.push({
      key: `card_bill:${card.id}:${bill.statementMonth}`,
      kind: "card_bill",
      accountId: card.id,
      accountName: card.name,
      statementMonth: bill.statementMonth,
      dueDate: bill.paymentDueDate,
      daysUntilDue,
      leftMinor,
      paidMinor: bill.paidSinceMinor,
      currency: card.currency
    });
  }
  return reminders;
}

// The middle value of a few days of the month; the lower one for two.
function medianDay(days: number[]) {
  const sorted = [...days].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// The day a statement falls on in a month: its usual closing day, kept
// inside the month (the 31st reads as the 30th in September).
function closingDateIn(month: string, usualDay: number) {
  return `${month}-${String(Math.min(usualDay, daysInMonth(month))).padStart(2, "0")}`;
}

// The statement the account should have by now, or null while it is not
// late. The usual closing day is the median day of the account's last three
// statement end dates; the next statement is expected on that day a month
// after the latest one. Needs two statements: an account with none stays
// quiet (that is Import inbox setup, not a reminder).
export function expectedStatement(account: ReminderAccount, today: string) {
  const { minStatements, closingDaySample, graceDays } = REMINDER_THRESHOLDS.statementMissing;
  const dated = account.checkpoints
    .filter((checkpoint) => checkpoint.statementEndDate)
    .sort((left, right) => left.month.localeCompare(right.month));
  if (dated.length < minStatements) {
    return null;
  }
  const usualDay = medianDay(dated.slice(-closingDaySample).map((checkpoint) => Number(checkpoint.statementEndDate!.slice(8, 10))));
  const latest = dated[dated.length - 1];
  // A checkpoint without an end date can still be the latest month.
  const latestMonth = account.checkpoints.reduce((max, checkpoint) => (checkpoint.month > max ? checkpoint.month : max), latest.month);
  const statementMonth = addMonths(latestMonth, 1);
  const latestEndMonth = latestMonth === latest.month ? latest.statementEndDate!.slice(0, 7) : latestMonth;
  const expectedOn = closingDateIn(addMonths(latestEndMonth, 1), usualDay);
  const daysSinceExpected = daysBetween(expectedOn, today);
  return daysSinceExpected >= graceDays ? { statementMonth, expectedOn, daysSinceExpected } : null;
}

// Statement not imported yet: an active bank or card account whose next
// statement is overdue by the rule above. It goes away when the statement is
// imported (a checkpoint exists for that month, so the next one is expected)
// or the account is archived.
export function statementMissingReminders(input: Pick<ReminderInputs, "today" | "viewId" | "accounts">): StatementMissingReminderDto[] {
  const reminders: StatementMissingReminderDto[] = [];
  for (const account of input.accounts) {
    if (!["bank", "credit_card"].includes(account.kind) || !accountInView(account, input.viewId)) {
      continue;
    }
    const expected = expectedStatement(account, input.today);
    if (!expected) {
      continue;
    }
    reminders.push({
      key: `statement:${account.id}:${expected.statementMonth}`,
      kind: "statement_missing",
      accountId: account.id,
      accountName: account.name,
      ...expected
    });
  }
  return reminders;
}

// Whether an account has the statement for a month (the month-close rule).
export function hasStatementForMonth(account: ReminderAccount, month: string) {
  return account.checkpoints.some((checkpoint) => checkpoint.month === month);
}
