// Trip ledger import: the household facts the plan is built from, read
// with plain SELECTs only (one statement per call, so the same reads run
// through `wrangler d1 execute --remote --command` for the preview and
// through a D1 binding for the apply step's re-check). Never writes.
import type { TripLedgerSnapshot } from "./trip-ledger-plan";

export type TripLedgerQuery = (sql: string) => Promise<Record<string, unknown>[]>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function loadTripLedgerSnapshot(
  query: TripLedgerQuery,
  input: { householdId: string; from: string; to: string }
): Promise<TripLedgerSnapshot> {
  // The values are written into the SQL (the wrangler CLI takes no binds),
  // so they are checked to be plain ids and dates first.
  if (!SAFE_ID.test(input.householdId)) throw new Error("Household id must be a plain id.");
  if (!ISO_DATE.test(input.from) || !ISO_DATE.test(input.to)) throw new Error("Dates must be YYYY-MM-DD.");
  const household = `'${input.householdId}'`;

  const people = await query(`SELECT id, display_name, role FROM people WHERE household_id = ${household} AND is_active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id`);
  const accounts = await query(`SELECT id, account_name, owner_person_id, is_joint, account_kind, currency, is_active FROM accounts WHERE household_id = ${household}`);
  const categories = await query(`SELECT id, name FROM categories WHERE household_id = ${household} ORDER BY name`);
  const tripEvents = await query(`SELECT id, name, start_date, end_date, currency, split_group_id, put_away_at FROM trip_events WHERE household_id = ${household}`).catch(() => []);
  const splitGroups = await query(`SELECT id, group_name, currency FROM split_groups WHERE household_id = ${household}`);
  const entries = await query(`
    SELECT
      transactions.id, transactions.account_id, accounts.owner_person_id AS account_owner_person_id,
      accounts.is_joint AS account_is_joint, transactions.transaction_date, transactions.post_date,
      transactions.transaction_time, transactions.description, transactions.amount_minor,
      transactions.entry_type, transactions.original_amount_minor, transactions.original_currency,
      transactions.bank_certification_status, categories.name AS category_name, transactions.note,
      transactions.external_reference,
      (SELECT trip_event_id FROM trip_event_entries WHERE trip_event_entries.transaction_id = transactions.id) AS trip_event_id,
      (SELECT split_expenses.id FROM split_expenses WHERE split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL LIMIT 1) AS split_expense_id
    FROM transactions
    INNER JOIN accounts ON accounts.id = transactions.account_id
    LEFT JOIN categories ON categories.id = transactions.category_id
    WHERE transactions.household_id = ${household}
      AND transactions.transaction_date BETWEEN '${input.from}' AND '${input.to}'
    ORDER BY transactions.transaction_date, transactions.id
  `);

  return {
    householdId: input.householdId,
    people: people.map((row) => ({ id: String(row.id), name: String(row.display_name), role: String(row.role) })),
    accounts: accounts.map((row) => ({
      id: String(row.id),
      name: String(row.account_name),
      ownerPersonId: row.owner_person_id ? String(row.owner_person_id) : null,
      isJoint: Number(row.is_joint) === 1,
      kind: String(row.account_kind),
      currency: String(row.currency ?? "SGD").toUpperCase(),
      active: Number(row.is_active ?? 1) === 1
    })),
    categories: categories.map((row) => ({ id: String(row.id), name: String(row.name) })),
    tripEvents: tripEvents.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      startDate: row.start_date ? String(row.start_date) : null,
      endDate: row.end_date ? String(row.end_date) : null,
      currency: row.currency ? String(row.currency) : null,
      splitGroupId: row.split_group_id ? String(row.split_group_id) : null,
      putAway: Boolean(row.put_away_at)
    })),
    splitGroups: splitGroups.map((row) => ({ id: String(row.id), name: String(row.group_name), currency: String(row.currency ?? "SGD") })),
    entries: entries.map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      accountOwnerPersonId: row.account_owner_person_id ? String(row.account_owner_person_id) : null,
      accountIsJoint: Number(row.account_is_joint) === 1,
      date: String(row.transaction_date),
      postDate: row.post_date ? String(row.post_date) : null,
      time: row.transaction_time ? String(row.transaction_time) : null,
      description: String(row.description),
      amountMinor: Number(row.amount_minor),
      entryType: String(row.entry_type),
      originalAmountMinor: row.original_amount_minor === null || row.original_amount_minor === undefined ? null : Number(row.original_amount_minor),
      originalCurrency: row.original_currency ? String(row.original_currency) : null,
      statementCertified: row.bank_certification_status === "statement_certified",
      categoryName: row.category_name ? String(row.category_name) : null,
      note: row.note === null || row.note === undefined ? null : String(row.note),
      tripEventId: row.trip_event_id ? String(row.trip_event_id) : null,
      splitExpenseId: row.split_expense_id ? String(row.split_expense_id) : null,
      externalReference: row.external_reference ? String(row.external_reference) : null
    }))
  };
}
