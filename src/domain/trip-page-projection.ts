// The trip page's read (DOMAIN.md "Trip or Event", "Trip page";
// `GET /api/trip-page`). Every read is bounded by the trip's own link rows
// (trip_event_entries, one row per entry on the trip) and grouped in SQL:
// the figures arrive as one row per day, category, kind of entry and payer,
// the biggest entries as a LIMIT, a day's entries only when that day is
// opened. All reads go together in one step (a missing trip simply reads
// nothing), so the page waits on one round trip.
//
// The household's money: whole amounts, as the trip view counts them in
// the household view (money-figures.ts, `tripPageFigures`), so each figure's
// View entries leads Entries with that figure to the cent. The tables are
// additive: with trip_events missing the page reads as "gone".

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildLinkedSplitShareMap, type LinkedSplitShareRow } from "./app-repository-entries";
import { spendingMinor } from "./category-offset";
import { tripPageFigures, type TripPageGroup } from "./money-figures";
import { isTripEventIcon, readTripEventDate, type TripEventIcon } from "./trip-events";
import { isOpenForeignEstimate, tripEntryName, tripStillOwed, TRIP_PAGE_TOP_COUNT, type TripDebt, type TripOwedShare } from "./trip-page";

export interface TripPageEntryDto {
  id: string;
  date: string;
  // The note's first line, else the description (trip-page.ts).
  name: string;
  amountMinor: number;
  entryType: "expense" | "income";
  categoryName: string;
  payerName?: string;
  // Still a foreign currency estimate: the Wallet amount it was paid in.
  estimate?: { amountMinor: number; currency: string };
}

export interface TripPageDto {
  tripEvent: {
    id: string;
    name: string;
    iconKey: TripEventIcon;
    startDate?: string;
    endDate?: string;
    currency?: string;
    splitGroupId?: string;
    splitGroupName?: string;
    putAway?: true;
  };
  // The first and last day of the trip's entries, and how many it holds.
  firstDate?: string;
  lastDate?: string;
  entryCount: number;
  spentMinor: number;
  // Entries that are still foreign currency estimates.
  estimateCount: number;
  days: Array<{ day: string; amountMinor: number; entryIds: string[] }>;
  categories: Array<{ categoryName: string; categoryId?: string; amountMinor: number; entryCount: number }>;
  payers: Array<{ personId: string | null; name: string; amountMinor: number; entryIds: string[] }>;
  biggest: TripPageEntryDto[];
  // Only when the trip follows a split group or any of its entries is on
  // Splits; `debts` empty is "nobody owes anything".
  owed?: { splitGroupId?: string; onSplitsCount: number; debts: TripDebt[] };
}

export interface TripPageDayDto {
  day: string;
  entries: TripPageEntryDto[];
}

// The entries of one trip, counted as Entries counts them: a pending
// import's rows are not entries yet. Binds: household, trip id.
const TRIP_ENTRIES_FROM = `
  FROM trip_event_entries AS tee
  INNER JOIN transactions AS t ON t.id = tee.transaction_id AND t.household_id = tee.household_id
  LEFT JOIN imports AS i ON i.id = t.import_id
  LEFT JOIN categories AS c ON c.id = t.category_id
  LEFT JOIN people AS payer ON payer.id = t.owner_person_id
  WHERE tee.household_id = ? AND tee.trip_event_id = ?
    AND (t.import_id IS NULL OR i.status = 'completed')`;

const ESTIMATE_SQL = `(t.original_amount_minor IS NOT NULL AND t.original_currency IS NOT NULL
    AND t.original_currency <> t.currency AND t.bank_certification_status <> 'statement_certified')`;

const ENTRY_COLUMNS = `
    t.id, t.transaction_date, t.description, substr(t.note, 1, 400) AS note, t.amount_minor, t.entry_type,
    COALESCE(c.name, 'Other') AS category_name, payer.display_name AS payer_name,
    t.original_amount_minor, t.original_currency, t.currency, t.bank_certification_status`;

interface EntryRow {
  id: string;
  transaction_date: string;
  description: string;
  note: string | null;
  amount_minor: number;
  entry_type: "expense" | "income" | "transfer";
  category_name: string;
  payer_name: string | null;
  original_amount_minor: number | null;
  original_currency: string | null;
  currency: string | null;
  bank_certification_status: string | null;
}

interface TripRow {
  id: string;
  name: string;
  icon_key: string;
  start_date: string | null;
  end_date: string | null;
  currency: string | null;
  split_group_id: string | null;
  put_away_at: string | null;
  split_group_name: string | null;
}

interface GroupRow {
  day: string;
  category_name: string;
  category_id: string | null;
  entry_type: "expense" | "income" | "transfer";
  payer_id: string | null;
  payer_name: string | null;
  amount_minor: number;
  ids: string;
  estimates: number;
}

type OwedRow = LinkedSplitShareRow & { payer_person_id: string; payer_name: string | null; split_group_id: string | null; settled: number };

