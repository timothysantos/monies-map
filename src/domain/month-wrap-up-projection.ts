// GET /api/month-wrap-up (DOMAIN.md "Month Wrap-up"): the facts the Month
// page's wrap-up card needs that the Month page does not already carry.
// Read-only, no AI, not part of any first-screen payload: the card asks for
// it once the Month page is usable. Every fact comes from an existing
// projection, never a rule of its own:
// - What changed: the "What changed" card's rows for the month
//   (summary-changed.ts over loadUsualEntries, the one date-window read
//   Ask's "What changed?" uses), the biggest few;
// - Other and estimates: the view's expenses of the month in that read, and
//   the month's foreign currency estimates still provisional (one read,
//   bounded by the month);
// - Statements: the Import inbox's plan of expected statements
//   (import-inbox.ts), over a light account read grouped in SQL;
// - Splits: the Splits tile's balances (summary-split-balances.ts, grouped
//   in SQL) and the "Usually shared" sweep (pages/usually-shared.ts) over
//   the month's days.
// The plan and the monthly note are on the Month page already, so they are
// not sent twice (month-wrap-up.ts reads them on the page).
import { todayInAppTimeZone } from "../lib/app-calendar";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { loadImportBatches } from "./app-repository-import-history";
import { loadUsualEntries } from "./pages/ask-usual";
import { loadSummarySplitBalances } from "./pages/summary-split-balances";
import { buildUsuallySharedDto } from "./pages/usually-shared";
import { buildImportInbox } from "./import-inbox";
import { MONTH_WRAP_UP_CONFIG, monthWrapUpEndDate, monthWrapUpIsOpen } from "./month-wrap-up";
import { addMonths } from "./money-signals/format";
import { effectiveScopeForView } from "./person-view-scope";
import { UNCATEGORISED_CATEGORY_NAMES } from "./reminders/thresholds";
import { loadRoutePageContext } from "./route-context";
import { splitBalanceWords } from "./splits-projection";
import { buildSummaryChanged } from "./summary-changed";
import type { UsualEntry } from "./ask-usual";
import type {
  AccountDto,
  ImportBatchDto,
  MonthWrapUpChangedRowDto,
  MonthWrapUpDto,
  MonthWrapUpSplitBalanceDto,
  PersonScope,
  SummarySplitBalanceDto,
  UsuallySharedGroupDto
} from "../types/dto";

export interface MonthWrapUpFacts {
  viewId: string;
  scope: PersonScope;
  month: string;
  today: string;
  // The view's spending and money-in entries of the month and the 6 before
  // (loadUsualEntries).
  entries: UsualEntry[];
  // Ids of the month's foreign currency estimates no statement has confirmed.
  estimateIds: string[];
  // The view's active bank and card accounts, as the Import inbox reads them.
  statementAccounts: AccountDto[];
  recentImports: ImportBatchDto[];
  splitBalances: SummarySplitBalanceDto[];
  personNameById: Record<string, string>;
  usuallyShared: UsuallySharedGroupDto[];
}

const inMonth = (month: string) => (entry: { date: string }) => entry.date.slice(0, 7) === month;
const total = (entries: UsualEntry[]) => entries.reduce((sum, entry) => sum + entry.amountMinor, 0);

/** The wrap-up for a month, or null when it cannot be wrapped up or has no entries. */
export function buildMonthWrapUp(facts: MonthWrapUpFacts): MonthWrapUpDto | null {
  const { month, today, viewId } = facts;
  const monthEntries = facts.entries.filter(inMonth(month));
  if (!monthWrapUpIsOpen(month, today) || !monthEntries.length) {
    return null;
  }
  const end = monthWrapUpEndDate(month, today);

  // What changed: the card's own rows for the month (the whole month against
  // the month before, or up to today in the month in progress), the biggest
  // few, in the card's order.
  const card = buildSummaryChanged({ viewId, scope: facts.scope, today: end, entries: facts.entries });
  const biggest = new Set([...(card?.rows ?? [])]
    .sort((left, right) => Math.abs(right.diffMinor) - Math.abs(left.diffMinor) || left.category.localeCompare(right.category))
    .slice(0, MONTH_WRAP_UP_CONFIG.changedRows)
    .map((row) => row.category));
  const changedRows: MonthWrapUpChangedRowDto[] = (card?.rows ?? [])
    .filter((row) => biggest.has(row.category))
    .map((row) => ({ category: row.category, direction: row.direction, diffMinor: row.diffMinor, amountMinor: row.amountMinor, ids: row.ids }));

  const expenses = monthEntries.filter((entry) => entry.entryType === "expense");
  const other = expenses.filter((entry) => UNCATEGORISED_CATEGORY_NAMES.includes(entry.categoryName));
  const estimateIds = new Set(facts.estimateIds);
  const estimates = expenses.filter((entry) => estimateIds.has(entry.id));

  // Statements: the Import inbox's expected statements for this month. For
  // the month in progress the inbox is asked as on the 1st of the next
  // month, when this month's statements become the ones it expects.
  const inboxNow = new Date(`${month < today.slice(0, 7) ? today : `${addMonths(month, 1)}-01`}T00:00:00Z`);
  const inbox = buildImportInbox({ accounts: facts.statementAccounts, recentImports: facts.recentImports, pendingSplitMatchCount: 0, now: inboxNow });
  const missing = inbox.reviewQueue
    .filter((file) => file.sourceType === "pdf_statement" && file.periodMonth === month)
    .map((file) => ({ id: file.id, name: file.accountName }));

  // Splits: what is owed right now, biggest first. The household view names
  // both people ("Ethan owes Serene"): splitBalanceWords names them for a
  // view that is neither person.
  const balances: MonthWrapUpSplitBalanceDto[] = facts.splitBalances
    .filter((balance) => balance.balanceMinor !== 0)
    .slice(0, MONTH_WRAP_UP_CONFIG.splitBalances)
    .map((balance) => ({
      id: balance.id,
      name: balance.name,
      currency: balance.currency,
      balanceMinor: balance.balanceMinor,
      owes: viewId === "household" ? splitBalanceWords(balance.balanceMinor, "", facts.personNameById) : balance.owes,
      direction: viewId === "household" ? "between" : balance.balanceMinor > 0 ? "owed_to_you" : "you_owe"
    }));
  // The month's entries the "Usually shared" rule would put on Splits; a
  // person sees their own (the entries their view lists).
  const usuallySharedIds = facts.usuallyShared
    .flatMap((group) => group.entries)
    .filter((entry) => entry.date.slice(0, 7) === month && entry.date <= end && (viewId === "household" || entry.ownerPersonId === viewId))
    .map((entry) => entry.id)
    .sort();

  return {
    viewId,
    scope: facts.scope,
    month,
    changed: changedRows.length && card ? { baseMonth: card.baseMonth, rowCount: card.rows.length, rows: changedRows } : null,
    other: { ids: other.map((entry) => entry.id).sort(), amountMinor: total(other) },
    estimates: { ids: estimates.map((entry) => entry.id).sort(), amountMinor: total(estimates) },
    statements: { accountCount: facts.statementAccounts.length, missing },
    splits: { balances, usuallySharedIds }
  };
}

