import { todayInAppTimeZone } from "../../lib/app-calendar";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { buildLinkedSplitShareMap, LINKED_SPLIT_SHARES_SQL, type LinkedSplitShareRow } from "../app-repository-entries";
import { loadRepeatingChoices } from "../app-repository-repeating-charges";
import { addDays } from "../money-signals/format";
import { personEntryAmountMinor } from "../person-entry-amount";
import { effectiveScopeForView } from "../person-view-scope";
import {
  findRepeatingCharges,
  repeatingWindowStart,
  type RepeatingChargeRow,
  type RepeatingChoice,
  type RepeatingSeries
} from "../repeating-charges";
import { resolvePageViewId } from "../route-context";
import type { EntryDto, PersonScope } from "../../types/dto";

// GET /api/repeating-charges (DOMAIN.md "Repeating Charge"): Summary's
// "Subscriptions and bills" card for one view and scope. Read-only, no AI,
// not part of any first-screen payload: the card asks for it only once the
// top summary is usable. Every read starts at once (one step): the charges
// grouped in SQL by description and month, the accounts with each one's
// latest entry date, the people, the household's choices and, for a person
// view only, the split shares of the window (so a person's charge is their
// share, the rule every figure uses).

export interface RepeatingSeriesDto {
  key: string;
  name: string;
  // The payee as the statement says it, when the household renamed it.
  payee?: string;
  period: "monthly" | "yearly";
  kind: "fixed" | "varies";
  status: "active" | "late" | "stopped" | "might_repeat" | "taken_off";
  kept?: true;
  category: string;
  account: string;
  usualDay: number;
  nextDate: string;
  runLength: number;
  latest: { date: string; amountMinor: number; ids: string[] };
  lowMinor: number;
  highMinor: number;
  focus: { amountMinor: number; ids: string[] };
  year: { amountMinor: number; ids: string[] };
  wentUp?: { fromMinor: number; fromDate: string; fromIds: string[]; toMinor: number; date: string; toIds: string[] };
  lastSeenMonth?: string;
}

export interface RepeatingChargesDto {
  viewId: string;
  scope: PersonScope;
  today: string;
  focusMonth: string;
  yearStartMonth: string;
  series: RepeatingSeriesDto[];
  mightRepeat: RepeatingSeriesDto[];
  takenOff: RepeatingSeriesDto[];
}

// The reads, exported so a test can check them against the indexes. Each
// group is one description in one month; its charges come as
// id~owner~amount, so a person view counts each at its own share.
export const REPEATING_CHARGES_SQL = `
  SELECT
    transactions.description,
    substr(transactions.transaction_date, 1, 7) AS month,
    MIN(transactions.transaction_date) AS first_date,
    SUM(transactions.amount_minor) AS amount_minor,
    GROUP_CONCAT(transactions.id || '~' || COALESCE(transactions.owner_person_id, '') || '~' || transactions.amount_minor) AS members,
    MAX(transactions.account_id) AS account_id,
    MAX(categories.name) AS category_name,
    MAX(CASE WHEN transactions.currency <> 'SGD' OR transactions.original_currency IS NOT NULL THEN 1 ELSE 0 END) AS is_foreign
  FROM transactions
  LEFT JOIN imports ON imports.id = transactions.import_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  WHERE transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date <= ?
    AND transactions.entry_type = 'expense'
    AND transactions.transfer_group_id IS NULL
    AND transactions.amount_minor > 0
    AND (transactions.import_id IS NULL OR imports.status = 'completed')
    AND (categories.name IS NULL OR lower(categories.name) NOT IN ('investments', 'savings'))
  GROUP BY transactions.description, month
`;

export const REPEATING_ACCOUNTS_SQL = `
  SELECT
    accounts.id,
    accounts.account_name,
    accounts.is_joint,
    owners.display_name AS owner_name,
    (SELECT MAX(transaction_date) FROM transactions WHERE transactions.account_id = accounts.id) AS latest_date
  FROM accounts
  LEFT JOIN people AS owners ON owners.id = accounts.owner_person_id
  WHERE accounts.household_id = ?
`;

interface GroupedChargeRow {
  description: string;
  month: string;
  first_date: string;
  amount_minor: number;
  members: string;
  account_id: string;
  category_name: string | null;
  is_foreign: number;
}

interface AccountRow {
  id: string;
  account_name: string;
  is_joint: number;
  owner_name: string | null;
  latest_date: string | null;
}

type SplitShareMap = ReturnType<typeof buildLinkedSplitShareMap>;

async function loadPeople(db: D1Database) {
  const result = await db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>();
  return result.results.map((row) => ({ id: row.id, name: row.display_name }));
}

async function loadSplitShares(db: D1Database, start: string, endExclusive: string): Promise<SplitShareMap> {
  const result = await db.prepare(LINKED_SPLIT_SHARES_SQL).bind(DEFAULT_HOUSEHOLD_ID, start, endExclusive).all<LinkedSplitShareRow>();
  return buildLinkedSplitShareMap(result.results);
}

