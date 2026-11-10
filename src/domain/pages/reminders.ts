import { todayInAppTimeZone } from "../../lib/app-calendar";
import { loadEntries } from "../app-repository-entries";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { loadSplitExpenses, loadSplitGroups, loadSplitSettlementCheckpoints, loadSplitSettlements } from "../app-repository-splits";
import { cardBillWindowStart, type CardBillTransactionRow } from "../card-bill-projection";
import { addMonths } from "../money-signals/format";
import { adjustEntriesForView } from "../month-projection";
import { filterEntriesForView } from "../person-view-scope";
import { loadRepeatingChoices, notRepeatingPayeeKeys } from "../app-repository-repeating-charges";
import { buildReminders } from "../reminders/build-reminders";
import type { ReminderAccount, ReminderChargeRow, ReminderInputs, ReminderSplitGroup, ReminderSplitsFacts } from "../reminders/facts";
import { monthsWithAllStatements } from "../reminders/month-close-reminder";
import { REMINDERS_MAX, SUBSCRIPTION_CATEGORY_PERIODS, REMINDER_THRESHOLDS, UNCATEGORISED_CATEGORY_NAMES } from "../reminders/thresholds";
import { resolvePageViewId } from "../route-context";
import { buildSplitsPage } from "../splits-projection";
import { loadTaxReliefsYear } from "./tax-reliefs";
import type { RemindersDto } from "../../types/dto";

// The read-only reminders projection for one view (GET /api/reminders,
// DOMAIN.md "Reminder"). It reads existing tables only (statement
// checkpoints, card payments, a few subscription categories, Splits, the
// last complete month's entries and note) and leaves every decision to the
// pure rules in src/domain/reminders/. It writes nothing, calls no model and
// is not part of any page or first-screen payload.
export async function buildRemindersDto(
  db: D1Database,
  selectedViewId = "household",
  today = todayInAppTimeZone()
): Promise<RemindersDto> {
  // Only the people: the app shell's context also reads categories and every
  // tracked month, which no reminder needs.
  // Every read starts at once; the split facts wait only for the people and
  // the month close only for the people and the accounts.
  const peopleRead = loadPeople(db);
  const accountsRead = loadReminderAccounts(db);
  const [people, accounts, cardPayments, charges, splits, monthClose, choices, taxRelief] = await Promise.all([
    peopleRead,
    accountsRead,
    loadCardPayments(db, today),
    loadSubscriptionCharges(db, today),
    peopleRead.then((list) => loadSplitsFacts(db, resolvePageViewId(selectedViewId, list), list)),
    // Statements first: a month's entries and note are read only for a
    // month whose statements are all in (the only one a card can show for).
    Promise.all([peopleRead, accountsRead]).then(([list, accountList]) => {
      const view = resolvePageViewId(selectedViewId, list);
      return loadMonthCloseFacts(db, view, monthsWithAllStatements({ today, accounts: accountList, viewId: view }));
    }),
    // "Not a subscription or bill" on Subscriptions and bills silences the
    // price change reminder for that payee.
    loadRepeatingChoices(db),
    // Tax relief room is a December reminder: no read in any other month.
    today.slice(5, 7) === "12" ? loadTaxReliefsYear(db, today).then((loaded) => loaded.reliefs) : Promise.resolve(undefined)
  ]);
  const viewId = resolvePageViewId(selectedViewId, people);
  const inputs: ReminderInputs = {
    today, viewId, people: people, accounts, cardPayments, charges, splits, monthClose,
    notRepeatingPayeeKeys: [...notRepeatingPayeeKeys(choices)],
    taxRelief
  };
  return { viewId, today, reminders: buildReminders(inputs).slice(0, REMINDERS_MAX) };
}

async function loadPeople(db: D1Database) {
  const result = await db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>();
  return result.results.map((row) => ({ id: row.id, name: row.display_name }));
}

