// Splits balance waiting: a settle-up nobody has paid, or a group's open
// balance that has been sitting. Weeks are whole weeks since the settle-up
// date or the oldest open record.
import { daysBetween } from "../money-signals/format";
import type { SplitsWaitingReminderDto } from "../../types/dto";
import { personName, type ReminderInputs, type ReminderSettleUp, type ReminderSplitGroup } from "./facts";
import { REMINDER_THRESHOLDS } from "./thresholds";

type SplitsInput = Pick<ReminderInputs, "today" | "viewId" | "people" | "splits">;

const wholeWeeks = (days: number) => Math.floor(days / 7);

// The two people a settle-up is between, and the viewer's side of it. A
// person view keeps only settle-ups that person is in; the household view
// sees both sides ("between Ethan and Serene").
function settleUpSides(input: SplitsInput, settleUp: ReminderSettleUp) {
  if (!settleUp.fromPersonId || !settleUp.toPersonId) {
    return null;
  }
  const fromName = personName(input.people, settleUp.fromPersonId);
  const toName = personName(input.people, settleUp.toPersonId);
  if (input.viewId === "household") {
    return { fromName, toName, direction: "between" as const };
  }
  if (settleUp.fromPersonId === input.viewId) {
    return { fromName, toName, direction: "you_owe" as const };
  }
  return settleUp.toPersonId === input.viewId ? { fromName, toName, direction: "owed_to_you" as const } : null;
}

// A settle-up is open until it is marked paid, matched to a payment, or
// settled another way (those change its status).
export function isOpenSettleUp(settleUp: ReminderSettleUp) {
  return settleUp.status === "open" && !settleUp.settledAt;
}

// Who owes whom in a group, from the sign of its balance as the Splits page
// computes it (see ReminderSplitGroup.balanceMinor).
function groupSides(input: SplitsInput, group: ReminderSplitGroup) {
  const owedToFirst = group.balanceMinor > 0;
  if (input.viewId === "household") {
    const [first, second] = input.people;
    if (!first || !second) {
      return null;
    }
    return owedToFirst
      ? { fromName: second.name, toName: first.name, direction: "between" as const }
      : { fromName: first.name, toName: second.name, direction: "between" as const };
  }
  const viewer = input.people.find((person) => person.id === input.viewId);
  const other = input.people.find((person) => person.id !== input.viewId);
  if (!viewer || !other) {
    return null;
  }
  return owedToFirst
    ? { fromName: other.name, toName: viewer.name, direction: "owed_to_you" as const }
    : { fromName: viewer.name, toName: other.name, direction: "you_owe" as const };
}

// The balance in home currency, for the floor. A foreign group is compared
// through its latest known rate; with none it cannot be compared and stays
// quiet.
function homeEquivalentMinor(group: ReminderSplitGroup) {
  const amount = Math.abs(group.balanceMinor);
  if (group.currency === "SGD") {
    return amount;
  }
  return group.homeRateBasisPoints ? Math.round((amount * group.homeRateBasisPoints) / 10000) : null;
}

// What is still to settle as of a date, for the month-close checklist: open
// settle-ups the view is in and groups with an open balance, from records
// dated on or before it. With exactly one item it also says how much and
// with whom ("$1,047.24 with Ethan"); the household view names both people.
export function openSplitsAsOf(input: SplitsInput, date: string) {
  const items: Array<{ amountMinor: number; currency: string; withName: string }> = [];
  for (const settleUp of input.splits.settleUps) {
    const sides = settleUpSides(input, settleUp);
    if (isOpenSettleUp(settleUp) && settleUp.settlementDate <= date && sides && settleUp.amountMinor > 0) {
      items.push({ amountMinor: settleUp.amountMinor, currency: settleUp.currency, withName: withNameFor(input, sides) });
    }
  }
  for (const group of input.splits.groups) {
    const sides = groupSides(input, group);
    if (group.balanceMinor !== 0 && group.oldestOpenDate && group.oldestOpenDate <= date && sides) {
      items.push({ amountMinor: Math.abs(group.balanceMinor), currency: group.currency, withName: withNameFor(input, sides) });
    }
  }
  const [only] = items;
  return items.length === 1 && only ? { count: 1, ...only } : { count: items.length };
}

function withNameFor(input: SplitsInput, sides: { fromName: string; toName: string; direction: string }) {
  if (input.viewId === "household") {
    return `${sides.fromName} and ${sides.toName}`;
  }
  return sides.direction === "you_owe" ? sides.toName : sides.fromName;
}

export function splitsWaitingReminders(input: SplitsInput): SplitsWaitingReminderDto[] {
  const { settleUpDays, groupBalanceMinMinor, groupBalanceDays } = REMINDER_THRESHOLDS.splits;
  const reminders: SplitsWaitingReminderDto[] = [];

  for (const settleUp of input.splits.settleUps) {
    const days = daysBetween(settleUp.settlementDate, input.today);
    const sides = settleUpSides(input, settleUp);
    if (!isOpenSettleUp(settleUp) || days <= settleUpDays || !sides || settleUp.amountMinor <= 0) {
      continue;
    }
    reminders.push({
      key: `splits:settle_up:${settleUp.id}`,
      kind: "splits_waiting",
      variant: "settle_up",
      ...sides,
      amountMinor: settleUp.amountMinor,
      currency: settleUp.currency,
      sinceDate: settleUp.settlementDate,
      weeks: wholeWeeks(days)
    });
  }

  for (const group of input.splits.groups) {
    if (!group.oldestOpenDate || group.balanceMinor === 0) {
      continue;
    }
    const days = daysBetween(group.oldestOpenDate, input.today);
    const homeMinor = homeEquivalentMinor(group);
    const sides = groupSides(input, group);
    if (days < groupBalanceDays || homeMinor === null || homeMinor < groupBalanceMinMinor || !sides) {
      continue;
    }
    reminders.push({
      key: `splits:group:${group.id}:${group.oldestOpenDate}`,
      kind: "splits_waiting",
      variant: "group_balance",
      ...sides,
      amountMinor: Math.abs(group.balanceMinor),
      currency: group.currency,
      sinceDate: group.oldestOpenDate,
      weeks: wholeWeeks(days),
      groupName: group.name
    });
  }
  return reminders;
}
