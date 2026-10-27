// The Ledger check-up's shared loader: every read the detectors need, in at
// most three `db.batch()` round trips and about two dozen statements, so no
// two detectors read the same rows (docs/proposals/ledger-checkup.md,
// "Performance budget").
//
//   round trip 1: independent reads (accounts, people, statements and their
//                 ledger stretches, candidate lists for every detector);
//   round trip 2: the reads that depend on round trip 1 (the twin and
//                 counterpart searches around the candidates, posting history,
//                 category rules and habits);
//   round trip 3: only when an account's statement no longer matches, the
//                 entries added after it was proven.
//
// Every read is an indexed range or primary-key read, a SQL aggregate over an
// account's own entries, or a self-join on an indexed key. Lists have a date
// window (400 days) and a LIMIT; a list that reaches its limit says so in
// `incomplete`. Nothing here writes.
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { loadCategoryMatchRules } from "../app-repository-category-match-rules";
import { loadAskHabits } from "../app-repository-ask-habits";
import {
  APPLE_PAY_ENTRIES_SQL,
  WRONG_CARD_MAX_ENTRIES,
  buildEarlierImportWindowsSql,
  buildNearbyEntriesSql,
  buildPostingLagSql,
  toLedgerFact,
  type NearbyRow
} from "../import-wrong-card-duplicates";
import {
  derivePostingLagDays,
  type AccountFact as WrongCardAccountFact,
  type ApplePayEntryFact,
  type CoverageFact
} from "../wrong-card-apple-pay-duplicate";
import { todayInAppTimeZone } from "../../lib/app-calendar";
import type { DuplicateEntryPair } from "./duplicate-entries";
import { addDays, daysBetween } from "./helpers";
import type { CheckupFacts } from "./registry";
import type { DeletedSettledFact, SplitPairFact, SplitPairFacts, SplitRecordFact } from "./split-duplicates";
import { STATEMENT_CHAIN_LENGTH, accountsNeedingMismatchCause, type LaterEntriesFact } from "./statements";
import type { EstimateFact } from "./stale-estimates";
import type { PlanCandidateFact, PlanRowFact } from "./plan-problems";
import { planMonths } from "./plan-problems";
import type { TransferCandidateFact, TransferFact, UnmatchedTransferFacts } from "./unmatched-transfers";
import type { AccountFact, CheckupContext, FindingKind } from "./types";

// How far back entry-based detectors look.
export const LOOKBACK_DAYS = 400;
// Two entries nobody has proven yet (a statement proves, and certified entries are
// never flagged) are looked for over the last half year: older ones have long been
// swept up by a statement. The self-join costs about 20 reads per row in the window.
export const DUPLICATE_ENTRY_LOOKBACK_DAYS = 180;
// Shared costs are settled up in rounds that can be a year old, and a mistake in
// a settled round is exactly what the check-up is for: Splits reads further back
// (a few hundred rows at most; one indexed range).
export const SPLIT_LOOKBACK_DAYS = 1100;
// A transfer nobody paired is as wrong a year on (the household's monthly
// transfers run for years); only 60 are weighed, newest first.
export const TRANSFER_LOOKBACK_DAYS = 800;
const APPLE_PAY_LOOKBACK_DAYS = 120;
const EXTRA_CAUSE_ACCOUNTS = 10;
const LIST_LIMIT = 150;
const SMALL_LIMIT = 60;
// D1 allows 100 bound values in a statement.
const MAX_AMOUNT_PARAMS = 60;

type Row = Record<string, string | number | null>;

function rowsOf(result: { results?: unknown[] } | undefined): Row[] {
  return (result?.results ?? []) as Row[];
}

const str = (value: unknown) => String(value ?? "");
const num = (value: unknown) => Number(value ?? 0);
const nullable = (value: unknown) => (value === null || value === undefined ? null : String(value));

// A split, a settle-up, a settlement check, a transfer link or a plan line holds
// the entry. An archived split or payment does not hold it (its link is kept
// only for a restore), so the two split tests use the partial indexes on live
// records (idx_split_expenses_active_linked_transaction and its twin).
const ledgerLinkExists = (entryId: string) => `(
  EXISTS (SELECT 1 FROM monthly_plan_entry_links WHERE transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_expenses WHERE linked_transaction_id = ${entryId} AND deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM split_settlements WHERE linked_transaction_id = ${entryId} AND deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM split_settlement_checkpoints WHERE matched_transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_settlement_checkpoint_matches WHERE transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM import_transfer_links WHERE transaction_id = ${entryId} OR counterpart_transaction_id = ${entryId})
)`;

const IMPORT_IS_COMPLETED = (alias: string, importAlias: string) => `(${alias}.import_id IS NULL OR ${importAlias}.status = 'completed')`;

// The signed amount of an entry on its account (income and transfers in add).
const SIGNED_AMOUNT = (alias: string) => `CASE WHEN ${alias}.entry_type = 'income' OR (${alias}.entry_type = 'transfer' AND ${alias}.transfer_direction = 'in') THEN ${alias}.amount_minor ELSE -${alias}.amount_minor END`;

const SAME_KEY_LEDGER = (left: string, right: string) => `
  ${right}.household_id = ${left}.household_id
  AND ${right}.account_id = ${left}.account_id
  AND ${right}.transaction_date = ${left}.transaction_date
  AND ${right}.amount_minor = ${left}.amount_minor
  AND ${right}.currency = ${left}.currency
  AND ${right}.entry_type = ${left}.entry_type
  AND COALESCE(${right}.transfer_direction, '') = COALESCE(${left}.transfer_direction, '')
  AND lower(trim(${right}.description)) = lower(trim(${left}.description))`;

// The partner of each entry is probed by account and day (INDEXED BY): without
// the hint the planner walked the household's whole date range for every row,
// 31 million reads on the 10k fixture.
export const DUPLICATE_ENTRIES_SQL = `
  SELECT a.id AS a_id, a.account_id, a.transaction_date AS date, a.amount_minor, a.currency, a.entry_type,
    a.description AS a_description, a.import_id AS a_import_id, a.created_at AS a_created_at, a.owner_person_id AS a_owner, ira.normalized_hash AS a_hash, ia.imported_at AS a_imported_at,
    b.id AS b_id, b.description AS b_description, b.import_id AS b_import_id, b.created_at AS b_created_at, b.owner_person_id AS b_owner, irb.normalized_hash AS b_hash, ib.imported_at AS b_imported_at
  FROM transactions AS a
  INNER JOIN transactions AS b INDEXED BY idx_transactions_account_date ON ${SAME_KEY_LEDGER("a", "b")} AND b.id > a.id
  LEFT JOIN imports AS ia ON ia.id = a.import_id
  LEFT JOIN imports AS ib ON ib.id = b.import_id
  LEFT JOIN import_rows AS ira ON ira.id = a.import_row_id
  LEFT JOIN import_rows AS irb ON irb.id = b.import_row_id
  WHERE a.household_id = ? AND a.transaction_date >= ?
    AND a.bank_certification_status = 'provisional' AND b.bank_certification_status = 'provisional'
    AND a.external_reference IS NULL AND b.external_reference IS NULL
    AND a.transfer_group_id IS NULL AND b.transfer_group_id IS NULL
    AND ${IMPORT_IS_COMPLETED("a", "ia")} AND ${IMPORT_IS_COMPLETED("b", "ib")}
    AND length(trim(a.description)) > 0
    AND NOT EXISTS (SELECT 1 FROM transactions AS c WHERE ${SAME_KEY_LEDGER("a", "c")} AND c.id <> a.id AND c.id <> b.id)
    AND NOT ${ledgerLinkExists("a.id")} AND NOT ${ledgerLinkExists("b.id")}
  ORDER BY a.transaction_date DESC, a.id
  LIMIT ${LIST_LIMIT + 1}`;