function toEntry(row: EntryRow): TripPageEntryDto {
  return {
    id: row.id,
    date: row.transaction_date,
    name: tripEntryName({ description: row.description, note: row.note }),
    amountMinor: row.amount_minor,
    entryType: row.entry_type === "income" ? "income" : "expense",
    categoryName: row.category_name,
    ...(row.payer_name ? { payerName: row.payer_name } : {}),
    ...(isOpenForeignEstimate(row) ? { estimate: { amountMinor: Number(row.original_amount_minor), currency: String(row.original_currency) } } : {})
  };
}

function readTripId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 120 ? value : null;
}

/**
 * The trip page for one trip or event of this household, or null when the
 * trip is not this household's (or there is no such trip).
 */
export async function buildTripPageDto(db: D1Database, tripEventId: unknown): Promise<TripPageDto | null> {
  const tripId = readTripId(tripEventId);
  if (!tripId) return null;
  const household = DEFAULT_HOUSEHOLD_ID;
  let results: [TripRow[], GroupRow[], EntryRow[], OwedRow[]];
  try {
    const [trip, groups, biggest, owed] = await Promise.all([
      db.prepare(`
        SELECT te.id, te.name, te.icon_key, te.start_date, te.end_date, te.currency, te.split_group_id, te.put_away_at,
          sg.group_name AS split_group_name
        FROM trip_events AS te
        LEFT JOIN split_groups AS sg ON sg.id = te.split_group_id AND sg.household_id = te.household_id
        WHERE te.household_id = ? AND te.id = ?
      `).bind(household, tripId).all<TripRow>(),
      db.prepare(`
        SELECT t.transaction_date AS day, COALESCE(c.name, 'Other') AS category_name, MIN(c.id) AS category_id,
          t.entry_type, t.owner_person_id AS payer_id, MIN(payer.display_name) AS payer_name,
          SUM(t.amount_minor) AS amount_minor, GROUP_CONCAT(t.id, ' ') AS ids,
          SUM(CASE WHEN ${ESTIMATE_SQL} THEN 1 ELSE 0 END) AS estimates
        ${TRIP_ENTRIES_FROM}
        GROUP BY t.transaction_date, COALESCE(c.name, 'Other'), t.entry_type, t.owner_person_id
      `).bind(household, tripId).all<GroupRow>(),
      db.prepare(`
        SELECT ${ENTRY_COLUMNS}
        ${TRIP_ENTRIES_FROM}
          AND t.entry_type = 'expense'
        ORDER BY t.amount_minor DESC, t.transaction_date, t.id
        LIMIT ${TRIP_PAGE_TOP_COUNT}
      `).bind(household, tripId).all<EntryRow>(),
      // The trip's entries on Splits, each share with whether its split is
      // settled (a closed batch, or covered by an active settle-up).
      db.prepare(`
        SELECT se.linked_transaction_id AS transaction_id, se.payer_person_id, payer_people.display_name AS payer_name,
          se.split_group_id, s.person_id, s.ratio_basis_points, s.amount_minor, p.display_name,
          se.currency AS split_currency, t.currency AS entry_currency, t.amount_minor AS entry_amount_minor,
          CASE p.role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END AS person_rank, p.created_at AS person_created_at,
          CASE WHEN b.closed_on IS NOT NULL OR se.id IN (
            SELECT ci.record_id FROM split_settlement_checkpoint_items AS ci
            INNER JOIN split_settlement_checkpoints AS cp ON cp.id = ci.checkpoint_id
            WHERE cp.household_id = ? AND cp.status NOT IN ('reopened', 'voided') AND ci.record_kind = 'expense'
          ) THEN 1 ELSE 0 END AS settled
        FROM trip_event_entries AS tee
        INNER JOIN transactions AS t ON t.id = tee.transaction_id AND t.household_id = tee.household_id
        LEFT JOIN imports AS i ON i.id = t.import_id
        INNER JOIN split_expenses AS se ON se.household_id = tee.household_id AND se.linked_transaction_id = t.id AND se.deleted_at IS NULL
        INNER JOIN split_expense_shares AS s ON s.split_expense_id = se.id
        INNER JOIN people AS p ON p.id = s.person_id
        LEFT JOIN people AS payer_people ON payer_people.id = se.payer_person_id
        LEFT JOIN split_batches AS b ON b.id = se.split_batch_id
        WHERE tee.household_id = ? AND tee.trip_event_id = ?
          AND (t.import_id IS NULL OR i.status = 'completed')
        ORDER BY s.created_at
      `).bind(household, household, tripId).all<OwedRow>()
    ]);
    results = [trip.results, groups.results, biggest.results, owed.results];
  } catch {
    // The trips tables are additive: without them there is no trip.
    return null;
  }
  const [[trip], groupRows, biggestRows, owedRows] = results;
  if (!trip) return null;

  const groups: TripPageGroup[] = groupRows.map((row) => ({
    day: row.day,
    categoryName: row.category_name,
    entryType: row.entry_type,
    payerId: row.payer_id,
    amountMinor: Number(row.amount_minor),
    entryIds: String(row.ids ?? "").split(" ").filter(Boolean)
  }));
  const figures = tripPageFigures(groups);
  const payerNames = new Map(groupRows.map((row) => [row.payer_id, row.payer_name ?? ""]));
  const categoryIds = new Map(groupRows.map((row) => [row.category_name, row.category_id]));
  const daysSorted = groupRows.map((row) => row.day).sort();
  const estimateCount = groupRows.reduce((sum, row) => sum + (spendingMinor({ entryType: row.entry_type, categoryName: row.category_name, amountMinor: 1 }) ? Number(row.estimates) : 0), 0);

  return {
    tripEvent: {
      id: trip.id,
      name: trip.name,
      iconKey: isTripEventIcon(trip.icon_key) ? trip.icon_key : "star",
      ...(readTripEventDate(trip.start_date) ? { startDate: trip.start_date as string } : {}),
      ...(readTripEventDate(trip.end_date ?? trip.start_date) ? { endDate: (trip.end_date ?? trip.start_date) as string } : {}),
      ...(trip.currency ? { currency: trip.currency } : {}),
      ...(trip.split_group_id ? { splitGroupId: trip.split_group_id } : {}),
      ...(trip.split_group_id && trip.split_group_name ? { splitGroupName: trip.split_group_name } : {}),
      ...(trip.put_away_at ? { putAway: true as const } : {})
    },
    ...(daysSorted.length ? { firstDate: daysSorted[0], lastDate: daysSorted[daysSorted.length - 1] } : {}),
    entryCount: groups.reduce((sum, group) => sum + group.entryIds.length, 0),
    spentMinor: figures.spentMinor,
    estimateCount,
    days: figures.byDay,
    categories: figures.byCategory.map((row) => ({
      ...row,
      ...(categoryIds.get(row.categoryName) ? { categoryId: categoryIds.get(row.categoryName) as string } : {})
    })),
    payers: figures.byPayer.map((row) => ({ personId: row.payerId, name: payerNames.get(row.payerId) ?? "", amountMinor: row.amountMinor, entryIds: row.entryIds })),
    biggest: biggestRows.map(toEntry),
    ...readOwed(trip, owedRows)
  };
}

