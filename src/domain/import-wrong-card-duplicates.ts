// Wrong-card Apple Pay duplicates (see "Wrong-card Apple Pay Duplicate" in
// DOMAIN.md and docs/audits/wrong-card-apple-pay-duplicate.md): the bounded
// reads that feed the pure rules (wrong-card-apple-pay-duplicate.ts), the
// preview's card, and the commit's removal with its rollback.
//
// An activity export lists every charge a card holds, so an Apple Pay entry
// it should list and does not, whose purchase sits as a bank row on another
// card, was paid with that other card. The preview offers the removal; the
// import commit removes only what the user confirmed, after checking every
// fact again, in the import's own batch. Rolling the import back restores
// each entry exactly as it was. Nothing here writes on its own.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  addDays,
  assessWrongCardDuplicates,
  derivePostingLagDays,
  singaporeToday,
  type AccountFact,
  type ApplePayEntryFact,
  type CoverageFact,
  type FileRowFact,
  type LedgerEntryFact,
  type WrongCardAssessment
} from "./wrong-card-apple-pay-duplicate";
import { daysBetween } from "./app-repository-helpers";
import { getPreviewRowDateContext } from "./statement-row-matching";
import type { ImportPreviewRowDto, ImportWrongCardDuplicateDto } from "../types/dto";

// How many Apple Pay entries one preview weighs. More than this in one
// file's dates is far outside normal use; the rest are left unflagged.
export const WRONG_CARD_MAX_ENTRIES = 60;
// Entries and twins are looked for this many days around the file's dates.
const WINDOW_MARGIN_DAYS = 3;
// How far around the entries an earlier export's rows are read for the
// dates it covered, and how far back the card's posting history goes.
const WINDOW_BEFORE_DAYS = 120;
const WINDOW_AFTER_DAYS = 60;
const LAG_HISTORY_DAYS = 365;
// A bank row's purchase day can be this many days before the day the bank
// posted it, and either day counts for the date gap.
const POSTED_LANE_MARGIN_DAYS = 7;

// A split, a settlement, a settlement check or a plan row that points at
// the entry: removing it would cut those loose.
const linkExists = (entryId: string) => `(
  EXISTS (SELECT 1 FROM monthly_plan_entry_links WHERE transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_expenses WHERE linked_transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_settlements WHERE linked_transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_settlement_checkpoints WHERE matched_transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM split_settlement_checkpoint_matches WHERE transaction_id = ${entryId})
  OR EXISTS (SELECT 1 FROM import_transfer_links WHERE transaction_id = ${entryId} OR counterpart_transaction_id = ${entryId})
)`;
const LINK_EXISTS = linkExists("t.id");

// The Apple Pay entries nothing has matched: saved by the Shortcut, still
// provisional, never given a bank row's import, not a transfer. One indexed
// read on the household and date index.
export const APPLE_PAY_ENTRIES_SQL = `
  SELECT t.id, t.account_id, t.transaction_date, t.description, t.amount_minor, t.currency,
    t.original_currency, t.owner_person_id, ${LINK_EXISTS} AS has_links
  FROM transactions AS t
  WHERE t.household_id = ?
    AND t.transaction_date BETWEEN ? AND ?
    AND t.import_id IS NULL
    AND t.bank_certification_status = 'provisional'
    AND t.entry_type = 'expense'
    AND t.transfer_group_id IS NULL
    AND t.external_reference LIKE 'shortcut:_%'
  ORDER BY t.transaction_date DESC, t.id
  LIMIT ${WRONG_CARD_MAX_ENTRIES + 1}
`;