const SHARES_OF = (alias: string) => `(SELECT group_concat(person_id || ':' || amount_minor) FROM split_expense_shares WHERE split_expense_id = ${alias}.id)`;
// The ledger entry a split record is linked to, as the Splits matcher reads it.
const LINKED_ENTRY = (alias: string, prefix: string) => `
    ${alias}.transaction_date AS ${prefix}_link_date, ${alias}.amount_minor AS ${prefix}_link_amount, ${alias}.currency AS ${prefix}_link_currency,
    ${alias}.entry_type AS ${prefix}_link_type, ${alias}.description AS ${prefix}_link_description,
    COALESCE(${alias}.owner_person_id, ${alias}_acct.owner_person_id) AS ${prefix}_link_owner`;
// The live records that share a deleted record's group, day, amount, currency and payer.
const SAME_SPLIT_KEY = (candidate: string, deleted: string) => `${candidate}.household_id = ${deleted}.household_id AND ${candidate}.deleted_at IS NULL AND ${candidate}.id <> ${deleted}.id
    AND ${candidate}.expense_date = ${deleted}.expense_date AND ${candidate}.total_amount_minor = ${deleted}.total_amount_minor AND ${candidate}.currency = ${deleted}.currency
    AND ${candidate}.payer_person_id = ${deleted}.payer_person_id AND COALESCE(${candidate}.split_group_id, '') = COALESCE(${deleted}.split_group_id, '')`;
const CHECKPOINT_COVER = (alias: string, kind: "expense" | "settlement") => `(
  SELECT cp.id || '|' || cp.settlement_date
  FROM split_settlement_checkpoint_items AS it
  INNER JOIN split_settlement_checkpoints AS cp ON cp.id = it.checkpoint_id
  WHERE it.record_kind = '${kind}' AND it.record_id = ${alias}.id AND cp.status NOT IN ('reopened', 'voided')
  ORDER BY cp.created_at DESC, cp.id DESC LIMIT 1)`;

export const SPLIT_EXPENSE_PAIRS_SQL = `
  SELECT a.id AS a_id, b.id AS b_id, a.split_group_id AS group_id, g.group_name, a.expense_date AS date, a.total_amount_minor AS amount_minor,
    a.currency, a.payer_person_id, a.description AS a_description, b.description AS b_description,
    a.linked_transaction_id AS a_link, b.linked_transaction_id AS b_link, a.created_at AS a_created_at, b.created_at AS b_created_at,
    ${SHARES_OF("a")} AS a_shares, ${SHARES_OF("b")} AS b_shares,
    ${CHECKPOINT_COVER("a", "expense")} AS a_cover, ${CHECKPOINT_COVER("b", "expense")} AS b_cover,
    ba.id AS a_batch, ba.closed_on AS a_closed_on, bb.id AS b_batch, bb.closed_on AS b_closed_on,
    ${LINKED_ENTRY("lta", "a")}, ${LINKED_ENTRY("ltb", "b")}
  FROM split_expenses AS a
  INNER JOIN split_expenses AS b ON b.household_id = a.household_id AND b.id > a.id AND b.expense_date = a.expense_date
    AND b.total_amount_minor = a.total_amount_minor AND b.currency = a.currency AND b.payer_person_id = a.payer_person_id
    AND COALESCE(b.split_group_id, '') = COALESCE(a.split_group_id, '') AND b.deleted_at IS NULL
  LEFT JOIN split_groups AS g ON g.id = a.split_group_id
  LEFT JOIN split_batches AS ba ON ba.id = a.split_batch_id
  LEFT JOIN split_batches AS bb ON bb.id = b.split_batch_id
  LEFT JOIN transactions AS lta ON lta.id = a.linked_transaction_id
  LEFT JOIN accounts AS lta_acct ON lta_acct.id = lta.account_id
  LEFT JOIN transactions AS ltb ON ltb.id = b.linked_transaction_id
  LEFT JOIN accounts AS ltb_acct ON ltb_acct.id = ltb.account_id
  WHERE a.household_id = ? AND a.deleted_at IS NULL AND a.expense_date >= ?
    AND NOT EXISTS (
      SELECT 1 FROM split_expenses AS c
      WHERE c.household_id = a.household_id AND c.deleted_at IS NULL AND c.id <> a.id AND c.id <> b.id
        AND c.expense_date = a.expense_date AND c.total_amount_minor = a.total_amount_minor AND c.currency = a.currency
        AND c.payer_person_id = a.payer_person_id AND COALESCE(c.split_group_id, '') = COALESCE(a.split_group_id, ''))
  ORDER BY a.expense_date DESC, a.id
  LIMIT ${LIST_LIMIT + 1}`;

