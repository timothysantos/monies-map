// Cash entries (DOMAIN.md "Cash Entry"; docs/flows/cash-entry-flow.md):
//
// - GET  /api/cash-entries/defaults?person=<id>: what the cash pad opens with
//   (wallet, currency and why, the trip on today, the Again chips). Read-only.
// - POST /api/cash-entries/create: the pad's Save. Body { requestId,
//   personId, amountMinor, currency?, description?, categoryName?, note?,
//   way?, accountId?, newPayment?, tapId?, date? }. A retry with the same
//   requestId returns the entry already saved, never a second one.
//   `way: "card"` saves on one of the person's own cards (accountId); while
//   an Apple Pay tap on that card waits, it answers 409 `offerTap` and saves
//   nothing unless `newPayment` is true. `tapId` finishes that waiting tap
//   instead, through the waiting tap's own complete command
//   (completeWaitingTapWithAmount, completed by the person in the app).
// - POST /api/shortcuts/cash/create: the "Log cash" Shortcut, on the
//   Shortcut Worker, outside Access. The Shortcut key says whose phone it is
//   (the entry is always that person's). Body { amount?, text?, requestId?,
//   clientVersion? }: an amount from the number pad, or words such as
//   "35000 coffee". The answer carries `notification`, the line the
//   Shortcut shows ("Saved: Coffee, Rp 35,000 cash").
//
// Every body is read through limited-body.ts.

import {
  CashEntryRefusedError,
  CashWalletMissingError,
  FxRateUnavailableError,
  WaitingTapOfferError,
  createCashEntry,
  loadCashEntryDefaults,
  loadPadSavedEntry,
  type CashEntrySaved
} from "../domain/app-repository-cash-entries";
import { loadWaitingTap, WaitingTapNotWaitingError } from "../domain/app-repository-waiting-taps";
import { describeSavedCash, isZeroDecimalCurrency, readCashCurrency, readCashRequestId, readCashSpokenText, isValidCashAmountMinor } from "../domain/cash-entry";
import { completeWaitingTapWithAmount, type ShortcutEntryEnv } from "./shortcut-entry-route";
import { saveFxRateForTests } from "../domain/foreign-currency";
import { applyHabitsToNewEntry } from "./ask-auto-apply";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const CASH_DEFAULTS_PATH = "/api/cash-entries/defaults";
export const CASH_CREATE_PATH = "/api/cash-entries/create";
export const SHORTCUT_CASH_PATH = "/api/shortcuts/cash/create";

// A cash entry is a few short fields; 8 KiB is far past any real body.
const MAX_BODY_BYTES = 8 * 1024;

type CashRouteEnv = ShortcutEntryEnv & {
  DB: D1Database;
  FX_RATES_OFFLINE?: string;
  APP_ENVIRONMENT?: string;
};

// Browser tests only: a test Worker cannot fetch rates (FX_RATES_OFFLINE),
// so a test may send "x-cash-test-rate: SGD/IDR=12350" to save one first.
const TEST_RATE_HEADER = "x-cash-test-rate";

async function applyTestRate(request: Request, env: CashRouteEnv) {
  const header = env.APP_ENVIRONMENT === "test" && env.FX_RATES_OFFLINE === "true" ? request.headers.get(TEST_RATE_HEADER) : null;
  const match = header?.match(/^([A-Z]{3})\/([A-Z]{3})=(\d+(?:\.\d+)?)$/);
  if (match) {
    await saveFxRateForTests(env.DB, { base: match[1], quote: match[2], quotePerBase: Number(match[3]) });
  }
}

export function isCashEntryPath(pathname: string) {
  return pathname === CASH_DEFAULTS_PATH || pathname === CASH_CREATE_PATH;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function refusal(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return json({ ok: false, error: error.message }, 413);
  }
  if (error instanceof WaitingTapOfferError) {
    // Not saved: the pad asks whether this is that tap first.
    const { tap } = error;
    return json({
      ok: false,
      offerTap: { id: tap.id, merchant: tap.merchant, time: tap.time, date: tap.date, accountId: tap.accountId, accountName: tap.accountName },
      error: error.message
    }, 409);
  }
  if (error instanceof CashWalletMissingError) {
    return json({ ok: false, needsWallet: true, walletChoices: error.choices, error: error.message }, 409);
  }
  if (error instanceof CashEntryRefusedError) {
    return json({ ok: false, field: error.code, error: error.message }, 400);
  }
  if (error instanceof FxRateUnavailableError) {
    // Retryable: the pad keeps the payment waiting and sends it again.
    return json({ ok: false, retry: true, error: error.message }, 503);
  }
  return null;
}

// Ask's safe set for a new entry (src/server/ask-auto-apply.ts): its
// category came from the rules, not the person, unless they chose one.
async function afterSave(env: CashRouteEnv, saved: CashEntrySaved, categoryChosen: boolean) {
  if (saved.created) {
    await applyHabitsToNewEntry(env.DB, saved.entryId, { applePay: !categoryChosen });
  }
}