// Every entry of the same amounts near those dates: the twins, the
// purchases that could claim them, and the same-amount rows on the entry's
// own card. One indexed read on the household and date index.
export function buildNearbyEntriesSql(amountCount: number) {
  return `
    SELECT t.id, t.account_id, t.transaction_date, t.post_date, t.description, t.amount_minor, t.currency,
      t.entry_type, t.transfer_group_id, t.import_id, t.external_reference, t.original_currency,
      t.bank_certification_status, imports.source_type AS import_source_type, imports.imported_at,
      import_rows.promoted_entry_snapshot_json IS NOT NULL AS promotes_manual_entry,
      (t.statement_certified_previous_description IS NOT NULL
        AND t.statement_certified_previous_import_id IS NULL) AS certified_over_manual
    FROM transactions AS t
    LEFT JOIN imports ON imports.id = t.import_id
    LEFT JOIN import_rows ON import_rows.id = t.import_row_id
    WHERE t.household_id = ?
      AND t.transaction_date BETWEEN ? AND ?
      AND t.amount_minor IN (${Array.from({ length: amountCount }, () => "?").join(", ")})
      AND (t.import_id IS NULL OR imports.status = 'completed')
  `;
}

// The dates each earlier export covered for the entries' cards, from the
// rows it saved (a promoted entry counts on its posted day).
// Only the rows near the entries are read, so a window can only come out
// narrower than the export's real one, never wider.
export function buildEarlierImportWindowsSql(accountCount: number) {
  return `
    SELECT t.account_id, imports.id AS import_id, imports.imported_at,
      MIN(COALESCE(t.post_date, t.transaction_date)) AS first_date,
      MAX(COALESCE(t.post_date, t.transaction_date)) AS last_date
    FROM transactions AS t
    INNER JOIN imports ON imports.id = t.import_id
    WHERE t.account_id IN (${Array.from({ length: accountCount }, () => "?").join(", ")})
      AND t.transaction_date BETWEEN ? AND ?
      AND imports.household_id = ?
      AND imports.status = 'completed'
      AND imports.source_type = 'csv'
    GROUP BY t.account_id, imports.id
  `;
}

// How long each card's own Apple Pay entries took to reach its bank rows.
export function buildPostingLagSql(accountCount: number) {
  return `
    SELECT t.account_id, t.transaction_date, t.post_date
    FROM transactions AS t
    WHERE t.account_id IN (${Array.from({ length: accountCount }, () => "?").join(", ")})
      AND t.transaction_date >= ?
      AND t.import_id IS NOT NULL
      AND t.post_date IS NOT NULL
      AND t.external_reference LIKE 'shortcut:_%'
    ORDER BY t.transaction_date DESC
    LIMIT 100
  `;
}

type AccountRecord = { id: string; account_name: string; owner_person_id: string | null; is_joint: number | boolean; currency: string };

export interface WrongCardEvidence {
  assessments: WrongCardAssessment[];
  entries: Map<string, ApplePayEntryFact>;
  accounts: Map<string, AccountFact>;
  // More entries than one preview weighs were found.
  isCapped: boolean;
}

const NO_EVIDENCE: WrongCardEvidence = { assessments: [], entries: new Map(), accounts: new Map(), isCapped: false };

// Whether a previewed row is a charge this import would add: a bank row of
// the file nothing in the ledger claims.
function isNewExpenseRow(row: ImportPreviewRowDto) {
  return Boolean(row.accountId)
    && row.entryType === "expense"
    && row.commitStatus === "included"
    && !row.reconciliationTargetTransactionId
    && !row.reconciliationMatch
    && !row.reconciliationMatches?.length
    && !row.isStatementMatchResolved;
}