// Records the person deleted that an active settle-up still holds (the app refuses
// to delete a held record, so this only exists after a data fix). Starts from the
// settle-up's own list of records and reads each by key.
export const DELETED_SETTLED_EXPENSES_SQL = `
  SELECT e.id, e.split_group_id AS group_id, g.group_name, e.expense_date AS date, e.description, e.total_amount_minor AS amount_minor,
    e.currency, e.payer_person_id, e.deleted_at, e.created_at, e.linked_transaction_id,
    cp.id AS cp_id, cp.settlement_date AS cp_date,
    ${SHARES_OF("e")} AS shares,
    (SELECT COUNT(*) FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")}) AS twin_count,
    (SELECT t.id FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1) AS twin_id,
    (SELECT t.description FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1) AS twin_description,
    (SELECT t.linked_transaction_id FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1) AS twin_link,
    (SELECT t.created_at FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1) AS twin_created_at,
    (SELECT group_concat(person_id || ':' || amount_minor) FROM split_expense_shares WHERE split_expense_id = (SELECT t.id FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1)) AS twin_shares,
    EXISTS (
      SELECT 1 FROM split_settlement_checkpoint_items AS it2
      WHERE it2.checkpoint_id = cp.id AND it2.record_kind = 'expense'
        AND it2.record_id = (SELECT t.id FROM split_expenses AS t WHERE ${SAME_SPLIT_KEY("t", "e")} ORDER BY t.id LIMIT 1)
    ) AS twin_in_cp
  FROM split_settlement_checkpoints AS cp
  INNER JOIN split_settlement_checkpoint_items AS it ON it.checkpoint_id = cp.id AND it.record_kind = 'expense'
  INNER JOIN split_expenses AS e ON e.id = it.record_id
  LEFT JOIN split_groups AS g ON g.id = e.split_group_id
  WHERE cp.household_id = ? AND cp.status NOT IN ('reopened', 'voided')
    AND e.deleted_at IS NOT NULL AND e.expense_date >= ?
  ORDER BY e.expense_date DESC, e.id
  LIMIT ${SMALL_LIMIT + 1}`;

export const SPLIT_SETTLEMENT_PAIRS_SQL = `
  SELECT a.id AS a_id, b.id AS b_id, a.split_group_id AS group_id, g.group_name, a.settlement_date AS date, a.amount_minor,
    a.currency, a.from_person_id, a.to_person_id, a.note AS a_note, b.note AS b_note,
    a.linked_transaction_id AS a_link, b.linked_transaction_id AS b_link, a.created_at AS a_created_at, b.created_at AS b_created_at,
    ${CHECKPOINT_COVER("a", "settlement")} AS a_cover, ${CHECKPOINT_COVER("b", "settlement")} AS b_cover,
    ba.id AS a_batch, ba.closed_on AS a_closed_on, bb.id AS b_batch, bb.closed_on AS b_closed_on
  FROM split_settlements AS a
  INNER JOIN split_settlements AS b ON b.household_id = a.household_id AND b.id > a.id AND b.settlement_date = a.settlement_date
    AND b.amount_minor = a.amount_minor AND b.currency = a.currency AND b.from_person_id = a.from_person_id AND b.to_person_id = a.to_person_id
    AND COALESCE(b.split_group_id, '') = COALESCE(a.split_group_id, '') AND b.deleted_at IS NULL
    AND b.correction_source_id IS NULL
  LEFT JOIN split_groups AS g ON g.id = a.split_group_id
  LEFT JOIN split_batches AS ba ON ba.id = a.split_batch_id
  LEFT JOIN split_batches AS bb ON bb.id = b.split_batch_id
  WHERE a.household_id = ? AND a.deleted_at IS NULL AND a.correction_source_id IS NULL AND a.settlement_date >= ?
    AND NOT EXISTS (
      SELECT 1 FROM split_settlements AS c
      WHERE c.household_id = a.household_id AND c.deleted_at IS NULL AND c.id <> a.id AND c.id <> b.id
        AND c.settlement_date = a.settlement_date AND c.amount_minor = a.amount_minor AND c.currency = a.currency
        AND c.from_person_id = a.from_person_id AND c.to_person_id = a.to_person_id AND COALESCE(c.split_group_id, '') = COALESCE(a.split_group_id, ''))
  ORDER BY a.settlement_date DESC, a.id
  LIMIT ${SMALL_LIMIT + 1}`;

// Transfers nobody has paired, newest first (at most TRANSFER_LIMIT), each with the
// entries of the same amount and currency on another account within a week that no
// transfer pair or live split already holds: the partner search of the Entries
// transfer dialog, answered in one read by probing the household's date index a
// fortnight at a time instead of pulling candidates into the Worker.
export const TRANSFER_LIMIT = 250;
export const UNMATCHED_TRANSFERS_SQL = `
  WITH unmatched AS (
    SELECT t.id, t.account_id, t.transaction_date, t.description, t.amount_minor, t.currency, t.transfer_direction, t.owner_person_id
    FROM transactions AS t
    LEFT JOIN imports AS i ON i.id = t.import_id
    WHERE t.household_id = ? AND t.entry_type = 'transfer' AND t.transfer_group_id IS NULL AND t.transfer_review_dismissed_at IS NULL
      AND t.transaction_date BETWEEN ? AND ? AND ${IMPORT_IS_COMPLETED("t", "i")}
      AND NOT EXISTS (SELECT 1 FROM split_settlements WHERE linked_transaction_id = t.id AND deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM split_settlement_checkpoints WHERE matched_transaction_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM split_settlement_checkpoint_matches WHERE transaction_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM import_transfer_links WHERE transaction_id = t.id OR counterpart_transaction_id = t.id)
    ORDER BY t.transaction_date DESC, t.id
    LIMIT ${TRANSFER_LIMIT + 1}
  )
  SELECT u.id, u.account_id, u.transaction_date, u.description, u.amount_minor, u.currency, u.transfer_direction, u.owner_person_id,
    c.id AS c_id, c.account_id AS c_account_id, c.transaction_date AS c_date, c.description AS c_description, c.currency AS c_currency,
    c.entry_type AS c_type, c.transfer_direction AS c_direction, c.owner_person_id AS c_owner
  FROM unmatched AS u
  LEFT JOIN transactions AS c ON c.household_id = ? AND c.amount_minor = u.amount_minor AND c.currency = u.currency
    AND c.account_id <> u.account_id AND c.id <> u.id AND c.transfer_group_id IS NULL
    AND c.transaction_date BETWEEN date(u.transaction_date, '-7 days') AND date(u.transaction_date, '+7 days')
    AND (c.import_id IS NULL OR EXISTS (SELECT 1 FROM imports AS ci WHERE ci.id = c.import_id AND ci.status = 'completed'))
    AND NOT EXISTS (SELECT 1 FROM split_expenses WHERE linked_transaction_id = c.id AND deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM split_settlements WHERE linked_transaction_id = c.id AND deleted_at IS NULL)
  ORDER BY u.transaction_date DESC, u.id, c.transaction_date, c.id
  LIMIT ${TRANSFER_LIMIT * 8}`;

export const STALE_ESTIMATES_SQL = `
  SELECT t.id, t.account_id, t.transaction_date, t.description, t.amount_minor, t.currency, t.original_amount_minor, t.original_currency, t.owner_person_id
  FROM transactions AS t
  WHERE t.household_id = ? AND t.transaction_date BETWEEN ? AND ?
    AND t.original_currency IS NOT NULL AND t.original_amount_minor IS NOT NULL
    AND t.import_id IS NULL AND t.bank_certification_status = 'provisional'
    AND t.entry_type = 'expense' AND t.transfer_group_id IS NULL
    AND NOT ${ledgerLinkExists("t.id")}
  ORDER BY t.transaction_date DESC, t.id
  LIMIT ${SMALL_LIMIT + 1}`;

