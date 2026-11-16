// The Apple Pay Shortcut's entry save and the waiting tap (DOMAIN.md
// "Waiting Tap"; README in shortcuts/apple-pay-api):
//
// - POST /api/shortcuts/entries/create   a Wallet purchase (token: the person's Shortcut key)
// - POST /api/shortcuts/taps/status      a held tap's status, by the Shortcut's request id (same key)
// - POST /api/waiting-taps/complete      Entries' "one line to finish": the amount for a held tap
// - POST /api/waiting-taps/remove        Entries' "Not a payment"
//
// One save path for all three ways an amount arrives (a second Shortcut run,
// the Shortcut's own question, the app), so category guess, habits, trips,
// the foreign-currency estimate and the "Done for you" safe set behave
// exactly as for any Apple Pay entry. The two app paths sit behind Access
// and the cross-site guard; the Shortcut paths behind the person's key.

import {
  applyRememberedTransferPurposes
} from "../domain/app-repository-transfer-purpose";
import { loadCategoryMatchRules, matchCategoryRule } from "../domain/app-repository-category-match-rules";
import { createEntryRecord } from "../domain/app-repository-entry-commands";
import { convertForeignAmount, describeForeignAmount, formatForeignAmount, FxRateUnavailableError } from "../domain/foreign-currency";
import {
  loadShortcutAccountReferences,
  loadShortcutConnectionRecords,
  resolveShortcutAccountSelection,
  selectShortcutAccount,
  shortcutConnectionPriorityIds,
  SHORTCUT_TAP_STATUS_PATH,
  type ShortcutConnectionRecord
} from "../domain/app-repository-shortcuts";
import {
  hasOversizedShortcutDescription,
  isShortcutAmountMissing,
  isShortcutEntryType,
  isShortcutOwnershipType,
  isShortcutTransferDirection,
  normalizeShortcutAmount,
  normalizeShortcutCurrency,
  normalizeShortcutDate,
  normalizeShortcutDescription,
  normalizeShortcutNote,
  normalizeShortcutRequestId,
  SHORTCUT_NOTE_MAX_LENGTH,
  type ShortcutCreateBody
} from "../domain/shortcut-entry-contract";
import {
  holdWaitingTap,
  loadWaitingTap,
  loadWaitingTapByRequestId,
  loadWaitingTapRows,
  markWaitingTapNotAPayment,
  WaitingTapNotWaitingError,
  WaitingTapsUnavailableError
} from "../domain/app-repository-waiting-taps";
import { buildWaitingTapCompletedStatements, toWaitingTapFact, type WaitingTapRow } from "../domain/waiting-tap-statements";
import { canHoldTap, findTapForSecondRun, secondsBetween, type WaitingTapCompletedBy } from "../domain/waiting-taps";
import { readAskAfterSeconds } from "../domain/waiting-taps-config";
import { DEFAULT_HOUSEHOLD_ID } from "../domain/app-repository-constants";
import { entryTimeInAppTimeZone } from "../lib/entry-time";
import { isoDateInAppTimeZone } from "../lib/app-calendar";
import { applyHabitsToNewEntry } from "./ask-auto-apply";
import { buildShortcutAppUrl, buildShortcutEntryOpenUrl } from "./shortcut-gateway";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export { SHORTCUT_TAP_STATUS_PATH };
export const WAITING_TAP_COMPLETE_PATH = "/api/waiting-taps/complete";
export const WAITING_TAP_REMOVE_PATH = "/api/waiting-taps/remove";

export interface ShortcutEntryEnv {
  DB: D1Database;
  FX_RATES_OFFLINE?: string;
  SHORTCUT_APP_ORIGIN?: string;
  SHORTCUT_INGEST_TOKEN?: string;
  // Seconds the Shortcut waits before asking for a held tap's amount;
  // unset uses the config (never), "off" never (waiting-taps-config.ts).
  WAITING_TAP_ASK_AFTER_SECONDS?: string;
}

function describeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Unknown server error";
}

