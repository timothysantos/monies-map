// Waiting taps (DOMAIN.md "Waiting Tap"): the pure rules. Which Shortcut
// versions get a held tap, which later Shortcut run completes one, and which
// imported bank rows or certified statements clear one. Nothing here reads a
// clock, a database or a model: callers pass `now` and the facts.

import { matchMerchants } from "./wrong-card-apple-pay-duplicate";
import { isCardMerchantPrefixMatch } from "./statement-row-matching";
import {
  FIRST_HOLDING_SHORTCUT_VERSION,
  IMPORT_CLEAR_MAX_DAY_DISTANCE,
  SECOND_TAP_WINDOW_SECONDS
} from "./waiting-taps-config";

export type WaitingTapStatus = "waiting" | "completed" | "not_a_payment" | "bank_row" | "statement_no_match" | "expired";
// Who supplied the amount that completed a tap. "bank_alert": the bank's own
// payment alert, read by the "Bank alert to Monies Map" Shortcut (bank-alerts.ts).
export type WaitingTapCompletedBy = "second_tap" | "shortcut_answer" | "app" | "bank_alert";

export interface WaitingTapFact {
  id: string;
  requestId: string;
  personId: string;
  accountId: string;
  otherCurrencyAccountId: string;
  merchant: string;
  walletName: string;
  tapDate: string;
  receivedAt: string;
  status: WaitingTapStatus;
}

// "apple-pay-api-2026-11-17-v8" is version 8. No version, or one this does
// not read, is 0: an older Shortcut.
export function readShortcutClientVersion(clientVersion: string | undefined | null) {
  const match = /(?:^|[-_ ])v(\d{1,3})$/i.exec(String(clientVersion ?? "").trim());
  return match ? Number(match[1]) : 0;
}

// Only a Shortcut that knows what a held tap is gets one; v7 and older keep
// the needsAmount answer they were built for.
export function canHoldTap(clientVersion: string | undefined | null) {
  return readShortcutClientVersion(clientVersion) >= FIRST_HOLDING_SHORTCUT_VERSION;
}

const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Two Wallet merchant texts for the same purchase. Either one blank counts
// as agreeing (a second run may carry no merchant); otherwise the same text,
// one running into the other, or a shop word in common.
export function merchantsAgree(left: string | undefined | null, right: string | undefined | null) {
  const a = compact(left ?? "");
  const b = compact(right ?? "");
  if (!a || !b) {
    return true;
  }
  if (a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))) {
    return true;
  }
  const match = matchMerchants(left ?? "", right ?? "");
  return match.matched >= 1 && match.strength >= 0.5;
}

export function secondsBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);
}

// The waiting tap a later Shortcut run for the same purchase belongs to:
// same person, on the tap's card (the run's card, or the card its Wallet name
// or Default account order picks before any currency is known), within the
// window after the tap, with merchants that agree. The newest such tap.
export function findTapForSecondRun(
  taps: readonly WaitingTapFact[],
  run: { personId: string; accountIds: readonly string[]; merchant: string; now: string }
): WaitingTapFact | null {
  const candidates = taps.filter((tap) => {
    const seconds = secondsBetween(tap.receivedAt, run.now);
    return tap.status === "waiting"
      && tap.personId === run.personId
      && run.accountIds.includes(tap.accountId)
      && seconds >= 0
      && seconds <= SECOND_TAP_WINDOW_SECONDS
      && merchantsAgree(tap.merchant, run.merchant);
  });
  return candidates.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))[0] ?? null;
}

export interface ImportClearRow {
  accountId: string;
  // The purchase day and, when the bank prints it, the posting day.
  dates: string[];
  description: string;
}

export interface ImportClearStatement {
  accountId: string;
  startDate: string;
  endDate: string;
}

export interface WaitingTapClear {
  tapId: string;
  status: "bank_row" | "statement_no_match";
}

function dayDistance(left: string, right: string) {
  return Math.abs(Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000));
}

export function bankRowMatchesTap(tap: WaitingTapFact, row: ImportClearRow) {
  const accounts = [tap.accountId, tap.otherCurrencyAccountId].filter(Boolean);
  if (!accounts.includes(row.accountId)) {
    return false;
  }
  if (!row.dates.some((date) => dayDistance(date, tap.tapDate) <= IMPORT_CLEAR_MAX_DAY_DISTANCE)) {
    return false;
  }
  if (!tap.merchant.trim()) {
    return false;
  }
  return matchMerchants(tap.merchant, row.description).strong
    || isCardMerchantPrefixMatch(row.description, tap.merchant);
}

// What an import does to the taps still waiting: a bank row for the same
// purchase (same card, near day, same shop) clears it, the bank row being
// the entry. A certified statement whose period covers the tap's day on
// every card it could be on, with no such row, clears it too: it was not a
// payment. Anything else stays waiting.
export function planWaitingTapClears(
  taps: readonly WaitingTapFact[],
  rows: readonly ImportClearRow[],
  certifiedStatements: readonly ImportClearStatement[]
): WaitingTapClear[] {
  const clears: WaitingTapClear[] = [];
  for (const tap of taps) {
    if (tap.status !== "waiting") {
      continue;
    }
    if (rows.some((row) => bankRowMatchesTap(tap, row))) {
      clears.push({ tapId: tap.id, status: "bank_row" });
      continue;
    }
    const accounts = [tap.accountId, tap.otherCurrencyAccountId].filter(Boolean);
    const covered = accounts.every((accountId) => certifiedStatements.some((statement) => (
      statement.accountId === accountId && statement.startDate <= tap.tapDate && tap.tapDate <= statement.endDate
    )));
    if (covered) {
      clears.push({ tapId: tap.id, status: "statement_no_match" });
    }
  }
  return clears;
}
