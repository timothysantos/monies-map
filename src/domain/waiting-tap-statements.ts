// The statements that resolve a waiting tap (DOMAIN.md "Waiting Tap"), each
// with its audit line. Shared by the entry create command (a completed tap
// changes in the entry's own batch), the import commit (a bank row or a
// certified statement clears it in the import's batch) and the waiting-tap
// commands, so no command module imports another. Every update is scoped to
// the household and only touches a tap that is still waiting, so a tap is
// never resolved twice.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import {
  planWaitingTapClears,
  type ImportClearRow,
  type ImportClearStatement,
  type WaitingTapCompletedBy
} from "./waiting-taps";

const COMPLETED_BY_WORDS: Record<WaitingTapCompletedBy, string> = {
  second_tap: "a second Shortcut run with the amount",
  shortcut_answer: "the amount typed in the Shortcut",
  app: "the amount typed in Monies Map",
  bank_alert: "the bank's alert"
};

export interface WaitingTapStatementTarget {
  id: string;
  receivedAt: string;
}

export function buildWaitingTapCompletedStatements(
  db: D1Database,
  tap: WaitingTapStatementTarget,
  input: {
    entryId: string;
    completedBy: WaitingTapCompletedBy;
    now: string;
    // A second Shortcut run: when it arrived, seconds after the first.
    secondRunSeconds?: number;
  }
) {
  const isSecondRun = input.completedBy === "second_tap";
  return [
    db
      .prepare(`
        UPDATE waiting_taps
        SET status = 'completed', completed_by = ?, entry_id = ?, resolved_at = ?,
          second_run_at = CASE WHEN ? THEN ? ELSE second_run_at END,
          second_run_seconds = CASE WHEN ? THEN ? ELSE second_run_seconds END,
          second_run_had_amount = CASE WHEN ? THEN 1 ELSE second_run_had_amount END
        WHERE household_id = ? AND id = ? AND status = 'waiting'
      `)
      .bind(
        input.completedBy, input.entryId, input.now,
        isSecondRun ? 1 : 0, input.now,
        isSecondRun ? 1 : 0, input.secondRunSeconds ?? null,
        isSecondRun ? 1 : 0,
        DEFAULT_HOUSEHOLD_ID, tap.id
      ),
    buildAuditEventStatement(db, {
      entityType: "waiting_tap",
      entityId: tap.id,
      action: "waiting_tap_completed",
      detail: isSecondRun
        ? `A tap waiting for its amount was completed by ${COMPLETED_BY_WORDS.second_tap} ${input.secondRunSeconds ?? 0} seconds after the first (${input.entryId}).`
        : `A tap waiting for its amount was completed by ${COMPLETED_BY_WORDS[input.completedBy]} (${input.entryId}).`
    })
  ];
}

export function buildWaitingTapClearedStatements(
  db: D1Database,
  tapId: string,
  input: { status: "not_a_payment" | "bank_row" | "statement_no_match"; now: string; importId?: string }
) {
  const detail = input.status === "not_a_payment"
    ? "A tap waiting for its amount was marked as not a payment."
    : input.status === "bank_row"
      ? `A tap waiting for its amount was cleared: the bank's row for it was imported (${input.importId ?? ""}).`
      : `A tap waiting for its amount was cleared: a confirmed statement covers its day without it (${input.importId ?? ""}).`;
  return [
    db
      .prepare("UPDATE waiting_taps SET status = ?, resolved_at = ?, cleared_by_import_id = ? WHERE household_id = ? AND id = ? AND status = 'waiting'")
      .bind(input.status, input.now, input.importId ?? null, DEFAULT_HOUSEHOLD_ID, tapId),
    buildAuditEventStatement(db, {
      entityType: "waiting_tap",
      entityId: tapId,
      action: input.status === "not_a_payment" ? "waiting_tap_not_a_payment" : "waiting_tap_cleared_by_import",
      detail
    })
  ];
}

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

export type WaitingTapRow = {
  id: string;
  request_id: string;
  person_id: string;
  account_id: string;
  other_currency_account_id: string;
  merchant: string;
  wallet_name: string;
  tap_date: string;
  received_at: string;
  client_version: string;
  status: string;
  completed_by: string | null;
  entry_id: string | null;
  resolved_at: string | null;
  second_run_at: string | null;
  second_run_seconds: number | null;
};

export const WAITING_TAP_COLUMNS = `id, request_id, person_id, account_id, other_currency_account_id, merchant, wallet_name,
  tap_date, received_at, client_version, status, completed_by, entry_id, resolved_at, second_run_at, second_run_seconds`;

