import type { ReminderDto } from "../../types/dto";
import { cardBillReminders, statementMissingReminders } from "./account-reminders";
import type { ReminderInputs } from "./facts";
import { monthCloseReminders } from "./month-close-reminder";
import { priceChangeReminders } from "./price-change-reminders";
import { splitsWaitingReminders } from "./splits-reminders";

// Position in the list: overdue bills, bills due soonest, month close,
// statements (oldest first), Splits (longest waiting first), price changes.
function rank(reminder: ReminderDto) {
  switch (reminder.kind) {
    case "card_bill": return reminder.daysUntilDue < 0 ? 0 : 1;
    case "month_close": return 2;
    case "statement_missing": return 3;
    case "splits_waiting": return 4;
    case "price_change": return 5;
  }
}

// Within a rank: the most overdue or soonest bill, the oldest statement, the
// longest waiting Splits, the earliest month. Price changes have no order
// beyond the money tie-break.
function withinRank(reminder: ReminderDto) {
  switch (reminder.kind) {
    case "card_bill": return reminder.daysUntilDue;
    case "month_close": return Number(reminder.month.replace("-", ""));
    case "statement_missing": return -reminder.daysSinceExpected;
    case "splits_waiting": return -reminder.weeks * 1000 - (reminder.variant === "settle_up" ? 1 : 0);
    case "price_change": return 0;
  }
}

// Ties: more money first.
function moneyOf(reminder: ReminderDto) {
  switch (reminder.kind) {
    case "card_bill": return reminder.leftMinor;
    case "splits_waiting": return reminder.amountMinor;
    case "price_change": return reminder.toMinor - reminder.fromMinor;
    default: return 0;
  }
}

// Every reminder the fixed rules raise for a view today, in the order they
// show. Pure: the loader passes the facts and the household's day, so the
// same facts always give the same list, and nothing here reads a clock, a
// database or a model.
export function buildReminders(input: ReminderInputs): ReminderDto[] {
  const monthClose = monthCloseReminders(input);
  const reminders: ReminderDto[] = [
    ...cardBillReminders(input),
    ...monthClose,
    ...statementMissingReminders(input),
    ...priceChangeReminders(input),
    // While the month-close card still asks about Splits, its Splits row
    // replaces the standalone reminders.
    ...(monthClose.some((card) => !card.allDone) ? [] : splitsWaitingReminders(input))
  ];
  return reminders.sort((left, right) => (
    rank(left) - rank(right)
    || withinRank(left) - withinRank(right)
    || moneyOf(right) - moneyOf(left)
    || left.key.localeCompare(right.key)
  ));
}
