// The waiting taps a page shows (DOMAIN.md "Waiting Tap"): Entries' card at
// the top and Ask's reminder. Read-only. One read when nothing is waiting
// (the usual case); with taps, one more for their currency choices. No table
// means nothing is waiting.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { entryTimeInAppTimeZone } from "../lib/entry-time";
import type { WaitingTapDto } from "../types/dto";
import { WAITING_TAP_EXPIRE_DAYS } from "./waiting-taps-config";
import { buildWaitingTapExpiredStatements } from "./waiting-tap-statements";

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

type Row = {
  id: string;
  merchant: string;
  tap_date: string;
  received_at: string;
  account_id: string;
  other_currency_account_id: string;
  person_id: string;
  account_name: string | null;
  currency: string | null;
  person_name: string | null;
};

export const WAITING_TAPS_LIST_SQL = `
  SELECT waiting_taps.id, waiting_taps.merchant, waiting_taps.tap_date, waiting_taps.received_at,
    waiting_taps.account_id, waiting_taps.other_currency_account_id, waiting_taps.person_id,
    accounts.account_name, accounts.currency, people.display_name AS person_name
  FROM waiting_taps
  LEFT JOIN accounts ON accounts.id = waiting_taps.account_id
  LEFT JOIN people ON people.id = waiting_taps.person_id
  WHERE waiting_taps.household_id = ? AND waiting_taps.status = 'waiting'
  ORDER BY waiting_taps.received_at, waiting_taps.id
`;

// How far back a person's last purchase in another currency counts as the
// currency they are paying in now.
const RECENT_OTHER_CURRENCY_DAYS = 60;

function daysBefore(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The taps waiting for their amount, oldest first, for one view: the
 * household sees everyone's, a person's view their own. Each carries the
 * currencies to offer: the card's own first, then a trip's currency on the
 * tap's day, then (for a person with a card for other currencies) the
 * currency they last paid in abroad.
 */
export async function loadWaitingTapsForView(db: D1Database, viewId: string, now = new Date()): Promise<WaitingTapDto[]> {
  let allRows: Row[];
  try {
    allRows = (await db.prepare(WAITING_TAPS_LIST_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<Row>()).results;
  } catch (error) {
    if (isMissingTable(error)) {
      return [];
    }
    throw error;
  }
  // A tap nobody finished in WAITING_TAP_EXPIRE_DAYS leaves the card and
  // the reminders; marking it is attempted here and retried on the next read.
  const cutoff = new Date(now.getTime() - WAITING_TAP_EXPIRE_DAYS * 86_400_000).toISOString();
  const expired = allRows.filter((row) => row.received_at < cutoff);
  if (expired.length) {
    await db.batch(expired.flatMap((row) => buildWaitingTapExpiredStatements(db, row.id, now.toISOString()))).catch((error) => {
      console.error("Waiting taps expiry failed", error instanceof Error ? error.name : "unknown");
    });
  }
  const rows = allRows.filter((row) => row.received_at >= cutoff);
  const visible = rows.filter((row) => viewId === "household" || row.person_id === viewId);
  if (!visible.length) {
    return [];
  }

  const earliest = visible.reduce((min, row) => (row.tap_date < min ? row.tap_date : min), visible[0].tap_date);
  const [trips, recent] = await Promise.all([
    db.prepare(`
      SELECT start_date, end_date, currency FROM trip_events
      WHERE household_id = ? AND currency IS NOT NULL AND put_away_at IS NULL
        AND start_date IS NOT NULL AND (end_date IS NULL OR end_date >= ?)
    `).bind(DEFAULT_HOUSEHOLD_ID, earliest).all<{ start_date: string; end_date: string | null; currency: string }>()
      .then((result) => result.results)
      .catch(() => []),
    db.prepare(`
      SELECT owner_person_id, original_currency, MAX(transaction_date) AS last_date
      FROM transactions
      WHERE household_id = ? AND original_currency IS NOT NULL AND transaction_date >= ?
      GROUP BY owner_person_id, original_currency
    `).bind(DEFAULT_HOUSEHOLD_ID, daysBefore(earliest, RECENT_OTHER_CURRENCY_DAYS))
      .all<{ owner_person_id: string | null; original_currency: string; last_date: string }>()
      .then((result) => result.results)
  ]);

  return visible.map((row) => {
    const currency = (row.currency ?? "SGD").toUpperCase();
    const tripCurrencies = trips
      .filter((trip) => trip.start_date <= row.tap_date && (trip.end_date ?? trip.start_date) >= row.tap_date)
      .map((trip) => trip.currency.toUpperCase());
    const lastAbroad = row.other_currency_account_id
      ? recent
        .filter((item) => item.owner_person_id === row.person_id && item.last_date <= row.tap_date)
        .sort((left, right) => right.last_date.localeCompare(left.last_date))
        .map((item) => item.original_currency.toUpperCase())
      : [];
    const otherCurrencies = [...new Set([...tripCurrencies, ...lastAbroad])].filter((code) => code !== currency).slice(0, 2);
    return {
      id: row.id,
      merchant: row.merchant,
      date: row.tap_date,
      time: entryTimeInAppTimeZone(new Date(row.received_at)) ?? "",
      accountId: row.account_id,
      accountName: row.account_name ?? "",
      currency,
      personId: row.person_id,
      personName: row.person_name ?? "",
      otherCurrencies
    };
  });
}
