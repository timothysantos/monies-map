// A confirmed statement is the complete record of its card's cycle. A bank
// row from an activity export dated inside that cycle that the statement does
// not list was billed on the next statement: it was bought before the
// cut-off but posted after it (a charge bought on 10 Sep, billed on the
// statement after the one that closed on 11 Sep). Such a row keeps its
// purchase day as its date and posts the day after the cycle closed, so the
// closed statement stays as the bank printed it.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { getMonthEndDate } from "./app-repository-helpers";

export interface ClosedStatementPeriod {
  accountId: string;
  checkpointMonth: string;
  startDate: string | null;
  endDate: string;
}

// A row this many days before the close or less is ordinary posting lag:
// the preview carries it to the next statement without asking. An older one
// still needs the person's review.
export const LATE_POSTING_DAYS = 3;

export async function loadClosedStatementPeriods(db: D1Database): Promise<ClosedStatementPeriod[]> {
  const result = await db
    .prepare(`
      SELECT certificates.account_id, certificates.checkpoint_month,
        certificates.statement_start_date, certificates.statement_end_date
      FROM statement_reconciliation_certificates AS certificates
      INNER JOIN imports ON imports.id = certificates.import_id AND imports.status = 'completed'
      WHERE certificates.household_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ account_id: string; checkpoint_month: string; statement_start_date: string | null; statement_end_date: string | null }>();
  return result.results.map((row) => ({
    accountId: row.account_id,
    checkpointMonth: row.checkpoint_month,
    startDate: row.statement_start_date,
    endDate: row.statement_end_date ?? getMonthEndDate(row.checkpoint_month)
  }));
}

export function findClosedStatementPeriod(periods: ClosedStatementPeriod[], accountId: string | null | undefined, date: string) {
  if (!accountId) {
    return undefined;
  }
  return periods.find((period) => (
    period.accountId === accountId
    && (!period.startDate || date >= period.startDate)
    && date <= period.endDate
  ));
}

// The posted date for a new bank row from an activity export: its own day,
// or the day after the confirmed statement whose cycle it falls in.
export function resolveActivityPostDate(periods: ClosedStatementPeriod[], accountId: string | null | undefined, date: string) {
  const period = findClosedStatementPeriod(periods, accountId, date);
  return period ? addDays(period.endDate, 1) : date;
}

export function isLatePosting(period: ClosedStatementPeriod, date: string) {
  return date >= addDays(period.endDate, -LATE_POSTING_DAYS);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