export async function loadWrongCardEvidence(db: D1Database, input: {
  sourceType?: "csv" | "pdf" | "manual";
  // Every row of the file as previewed (skipped and left-for-review ones
  // too): they say which dates the file covers and which entries it lists.
  previewRows: ImportPreviewRowDto[];
  accounts?: ReadonlyArray<{ id: string; name: string; ownerPersonId?: string; isJoint: boolean; currency: string }>;
  today?: string;
}): Promise<WrongCardEvidence> {
  // A statement is reviewed card by card against its balance (the statement
  // check and the Settings comparison); it has its own wrong-card path.
  if (input.sourceType === "pdf" || !input.previewRows.length) {
    return NO_EVIDENCE;
  }
  const dates = input.previewRows.map((row) => row.date).sort();
  const entryRows = await db
    .prepare(APPLE_PAY_ENTRIES_SQL)
    .bind(DEFAULT_HOUSEHOLD_ID, addDays(dates[0], -WINDOW_MARGIN_DAYS), addDays(dates[dates.length - 1], WINDOW_MARGIN_DAYS))
    .all<{
      id: string; account_id: string; transaction_date: string; description: string; amount_minor: number; currency: string;
      original_currency: string | null; owner_person_id: string | null; has_links: number;
    }>();
  if (!entryRows.results.length) {
    return NO_EVIDENCE;
  }
  const isCapped = entryRows.results.length > WRONG_CARD_MAX_ENTRIES;
  const entries: ApplePayEntryFact[] = entryRows.results.slice(0, WRONG_CARD_MAX_ENTRIES).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    date: row.transaction_date,
    description: row.description,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    originalCurrency: row.original_currency,
    ownerPersonId: row.owner_person_id,
    hasLinks: Boolean(row.has_links)
  }));
  const accountIds = Array.from(new Set(entries.map((entry) => entry.accountId)));
  const entryDates = entries.map((entry) => entry.date).sort();
  const amounts = Array.from(new Set(entries.map((entry) => entry.amountMinor)));

  const [accounts, nearby, windows, lags] = await Promise.all([
    input.accounts ? Promise.resolve(toAccountFacts(input.accounts)) : loadAccountFacts(db),
    db
      .prepare(buildNearbyEntriesSql(amounts.length))
      .bind(
        DEFAULT_HOUSEHOLD_ID,
        addDays(entryDates[0], -(WINDOW_MARGIN_DAYS + POSTED_LANE_MARGIN_DAYS)),
        addDays(entryDates[entryDates.length - 1], WINDOW_MARGIN_DAYS),
        ...amounts
      )
      .all<NearbyRow>(),
    db
      .prepare(buildEarlierImportWindowsSql(accountIds.length))
      .bind(...accountIds, addDays(entryDates[0], -WINDOW_BEFORE_DAYS), addDays(entryDates[entryDates.length - 1], WINDOW_AFTER_DAYS), DEFAULT_HOUSEHOLD_ID)
      .all<{ account_id: string; import_id: string; imported_at: string; first_date: string; last_date: string }>(),
    db
      .prepare(buildPostingLagSql(accountIds.length))
      .bind(...accountIds, addDays(entryDates[0], -LAG_HISTORY_DAYS))
      .all<{ account_id: string; transaction_date: string; post_date: string }>()
  ]);

  const today = input.today ?? singaporeToday();
  const lagsByAccount = new Map<string, number[]>();
  for (const row of lags.results) {
    const lag = daysBetween(row.transaction_date, row.post_date);
    lagsByAccount.set(row.account_id, [...(lagsByAccount.get(row.account_id) ?? []), lag]);
  }
  const postingLagByAccount = new Map(accountIds.map((id) => [id, derivePostingLagDays(lagsByAccount.get(id) ?? [])]));

  const assessments = assessWrongCardDuplicates({
    entries,
    ledger: nearby.results.map(toLedgerFact),
    fileRows: input.previewRows.filter(isNewExpenseRow).map((row): FileRowFact => ({
      rowId: row.rowId,
      accountId: row.accountId!,
      // A card export prints the purchase day beside the posted day.
      date: getPreviewRowDateContext(row).eventDate,
      postDate: row.date,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: accounts.get(row.accountId!)?.currency ?? "SGD"
    })),
    listedEntryIds: collectListedEntryIds(input.previewRows),
    coverages: [
      ...readFileCoverages(input.previewRows, today),
      ...windows.results.map((window): CoverageFact => ({
        accountId: window.account_id,
        first: window.first_date,
        last: window.last_date,
        referenceDate: window.imported_at.slice(0, 10),
        kind: "earlier_import",
        importedAt: window.imported_at
      }))
    ],
    accounts,
    postingLagDays: (accountId) => postingLagByAccount.get(accountId) ?? derivePostingLagDays([])
  });
  return { assessments, entries: new Map(entries.map((entry) => [entry.id, entry])), accounts, isCapped };
}