export const STATEMENTS_SQL = `
  SELECT c.account_id, c.checkpoint_month, c.statement_start_date, c.statement_end_date, c.statement_balance_minor,
    MAX(CASE WHEN cert.status = 'certified' THEN 1 ELSE 0 END) AS proven, MAX(cert.created_at) AS certified_at
  FROM account_balance_checkpoints AS c
  INNER JOIN statement_reconciliation_certificates AS cert
    ON cert.household_id = c.household_id AND cert.account_id = c.account_id AND cert.checkpoint_month = c.checkpoint_month
  INNER JOIN imports AS i ON i.id = cert.import_id AND i.status = 'completed'
  WHERE c.household_id = ?
  GROUP BY c.account_id, c.checkpoint_month
  ORDER BY c.account_id, c.checkpoint_month
  LIMIT 1000`;

// Each proven statement's own stretch of ledger movement, for an account's last
// STATEMENT_CHAIN_LENGTH proven statements (the first one's stretch is all of
// history before its end date, so the running total starts at the opening
// balance). One pass over the account's entries.
export const STATEMENT_SEGMENTS_SQL = `
  WITH proven AS (
    SELECT c.account_id, c.checkpoint_month,
      COALESCE(c.statement_end_date, date(c.checkpoint_month || '-01', '+1 month', '-1 day')) AS end_date
    FROM account_balance_checkpoints AS c
    WHERE c.household_id = ? AND EXISTS (
      SELECT 1 FROM statement_reconciliation_certificates AS cert
      INNER JOIN imports AS i ON i.id = cert.import_id AND i.status = 'completed'
      WHERE cert.account_id = c.account_id AND cert.checkpoint_month = c.checkpoint_month AND cert.status = 'certified')
  ),
  ranked AS (
    SELECT account_id, checkpoint_month, end_date, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY end_date DESC, checkpoint_month DESC) AS rn
    FROM proven
  ),
  kept AS (
    SELECT account_id, checkpoint_month, end_date,
      COALESCE(LAG(end_date) OVER (PARTITION BY account_id ORDER BY end_date, checkpoint_month), '0000-00-00') AS prev_end
    FROM ranked WHERE rn <= ${STATEMENT_CHAIN_LENGTH}
  )
  SELECT k.account_id, k.checkpoint_month, COUNT(t.id) AS entry_count, COALESCE(SUM(${SIGNED_AMOUNT("t")}), 0) AS net_minor
  FROM kept AS k
  LEFT JOIN transactions AS t ON t.account_id = k.account_id AND t.household_id = ?
    AND COALESCE(t.post_date, t.transaction_date) > k.prev_end AND COALESCE(t.post_date, t.transaction_date) <= k.end_date
    AND (t.import_id IS NULL OR EXISTS (SELECT 1 FROM imports AS i2 WHERE i2.id = t.import_id AND i2.status = 'completed'))
  GROUP BY k.account_id, k.checkpoint_month`;

export const MONTH_ACTIVITY_SQL = `
  SELECT t.account_id, substr(COALESCE(t.post_date, t.transaction_date), 1, 7) AS month, COUNT(*) AS entry_count
  FROM transactions AS t
  WHERE t.household_id = ? AND t.transaction_date >= ?
    AND t.account_id IN (SELECT account_id FROM account_balance_checkpoints WHERE household_id = ? GROUP BY account_id HAVING COUNT(*) >= 2)
    AND (t.import_id IS NULL OR EXISTS (SELECT 1 FROM imports AS i WHERE i.id = t.import_id AND i.status = 'completed'))
  GROUP BY t.account_id, month`;

export const PLAN_ROWS_SQL = `
  SELECT r.id, r.year, r.month, r.person_id, r.section_key, r.category_id, c.name AS category_name, r.label, r.plan_date,
    r.planned_amount_minor, r.actual_amount_minor,
    (SELECT COUNT(*) FROM monthly_plan_entry_links AS l WHERE l.monthly_plan_row_id = r.id) AS link_count
  FROM monthly_plan_rows AS r
  LEFT JOIN categories AS c ON c.id = r.category_id
  WHERE r.household_id = ? AND ((r.year = ? AND r.month = ?) OR (r.year = ? AND r.month = ?))
  LIMIT 500`;

export function buildPlanCandidatesSql(amountCount: number) {
  return `
    SELECT t.id, t.transaction_date, t.description, t.amount_minor, c.name AS category_name, a.account_name
    FROM transactions AS t
    INNER JOIN accounts AS a ON a.id = t.account_id
    LEFT JOIN categories AS c ON c.id = t.category_id
    LEFT JOIN imports AS i ON i.id = t.import_id
    WHERE t.household_id = ? AND t.entry_type = 'expense' AND t.transaction_date BETWEEN ? AND ?
      AND t.amount_minor IN (${Array.from({ length: amountCount }, () => "?").join(", ")})
      AND ${IMPORT_IS_COMPLETED("t", "i")}
      AND NOT EXISTS (SELECT 1 FROM monthly_plan_entry_links AS l WHERE l.transaction_id = t.id)
    LIMIT 300`;
}

export const OTHER_ENTRIES_SQL = `
  SELECT t.id, t.account_id, t.transaction_date, t.description, t.amount_minor, t.currency, t.entry_type, t.owner_person_id
  FROM transactions AS t
  INNER JOIN categories AS c ON c.id = t.category_id
  LEFT JOIN imports AS i ON i.id = t.import_id
  WHERE t.household_id = ? AND c.name = 'Other' AND t.entry_type = 'expense'
    AND t.transaction_date BETWEEN ? AND ? AND ${IMPORT_IS_COMPLETED("t", "i")}
  ORDER BY t.transaction_date DESC, t.id
  LIMIT ${SMALL_LIMIT + 1}`;

export const ODD_ENTRIES_SQL = `
  SELECT t.id, t.account_id, t.transaction_date, t.description, t.amount_minor, t.currency, t.entry_type, t.owner_person_id
  FROM transactions AS t
  LEFT JOIN imports AS i ON i.id = t.import_id
  WHERE t.household_id = ? AND t.transaction_date >= ? AND (t.amount_minor = 0 OR t.transaction_date > ?)
    AND ${IMPORT_IS_COMPLETED("t", "i")}
  ORDER BY t.transaction_date DESC, t.id
  LIMIT ${SMALL_LIMIT + 1}`;

export const ACCOUNTS_SQL = `
  SELECT a.id, a.account_name, a.account_kind, a.owner_person_id, a.is_joint, a.is_active, a.currency, a.opening_balance_minor,
    (SELECT MAX(t.transaction_date) FROM transactions AS t WHERE t.account_id = a.id) AS last_entry_date
  FROM accounts AS a
  WHERE a.household_id = ?`;