// The taps still waiting, oldest first. No table means none (the feature is
// off until the additive schema is applied).
export async function readWaitingTapRows(db: D1Database): Promise<WaitingTapRow[]> {
  try {
    const result = await db
      .prepare(`SELECT ${WAITING_TAP_COLUMNS} FROM waiting_taps WHERE household_id = ? AND status = 'waiting' ORDER BY received_at, id`)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<WaitingTapRow>();
    return result.results;
  } catch (error) {
    if (isMissingTable(error)) {
      return [];
    }
    throw error;
  }
}

export function toWaitingTapFact(row: WaitingTapRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    personId: row.person_id,
    accountId: row.account_id,
    otherCurrencyAccountId: row.other_currency_account_id ?? "",
    merchant: row.merchant ?? "",
    walletName: row.wallet_name ?? "",
    tapDate: row.tap_date,
    receivedAt: row.received_at,
    status: row.status as "waiting"
  };
}

// A tap nobody finished in WAITING_TAP_EXPIRE_DAYS (waiting-taps-config.ts):
// it leaves the card and the reminders, and its audit lines stay.
export function buildWaitingTapExpiredStatements(db: D1Database, tapId: string, now: string) {
  return [
    db
      .prepare("UPDATE waiting_taps SET status = 'expired', resolved_at = ? WHERE household_id = ? AND id = ? AND status = 'waiting'")
      .bind(now, DEFAULT_HOUSEHOLD_ID, tapId),
    buildAuditEventStatement(db, {
      entityType: "waiting_tap",
      entityId: tapId,
      action: "waiting_tap_expired",
      detail: "A tap waiting for its amount was not finished within a week and was put away."
    })
  ];
}

// Rolling an import back puts the taps it cleared back to waiting, in the
// rollback's own batch. No table: nothing to put back.
export async function buildWaitingTapRollbackStatements(db: D1Database, importId: string) {
  const cleared = await db
    .prepare("SELECT id FROM waiting_taps WHERE household_id = ? AND cleared_by_import_id = ? AND status IN ('bank_row', 'statement_no_match')")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ id: string }>()
    .then((result) => result.results)
    .catch((error) => {
      if (isMissingTable(error)) {
        return [];
      }
      throw error;
    });
  return cleared.flatMap((tap) => [
    db
      .prepare(`
        UPDATE waiting_taps SET status = 'waiting', resolved_at = NULL, cleared_by_import_id = NULL
        WHERE household_id = ? AND id = ? AND cleared_by_import_id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, tap.id, importId),
    buildAuditEventStatement(db, {
      entityType: "waiting_tap",
      entityId: tap.id,
      action: "waiting_tap_reopened",
      detail: `The import that cleared a tap waiting for its amount was rolled back (${importId}); the tap is waiting again.`
    })
  ]);
}

// The day after a statement's end date one month earlier: the period a
// statement with no printed start date most likely covers.
export function fallbackStatementStart(endDate: string) {
  const [year, month, day] = endDate.split("-").map(Number);
  // The same day a month earlier, kept inside that month (31 March: 28 Feb).
  const daysInPreviousMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, daysInPreviousMonth) + 1)).toISOString().slice(0, 10);
}

// The statements an import commit writes that clear waiting taps: a tap the
// import's bank rows pay for, and a tap whose day a certified statement
// covers on every card it could be on without such a row. Reads the taps
// still waiting (none when the table is missing) and the household's earlier
// certified statements for their cards; the caller writes the statements in
// the import's own batch.
export async function buildImportWaitingTapClearStatements(
  db: D1Database,
  input: {
    importId: string;
    rows: ImportClearRow[];
    // This import's statements that reconcile (a PDF statement with no
    // difference), by card.
    certifiedStatements: ImportClearStatement[];
    now?: Date;
  }
) {
  const taps = (await readWaitingTapRows(db)).map(toWaitingTapFact);
  if (!taps.length) {
    return [];
  }
  const accountIds = [...new Set(taps.flatMap((tap) => [tap.accountId, tap.otherCurrencyAccountId]).filter(Boolean))];
  const earlier = await db
    .prepare(`
      SELECT account_id, statement_start_date, statement_end_date
      FROM statement_reconciliation_certificates
      WHERE household_id = ? AND status = 'certified' AND statement_end_date IS NOT NULL
        AND account_id IN (${accountIds.map(() => "?").join(", ")})
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...accountIds)
    .all<{ account_id: string; statement_start_date: string | null; statement_end_date: string }>();
  const statements: ImportClearStatement[] = [
    ...input.certifiedStatements,
    ...earlier.results.map((row) => ({
      accountId: row.account_id,
      startDate: row.statement_start_date ?? fallbackStatementStart(row.statement_end_date),
      endDate: row.statement_end_date
    }))
  ];
  const now = (input.now ?? new Date()).toISOString();
  return planWaitingTapClears(taps, input.rows, statements)
    .flatMap((clear) => buildWaitingTapClearedStatements(db, clear.tapId, { status: clear.status, now, importId: input.importId }));
}