type NearbyRow = {
  id: string; account_id: string; transaction_date: string; post_date: string | null; description: string; amount_minor: number;
  currency: string; entry_type: "expense" | "income" | "transfer"; transfer_group_id: string | null; import_id: string | null;
  external_reference: string | null; original_currency: string | null; bank_certification_status: string;
  import_source_type: string | null; imported_at: string | null; promotes_manual_entry: number; certified_over_manual: number;
};

function toLedgerFact(row: NearbyRow): LedgerEntryFact {
  const isApplePay = typeof row.external_reference === "string" && /^shortcut:./.test(row.external_reference);
  return {
    id: row.id,
    accountId: row.account_id,
    date: row.transaction_date,
    postDate: row.post_date,
    description: row.description,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    entryType: row.entry_type,
    transferGroupId: row.transfer_group_id,
    originalCurrency: row.original_currency,
    isBankRow: (row.import_id !== null && row.import_source_type !== null && row.import_source_type !== "manual")
      || row.bank_certification_status === "statement_certified",
    // Anything saved by a tool, or a manual entry a bank row was matched to,
    // has its own purchase behind it.
    isPaired: row.external_reference !== null || Boolean(row.promotes_manual_entry) || Boolean(row.certified_over_manual),
    isOpenApplePay: isApplePay && row.import_id === null && row.bank_certification_status === "provisional" && row.entry_type === "expense",
    importedAt: row.imported_at
  };
}

async function loadAccountFacts(db: D1Database) {
  const result = await db
    .prepare("SELECT id, account_name, owner_person_id, is_joint, currency FROM accounts WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<AccountRecord>();
  return new Map(result.results.map((account): [string, AccountFact] => [account.id, {
    id: account.id,
    name: account.account_name,
    ownerPersonId: account.owner_person_id,
    isJoint: Boolean(account.is_joint),
    currency: account.currency
  }]));
}

function toAccountFacts(accounts: NonNullable<Parameters<typeof loadWrongCardEvidence>[1]["accounts"]>) {
  return new Map(accounts.map((account): [string, AccountFact] => [account.id, {
    id: account.id,
    name: account.name,
    ownerPersonId: account.ownerPersonId ?? null,
    isJoint: account.isJoint,
    currency: account.currency
  }]));
}

// The dates the file being imported covers for each card, first row to last.
function readFileCoverages(previewRows: ImportPreviewRowDto[], today: string): CoverageFact[] {
  const windows = new Map<string, { first: string; last: string }>();
  for (const row of previewRows) {
    if (!row.accountId) {
      continue;
    }
    const window = windows.get(row.accountId);
    windows.set(row.accountId, window
      ? { first: row.date < window.first ? row.date : window.first, last: row.date > window.last ? row.date : window.last }
      : { first: row.date, last: row.date });
  }
  return [...windows.entries()].map(([accountId, window]) => ({ accountId, ...window, referenceDate: today, kind: "this_file" as const }));
}

// The entries any row of the file is paired with (or may be): the file
// lists them.
function collectListedEntryIds(previewRows: ImportPreviewRowDto[]) {
  return new Set(previewRows.flatMap((row) => [
    row.reconciliationTargetTransactionId,
    row.reconciliationMatch?.existingTransactionId,
    ...(row.reconciliationMatches ?? []).map((match) => match.existingTransactionId)
  ]).filter((id): id is string => Boolean(id)));
}

// What the preview carries for the card: only what it reads. HIGH is
// offered for removal, MEDIUM is a note; LOW is never shown.
export function toWrongCardDuplicateDtos(evidence: WrongCardEvidence): ImportWrongCardDuplicateDto[] {
  return evidence.assessments
    .flatMap((assessment) => {
      const entry = evidence.entries.get(assessment.entryId);
      const twin = assessment.twin;
      if (!entry || !twin || assessment.confidence === "low") {
        return [];
      }
      const accountName = (id: string) => evidence.accounts.get(id)?.name ?? "";
      return [{
        transactionId: entry.id,
        confidence: assessment.confidence,
        ...(assessment.blockers.includes("has_links") ? { isLinked: true } : {}),
        coverage: { kind: assessment.coverage?.kind ?? "this_file", ...(assessment.coverage?.importedAt ? { importedAt: assessment.coverage.importedAt } : {}) },
        entry: { accountId: entry.accountId, accountName: accountName(entry.accountId), date: entry.date, description: entry.description, amountMinor: entry.amountMinor },
        twin: {
          kind: twin.kind,
          id: twin.id,
          accountId: twin.accountId,
          accountName: accountName(twin.accountId),
          date: twin.date,
          description: twin.description,
          ...(twin.importedAt ? { importedAt: twin.importedAt } : {})
        }
      }];
    })
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) || left.entry.description.localeCompare(right.entry.description));
}