// A statement period with no printed start opens the day after the same date
// one month earlier (DOMAIN.md "Statement Checkpoint").
export function statementPeriodStart(endDate: string) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const earlier = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  const lastDay = new Date(Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth() + 1, 0)).getUTCDate();
  earlier.setUTCDate(Math.min(end.getUTCDate(), lastDay));
  return addDays(earlier.toISOString().slice(0, 10), 1);
}

function parseShares(text: unknown) {
  return str(text)
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const at = part.lastIndexOf(":");
      return { personId: part.slice(0, at), amountMinor: Number(part.slice(at + 1)) };
    });
}

// The split facts the settled-period and duplicate-split detectors read, built
// from the three split reads (and the list of expenses a live correction
// already corrects). Shared by the whole check-up and by the Split Correction
// command, which must offer a correction only for a finding the detector reports.
export function buildSplitPairFacts(
  rows: { expenseRows: Row[]; settlementRows: Row[]; deletedRows: Row[]; correctedRows: Row[] },
  incomplete: Set<FindingKind>
): SplitPairFacts {
  const { expenseRows: splitExpenseRows, settlementRows: splitSettlementRows, deletedRows: deletedSettledRows, correctedRows } = rows;
  const splitPairs: SplitPairFact[] = [
    ...splitExpenseRows.slice(0, LIST_LIMIT).map((row): SplitPairFact => {
      const side = (prefix: "a" | "b"): SplitRecordFact => ({
        id: str(row[`${prefix}_id`]),
        kind: "expense",
        description: str(row[`${prefix}_description`]),
        date: str(row.date),
        amountMinor: num(row.amount_minor),
        currency: str(row.currency),
        groupId: nullable(row.group_id),
        groupName: nullable(row.group_name),
        payerPersonId: str(row.payer_person_id),
        toPersonId: null,
        linkedTransactionId: nullable(row[`${prefix}_link`]),
        linkedEntry: row[`${prefix}_link_date`] === null || row[`${prefix}_link_date`] === undefined ? null : {
          date: str(row[`${prefix}_link_date`]),
          amountMinor: num(row[`${prefix}_link_amount`]),
          currency: str(row[`${prefix}_link_currency`]),
          entryType: str(row[`${prefix}_link_type`]) as "expense" | "income" | "transfer",
          description: str(row[`${prefix}_link_description`]),
          ownerPersonId: nullable(row[`${prefix}_link_owner`])
        },
        shares: parseShares(row[`${prefix}_shares`]),
        coveredBy: coveredBy(row[`${prefix}_cover`], row[`${prefix}_batch`], row[`${prefix}_closed_on`]),
        createdAt: str(row[`${prefix}_created_at`])
      });
      return { a: side("a"), b: side("b") };
    }),
    ...splitSettlementRows.slice(0, SMALL_LIMIT).map((row): SplitPairFact => {
      const side = (prefix: "a" | "b"): SplitRecordFact => ({
        id: str(row[`${prefix}_id`]),
        kind: "settlement",
        description: str(row[`${prefix}_note`]) || "Payment",
        date: str(row.date),
        amountMinor: num(row.amount_minor),
        currency: str(row.currency),
        groupId: nullable(row.group_id),
        groupName: nullable(row.group_name),
        payerPersonId: str(row.from_person_id),
        toPersonId: str(row.to_person_id),
        linkedTransactionId: nullable(row[`${prefix}_link`]),
        linkedEntry: null,
        shares: [],
        coveredBy: coveredBy(row[`${prefix}_cover`], row[`${prefix}_batch`], row[`${prefix}_closed_on`]),
        createdAt: str(row[`${prefix}_created_at`])
      });
      return { a: side("a"), b: side("b") };
    })
  ];
  const deletedInSettled: DeletedSettledFact[] = deletedSettledRows.slice(0, SMALL_LIMIT).map((row) => {
    const record = {
      id: str(row.id),
      kind: "expense" as const,
      description: str(row.description),
      date: str(row.date),
      amountMinor: num(row.amount_minor),
      currency: str(row.currency),
      groupId: nullable(row.group_id),
      groupName: nullable(row.group_name),
      payerPersonId: str(row.payer_person_id),
      toPersonId: null,
      linkedTransactionId: nullable(row.linked_transaction_id),
      linkedEntry: null,
      shares: parseShares(row.shares),
      coveredBy: { kind: "checkpoint" as const, id: str(row.cp_id), date: str(row.cp_date) },
      createdAt: str(row.created_at),
      deletedAt: str(row.deleted_at)
    };
    const twinCount = num(row.twin_count);
    return {
      record,
      twinCount,
      twin: twinCount === 1 && row.twin_id ? {
        inSameSettleUp: Boolean(num(row.twin_in_cp)),
        record: {
          id: str(row.twin_id),
          kind: "expense" as const,
          description: str(row.twin_description),
          date: record.date,
          amountMinor: record.amountMinor,
          currency: record.currency,
          groupId: record.groupId,
          groupName: record.groupName,
          payerPersonId: record.payerPersonId,
          toPersonId: null,
          linkedTransactionId: nullable(row.twin_link),
          linkedEntry: null,
          shares: parseShares(row.twin_shares),
          coveredBy: null,
          createdAt: str(row.twin_created_at)
        }
      } : null
    };
  });
  if (deletedSettledRows.length > SMALL_LIMIT) incomplete.add("settled_period_error");
  if (splitExpenseRows.length > LIST_LIMIT || splitSettlementRows.length > SMALL_LIMIT) {
    incomplete.add("duplicate_split");
    incomplete.add("settled_period_error");
  }
  return { pairs: splitPairs, deletedInSettled, correctedSourceIds: correctedRows.map((row) => str(row.correction_source_id)) };
}

// The live split expenses a correction already corrects (their settled
// mistake is resolved until the correction is undone).
export const CORRECTED_SOURCES_SQL = `
  SELECT correction_source_id FROM split_settlements
  WHERE household_id = ? AND correction_source_id IS NOT NULL AND deleted_at IS NULL`;

