// Waiting taps (DOMAIN.md "Waiting Tap"): the store of Apple Pay Shortcut
// runs that came with no amount. Every read and write is scoped to the
// household. Commands read and check first, then write the tap and its audit
// line in one db.batch(). The table is additive (schema.sql "waiting_taps"):
// a reader treats it missing as no taps, and holding a tap refuses with
// WaitingTapsUnavailableError so the Shortcut route keeps the older
// needsAmount answer. Completing a tap is not here: it is part of the entry
// create command's own batch (waiting-tap-statements.ts).

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import { findTapForSecondRun, secondsBetween } from "./waiting-taps";
import {
  buildWaitingTapClearedStatements,
  readWaitingTapRows,
  toWaitingTapFact,
  WAITING_TAP_COLUMNS,
  type WaitingTapRow
} from "./waiting-tap-statements";

export class WaitingTapsUnavailableError extends Error {
  constructor() {
    super("Waiting taps are not set up.");
  }
}

export class WaitingTapNotWaitingError extends Error {
  constructor() {
    super("This payment was already sorted.");
  }
}

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

async function tolerant<T>(read: () => Promise<T>, missing: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isMissingTable(error)) {
      return missing;
    }
    throw error;
  }
}

export function loadWaitingTapByRequestId(db: D1Database, requestId: string) {
  return tolerant(() => db
    .prepare(`SELECT ${WAITING_TAP_COLUMNS} FROM waiting_taps WHERE household_id = ? AND request_id = ?`)
    .bind(DEFAULT_HOUSEHOLD_ID, requestId)
    .first<WaitingTapRow>(), null);
}

export function loadWaitingTap(db: D1Database, id: string) {
  return tolerant(() => db
    .prepare(`SELECT ${WAITING_TAP_COLUMNS} FROM waiting_taps WHERE household_id = ? AND id = ?`)
    .bind(DEFAULT_HOUSEHOLD_ID, id)
    .first<WaitingTapRow>(), null);
}

export { readWaitingTapRows as loadWaitingTapRows };

export interface HoldWaitingTapInput {
  requestId: string;
  personId: string;
  accountId: string;
  otherCurrencyAccountId?: string;
  merchant: string;
  walletName?: string;
  tapDate: string;
  clientVersion?: string;
}

export type HoldWaitingTapResult =
  // A new tap is waiting.
  | { outcome: "held"; tap: WaitingTapRow }
  // The same request again (the Shortcut's own retry): nothing new.
  | { outcome: "replayed"; tap: WaitingTapRow }
  // Another run with no amount for a tap already waiting (the second tap
  // also came blank): recorded on that tap, no second tap is kept.
  | { outcome: "second_blank"; tap: WaitingTapRow; seconds: number };

// Keeps a tap that came with no amount. Idempotent on the Shortcut's
// request id.
export async function holdWaitingTap(db: D1Database, input: HoldWaitingTapInput, now = new Date()): Promise<HoldWaitingTapResult> {
  const nowIso = now.toISOString();
  let existing: WaitingTapRow | null;
  let waiting: WaitingTapRow[];
  try {
    [existing, waiting] = await Promise.all([
      db.prepare(`SELECT ${WAITING_TAP_COLUMNS} FROM waiting_taps WHERE household_id = ? AND request_id = ?`)
        .bind(DEFAULT_HOUSEHOLD_ID, input.requestId)
        .first<WaitingTapRow>(),
      db.prepare(`SELECT ${WAITING_TAP_COLUMNS} FROM waiting_taps WHERE household_id = ? AND status = 'waiting' AND person_id = ?`)
        .bind(DEFAULT_HOUSEHOLD_ID, input.personId)
        .all<WaitingTapRow>()
        .then((result) => result.results)
    ]);
  } catch (error) {
    if (isMissingTable(error)) {
      throw new WaitingTapsUnavailableError();
    }
    throw error;
  }
  if (existing) {
    if (existing.person_id !== input.personId) {
      throw new Error("Shortcut request ID was already used for a different entry.");
    }
    return { outcome: "replayed", tap: existing };
  }

  const earlier = findTapForSecondRun(waiting.map(toWaitingTapFact), {
    personId: input.personId,
    accountIds: [input.accountId],
    merchant: input.merchant,
    now: nowIso
  });
  if (earlier) {
    const tap = waiting.find((row) => row.id === earlier.id)!;
    const seconds = secondsBetween(tap.received_at, nowIso);
    if (!tap.second_run_at) {
      await db.batch([
        db.prepare(`
          UPDATE waiting_taps SET second_run_at = ?, second_run_seconds = ?, second_run_had_amount = 0
          WHERE household_id = ? AND id = ? AND status = 'waiting' AND second_run_at IS NULL
        `).bind(nowIso, seconds, DEFAULT_HOUSEHOLD_ID, tap.id),
        buildAuditEventStatement(db, {
          entityType: "waiting_tap",
          entityId: tap.id,
          action: "waiting_tap_second_run",
          detail: `A second Shortcut run with no amount arrived ${seconds} seconds after the first.`
        })
      ]);
    }
    return { outcome: "second_blank", tap: { ...tap, second_run_at: tap.second_run_at ?? nowIso, second_run_seconds: tap.second_run_seconds ?? seconds }, seconds };
  }

  const tap: WaitingTapRow = {
    id: `tap-${crypto.randomUUID()}`,
    request_id: input.requestId,
    person_id: input.personId,
    account_id: input.accountId,
    other_currency_account_id: input.otherCurrencyAccountId && input.otherCurrencyAccountId !== input.accountId ? input.otherCurrencyAccountId : "",
    merchant: input.merchant.slice(0, 500),
    wallet_name: (input.walletName ?? "").slice(0, 200),
    tap_date: input.tapDate,
    received_at: nowIso,
    client_version: (input.clientVersion ?? "").slice(0, 80),
    status: "waiting",
    completed_by: null,
    entry_id: null,
    resolved_at: null,
    second_run_at: null,
    second_run_seconds: null
  };
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO waiting_taps (
          id, household_id, request_id, person_id, account_id, other_currency_account_id,
          merchant, wallet_name, tap_date, received_at, client_version, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
      `).bind(
        tap.id, DEFAULT_HOUSEHOLD_ID, tap.request_id, tap.person_id, tap.account_id, tap.other_currency_account_id,
        tap.merchant, tap.wallet_name, tap.tap_date, tap.received_at, tap.client_version
      ),
      buildAuditEventStatement(db, {
        entityType: "waiting_tap",
        entityId: tap.id,
        action: "waiting_tap_held",
        detail: `An Apple Pay tap on ${tap.tap_date} came with no amount and is waiting for it.`
      })
    ]);
  } catch (error) {
    // Two runs of the same request at once: the other one kept it.
    const raced = await loadWaitingTapByRequestId(db, input.requestId);
    if (raced && raced.person_id === input.personId) {
      return { outcome: "replayed", tap: raced };
    }
    throw error;
  }
  return { outcome: "held", tap };
}

// "Not a payment": the tap goes, nothing is saved.
export async function markWaitingTapNotAPayment(db: D1Database, tapId: string, now = new Date()) {
  const tap = await loadWaitingTap(db, tapId);
  if (!tap || tap.status !== "waiting") {
    throw new WaitingTapNotWaitingError();
  }
  await db.batch(buildWaitingTapClearedStatements(db, tap.id, { status: "not_a_payment", now: now.toISOString() }));
  return { tapId: tap.id, status: "not_a_payment" as const };
}
