import { todayInAppTimeZone } from "../../lib/app-calendar";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { loadEntriesForMonths } from "../app-repository-entries";
import { buildInvestmentsOverTime, type InvestmentsOverTime } from "../investments-over-time";
import { resolvePageViewId } from "../route-context";

// GET /api/investments-over-time (DOMAIN.md "Investments Over Time"):
// Summary's "Investments" card. Read-only, no AI, never on the first
// screen: the card asks once the top summary is usable. Two steps: the
// investment accounts, their statement values and the people; then, only
// when some account has a statement value, the household's entries from 1
// January to the end of this month (figures only), where the money put in
// is found.
//
// The figures are the household's whole amounts in every view, and open in
// the household view (data-fig-view on the card), so View entries totals
// them to the cent. A person view shows only the accounts that person owns
// (and joint ones).

export interface InvestmentsOverTimeDto extends Partial<InvestmentsOverTime> {
  viewId: string;
  today: string;
  // Empty when no account in view has a statement value: the card shows nothing.
  accounts: InvestmentsOverTime["accounts"];
}

export const INVESTMENT_ACCOUNTS_SQL = `
  SELECT
    accounts.id,
    accounts.account_name,
    accounts.owner_person_id,
    accounts.is_joint,
    institutions.name AS institution_name,
    people.display_name AS owner_name
  FROM accounts
  LEFT JOIN institutions ON institutions.id = accounts.institution_id
  LEFT JOIN people ON people.id = accounts.owner_person_id
  WHERE accounts.household_id = ?
    AND accounts.account_kind = 'investment'
  ORDER BY accounts.account_name
`;

export const INVESTMENT_VALUES_SQL = `
  SELECT account_id, value_month, as_of_date, total_assets_minor, income_minor
  FROM investment_statement_values
  WHERE household_id = ?
`;

interface AccountRow {
  id: string;
  account_name: string;
  owner_person_id: string | null;
  is_joint: number;
  institution_name: string | null;
  owner_name: string | null;
}

interface ValueRow {
  account_id: string;
  value_month: string;
  as_of_date: string;
  total_assets_minor: number;
  income_minor: number;
}

export async function buildInvestmentsOverTimeDto(
  db: D1Database,
  selectedViewId = "household",
  today = todayInAppTimeZone()
): Promise<InvestmentsOverTimeDto> {
  const [people, accounts, values] = await Promise.all([
    db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
      .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>(),
    db.prepare(INVESTMENT_ACCOUNTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<AccountRow>(),
    // An older database without the table has no statement values.
    db.prepare(INVESTMENT_VALUES_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<ValueRow>()
      .catch(() => ({ results: [] as ValueRow[] }))
  ]);
  const personOrder = people.results.map((person) => person.id);
  const viewId = resolvePageViewId(selectedViewId, people.results.map((person) => ({ id: person.id, name: person.display_name })));
  const empty: InvestmentsOverTimeDto = { viewId, today, accounts: [] };
  const withValues = new Set(values.results.map((row) => row.account_id));
  const inView = accounts.results
    .filter((account) => withValues.has(account.id))
    .filter((account) => viewId === "household" || account.is_joint || account.owner_person_id === viewId)
    // In the household's order of people, joint accounts last.
    .sort((left, right) => rank(left) - rank(right) || left.account_name.localeCompare(right.account_name));
  function rank(account: AccountRow) {
    const index = account.is_joint || !account.owner_person_id ? -1 : personOrder.indexOf(account.owner_person_id);
    return index < 0 ? personOrder.length : index;
  }
  if (!inView.length) {
    return empty;
  }

  const year = today.slice(0, 4);
  const months = Array.from({ length: Number(today.slice(5, 7)) }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const entries = await loadEntriesForMonths(db, months, { figuresOnly: true });
  const built = buildInvestmentsOverTime({
    today,
    accounts: inView.map((account) => ({
      id: account.id,
      name: account.account_name,
      provider: account.institution_name || account.account_name,
      personId: account.is_joint ? "" : account.owner_person_id ?? "",
      personName: account.is_joint ? "Shared" : account.owner_name ?? ""
    })),
    values: values.results.map((row) => ({
      accountId: row.account_id,
      month: row.value_month,
      asOfDate: row.as_of_date,
      worthMinor: row.total_assets_minor,
      paidOutMinor: row.income_minor
    })),
    entries,
    investmentAccountIds: new Set(accounts.results.map((account) => account.id))
  });
  return built ? { viewId, today, ...built } : empty;
}