// Still owed (trip-page.ts `tripStillOwed`), each share in the ledger's
// money as every projection counts it (buildLinkedSplitShareMap).
function readOwed(trip: TripRow, rows: OwedRow[]): { owed?: TripPageDto["owed"] } {
  const onSplits = new Set(rows.map((row) => row.transaction_id));
  if (!trip.split_group_id && !onSplits.size) return {};
  const shareMap = buildLinkedSplitShareMap(rows);
  const byTransaction = new Map(rows.map((row) => [row.transaction_id, row]));
  const shares: TripOwedShare[] = [];
  for (const [transactionId, list] of shareMap) {
    const row = byTransaction.get(transactionId);
    if (!row) continue;
    for (const share of list) {
      shares.push({
        transactionId,
        payerId: row.payer_person_id,
        payerName: row.payer_name ?? "",
        personId: share.personId,
        personName: share.personName,
        amountMinor: share.amountMinor,
        settled: Number(row.settled) === 1
      });
    }
  }
  const groups = new Set(rows.map((row) => row.split_group_id ?? "split-group-none"));
  const splitGroupId = trip.split_group_id ?? (groups.size === 1 ? [...groups][0] : null);
  return {
    owed: {
      ...(splitGroupId ? { splitGroupId } : {}),
      onSplitsCount: onSplits.size,
      debts: tripStillOwed(shares)
    }
  };
}

/** One day's entries on the trip, when the page opens that day. Null for an unknown trip or day. */
export async function buildTripPageDayDto(db: D1Database, tripEventId: unknown, day: unknown): Promise<TripPageDayDto | null> {
  const tripId = readTripId(tripEventId);
  const date = readTripEventDate(day);
  if (!tripId || !date) return null;
  let rows: EntryRow[];
  try {
    const result = await db.prepare(`
      SELECT ${ENTRY_COLUMNS}
      ${TRIP_ENTRIES_FROM}
        AND t.transaction_date = ? AND t.entry_type IN ('expense', 'income')
      ORDER BY t.transaction_time IS NULL, t.transaction_time, t.created_at, t.id
      LIMIT 200
    `).bind(DEFAULT_HOUSEHOLD_ID, tripId, date).all<EntryRow>();
    rows = result.results;
  } catch {
    return null;
  }
  // Only what the day's total counts: expenses and paybacks.
  const entries = rows
    .filter((row) => spendingMinor({ entryType: row.entry_type, categoryName: row.category_name, amountMinor: row.amount_minor }) !== 0 || row.entry_type === "expense")
    .map(toEntry);
  return { day: date, entries };
}