// Only the split reads, for the Split Correction preview and command: the
// same facts the check-up builds, in one round trip.
export async function loadSplitPairFacts(db: D1Database, today = todayInAppTimeZone()): Promise<{ facts: SplitPairFacts; context: CheckupContext; incomplete: FindingKind[] }> {
  const household = DEFAULT_HOUSEHOLD_ID;
  const since = addDays(today, -SPLIT_LOOKBACK_DAYS);
  const [peopleRows, expenseRows, settlementRows, deletedRows, correctedRows] = (await db.batch([
    db.prepare("SELECT id, display_name FROM people WHERE household_id = ?").bind(household),
    db.prepare(SPLIT_EXPENSE_PAIRS_SQL).bind(household, since),
    db.prepare(SPLIT_SETTLEMENT_PAIRS_SQL).bind(household, since),
    db.prepare(DELETED_SETTLED_EXPENSES_SQL).bind(household, since),
    db.prepare(CORRECTED_SOURCES_SQL).bind(household)
  ])).map(rowsOf);
  const incomplete = new Set<FindingKind>();
  const facts = buildSplitPairFacts({ expenseRows, settlementRows, deletedRows, correctedRows }, incomplete);
  const context: CheckupContext = {
    today,
    accounts: new Map(),
    people: new Map(peopleRows.map((row): [string, string] => [str(row.id), str(row.display_name)]))
  };
  return { facts, context, incomplete: [...incomplete] };
}

function coveredBy(cover: unknown, batchId: unknown, closedOn: unknown): SplitRecordFact["coveredBy"] {
  if (cover) {
    const [id, date] = str(cover).split("|");
    return { kind: "checkpoint", id, date };
  }
  return closedOn ? { kind: "batch", id: str(batchId), date: str(closedOn) } : null;
}

function toWrongCardAccountFacts(accounts: Map<string, AccountFact>) {
  return new Map(Array.from(accounts.values(), (account): [string, WrongCardAccountFact] => [account.id, {
    id: account.id,
    name: account.name,
    ownerPersonId: account.ownerPersonId,
    isJoint: account.isJoint,
    currency: account.currency
  }]));
}

// One row per transfer and possible partner: the transfers newest first (the
// sentinel one past the limit says there are more), the partners beside them.
// When the read hit its row limit the last transfer may have lost partners, so
// its id is listed in `unreliableIds` (a clear pair never relies on it).
export function buildUnmatchedTransferFacts(transferRows: Row[], incomplete: Set<FindingKind>): UnmatchedTransferFacts {
  const transferById = new Map<string, TransferFact>();
  const partnerById = new Map<string, TransferCandidateFact>();
  for (const row of transferRows) {
    if (transferById.size >= TRANSFER_LIMIT && !transferById.has(str(row.id))) {
      incomplete.add("unmatched_transfer");
      continue;
    }
    transferById.set(str(row.id), {
      id: str(row.id),
      accountId: str(row.account_id),
      date: str(row.transaction_date),
      description: str(row.description),
      amountMinor: num(row.amount_minor),
      currency: str(row.currency),
      direction: (nullable(row.transfer_direction) as "in" | "out" | null),
      ownerPersonId: nullable(row.owner_person_id)
    });
    if (row.c_id) {
      partnerById.set(str(row.c_id), {
        id: str(row.c_id),
        accountId: str(row.c_account_id),
        date: str(row.c_date),
        description: str(row.c_description),
        amountMinor: num(row.amount_minor),
        currency: str(row.c_currency),
        entryType: str(row.c_type) as TransferCandidateFact["entryType"],
        direction: (nullable(row.c_direction) as "in" | "out" | null),
        ownerPersonId: nullable(row.c_owner)
      });
    }
  }
  const cutShort = transferRows.length >= TRANSFER_LIMIT * 8;
  if (cutShort) incomplete.add("unmatched_transfer");
  return {
    transfers: [...transferById.values()],
    candidates: [...partnerById.values()],
    unreliableIds: cutShort && transferRows.length ? [str(transferRows[transferRows.length - 1].id)] : []
  };
}

function accountFactsFrom(accountRows: Row[]) {
  return new Map<string, AccountFact>(accountRows.map((row): [string, AccountFact] => [str(row.id), {
    id: str(row.id),
    name: str(row.account_name),
    kind: str(row.account_kind) as AccountFact["kind"],
    ownerPersonId: nullable(row.owner_person_id),
    isJoint: Boolean(num(row.is_joint)),
    isActive: Boolean(num(row.is_active)),
    currency: str(row.currency) || "SGD",
    openingBalanceMinor: num(row.opening_balance_minor),
    lastEntryDate: nullable(row.last_entry_date)
  }]));
}

// Only the transfer reads, for the preview and command that link clear pairs:
// the check-up's own unlinked transfers with their possible partners, and the
// accounts they sit on, in one round trip of two statements.
export async function loadTransferPairFacts(db: D1Database, today = todayInAppTimeZone()): Promise<{ facts: UnmatchedTransferFacts; context: CheckupContext }> {
  const household = DEFAULT_HOUSEHOLD_ID;
  const [accountRows, transferRows] = (await db.batch([
    db.prepare(ACCOUNTS_SQL).bind(household),
    db.prepare(UNMATCHED_TRANSFERS_SQL).bind(household, addDays(today, -TRANSFER_LOOKBACK_DAYS), addDays(today, -7), household)
  ])).map(rowsOf);
  return {
    facts: buildUnmatchedTransferFacts(transferRows, new Set()),
    context: { today, accounts: accountFactsFrom(accountRows), people: new Map() }
  };
}

