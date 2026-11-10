// What the reminder cards at the top of Ask show, as plain data (docs/flows/
// reminders-flow.md). Pure: the server's reminders (GET /api/reminders), what
// this device remembers (reminders-device-state.js), the day, whether money is
// hidden and a money formatter go in; cards, their words, their money tones,
// the page each one opens and its Later choices come out. The components
// (reminders-block.jsx) only lay these out, and tests/reminders-client-model.
// test.mjs pins them.

import { isReminderHidden } from "./reminders-device-state";
import { shiftIsoDate } from "./reminders-actions";
import { remindersCopy as copy, reminderDate, reminderMonthName, reminderShortDate } from "./copy/reminders-copy";

// At most this many cards before "N more reminders": a phone keeps the brief
// peeking above the chips, the wide docked panel has room for three.
export const PHONE_CARD_LIMIT = 2;
export const DOCK_CARD_LIMIT = 3;

export function cardLimitFor(placement) {
  return placement === "docked" ? DOCK_CARD_LIMIT : PHONE_CARD_LIMIT;
}

const nextMonthOf = (month) => {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
};

// The coming Monday: next week's first day, never today.
export function nextMondayAfter(today) {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftIsoDate(today, ((8 - weekday) % 7) || 7);
}

// Later: Tomorrow, In 3 days, Next week, each with its date, then one "not
// for this one" choice for the kind. A price change has none of it ("Got it").
export function laterChoices(reminder, today) {
  const days = [
    { id: "tomorrow", label: copy.laterSheet.tomorrow, date: shiftIsoDate(today, 1) },
    { id: "in-3-days", label: copy.laterSheet.inThreeDays, date: shiftIsoDate(today, 3) },
    { id: "next-week", label: copy.laterSheet.nextWeek, date: nextMondayAfter(today) }
  ].map((choice) => ({ ...choice, dateText: reminderDate(choice.date) }));
  switch (reminder.kind) {
    case "card_bill":
      return { days, skips: [copy.cardBill.skip, copy.cardBill.elsewhere], note: copy.cardBill.laterNote };
    case "statement_missing":
      return { days, skips: [copy.statement.skip(reminderMonthName(nextMonthOf(reminder.statementMonth)))], note: copy.statement.laterNote };
    case "splits_waiting":
      return { days, skips: [copy.splits.skip], note: copy.splits.laterNote };
    case "month_close":
      return { days, skips: [copy.monthClose.skip], note: copy.monthClose.laterNote };
    case "tax_relief":
      return { days, skips: [copy.taxRelief.skip], note: copy.taxRelief.laterNote };
    default:
      return null;
  }
}

function laterTitleFor(reminder) {
  switch (reminder.kind) {
    case "card_bill": return copy.cardBill.laterTitle(reminder.accountName);
    case "statement_missing": return copy.statement.laterTitle(reminder.accountName, reminderMonthName(reminder.statementMonth));
    case "splits_waiting": return reminder.direction === "between" ? copy.splits.laterTitleHousehold : copy.splits.laterTitle(otherName(reminder));
    case "month_close": return copy.monthClose.laterTitle(reminderMonthName(reminder.month));
    case "tax_relief": return copy.taxRelief.laterTitle;
    default: return "";
  }
}

// The other person in a Splits reminder, from the viewer's side.
function otherName(reminder) {
  return reminder.direction === "you_owe" ? reminder.toName : reminder.fromName;
}

function moneyText(minor, currency, { hidden, formatMoney }) {
  return hidden ? copy.hiddenAmount : formatMoney(minor, currency);
}

// The page a card (or one of a checklist's rows) opens: a path and the
// filters to put on it. The view, month and scope come from the Ask page.
export function reminderTarget(reminder, row = null) {
  switch (reminder.kind) {
    case "card_bill":
      return { pathname: "/entries", extra: { entry_wallet: reminder.accountId } };
    case "statement_missing":
      return { pathname: "/imports", extra: {} };
    case "splits_waiting":
      return { pathname: "/splits", extra: {} };
    case "price_change":
      return { pathname: "/entries", extra: { entry_search: reminder.payeeName } };
    case "tax_relief":
      return { pathname: "/summary", extra: {} };
    case "month_close":
      if (row === "statements") return { pathname: "/imports", extra: {} };
      if (row === "other") return { pathname: "/entries", extra: { month: reminder.month, entry_category: "Other" } };
      if (row === "splits") return { pathname: "/splits", extra: {} };
      return { pathname: "/month", extra: { month: reminder.month } };
    default:
      return { pathname: "/summary", extra: {} };
  }
}