// The words the Shortcut shows, from the server so they can change without a
// reinstall.
export const waitingTapNotices = {
  held: (merchant: string) => `${merchant} noted. Waiting for the amount.`,
  saved: (merchant: string, amountText: string, accountName: string) => `Saved ${merchant} • ${amountText} • ${accountName}`,
  sorted: (merchant: string) => `${merchant} is already sorted in Monies Map.`
};

// Where a held tap is finished in the app: the Entries card.
export function buildWaitingTapOpenUrl(request: Request, tapId: string, appOrigin?: string) {
  const url = buildShortcutAppUrl("/entries", request.url, appOrigin);
  url.searchParams.set("waiting_tap", tapId);
  return url.toString();
}

type HeldTapToComplete = { tap: WaitingTapRow; completedBy: WaitingTapCompletedBy; secondRunSeconds?: number };

/**
 * Saves a Wallet purchase for one person's connection, or holds it as a
 * waiting tap when only its amount is missing (Shortcut v8 and later). An
 * amount for a held tap (its own request id, a second Shortcut run, or the
 * app) completes it in the entry's own batch.
 */
export async function saveShortcutEntry(
  env: ShortcutEntryEnv,
  request: Request,
  connection: ShortcutConnectionRecord,
  body: ShortcutCreateBody,
  options: {
    source: "shortcut" | "app";
    // A held tap this save completes, and who supplied the amount: the
    // person in the app today; a later bank-alert automation would pass
    // its own source (DOMAIN.md "Waiting Tap", the completion seam).
    tap?: WaitingTapRow;
    completedBy?: WaitingTapCompletedBy;
    now?: Date;
  } = { source: "shortcut" }
): Promise<Response> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  // The key said whose phone this is: their default params, card order
  // and card for other currencies apply, and the entry is theirs.
  const bodyWithDefaults = applyShortcutCreateDefaults(body, connection.stored.defaultParams);
  const amount = normalizeShortcutAmount(bodyWithDefaults.amountMinor, bodyWithDefaults.amount);
  const shortcutDate = normalizeShortcutDate(bodyWithDefaults.date);
  const explicitCurrency = normalizeShortcutCurrency(bodyWithDefaults.currency);
  const requestId = normalizeShortcutRequestId(bodyWithDefaults.requestId);
  const entryType = bodyWithDefaults.entryType ?? "expense";
  const ownershipType = bodyWithDefaults.ownershipType ?? "direct";
  let account;
  try {
    account = await resolveShortcutAccountSelection(env.DB, connection, {
      accountId: bodyWithDefaults.accountId,
      accountName: bodyWithDefaults.accountName,
      walletName: bodyWithDefaults.name,
      amountCurrency: explicitCurrency ?? amount?.currency
    });
  } catch (error) {
    return json({ ok: false, error: describeError(error) }, 400);
  }
  const descriptionValues = [
    bodyWithDefaults.description,
    bodyWithDefaults.merchant,
    account?.resolution === "wallet_name" ? undefined : bodyWithDefaults.name
  ];
  const shortcutDescription = normalizeShortcutDescription(...descriptionValues);
  const note = normalizeShortcutNote(bodyWithDefaults.note);
  const amountCurrency = explicitCurrency ?? amount?.currency;
  const invalidFields = [
    !shortcutDate ? "date" : undefined,
    !shortcutDescription ? "description" : undefined,
    !account ? "account" : undefined,
    !amount ? "amount" : undefined,
    bodyWithDefaults.currency && !explicitCurrency ? "currency" : undefined,
    explicitCurrency && amount?.currency && explicitCurrency !== amount.currency ? "currency" : undefined,
    !isShortcutEntryType(entryType) ? "entryType" : undefined,
    bodyWithDefaults.transferDirection != null && !isShortcutTransferDirection(bodyWithDefaults.transferDirection) ? "transferDirection" : undefined,
    !isShortcutOwnershipType(ownershipType) ? "ownershipType" : undefined,
    bodyWithDefaults.requestId != null && !requestId ? "requestId" : undefined,
    bodyWithDefaults.note != null && bodyWithDefaults.note.trim().length > SHORTCUT_NOTE_MAX_LENGTH ? "note" : undefined,
    bodyWithDefaults.splitBasisPoints != null && (
      !Number.isInteger(bodyWithDefaults.splitBasisPoints)
      || bodyWithDefaults.splitBasisPoints < 0
      || bodyWithDefaults.splitBasisPoints > 10_000
    ) ? "splitBasisPoints" : undefined
  ].filter((field): field is string => Boolean(field));
  if (
    invalidFields.length
    || !shortcutDate
    || !shortcutDescription
    || !account
    || !amount
    || !isShortcutEntryType(entryType)
    || !isShortcutOwnershipType(ownershipType)
  ) {
    const onlyAmountMissing = invalidFields.length === 1
      && invalidFields[0] === "amount"
      && account
      && shortcutDescription
      && shortcutDate
      && isShortcutAmountMissing(bodyWithDefaults.amountMinor, bodyWithDefaults.amount);
    if (onlyAmountMissing && account && shortcutDescription && shortcutDate) {
      // A Shortcut that knows held taps: keep the tap and let it end quietly.
      if (
        options.source === "shortcut"
        && canHoldTap(bodyWithDefaults.clientVersion)
        && requestId
        && entryType === "expense"
        && ownershipType === "direct"
      ) {
        try {
          const held = await holdWaitingTap(env.DB, {
            requestId,
            personId: connection.personId,
            accountId: account.id,
            otherCurrencyAccountId: connection.stored.foreignCurrencyAccountId || connection.householdForeignCurrencyAccountId,
            merchant: shortcutDescription,
            walletName: bodyWithDefaults.name,
            tapDate: shortcutDate,
            clientVersion: bodyWithDefaults.clientVersion
          }, now);
          // A second blank run for a tap already waiting must not ask a
          // second time: the first run asks.
          const askAfterSeconds = readAskAfterSeconds(env.WAITING_TAP_ASK_AFTER_SECONDS);
          const asks = askAfterSeconds !== null && held.outcome !== "second_blank";
          return json({
            ok: true,
            held: true,
            requestId: held.tap.request_id,
            merchant: held.tap.merchant,
            accountName: account.name,
            notice: waitingTapNotices.held(held.tap.merchant),
            ...(asks ? { askAfterSeconds } : {}),
            openUrl: buildWaitingTapOpenUrl(request, held.tap.id, env.SHORTCUT_APP_ORIGIN)
          }, 202);
        } catch (error) {
          if (!(error instanceof WaitingTapsUnavailableError)) {
            const message = describeError(error);
            if (message.includes("request ID was already used")) {
              return json({ ok: false, error: message }, 409);
            }
            console.error("Holding a tap failed", error instanceof Error ? error.name : "unknown");
            return json({ ok: false, error: "Monies Map could not save this shortcut entry." }, 500);
          }
          // No table yet: the older answer, exactly.
        }
      }
      // Only the amount is missing (a terminal asking which currency to pay
      // in): say so, with what the Shortcut's prompt names, so it can ask
      // the person and post the same request again. Nothing is saved.
      return json({
        ok: false,
        needsAmount: true,
        merchant: shortcutDescription,
        accountName: account.name,
        error: "Missing or invalid shortcut fields: amount."
      }, 400);
    }
    return json({
      ok: false,
      error: hasOversizedShortcutDescription(...descriptionValues)
        ? "Shortcut description must be 500 characters or fewer. Nothing was saved."
        : `Missing or invalid shortcut fields: ${invalidFields.join(", ")}.`
    }, 400);
  }
  if (requestId && ownershipType !== "direct") {
    return json({
      ok: false,
      error: "Shortcut requestId is only supported for direct ownership entries. Nothing was saved."
    }, 400);
  }

  // The held tap this amount finishes, if any.
  let held: HeldTapToComplete | null = options.tap ? { tap: options.tap, completedBy: options.completedBy ?? "app" } : null;
  if (!held && requestId && options.source === "shortcut") {
    const byRequest = await loadWaitingTapByRequestId(env.DB, requestId);
    if (byRequest && byRequest.person_id === connection.personId) {
      if (byRequest.status === "waiting") {
        held = { tap: byRequest, completedBy: "shortcut_answer" };
      } else if (byRequest.status === "completed" && byRequest.entry_id) {
        // Finished meanwhile (a second tap, or the app): never a second entry.
        return savedTapReply(env, request, byRequest, bodyWithDefaults.view);
      }
    }
  }
  if (!held && options.source === "shortcut" && entryType === "expense" && ownershipType === "direct") {
    const waiting = (await loadWaitingTapRows(env.DB)).filter((row) => row.person_id === connection.personId);
    if (waiting.length) {
      // The card the Wallet name or Default account order picks before any
      // currency is known: where the blank first tap was held.
      const accounts = await loadShortcutAccountReferences(env.DB);
      const base = selectShortcutAccount(accounts, shortcutConnectionPriorityIds(accounts, connection), {
        accountId: bodyWithDefaults.accountId,
        accountName: bodyWithDefaults.accountName,
        walletName: bodyWithDefaults.name
      }).account;
      const match = findTapForSecondRun(waiting.map(toWaitingTapFact), {
        personId: connection.personId,
        accountIds: [account.id, base?.id].filter((id): id is string => Boolean(id)),
        merchant: shortcutDescription,
        now: nowIso
      });
      const tap = match ? waiting.find((row) => row.id === match.id) : undefined;
      if (tap) {
        held = { tap, completedBy: "second_tap", secondRunSeconds: secondsBetween(tap.received_at, nowIso) };
      }
    }
  }

  // A held tap's entry is dated and timed when the first tap happened.
  const entryDate = held ? held.tap.tap_date : shortcutDate;
  const heldTime = held && held.tap.tap_date === isoDateInAppTimeZone(new Date(held.tap.received_at))
    ? entryTimeInAppTimeZone(new Date(held.tap.received_at))
    : null;

  // A Wallet amount in another currency (an Amaze card abroad) is saved
  // in the account's currency at the day's rate, the original kept.
  let foreign: { amountMinor: number; originalAmountMinor: number; originalCurrency: string; note: string } | undefined;
  if (amountCurrency && amountCurrency !== account.currency) {
    try {
      const conversion = await convertForeignAmount(env.DB, {
        amountMinor: amount.amountMinor,
        fromCurrency: amountCurrency,
        toCurrency: account.currency,
        offline: env.FX_RATES_OFFLINE === "true"
      });
      foreign = {
        amountMinor: conversion.amountMinor,
        originalAmountMinor: amount.amountMinor,
        originalCurrency: amountCurrency,
        note: describeForeignAmount({ originalAmountMinor: amount.amountMinor, originalCurrency: amountCurrency, accountCurrency: account.currency, conversion })
      };
    } catch (error) {
      if (error instanceof FxRateUnavailableError) {
        return json({ ok: false, error: error.message }, 503);
      }
      throw error;
    }
  }
  const savedAmountMinor = foreign?.amountMinor ?? amount.amountMinor;

  try {
    const categoryName = bodyWithDefaults.categoryName
      ?? matchCategoryRule(shortcutDescription, await loadCategoryMatchRules(env.DB))
      ?? "Other";
    const created = await createEntryRecord(env.DB, {
      date: entryDate,
      description: shortcutDescription,
      accountId: account.id,
      categoryName,
      amountMinor: savedAmountMinor,
      originalAmountMinor: foreign?.originalAmountMinor,
      originalCurrency: foreign?.originalCurrency,
      entryType,
      transferDirection: bodyWithDefaults.transferDirection,
      ownershipType,
      // Always the key's person, whatever the request or the default
      // params name: one person's key cannot save an entry as another's.
      ownerName: connection.personName,
      offsetsCategory: bodyWithDefaults.offsetsCategory,
      note: [foreign?.note, note].filter(Boolean).join("\n") || undefined,
      splitBasisPoints: bodyWithDefaults.splitBasisPoints,
      externalReference: requestId ? `shortcut:${requestId}` : undefined,
      ...(held ? { time: heldTime } : {})
    }, held
      ? (entryId) => buildWaitingTapCompletedStatements(env.DB, { id: held!.tap.id, receivedAt: held!.tap.received_at }, {
          entryId,
          completedBy: held!.completedBy,
          now: nowIso,
          secondRunSeconds: held!.secondRunSeconds
        })
      : undefined);
    // A new Apple Pay entry: Ask handles what its habits allow (its
    // category is the rules' default, not the person's choice). Best
    // effort, never part of the save.
    if (created.created && entryType === "expense") {
      await applyHabitsToNewEntry(env.DB, created.entryId, { applePay: true });
    }
    if (created.created && entryType === "transfer") {
      await applyRememberedTransferPurposes(env.DB, [created.entryId]).catch((error) => {
        console.error("Remembered transfer purposes failed", error);
      });
    }
    const openUrl = buildShortcutEntryOpenUrl(request, {
      entryId: created.entryId,
      date: entryDate,
      viewId: bodyWithDefaults.view,
      accountId: account.id
    }, env.SHORTCUT_APP_ORIGIN);

    return json({
      ok: true,
      entryId: created.entryId,
      created: created.created,
      date: entryDate,
      // The Singapore clock time saved with a new entry dated today.
      ...("time" in created && created.time ? { time: created.time } : {}),
      description: shortcutDescription,
      amountMinor: savedAmountMinor,
      currency: account.currency,
      ...(foreign ? { originalAmount: formatForeignAmount(foreign.originalAmountMinor, foreign.originalCurrency) } : {}),
      accountId: account.id,
      accountName: account.name,
      accountResolution: account.resolution,
      ...(held && created.created ? {
        completedHeldTap: true,
        ...(held.secondRunSeconds !== undefined ? { heldTapSeconds: held.secondRunSeconds } : {})
      } : {}),
      // What Shortcut v8 shows after the person typed a held tap's amount.
      notice: waitingTapNotices.saved(
        shortcutDescription,
        foreign ? formatForeignAmount(foreign.originalAmountMinor, foreign.originalCurrency) : formatForeignAmount(savedAmountMinor, account.currency),
        account.name
      ),
      openUrl
    });
  } catch (error) {
    const message = describeError(error);
    if (message.includes("request ID was already used")) {
      return json({ ok: false, error: message }, 409);
    }
    if (/^(Amount|Unknown|Missing)/.test(message)) {
      return json({ ok: false, error: message }, 400);
    }
    console.error("Shortcut entry create failed", error);
    return json({ ok: false, error: "Monies Map could not save this shortcut entry." }, 500);
  }
}