export async function loadCheckupFacts(db: D1Database, today = todayInAppTimeZone()): Promise<CheckupFacts> {
  const household = DEFAULT_HOUSEHOLD_ID;
  const since = addDays(today, -LOOKBACK_DAYS);
  const [currentMonth, nextMonth] = planMonths(today);
  const [currentYear, currentNumber] = currentMonth.split("-").map(Number);
  const [nextYear, nextNumber] = nextMonth.split("-").map(Number);
  const incomplete = new Set<FindingKind>();

  // ---- Round trip 1 -------------------------------------------------------
  const [
    accountRows, peopleRows, applePayRows, statementRows, segmentRows, activityRows, breakRows,
    duplicateRows, splitExpenseRows, splitSettlementRows, transferRows, estimateRows, planRows, otherRows, oddRows, deletedSettledRows, correctedRows
  ] = (await db.batch([
    db.prepare(ACCOUNTS_SQL).bind(household),
    db.prepare("SELECT id, display_name FROM people WHERE household_id = ?").bind(household),
    db.prepare(APPLE_PAY_ENTRIES_SQL).bind(household, addDays(today, -APPLE_PAY_LOOKBACK_DAYS), today),
    db.prepare(STATEMENTS_SQL).bind(household),
    db.prepare(STATEMENT_SEGMENTS_SQL).bind(household, household),
    db.prepare(MONTH_ACTIVITY_SQL).bind(household, since, household),
    db.prepare("SELECT account_id, missing_checkpoint_month FROM statement_chain_breaks WHERE household_id = ? LIMIT 200").bind(household),
    db.prepare(DUPLICATE_ENTRIES_SQL).bind(household, addDays(today, -DUPLICATE_ENTRY_LOOKBACK_DAYS)),
    db.prepare(SPLIT_EXPENSE_PAIRS_SQL).bind(household, addDays(today, -SPLIT_LOOKBACK_DAYS)),
    db.prepare(SPLIT_SETTLEMENT_PAIRS_SQL).bind(household, addDays(today, -SPLIT_LOOKBACK_DAYS)),
    db.prepare(UNMATCHED_TRANSFERS_SQL).bind(household, addDays(today, -TRANSFER_LOOKBACK_DAYS), addDays(today, -7), household),
    db.prepare(STALE_ESTIMATES_SQL).bind(household, since, addDays(today, -17)),
    db.prepare(PLAN_ROWS_SQL).bind(household, currentYear, currentNumber, nextYear, nextNumber),
    db.prepare(OTHER_ENTRIES_SQL).bind(household, since, addDays(today, -60)),
    db.prepare(ODD_ENTRIES_SQL).bind(household, since, addDays(today, 14)),
    db.prepare(DELETED_SETTLED_EXPENSES_SQL).bind(household, addDays(today, -SPLIT_LOOKBACK_DAYS)),
    db.prepare(CORRECTED_SOURCES_SQL).bind(household)
  ])).map(rowsOf);

  const accounts = accountFactsFrom(accountRows);
  const people = new Map(peopleRows.map((row): [string, string] => [str(row.id), str(row.display_name)]));
  const context: CheckupContext = { today, accounts, people };

  const applePayEntries: ApplePayEntryFact[] = applePayRows.slice(0, WRONG_CARD_MAX_ENTRIES).map((row) => ({
    id: str(row.id),
    accountId: str(row.account_id),
    date: str(row.transaction_date),
    description: str(row.description),
    amountMinor: num(row.amount_minor),
    currency: str(row.currency),
    originalCurrency: nullable(row.original_currency),
    ownerPersonId: nullable(row.owner_person_id),
    hasLinks: Boolean(num(row.has_links))
  }));
  if (applePayRows.length > WRONG_CARD_MAX_ENTRIES) incomplete.add("wrong_card_duplicate");

  const duplicatePairs: DuplicateEntryPair[] = duplicateRows.slice(0, LIST_LIMIT).map((row) => {
    const side = (prefix: "a" | "b") => ({
      id: str(row[`${prefix}_id`]),
      accountId: str(row.account_id),
      date: str(row.date),
      description: str(row[`${prefix}_description`]),
      amountMinor: num(row.amount_minor),
      currency: str(row.currency),
      entryType: str(row.entry_type) as "expense" | "income" | "transfer",
      importId: nullable(row[`${prefix}_import_id`]),
      rowHash: nullable(row[`${prefix}_hash`]),
      importedAt: nullable(row[`${prefix}_imported_at`]),
      createdAt: str(row[`${prefix}_created_at`]),
      ownerPersonId: nullable(row[`${prefix}_owner`])
    });
    return { a: side("a"), b: side("b") };
  });
  if (duplicateRows.length > LIST_LIMIT) incomplete.add("duplicate_entry");

  const splitPairs = buildSplitPairFacts({ expenseRows: splitExpenseRows, settlementRows: splitSettlementRows, deletedRows: deletedSettledRows, correctedRows }, incomplete);

  // One row per transfer and possible partner: the transfers newest first (the
  // sentinel one past the limit says there are more), the partners beside them.
  const transferFacts = buildUnmatchedTransferFacts(transferRows, incomplete);

  const estimates: EstimateFact[] = estimateRows.slice(0, SMALL_LIMIT).map((row) => ({
    id: str(row.id),
    accountId: str(row.account_id),
    date: str(row.transaction_date),
    description: str(row.description),
    amountMinor: num(row.amount_minor),
    currency: str(row.currency),
    originalAmountMinor: num(row.original_amount_minor),
    originalCurrency: str(row.original_currency),
    ownerPersonId: nullable(row.owner_person_id)
  }));
  if (estimateRows.length > SMALL_LIMIT) incomplete.add("stale_estimate");

  const statements = statementRows.map((row) => ({
    accountId: str(row.account_id),
    month: str(row.checkpoint_month),
    startDate: nullable(row.statement_start_date),
    endDate: nullable(row.statement_end_date) ?? addDays(`${nextMonthStart(str(row.checkpoint_month))}`, -1),
    balanceMinor: num(row.statement_balance_minor),
    proven: Boolean(num(row.proven)),
    certifiedAt: str(row.certified_at)
  }));

  const planFacts: PlanRowFact[] = planRows.map((row) => ({
    id: str(row.id),
    month: `${num(row.year)}-${String(num(row.month)).padStart(2, "0")}`,
    section: str(row.section_key) as PlanRowFact["section"],
    personId: nullable(row.person_id),
    categoryId: nullable(row.category_id),
    categoryName: nullable(row.category_name),
    label: str(row.label),
    planDate: nullable(row.plan_date),
    plannedMinor: num(row.planned_amount_minor),
    actualMinor: num(row.actual_amount_minor),
    linkCount: num(row.link_count)
  }));
  const dueLines = planFacts.filter((row) => row.month === currentMonth && row.section === "planned_items" && row.planDate && row.planDate < today && row.plannedMinor > 0 && row.linkCount === 0 && row.actualMinor === 0);

  const otherEntries = otherRows.slice(0, SMALL_LIMIT).map((row) => hygieneEntry(row));
  if (otherRows.length > SMALL_LIMIT) incomplete.add("other_category");
  const oddEntries = oddRows.slice(0, SMALL_LIMIT).map((row) => hygieneEntry(row));
  if (oddRows.length > SMALL_LIMIT) incomplete.add("odd_entry");

  // ---- Round trip 2 -------------------------------------------------------
  const cardAccountIds = Array.from(new Set([...applePayEntries.map((entry) => entry.accountId), ...estimates.map((estimate) => estimate.accountId)]));
  const entryDates = [...applePayEntries.map((entry) => entry.date), ...estimates.map((estimate) => estimate.date)].sort();
  const applePayAmounts = Array.from(new Set(applePayEntries.map((entry) => entry.amountMinor)));
  const planAmounts = Array.from(new Set(dueLines.map((row) => row.plannedMinor))).slice(0, MAX_AMOUNT_PARAMS);

  const phaseTwo: D1PreparedStatement[] = [];
  const slots: Record<string, number> = {};
  const add = (name: string, statement: D1PreparedStatement) => {
    slots[name] = phaseTwo.length;
    phaseTwo.push(statement);
  };
  if (applePayEntries.length) {
    add("nearby", db.prepare(buildNearbyEntriesSql(applePayAmounts.length)).bind(household, addDays(applePayEntries.map((entry) => entry.date).sort()[0], -10), today, ...applePayAmounts));
  }
  if (cardAccountIds.length) {
    add("windows", db.prepare(buildEarlierImportWindowsSql(cardAccountIds.length)).bind(...cardAccountIds, addDays(entryDates[0], -120), addDays(entryDates[entryDates.length - 1], 60), household));
    add("lags", db.prepare(buildPostingLagSql(cardAccountIds.length)).bind(...cardAccountIds, addDays(entryDates[0], -365)));
  }
  if (dueLines.length) {
    const dates = dueLines.map((row) => row.planDate!).sort();
    add("planCandidates", db.prepare(buildPlanCandidatesSql(planAmounts.length)).bind(household, addDays(dates[0], -10), today, ...planAmounts));
  }
  if (otherEntries.length) {
    add("categories", db.prepare("SELECT name FROM categories WHERE household_id = ?").bind(household));
  }
  const [phaseTwoResults, rules, habits] = await Promise.all([
    phaseTwo.length ? db.batch(phaseTwo) : Promise.resolve([]),
    otherEntries.length ? loadCategoryMatchRules(db).catch(() => []) : Promise.resolve([]),
    otherEntries.length ? loadAskHabits(db).catch(() => ({ available: false, habits: [] })) : Promise.resolve({ available: false, habits: [] })
  ]);
  const second = (name: string) => (name in slots ? rowsOf(phaseTwoResults[slots[name]]) : []);

  const lagsByAccount = new Map<string, number[]>();
  for (const row of second("lags")) {
    const lag = daysBetween(str(row.transaction_date), str(row.post_date));
    lagsByAccount.set(str(row.account_id), [...(lagsByAccount.get(str(row.account_id)) ?? []), lag]);
  }
  const postingLagDays: Record<string, number> = Object.fromEntries(cardAccountIds.map((id) => [id, derivePostingLagDays(lagsByAccount.get(id) ?? [])]));

  const windows = second("windows");
  const earlierImportCoverages: CoverageFact[] = windows.map((row) => ({
    accountId: str(row.account_id),
    first: str(row.first_date),
    last: str(row.last_date),
    referenceDate: str(row.imported_at).slice(0, 10),
    kind: "earlier_import",
    importedAt: str(row.imported_at)
  }));

  const wrongCardInput = applePayEntries.length
    ? {
      entries: applePayEntries,
      ledger: second("nearby").map((row) => toLedgerFact(row as unknown as NearbyRow)),
      fileRows: [],
      listedEntryIds: new Set<string>(),
      coverages: earlierImportCoverages,
      accounts: toWrongCardAccountFacts(accounts),
      postingLagDays: (accountId: string) => postingLagDays[accountId] ?? derivePostingLagDays([])
    }
    : null;

  // A card's files and its saved statements both cover days for the estimates.
  const estimateCoverages = [
    ...earlierImportCoverages.map((coverage) => ({ accountId: coverage.accountId, first: coverage.first, last: coverage.last, referenceDate: coverage.referenceDate })),
    ...statements.map((statement) => ({
      accountId: statement.accountId,
      first: statement.startDate ?? statementPeriodStart(statement.endDate),
      last: statement.endDate,
      referenceDate: statement.certifiedAt.slice(0, 10) || statement.endDate
    }))
  ];

  const segments = segmentRows.map((row) => ({ accountId: str(row.account_id), month: str(row.checkpoint_month), netMinor: num(row.net_minor), entryCount: num(row.entry_count) }));

  // ---- Round trip 3 (only when a statement no longer matches) --------------
  const needing = accountsNeedingMismatchCause({ statements, segments }, accounts).slice(0, EXTRA_CAUSE_ACCOUNTS);
  let laterEntries: LaterEntriesFact[] = [];
  if (needing.length) {
    const condition = needing.map(() => `(t.account_id = ? AND t.created_at > datetime(?, '+1 minute') AND COALESCE(t.post_date, t.transaction_date) <= ?)`).join(" OR ");
    const result = await db
      .prepare(`
        SELECT t.account_id, t.id, t.description, COALESCE(t.post_date, t.transaction_date) AS cleared_date, t.amount_minor, t.entry_type, t.transfer_direction,
          ${SIGNED_AMOUNT("t")} AS signed_minor
        FROM transactions AS t
        LEFT JOIN imports AS i ON i.id = t.import_id
        WHERE t.household_id = ? AND (${condition}) AND ${IMPORT_IS_COMPLETED("t", "i")}
        ORDER BY t.created_at DESC
        LIMIT 200`)
      .bind(household, ...needing.flatMap((item) => [item.accountId, item.certifiedAt, item.endDate]))
      .all<Row>();
    const byAccount = new Map<string, LaterEntriesFact>();
    for (const row of result.results) {
      const fact = byAccount.get(str(row.account_id)) ?? { accountId: str(row.account_id), entryCount: 0, netMinor: 0, sample: [] };
      fact.entryCount += 1;
      fact.netMinor += num(row.signed_minor);
      if (fact.sample.length < 5) {
        fact.sample.push({ id: str(row.id), description: str(row.description), date: str(row.cleared_date), amountMinor: num(row.amount_minor), entryType: str(row.entry_type) });
      }
      byAccount.set(fact.accountId, fact);
    }
    laterEntries = [...byAccount.values()];
  }

  const planCandidates: PlanCandidateFact[] = second("planCandidates").map((row) => ({
    id: str(row.id),
    date: str(row.transaction_date),
    description: str(row.description),
    amountMinor: num(row.amount_minor),
    categoryName: nullable(row.category_name),
    accountName: str(row.account_name)
  }));

  return {
    context,
    wrongCard: { input: wrongCardInput },
    duplicateEntries: { pairs: duplicatePairs },
    splitPairs,
    transfers: transferFacts,
    statements: {
      statements,
      segments,
      activity: activityRows.map((row) => ({ accountId: str(row.account_id), month: str(row.month), entryCount: num(row.entry_count) })),
      chainBreaks: breakRows.map((row) => ({ accountId: str(row.account_id), month: str(row.missing_checkpoint_month) })),
      laterEntries
    },
    estimates: { estimates, postingLagDays, coverages: estimateCoverages },
    plan: { rows: planFacts, candidates: planCandidates },
    hygiene: {
      otherEntries,
      oddEntries,
      categoryNames: second("categories").map((row) => str(row.name)),
      rules: rules as Awaited<ReturnType<typeof loadCategoryMatchRules>>,
      habits: (habits as Awaited<ReturnType<typeof loadAskHabits>>).habits
    },
    incomplete: [...incomplete]
  };
}

function nextMonthStart(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`;
}

function hygieneEntry(row: Row) {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    date: str(row.transaction_date),
    description: str(row.description),
    amountMinor: num(row.amount_minor),
    currency: str(row.currency),
    entryType: str(row.entry_type) as "expense" | "income" | "transfer",
    ownerPersonId: nullable(row.owner_person_id)
  };
}