export interface WrongCardRemovalRequest {
  transactionId: string;
  twinKind: "ledger" | "this_file";
  twinId: string;
}

// The commit's removal of the entries the user confirmed. Every one is
// judged again from the ledger as it is now and the file as it is being
// committed; anything short of HIGH, a different twin, or a row that this
// same commit would pair with the entry stops the whole commit before
// anything is written. Each removal saves the whole entry for the rollback
// and its audit event, and a guarded DELETE removes it only while it is
// still the provisional Apple Pay entry that was checked.
export async function buildWrongCardDuplicateRemoval(db: D1Database, importId: string, input: {
  requests: WrongCardRemovalRequest[];
  reviewedRows: ImportPreviewRowDto[];
  committedRows: ImportPreviewRowDto[];
  sourceLabel: string;
}) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  const requests = new Map(input.requests.map((request) => [request.transactionId, request]));
  if (!requests.size) {
    return { statements, months };
  }
  const stale = new Error("A purchase you chose to remove has changed since the preview. Refresh the import preview and try again.");
  if (requests.size !== input.requests.length) {
    throw stale;
  }
  const evidence = await loadWrongCardEvidence(db, { sourceType: "csv", previewRows: input.reviewedRows });
  const committedRowIds = new Set(input.committedRows.map((row) => row.rowId));
  const pairedRowIds = new Set(input.committedRows.flatMap((row) => row.reconciliationTargetTransactionId ? [row.reconciliationTargetTransactionId] : []));
  const guards: Array<{ id: string; accountId: string }> = [];
  for (const request of requests.values()) {
    const assessment = evidence.assessments.find((item) => item.entryId === request.transactionId);
    const entry = evidence.entries.get(request.transactionId);
    if (
      !assessment || !entry || assessment.confidence !== "high" || !assessment.twin
      || assessment.twin.kind !== request.twinKind || assessment.twin.id !== request.twinId
      || pairedRowIds.has(entry.id)
      || (assessment.twin.kind === "this_file" && !committedRowIds.has(assessment.twin.id))
    ) {
      throw stale;
    }
    guards.push({ id: entry.id, accountId: entry.accountId });
  }

  // The whole rows, read once, so a rollback puts back exactly what is here.
  const ids = guards.map((guard) => guard.id);
  const snapshots = await db
    .prepare(`SELECT * FROM transactions WHERE household_id = ? AND id IN (${ids.map(() => "?").join(", ")})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...ids)
    .all<Record<string, unknown>>();
  const snapshotsById = new Map(snapshots.results.map((row) => [String(row.id), row]));

  for (const guard of guards) {
    const snapshot = snapshotsById.get(guard.id);
    const request = requests.get(guard.id)!;
    const assessment = evidence.assessments.find((item) => item.entryId === guard.id)!;
    const entry = evidence.entries.get(guard.id)!;
    if (!snapshot) {
      throw stale;
    }
    const accountName = (id: string) => evidence.accounts.get(id)?.name ?? "a card";
    // Every statement runs only while the entry is still what was checked.
    const stillThere = `EXISTS (
      SELECT 1 FROM transactions AS t
      WHERE t.household_id = ? AND t.id = ? AND t.account_id = ? AND t.import_id IS NULL
        AND t.bank_certification_status = 'provisional' AND t.transfer_group_id IS NULL
        AND t.external_reference LIKE 'shortcut:_%' AND NOT ${LINK_EXISTS}
    )`;
    const guardBinds = [DEFAULT_HOUSEHOLD_ID, guard.id, guard.accountId];
    statements.push(
      db
        .prepare(`
          INSERT INTO import_wrong_card_duplicates (
            id, household_id, import_id, transaction_id, account_id, twin_kind, twin_id, entry_snapshot_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${stillThere}
        `)
        .bind(`wrongcard-${crypto.randomUUID()}`, DEFAULT_HOUSEHOLD_ID, importId, guard.id, guard.accountId, request.twinKind, request.twinId, JSON.stringify(snapshot), ...guardBinds),
      db
        .prepare(`
          INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, detail)
          SELECT ?, ?, 'transaction', ?, 'entry_removed_as_wrong_card_duplicate', ? WHERE ${stillThere}
        `)
        .bind(
          `audit-${crypto.randomUUID()}`,
          DEFAULT_HOUSEHOLD_ID,
          guard.id,
          `Removed the Apple Pay entry ${entry.description} (${(entry.amountMinor / 100).toFixed(2)}) from ${accountName(entry.accountId)}: the same purchase is on ${accountName(assessment.twin!.accountId)} as ${assessment.twin!.description}. Confirmed while importing ${input.sourceLabel} (score ${assessment.score}: ${assessment.reasons.join(", ")}).`,
          ...guardBinds
        ),
      db
        .prepare(`
          DELETE FROM transactions
          WHERE household_id = ? AND id = ? AND account_id = ? AND import_id IS NULL
            AND bank_certification_status = 'provisional' AND transfer_group_id IS NULL
            AND external_reference LIKE 'shortcut:_%'
            AND NOT ${linkExists("transactions.id")}
        `)
        .bind(...guardBinds)
    );
    months.add(entry.date.slice(0, 7));
  }
  return { statements, months };
}

// An earlier import whose bank row was the twin of a removal this import
// made cannot be rolled back first: both copies of the purchase would be
// gone. Returns true when such a removal is in place.
export async function hasLaterWrongCardRemovalCovering(db: D1Database, importId: string) {
  const found = await db
    .prepare(`
      SELECT 1 AS found
      FROM import_wrong_card_duplicates AS removed
      INNER JOIN imports ON imports.id = removed.import_id AND imports.status = 'completed'
      INNER JOIN transactions AS twin ON twin.id = removed.twin_id AND removed.twin_kind = 'ledger'
      WHERE removed.household_id = ?
        AND removed.import_id != ?
        AND twin.import_id = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId, importId)
    .first<{ found: number }>();
  return Boolean(found);
}