async function loadSavedEntryFacts(db: D1Database, entryId: string) {
  return db
    .prepare(`
      SELECT transactions.id, transactions.description, transactions.amount_minor, transactions.currency,
        transactions.transaction_date, accounts.id AS account_id, accounts.account_name
      FROM transactions
      LEFT JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{ id: string; description: string; amount_minor: number; currency: string; transaction_date: string; account_id: string | null; account_name: string | null }>();
}

// A request for a tap that was finished meanwhile: the entry it became.
async function savedTapReply(env: ShortcutEntryEnv, request: Request, tap: WaitingTapRow, viewId?: string) {
  const entry = tap.entry_id ? await loadSavedEntryFacts(env.DB, tap.entry_id) : null;
  if (!entry) {
    return json({ ok: true, held: false, status: tap.status, notice: waitingTapNotices.sorted(tap.merchant) });
  }
  const amountMinor = Math.abs(Number(entry.amount_minor));
  return json({
    ok: true,
    entryId: entry.id,
    created: false,
    date: entry.transaction_date,
    description: entry.description,
    amountMinor,
    currency: entry.currency,
    accountId: entry.account_id ?? "",
    accountName: entry.account_name ?? "",
    completedHeldTap: true,
    notice: waitingTapNotices.saved(tap.merchant || entry.description, formatForeignAmount(amountMinor, entry.currency), entry.account_name ?? ""),
    openUrl: buildShortcutEntryOpenUrl(request, { entryId: entry.id, date: entry.transaction_date, viewId }, env.SHORTCUT_APP_ORIGIN)
  });
}

// The Shortcut's question "is this tap still waiting?", by its own request
// id. Only the key's person's taps answer; anything else is not found.
export async function handleShortcutTapStatus(env: ShortcutEntryEnv, request: Request, connection: ShortcutConnectionRecord) {
  let body: Partial<{ requestId: unknown }>;
  try {
    body = await readJsonObject<{ requestId: unknown }>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "Request is too large." }, 413);
    }
    return json({ ok: false, error: "Shortcut request body must be valid JSON." }, 400);
  }
  const requestId = normalizeShortcutRequestId(typeof body.requestId === "string" ? body.requestId : undefined);
  if (!requestId) {
    return json({ ok: false, error: "Missing or invalid shortcut fields: requestId." }, 400);
  }
  const tap = await loadWaitingTapByRequestId(env.DB, requestId);
  if (!tap || tap.person_id !== connection.personId) {
    return json({ ok: false, error: "No payment is waiting for this tap." }, 404);
  }
  if (tap.status === "waiting") {
    const accountName = await env.DB
      .prepare("SELECT account_name FROM accounts WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, tap.account_id)
      .first<{ account_name: string }>();
    return json({
      ok: true,
      status: "waiting",
      ask: true,
      requestId: tap.request_id,
      merchant: tap.merchant,
      accountName: accountName?.account_name ?? "",
      openUrl: buildWaitingTapOpenUrl(request, tap.id, env.SHORTCUT_APP_ORIGIN)
    });
  }
  if (tap.status === "completed") {
    const reply = await savedTapReply(env, request, tap);
    const payload = await reply.json<Record<string, unknown>>();
    return json({ ...payload, status: "completed" });
  }
  return json({ ok: true, status: tap.status, notice: waitingTapNotices.sorted(tap.merchant) });
}

export function isWaitingTapAppPath(pathname: string) {
  return pathname === WAITING_TAP_COMPLETE_PATH || pathname === WAITING_TAP_REMOVE_PATH;
}

// The person's connection for a held tap's save from the app, even with no
// key (a revoked key still owns its card order and defaults).
async function connectionForPerson(env: ShortcutEntryEnv, personId: string): Promise<ShortcutConnectionRecord | null> {
  const connections = await loadShortcutConnectionRecords(env.DB, env.SHORTCUT_INGEST_TOKEN);
  return connections.find((connection) => connection.personId === personId) ?? null;
}

const AMOUNT_TEXT = /^\d[\d,]*(?:\.\d{1,3})?$/;

// Entries' card: Save (the amount and its currency) or Not a payment.
export async function handleWaitingTapAppRoute(request: Request, env: ShortcutEntryEnv, url: URL): Promise<Response | null> {
  if (!isWaitingTapAppPath(url.pathname)) {
    return null;
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  let body: Partial<{ tapId: unknown; amount: unknown; currency: unknown }>;
  try {
    body = await readJsonObject<{ tapId: unknown; amount: unknown; currency: unknown }>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: "Request is too large." }, 413);
    }
    return json({ ok: false, error: "Request body must be valid JSON." }, 400);
  }
  const tapId = typeof body.tapId === "string" ? body.tapId.trim() : "";
  if (!tapId) {
    return json({ ok: false, error: "Missing payment." }, 400);
  }

  if (url.pathname === WAITING_TAP_REMOVE_PATH) {
    try {
      return json({ ok: true, ...(await markWaitingTapNotAPayment(env.DB, tapId)) });
    } catch (error) {
      if (error instanceof WaitingTapNotWaitingError) {
        return json({ ok: false, error: error.message }, 409);
      }
      throw error;
    }
  }

  const amountText = typeof body.amount === "string" ? body.amount.trim() : typeof body.amount === "number" ? String(body.amount) : "";
  const currency = normalizeShortcutCurrency(typeof body.currency === "string" ? body.currency : undefined);
  // Read exactly as the save will read it, so a refusal is said in plain words.
  if (!AMOUNT_TEXT.test(amountText) || !currency || !normalizeShortcutAmount(undefined, `${currency} ${amountText}`)) {
    return json({ ok: false, error: "Type the amount, like 12.50." }, 400);
  }
  const tap = await loadWaitingTap(env.DB, tapId);
  if (!tap || tap.status !== "waiting") {
    return json({ ok: false, error: new WaitingTapNotWaitingError().message }, 409);
  }
  const connection = await connectionForPerson(env, tap.person_id);
  if (!connection) {
    return json({ ok: false, error: "This payment's person is no longer in the household." }, 409);
  }
  const account = await env.DB
    .prepare("SELECT currency FROM accounts WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, tap.account_id)
    .first<{ currency: string }>();
  const inCardCurrency = account?.currency?.toUpperCase() === currency;
  return saveShortcutEntry(env, request, connection, {
    date: tap.tap_date,
    description: tap.merchant,
    // The card the tap was held on, in its own currency; another currency
    // goes where the Shortcut would send it (the card for other currencies).
    ...(inCardCurrency ? { accountId: tap.account_id } : { name: tap.wallet_name || undefined }),
    // "IDR 150.000" reads the dots as thousands, as the Shortcut's reader does.
    amount: `${currency} ${amountText}`,
    requestId: tap.request_id,
    clientVersion: "app"
  }, { source: "app", tap });
}

function applyShortcutCreateDefaults<T extends ShortcutCreateBody>(body: T, defaultParams = ""): T {
  const params = new URLSearchParams(defaultParams.trim().replace(/^\?/, ""));
  const shared = parseShortcutBoolean(params.get("shared"));
  return {
    ...body,
    date: body.date ?? params.get("date") ?? undefined,
    description: body.description ?? params.get("description") ?? params.get("merchant") ?? undefined,
    accountId: body.accountId ?? params.get("account_id") ?? params.get("accountId") ?? undefined,
    accountName: body.accountName ?? params.get("account") ?? params.get("accountName") ?? undefined,
    categoryName: body.categoryName ?? params.get("categoryName") ?? params.get("category") ?? undefined,
    amount: body.amount ?? params.get("amount") ?? undefined,
    entryType: body.entryType ?? parseShortcutEntryType(params.get("entryType")) ?? "expense",
    transferDirection: body.transferDirection ?? parseShortcutTransferDirection(params.get("transferDirection")),
    ownershipType: body.ownershipType ?? parseShortcutOwnershipType(params.get("ownershipType")) ?? (shared === true ? "shared" : undefined),
    ownerName: body.ownerName ?? params.get("ownerName") ?? params.get("owner") ?? undefined,
    offsetsCategory: body.offsetsCategory ?? parseShortcutBoolean(params.get("offsetsCategory")),
    note: body.note ?? params.get("note") ?? undefined,
    splitBasisPoints: body.splitBasisPoints ?? parseShortcutNumber(params.get("splitBasisPoints")),
    view: body.view ?? params.get("view") ?? undefined
  };
}

function parseShortcutBoolean(value?: string | null) {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "shared"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "direct"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseShortcutNumber(value?: string | null) {
  if (value == null || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseShortcutEntryType(value?: string | null): "expense" | "income" | "transfer" | undefined {
  return value === "expense" || value === "income" || value === "transfer" ? value : undefined;
}

function parseShortcutTransferDirection(value?: string | null): "in" | "out" | undefined {
  return value === "in" || value === "out" ? value : undefined;
}

function parseShortcutOwnershipType(value?: string | null): "direct" | "shared" | undefined {
  return value === "direct" || value === "shared" ? value : undefined;
}