export async function handleCashEntryRoute(request: Request, env: CashRouteEnv, url: URL): Promise<Response | null> {
  if (url.pathname === CASH_DEFAULTS_PATH) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "This route only answers GET." }, 405, { Allow: "GET" });
    }
    try {
      return json({ ok: true, defaults: await loadCashEntryDefaults(env.DB, { personId: url.searchParams.get("person") ?? "" }) });
    } catch (error) {
      const refused = refusal(error);
      if (refused) return refused;
      throw error;
    }
  }
  if (url.pathname !== CASH_CREATE_PATH) {
    return null;
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
  }
  try {
    const body = await readJsonObject<Record<string, unknown>>(request, MAX_BODY_BYTES);
    const requestId = readCashRequestId(body.requestId);
    if (!requestId) {
      return json({ ok: false, field: "request", error: "Missing or invalid requestId." }, 400);
    }
    const categoryName = text(body.categoryName);
    await applyTestRate(request, env);
    const tapId = text(body.tapId);
    if (tapId) {
      return await finishWaitingTap(request, env, { tapId, personId: text(body.personId), amountMinor: body.amountMinor, currency: text(body.currency) });
    }
    const saved = await createCashEntry(env.DB, {
      requestId,
      personId: text(body.personId),
      amountMinor: typeof body.amountMinor === "number" ? body.amountMinor : NaN,
      currency: text(body.currency) || null,
      description: text(body.description) || null,
      categoryName: categoryName || null,
      note: text(body.note) || null,
      way: body.way === "card" ? "card" : "cash",
      accountId: text(body.accountId) || null,
      newPayment: body.newPayment === true,
      date: text(body.date) || null
    }, { offlineRates: env.FX_RATES_OFFLINE === "true" });
    await afterSave(env, saved, Boolean(categoryName));
    return json({ ok: true, entry: saved });
  } catch (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw error;
  }
}

// The pad finishing an Apple Pay tap that came with no amount: the amount
// typed on the pad, through the waiting tap's own complete command (the tap's
// shop, card, day and time; the card for other currencies; the estimate;
// the entry and the tap's completion in one batch). The person's own tap
// only. A retry after a lost answer finds the tap completed and answers with
// its entry: never a second one.
async function finishWaitingTap(
  request: Request,
  env: CashRouteEnv,
  input: { tapId: string; personId: string; amountMinor: unknown; currency: string }
) {
  const tap = await loadWaitingTap(env.DB, input.tapId);
  if (!tap || tap.person_id !== input.personId) {
    return json({ ok: false, field: "tap", error: "That payment is not one of yours." }, 400);
  }
  if (tap.status === "completed" && tap.entry_id) {
    const entry = await loadPadSavedEntry(env.DB, tap.entry_id);
    if (entry) return json({ ok: true, entry, completedTap: true });
  }
  if (tap.status !== "waiting") {
    return json({ ok: false, field: "tap", error: new WaitingTapNotWaitingError().message }, 409);
  }
  const currency = readCashCurrency(input.currency);
  if (!currency || !isValidCashAmountMinor(input.amountMinor, currency)) {
    return json({ ok: false, field: "amount", error: "Type an amount more than zero." }, 400);
  }
  const minor = input.amountMinor as number;
  const amountText = isZeroDecimalCurrency(currency) ? String(minor / 100) : (minor / 100).toFixed(2);
  const response = await completeWaitingTapWithAmount(env, request, tap, { currency, amountText, completedBy: "app" });
  const answer = await response.json().catch(() => null) as { ok?: boolean; entryId?: string; error?: string } | null;
  if (!response.ok || !answer?.ok || !answer.entryId) {
    // No rate yet (503) waits on the phone like any pad payment.
    return json({ ok: false, ...(response.status === 503 ? { retry: true } : {}), error: answer?.error ?? "This couldn't be saved." }, response.ok ? 500 : response.status);
  }
  const entry = await loadPadSavedEntry(env.DB, answer.entryId);
  return json({ ok: true, entry, completedTap: true });
}

// The "Log cash" Shortcut: authenticated by the caller (the Shortcut key,
// in index.ts), which names the person.
export async function handleShortcutCashRoute(
  request: Request,
  env: CashRouteEnv,
  person: { personId: string; personName: string }
): Promise<Response> {
  try {
    const body = await readJsonObject<Record<string, unknown>>(request, MAX_BODY_BYTES);
    const requestId = body.requestId == null || body.requestId === ""
      ? crypto.randomUUID()
      : readCashRequestId(body.requestId);
    if (!requestId) {
      return json({ ok: false, error: "Missing or invalid requestId. Nothing was saved." }, 400);
    }
    // The amount from the number pad, and/or words ("35000 coffee"). The
    // currency is the pad's default unless the words name one.
    const defaults = await loadCashEntryDefaults(env.DB, { personId: person.personId });
    const spoken = [typeof body.amount === "number" ? String(body.amount) : text(body.amount), text(body.text)]
      .filter(Boolean)
      .join(" ");
    const read = readCashSpokenText(spoken, defaults.currency);
    if (!read || !isValidCashAmountMinor(read.amountMinor, read.currency)) {
      return json({ ok: false, needsAmount: true, error: "Say or type an amount, like 35000 coffee. Nothing was saved." }, 400);
    }
    const saved = await createCashEntry(env.DB, {
      requestId,
      personId: person.personId,
      amountMinor: read.amountMinor,
      currency: read.currency,
      description: read.description || null
    }, { offlineRates: env.FX_RATES_OFFLINE === "true" });
    await afterSave(env, saved, false);
    return json({
      ok: true,
      entryId: saved.entryId,
      created: saved.created,
      notification: describeSavedCash({ description: saved.description, amountMinor: saved.paidAmountMinor, currency: saved.paidCurrency })
    });
  } catch (error) {
    if (error instanceof CashWalletMissingError) {
      // A Shortcut cannot choose: say where to set the wallet.
      return json({ ok: false, error: `No cash wallet for ${person.personName}. Choose one in Monies Map, Settings, Payment ways. Nothing was saved.` }, 409);
    }
    if (error instanceof FxRateUnavailableError) {
      return json({ ok: false, error: error.message }, 503);
    }
    const refused = refusal(error);
    if (refused) return refused;
    console.error("Log cash Shortcut save failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "Monies Map could not save this cash payment. Nothing was saved." }, 500);
  }
}
