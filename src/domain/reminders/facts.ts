// The narrow facts the reminder rules read. The loader
// (src/domain/pages/reminders.ts) fills them from D1; the tests build them
// by hand. Every rule is a pure function of these and `today`.
import type { CardBillTransactionRow } from "../card-bill-projection";

export interface ReminderCheckpoint {
  // The statement's month (the account's checkpoint month).
  month: string;
  statementEndDate?: string;
  // Negative when a card owes money (the ledger's sign).
  statementBalanceMinor: number;
  paymentDueDate?: string;
  minimumPaymentMinor?: number;
}

export interface ReminderAccount {
  id: string;
  name: string;
  kind: string;
  currency: string;
  isActive: boolean;
  isJoint: boolean;
  ownerPersonId?: string;
  checkpoints: ReminderCheckpoint[];
}

export interface ReminderPerson {
  id: string;
  name: string;
}

// A charge in a subscription-like category, in the household's day order.
export interface ReminderChargeRow {
  accountId: string;
  date: string;
  description: string;
  // Positive, whatever the ledger's sign.
  amountMinor: number;
  currency: string;
  // The category's repeat cycle (thresholds.ts SUBSCRIPTION_CATEGORY_PERIODS).
  period: "monthly" | "yearly";
  // A charge made in another currency: never read (rates move every month).
  isForeign: boolean;
}

export interface ReminderSettleUp {
  id: string;
  fromPersonId?: string;
  toPersonId?: string;
  amountMinor: number;
  currency: string;
  settlementDate: string;
  status: string;
  // Set once someone marked it paid.
  settledAt?: string;
}

export interface ReminderSplitGroup {
  id: string;
  name: string;
  currency: string;
  // From the viewer's side: positive means the other person owes them. In
  // the household view, positive means the second person owes the first.
  balanceMinor: number;
  // The oldest record still open (not archived, not in a settle-up).
  oldestOpenDate?: string;
  // Home-currency basis points per unit of the group's currency (a foreign
  // group's balance is compared to the $20 floor through this).
  homeRateBasisPoints?: number;
}

export interface ReminderSplitsFacts {
  settleUps: ReminderSettleUp[];
  groups: ReminderSplitGroup[];
}

export interface ReminderInputs {
  today: string;
  // "household" or a person's id.
  viewId: string;
  // In the household's order: the first two are the settle-up pair.
  people: ReminderPerson[];
  accounts: ReminderAccount[];
  // Transfers into card accounts (the payments), for the card bill rule.
  cardPayments: CardBillTransactionRow[];
  charges: ReminderChargeRow[];
  splits: ReminderSplitsFacts;
  // Per month the card can ask about (month-close-reminder.ts): entries of
  // that month still in Other (no category) for this view, and whether the
  // view's note for it is written. A month not listed was not read.
  monthClose: Record<string, { otherEntryCount: number; hasNote: boolean }>;
  // Payees the household said are "Not a subscription or bill" on
  // Subscriptions and bills (repeating_charge_choices): no price change
  // reminder for them.
  notRepeatingPayeeKeys?: string[];
}

// A person view reads the accounts that person owns plus joint ones; the
// household view reads every account.
export function accountInView(account: ReminderAccount, viewId: string) {
  return account.isActive && (viewId === "household" || account.isJoint || account.ownerPersonId === viewId);
}

export function personName(people: ReminderPerson[], personId: string | undefined) {
  return people.find((person) => person.id === personId)?.name ?? "";
}
