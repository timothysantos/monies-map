// Month ready to close: for the last complete month (and the one before it
// for 45 days after it ended), from the day every active statement account
// has its statement for it, until all four checks are done. Guidance only:
// nothing records a month as closed (owner decision D3).
import { addDays, addMonths, daysBetween } from "../money-signals/format";
import type { MonthCloseCheckDto, MonthCloseReminderDto } from "../../types/dto";
import { accountInView, type ReminderInputs } from "./facts";
import { hasStatementForMonth } from "./account-reminders";
import { openSplitsAsOf } from "./splits-reminders";
import { REMINDER_THRESHOLDS } from "./thresholds";

export function lastCompleteMonth(today: string) {
  return addMonths(today.slice(0, 7), -1);
}

const lastDayOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

// The months a card can be asked about today: the last complete month, and
// the one before it while it ended no more than 45 days ago.
export function monthCloseCandidateMonths(today: string) {
  const last = lastCompleteMonth(today);
  const before = addMonths(last, -1);
  return daysBetween(lastDayOf(before), today) <= REMINDER_THRESHOLDS.monthClose.showDaysAfterMonthEnd ? [before, last] : [last];
}

// Accounts with no statement at all stay quiet, as for the missing-statement
// reminder: they are Import inbox setup, not something to wait for.
function statementAccountsOf(input: Pick<ReminderInputs, "accounts" | "viewId">) {
  return input.accounts.filter((account) => (
    ["bank", "credit_card"].includes(account.kind) && accountInView(account, input.viewId) && account.checkpoints.length > 0
  ));
}

// The candidate months whose statements are all in: the only months the
// loader needs to read entries and a note for.
export function monthsWithAllStatements(input: Pick<ReminderInputs, "today" | "accounts" | "viewId">) {
  const statementAccounts = statementAccountsOf(input);
  return monthCloseCandidateMonths(input.today).filter((month) => (
    statementAccounts.length > 0 && statementAccounts.every((account) => hasStatementForMonth(account, month))
  ));
}

function monthCloseCard(input: ReminderInputs, month: string): MonthCloseReminderDto | null {
  const facts = input.monthClose[month];
  const statementAccounts = statementAccountsOf(input);
  if (!facts || !statementAccounts.length || !statementAccounts.every((account) => hasStatementForMonth(account, month))) {
    return null;
  }

  const splits = openSplitsAsOf(input, lastDayOf(month));
  const checks: MonthCloseCheckDto[] = [
    { id: "statements", done: true, count: statementAccounts.length },
    { id: "other", done: facts.otherEntryCount === 0, count: facts.otherEntryCount },
    { id: "splits", done: splits.count === 0, ...splits },
    { id: "note", done: facts.hasNote, count: facts.hasNote ? 1 : 0 }
  ];
  return {
    key: `month_close:${month}`,
    kind: "month_close",
    month,
    checks,
    allDone: checks.every((check) => check.done)
  };
}

// Oldest month first.
export function monthCloseReminders(input: ReminderInputs): MonthCloseReminderDto[] {
  return monthCloseCandidateMonths(input.today).flatMap((month) => monthCloseCard(input, month) ?? []);
}

// The last complete month's card alone.
export function monthCloseReminder(input: ReminderInputs): MonthCloseReminderDto | null {
  return monthCloseCard(input, lastCompleteMonth(input.today));
}