// The rollback's restore: each removed entry goes back as it was, whole
// row, and is forgotten here.
export async function buildWrongCardDuplicateRestore(db: D1Database, importId: string) {
  const statements: D1PreparedStatement[] = [];
  const months = new Set<string>();
  const removed = await db
    .prepare("SELECT transaction_id, entry_snapshot_json FROM import_wrong_card_duplicates WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ transaction_id: string; entry_snapshot_json: string }>();
  for (const row of removed.results) {
    const snapshot = JSON.parse(row.entry_snapshot_json) as Record<string, unknown>;
    // The columns come from the saved row itself, never from a request.
    const columns = Object.keys(snapshot).filter((column) => /^[a-z][a-z0-9_]*$/.test(column));
    statements.push(
      db
        .prepare(`INSERT OR IGNORE INTO transactions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .bind(...columns.map((column) => snapshot[column] ?? null)),
      db
        .prepare(`
          INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, detail)
          VALUES (?, ?, 'transaction', ?, 'entry_restored_by_import_rollback', ?)
        `)
        .bind(`audit-${crypto.randomUUID()}`, DEFAULT_HOUSEHOLD_ID, row.transaction_id, `Restored the Apple Pay entry ${String(snapshot.description ?? "")} removed as a wrong-card duplicate by import ${importId}.`)
    );
    if (typeof snapshot.transaction_date === "string") {
      months.add(snapshot.transaction_date.slice(0, 7));
    }
  }
  statements.push(db
    .prepare("DELETE FROM import_wrong_card_duplicates WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId));
  return { statements, months };
}