function checkRows(reminder, options) {
  const rows = copy.monthClose.checks;
  return reminder.checks.map((check) => {
    if (check.id === "statements") {
      return { id: "statements", done: true, label: rows.statements.label, value: rows.statements.value(check.count), amountText: "", amountTone: "neutral", opens: false };
    }
    if (check.id === "other") {
      return { id: "other", done: check.done, label: rows.other.label, value: rows.other.value(check.count), amountText: "", amountTone: "neutral", opens: !check.done };
    }
    if (check.id === "splits") {
      if (check.done) {
        return { id: "splits", done: true, label: rows.splits.label, value: rows.splits.none, amountText: "", amountTone: "neutral", opens: false };
      }
      // One open balance with one person says how much; several only count.
      const single = typeof check.amountMinor === "number" && check.withName;
      return {
        id: "splits",
        done: false,
        label: rows.splits.label,
        value: single ? rows.splits.withName(check.withName) : rows.splits.many(check.count),
        amountText: single ? moneyText(check.amountMinor, check.currency ?? "SGD", options) : "",
        // The check does not say which way the money goes, so it stays plain ink.
        amountTone: "neutral",
        opens: true
      };
    }
    return {
      id: "note",
      done: check.done,
      label: rows.note.label,
      value: check.done ? rows.note.written : rows.note.notWritten,
      amountText: "",
      amountTone: "neutral",
      opens: !check.done
    };
  });
}

function buildCard(reminder, options) {
  const { today, hidden, formatMoney } = options;
  const base = { key: reminder.key, kind: reminder.kind, hidden, target: reminderTarget(reminder), later: laterChoices(reminder, today), laterTitle: laterTitleFor(reminder), amountText: "", amountTone: "neutral" };
  switch (reminder.kind) {
    case "card_bill": {
      const overdue = reminder.daysUntilDue < 0;
      return {
        ...base,
        icon: "card",
        tone: "butter",
        title: copy.cardBill.title(reminder.accountName, reminder.daysUntilDue),
        sentence: copy.cardBill.sentence({
          dueText: reminderDate(reminder.dueDate),
          overdue,
          hasPaid: reminder.paidMinor > 0,
          paidText: reminder.paidMinor > 0 && !hidden ? moneyText(reminder.paidMinor, reminder.currency, options) : ""
        }),
        amountText: moneyText(reminder.leftMinor, reminder.currency, options),
        // Plain ink until the bill is late; then it is a debt (rose).
        amountTone: overdue && !hidden ? "short" : "neutral",
        primaryLabel: copy.cardBill.open,
        quiet: "later"
      };
    }
    case "statement_missing": {
      const monthName = reminderMonthName(reminder.statementMonth);
      return {
        ...base,
        icon: "file",
        tone: "sky",
        title: copy.statement.title(reminder.accountName, monthName),
        sentence: copy.statement.sentence(reminder.daysSinceExpected, reminderShortDate(reminder.expectedOn), monthName),
        primaryLabel: copy.statement.open,
        quiet: "later"
      };
    }
    case "splits_waiting": {
      const common = { direction: reminder.direction, otherName: otherName(reminder), fromName: reminder.fromName, toName: reminder.toName, weeks: reminder.weeks };
      const dateText = reminderShortDate(reminder.sinceDate);
      const isSettleUp = reminder.variant === "settle_up";
      return {
        ...base,
        icon: "people",
        tone: "person",
        personName: reminder.direction === "between" ? "" : otherName(reminder),
        title: isSettleUp ? copy.splits.settleUpTitle(common) : copy.splits.balanceTitle(common),
        sentence: isSettleUp
          ? copy.splits.settleUpSentence({ ...common, dateText, hidden })
          : copy.splits.balanceSentence({ ...common, groupName: reminder.groupName ?? "", dateText, hidden }),
        amountText: moneyText(reminder.amountMinor, reminder.currency, options),
        amountTone: hidden ? "neutral" : { you_owe: "short", owed_to_you: "in", between: "neutral" }[reminder.direction],
        primaryLabel: copy.splits.open,
        quiet: "later"
      };
    }
    case "price_change": {
      const delta = reminder.toMinor - reminder.fromMinor;
      return {
        ...base,
        later: null,
        icon: "repeat",
        tone: "lavender",
        title: copy.price.title({ payeeName: reminder.payeeName, newText: moneyText(reminder.toMinor, reminder.currency, options), period: reminder.period, hidden }),
        sentence: copy.price.sentence({
          oldText: moneyText(reminder.fromMinor, reminder.currency, options),
          higher: delta > 0,
          priorCount: reminder.priorChargeCount,
          period: reminder.period,
          dateText: reminderShortDate(reminder.firstNewChargeDate),
          hidden
        }),
        amountText: hidden ? copy.hiddenAmount : `${delta > 0 ? "+" : "-"}${formatMoney(Math.abs(delta), reminder.currency)}`,
        primaryLabel: copy.price.open,
        quiet: "got-it"
      };
    }
    case "tax_relief": {
      const names = [...new Set(reminder.items.map((item) => item.personName))];
      const lines = names.map((name) => copy.taxRelief.line({
        name,
        withName: names.length > 1,
        parts: reminder.items.filter((item) => item.personName === name).map((item) => copy.taxRelief.part(formatMoney(item.roomMinor, "SGD"), copy.taxRelief.reliefs[item.relief]))
      }));
      return {
        ...base,
        icon: "calendar",
        tone: "butter",
        title: copy.taxRelief.title(reminder.daysLeft),
        sentence: hidden ? copy.taxRelief.hiddenSentence : lines.join(" "),
        primaryLabel: copy.taxRelief.open,
        quiet: "later"
      };
    }
    case "month_close": {
      const monthName = reminderMonthName(reminder.month);
      const rows = checkRows(reminder, options);
      const doneCount = rows.filter((row) => row.done).length;
      return {
        ...base,
        icon: "calendar",
        tone: "sky",
        title: copy.monthClose.title(monthName, false),
        sentence: copy.monthClose.sentence(doneCount, rows.length),
        progress: { done: rows.map((row) => row.done), label: copy.monthClose.progressLabel(doneCount, rows.length) },
        rows: rows.map((row) => ({ ...row, target: row.opens ? reminderTarget(reminder, row.id) : null })),
        primaryLabel: copy.monthClose.open(monthName),
        quiet: "later"
      };
    }
    default:
      return null;
  }
}