// The reads, exported so a test can check each is answered from an index.
export const REMINDER_ACCOUNTS_SQL = `
  SELECT id, account_name, account_kind, currency, is_active, is_joint, owner_person_id
  FROM accounts
  WHERE household_id = ?
`;
export const REMINDER_CHECKPOINTS_SQL = `
  SELECT account_id, checkpoint_month, statement_end_date, statement_balance_minor, payment_due_date, minimum_payment_minor
  FROM account_balance_checkpoints
  WHERE household_id = ?
`;
export const CARD_PAYMENTS_SQL = `
  SELECT transactions.id, transactions.account_id, transactions.transaction_date, transactions.post_date,
    transactions.description, transactions.amount_minor, transactions.entry_type, transactions.transfer_direction
  FROM transactions
  INNER JOIN accounts ON accounts.id = transactions.account_id
  WHERE transactions.household_id = ?
    AND accounts.account_kind = 'credit_card'
    AND transactions.entry_type = 'transfer'
    AND transactions.transfer_direction = 'in'
    AND transactions.transaction_date >= ?
`;
export function buildSubscriptionChargesSql(categoryCount: number) {
  return `
    SELECT transactions.account_id, transactions.transaction_date, transactions.description, transactions.amount_minor,
      transactions.currency, transactions.original_currency, categories.name AS category_name
    FROM transactions
    INNER JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.household_id = ?
      AND transactions.entry_type = 'expense'
      AND categories.name IN (${Array.from({ length: categoryCount }, () => "?").join(", ")})
      AND transactions.transaction_date >= ?
  `;
}