// A person's own amount of a charge (personEntryAmountMinor, the one rule
// behind every person figure): their share of a split-linked entry, else
// the whole amount when they own it; null when it is not theirs in the scope.
function personAmount(charge: { id: string; ownerPersonId: string; amountMinor: number }, shares: SplitShareMap, personId: string, scope: PersonScope) {
  const linkedShares = shares.get(charge.id);
  const entry = {
    amountMinor: charge.amountMinor,
    ownershipType: "direct",
    linkedSplitExpenseId: linkedShares ? charge.id : undefined,
    linkedSplitShares: linkedShares,
    splits: charge.ownerPersonId ? [{ personId: charge.ownerPersonId, amountMinor: charge.amountMinor }] : []
  } as unknown as EntryDto;
  return personEntryAmountMinor(entry, personId, scope);
}

// Reads the household's choices (keep, rename, take off). A missing table
// means no choices.
export type LoadRepeatingChoices = (db: D1Database) => Promise<Record<string, RepeatingChoice>>;

export async function buildRepeatingChargesDto(
  db: D1Database,
  selectedViewId = "household",
  selectedScope: PersonScope = "direct_plus_shared",
  today = todayInAppTimeZone(),
  loadChoices: LoadRepeatingChoices = loadRepeatingChoices
): Promise<RepeatingChargesDto> {
  const start = repeatingWindowStart(today);
  const endExclusive = addDays(today, 1);
  const [people, grouped, accounts, choices, splitShares] = await Promise.all([
    loadPeople(db),
    db.prepare(REPEATING_CHARGES_SQL).bind(DEFAULT_HOUSEHOLD_ID, start, today).all<GroupedChargeRow>(),
    db.prepare(REPEATING_ACCOUNTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<AccountRow>(),
    loadChoices(db),
    selectedViewId !== "household" ? loadSplitShares(db, start, endExclusive) : Promise.resolve(null)
  ]);
  const viewId = resolvePageViewId(selectedViewId, people);
  const scope = effectiveScopeForView(viewId, selectedScope);
  const shares = viewId === "household" ? null : splitShares;

  const rows: RepeatingChargeRow[] = [];
  for (const group of grouped.results) {
    const members = String(group.members ?? "").split(",").filter(Boolean).map((member) => {
      const [id, ownerPersonId = "", amount = "0"] = member.split("~");
      return { id, ownerPersonId, amountMinor: Number(amount) };
    });
    let ids = members.map((member) => member.id);
    let amountMinor = group.amount_minor;
    if (shares) {
      const own = members.map((member) => personAmount(member, shares, viewId, scope));
      ids = members.filter((_, index) => own[index] !== null).map((member) => member.id);
      amountMinor = own.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }
    if (!ids.length || amountMinor <= 0) {
      continue;
    }
    rows.push({
      ids: ids.sort(),
      date: group.first_date,
      description: group.description,
      amountMinor,
      accountId: group.account_id,
      categoryName: group.category_name ?? "Other",
      entryType: "expense",
      isForeign: Boolean(group.is_foreign)
    });
  }

  const accountLatestDate: Record<string, string> = {};
  const accountLabel = new Map<string, string>();
  for (const account of accounts.results) {
    accountLatestDate[account.id] = account.latest_date ?? "";
    const owner = account.is_joint ? "Shared" : account.owner_name ?? "";
    accountLabel.set(account.id, owner ? `${account.account_name} • ${owner}` : account.account_name);
  }

  const result = findRepeatingCharges({ today, rows, accountLatestDate, choices });
  const toDto = (series: RepeatingSeries): RepeatingSeriesDto => ({
    key: series.seriesKey,
    name: series.name,
    ...(series.renamed ? { payee: series.payeeName } : {}),
    period: series.period,
    kind: series.amountKind,
    status: series.status,
    ...(series.kept ? { kept: true as const } : {}),
    category: series.categoryName,
    account: accountLabel.get(series.accountId) ?? "",
    usualDay: series.usualDay,
    nextDate: series.nextDate,
    runLength: series.runLength,
    latest: series.latest,
    lowMinor: series.lastThree.lowMinor,
    highMinor: series.lastThree.highMinor,
    focus: series.focus,
    year: series.year,
    ...(series.wentUp ? { wentUp: { fromMinor: series.wentUp.fromMinor, fromDate: series.wentUp.lastOldDate, fromIds: series.wentUp.fromIds, toMinor: series.wentUp.toMinor, date: series.wentUp.firstNewDate, toIds: series.wentUp.toIds } } : {}),
    ...(series.lastSeenMonth ? { lastSeenMonth: series.lastSeenMonth } : {})
  });
  return {
    viewId,
    scope,
    today,
    focusMonth: result.focusMonth,
    yearStartMonth: result.yearStartMonth,
    series: result.series.map(toDto),
    mightRepeat: result.mightRepeat.map(toDto),
    takenOff: result.takenOff.map(toDto)
  };
}