// The one mint line for a month that has just been finished.
function allInLine(reminder) {
  return {
    key: reminder.key,
    kind: "month_all_in",
    title: copy.monthClose.title(reminderMonthName(reminder.month), true)
  };
}

// The foldedLine a card shrinks to for the rest of the visit after a choice.
function foldedLine(key, choice) {
  return {
    key,
    kind: "folded",
    text: choice.until ? copy.folded.until(reminderDate(choice.until)) : choice.gotIt ? copy.folded.gotIt : copy.folded.skipped
  };
}

/**
 * The list Ask shows.
 * @param {{
 *   reminders: any[], state: import("./reminders-device-state").ReminderState, today: string, hidden: boolean,
 *   formatMoney: (minor: number, currency: string) => string, folded?: Record<string, { until?: string, gotIt?: boolean }>,
 *   allInKeys?: Set<string>, expanded?: boolean, limit: number
 * }} input
 */
export function buildReminderList({ reminders, state, today, hidden, formatMoney, folded = {}, allInKeys = new Set(), expanded = false, limit }) {
  const options = { today, hidden, formatMoney };
  const entries = [];
  for (const reminder of reminders) {
    const item = state.items[reminder.key];
    if (folded[reminder.key]) {
      entries.push(foldedLine(reminder.key, folded[reminder.key]));
    } else if (reminder.kind === "month_close" && reminder.allDone) {
      // Finished: one line, once, and only for a checklist this device showed open.
      if ((item?.open && !item.doneShown && !isReminderHidden(item, today)) || allInKeys.has(reminder.key)) entries.push(allInLine(reminder));
    } else if (!isReminderHidden(item, today)) {
      entries.push(buildCard(reminder, options));
    }
  }
  const shown = expanded ? entries : entries.slice(0, limit);
  return { entries: shown, total: entries.length, more: entries.length - shown.length };
}

// The check-in signals a visible reminder already says, so "Since you last
// looked" skips them: a card bill with a reminder card is not also its
// headline. (A Later or "not for this one" on the card gives the headline back.)
export function coveredSignalKeys(reminders, state, today) {
  return reminders
    .filter((reminder) => reminder.kind === "card_bill" && !isReminderHidden(state.items[reminder.key], today))
    .map((reminder) => `card-bill:${reminder.accountId}:${reminder.statementMonth}`);
}

// The checklist's own keys that are finished and about to show their line:
// the hook freezes them for the visit, so the line stays after it is marked.
export function allInKeysToShow(reminders, state, today) {
  return reminders
    .filter((reminder) => reminder.kind === "month_close" && reminder.allDone)
    .filter((reminder) => {
      const item = state.items[reminder.key];
      return item?.open && !item.doneShown && !isReminderHidden(item, today);
    })
    .map((reminder) => reminder.key);
}