// Active-or-not accounts with their statement checkpoints, without the
// all-time balance work the wallet pills do: a reminder reads only what each
// statement says.
async function loadReminderAccounts(db: D1Database): Promise<ReminderAccount[]> {
  const [accounts, checkpoints] = await Promise.all([
    db.prepare(REMINDER_ACCOUNTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<{
      id: string; account_name: string; account_kind: string; currency: string;
      is_active: number; is_joint: number; owner_person_id: string | null;
    }>(),
    db.prepare(REMINDER_CHECKPOINTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<{
      account_id: string; checkpoint_month: string; statement_end_date: string | null;
      statement_balance_minor: number; payment_due_date: string | null; minimum_payment_minor: number | null;
    }>()
  ]);
  const byAccount = new Map<string, ReminderAccount["checkpoints"]>();
  for (const row of checkpoints.results) {
    const list = byAccount.get(row.account_id) ?? [];
    list.push({
      month: row.checkpoint_month,
      statementEndDate: row.statement_end_date ?? undefined,
      statementBalanceMinor: row.statement_balance_minor,
      paymentDueDate: row.payment_due_date ?? undefined,
      minimumPaymentMinor: row.minimum_payment_minor ?? undefined
    });
    byAccount.set(row.account_id, list);
  }
  return accounts.results.map((row) => ({
    id: row.id,
    name: row.account_name,
    kind: row.account_kind,
    currency: row.currency,
    isActive: row.is_active === 1,
    isJoint: row.is_joint === 1,
    ownerPersonId: row.owner_person_id ?? undefined,
    checkpoints: byAccount.get(row.id) ?? []
  }));
}

// Payments towards a card bill are transfers into the card; nothing else on
// a card is read here.
async function loadCardPayments(db: D1Database, today: string): Promise<CardBillTransactionRow[]> {
  const result = await db.prepare(CARD_PAYMENTS_SQL).bind(DEFAULT_HOUSEHOLD_ID, cardBillWindowStart(today)).all<CardBillTransactionRow>();
  return result.results;
}

// Expense charges in the subscription-like categories: a monthly window for
// Subscriptions MO and Bills, a longer one for yearly subscriptions.
async function loadSubscriptionCharges(db: D1Database, today: string): Promise<ReminderChargeRow[]> {
  const { monthlyLookbackMonths, yearlyLookbackMonths } = REMINDER_THRESHOLDS.priceChange;
  const monthlyStart = `${addMonths(today.slice(0, 7), -monthlyLookbackMonths)}-01`;
  const yearlyStart = `${addMonths(today.slice(0, 7), -yearlyLookbackMonths)}-01`;
  const names = Object.keys(SUBSCRIPTION_CATEGORY_PERIODS);
  const result = await db.prepare(buildSubscriptionChargesSql(names.length)).bind(DEFAULT_HOUSEHOLD_ID, ...names, yearlyStart).all<{
    account_id: string; transaction_date: string; description: string; amount_minor: number;
    currency: string; original_currency: string | null; category_name: string;
  }>();
  return result.results.flatMap((row) => {
    const period = SUBSCRIPTION_CATEGORY_PERIODS[row.category_name];
    if (!period || (period === "monthly" && row.transaction_date < monthlyStart)) {
      return [];
    }
    return [{
      accountId: row.account_id,
      date: row.transaction_date,
      description: row.description,
      amountMinor: Math.abs(row.amount_minor),
      currency: row.currency,
      period,
      isForeign: row.currency !== "SGD" || Boolean(row.original_currency)
    }];
  });
}

// Splits as the Splits page computes them (open records only: nothing
// archived and nothing already inside a settle-up), reduced to what the
// rules read. The household view reads the first person's side, so a
// positive group balance means the second person owes the first.
async function loadSplitsFacts(db: D1Database, viewId: string, people: Array<{ id: string; name: string }>): Promise<ReminderSplitsFacts> {
  const [groups, expenses, settlements, checkpoints] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db),
    loadSplitSettlements(db),
    loadSplitSettlementCheckpoints(db)
  ]);
  const perspective = viewId === "household" ? people[0]?.id ?? viewId : viewId;
  const personNameById = Object.fromEntries(people.map((person) => [person.id, person.name]));
  const page = buildSplitsPage(perspective, groups, expenses, settlements, [], [], "", personNameById, checkpoints);

  const openByGroup = new Map<string, { oldest: string; rate?: { date: string; basisPoints: number } }>();
  for (const item of page.activity) {
    if (item.settlementStatus !== "open") {
      continue;
    }
    const current = openByGroup.get(item.groupId) ?? { oldest: item.date };
    if (item.date < current.oldest) {
      current.oldest = item.date;
    }
    // The newest rate seen on an open record converts a foreign balance.
    if (item.fxRateBasisPoints && (!current.rate || item.date > current.rate.date)) {
      current.rate = { date: item.date, basisPoints: item.fxRateBasisPoints };
    }
    openByGroup.set(item.groupId, current);
  }

  const splitGroups: ReminderSplitGroup[] = page.groups.map((group) => ({
    id: group.id,
    name: group.name,
    currency: group.currency,
    balanceMinor: group.balanceMinor,
    oldestOpenDate: openByGroup.get(group.id)?.oldest,
    homeRateBasisPoints: openByGroup.get(group.id)?.rate?.basisPoints
  }));
  return {
    groups: splitGroups,
    settleUps: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      fromPersonId: checkpoint.fromPersonId,
      toPersonId: checkpoint.toPersonId,
      amountMinor: checkpoint.amountMinor,
      currency: checkpoint.currency,
      settlementDate: checkpoint.settlementDate,
      status: checkpoint.status,
      settledAt: checkpoint.settledAt
    }))
  };
}

// Per month: the entries still in Other for this view (counted as the Month
// page counts them), and whether the view's note for it is written.
async function loadMonthCloseFacts(db: D1Database, viewId: string, months: string[]): Promise<ReminderInputs["monthClose"]> {
  const facts: ReminderInputs["monthClose"] = {};
  for (const month of months) {
    const [year, monthNumber] = month.split("-").map(Number);
    const [entries, note] = await Promise.all([
      loadEntries(db, month),
      db.prepare(`
        SELECT note FROM monthly_snapshots
        WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?
      `).bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, viewId).first<{ note: string | null }>()
    ]);
    const visible = filterEntriesForView(adjustEntriesForView(entries, viewId), viewId, "direct_plus_shared");
    facts[month] = {
      otherEntryCount: visible.filter((entry) => entry.entryType !== "transfer" && UNCATEGORISED_CATEGORY_NAMES.includes(entry.categoryName)).length,
      hasNote: Boolean(note?.note?.trim())
    };
  }
  return facts;
}