const WRAP_UP_RECENT_IMPORTS = 30;

// The month's foreign currency estimates still waiting for their statement
// (DOMAIN.md "Foreign Currency Estimate"): bounded by the month.
export const WRAP_UP_ESTIMATES_SQL = `
  SELECT id FROM transactions
  WHERE household_id = ?
    AND transaction_date >= ? AND transaction_date <= ?
    AND entry_type = 'expense'
    AND original_currency IS NOT NULL
    AND bank_certification_status = 'provisional'
`;

// The active bank and card accounts with their latest statement month,
// grouped in SQL: all the Import inbox's statement plan reads of an account.
export const WRAP_UP_ACCOUNTS_SQL = `
  SELECT accounts.id, accounts.account_name, accounts.account_kind, accounts.is_joint, accounts.owner_person_id,
    institutions.name AS institution_name, people.display_name AS owner_name,
    (SELECT MAX(checkpoints.checkpoint_month) FROM account_balance_checkpoints AS checkpoints
      WHERE checkpoints.household_id = accounts.household_id AND checkpoints.account_id = accounts.id) AS latest_checkpoint_month
  FROM accounts
  INNER JOIN institutions ON institutions.id = accounts.institution_id
  LEFT JOIN people ON people.id = accounts.owner_person_id
  WHERE accounts.household_id = ? AND accounts.is_active = 1 AND accounts.account_kind IN ('bank', 'credit_card')
`;

interface AccountRow {
  id: string;
  account_name: string;
  account_kind: string;
  is_joint: number;
  owner_person_id: string | null;
  institution_name: string;
  owner_name: string | null;
  latest_checkpoint_month: string | null;
}

// A person sees the accounts they own and joint ones, as reminders do.
async function loadStatementAccounts(db: D1Database, viewId: string): Promise<AccountDto[]> {
  const result = await db.prepare(WRAP_UP_ACCOUNTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<AccountRow>();
  return result.results
    .filter((row) => viewId === "household" || row.is_joint === 1 || row.owner_person_id === viewId)
    .map((row) => ({
      id: row.id,
      institutionId: "",
      ownerPersonId: row.owner_person_id ?? undefined,
      name: row.account_name,
      institution: row.institution_name,
      kind: row.account_kind,
      ownerLabel: row.owner_name ?? "Shared",
      currency: "",
      isJoint: row.is_joint === 1,
      isActive: true,
      latestCheckpointMonth: row.latest_checkpoint_month ?? undefined
    }));
}

/** The wrap-up DTO for one view, scope and month. */
export async function buildMonthWrapUpDto(
  db: D1Database,
  selectedViewId = "household",
  selectedScope: PersonScope = "direct_plus_shared",
  month = "",
  today = todayInAppTimeZone()
): Promise<{ wrapUp: MonthWrapUpDto | null }> {
  if (!monthWrapUpIsOpen(month, today)) {
    return { wrapUp: null };
  }
  const end = monthWrapUpEndDate(month, today);
  const { viewId, personNameById } = await loadRoutePageContext(db, selectedViewId);
  const scope = effectiveScopeForView(viewId, selectedScope);
  // Every read starts at once: none needs another's answer.
  const [entries, estimates, statementAccounts, recentImports, splitBalances, usuallyShared] = await Promise.all([
    loadUsualEntries(db, viewId, scope, month),
    db.prepare(WRAP_UP_ESTIMATES_SQL).bind(DEFAULT_HOUSEHOLD_ID, `${month}-01`, end).all<{ id: string }>(),
    loadStatementAccounts(db, viewId),
    // The latest imports only: the inbox reads them for statements one PDF
    // shares between accounts, and the newest such statement wins.
    loadImportBatches(db, { includeOverlapDetails: false, limit: WRAP_UP_RECENT_IMPORTS }),
    loadSummarySplitBalances(db, viewId, personNameById),
    // The sweep reads back from the month's end over its days.
    buildUsuallySharedDto(db, { today: end, days: Math.max(1, Number(end.slice(8, 10)) - 1) })
  ]);
  return {
    wrapUp: buildMonthWrapUp({
      viewId,
      scope,
      month,
      today,
      entries,
      estimateIds: estimates.results.map((row) => row.id),
      statementAccounts,
      recentImports,
      splitBalances,
      personNameById,
      usuallyShared: usuallyShared.groups
    })
  };
}
