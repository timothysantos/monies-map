// Cash payments waiting to send (DOMAIN.md "Cash Entry", "Waiting to send";
// docs/flows/cash-entry-flow.md). A Save that cannot reach the server for a
// network reason (no signal, a timeout, the server busy or without today's
// rate) is kept on this device, shown in the cash pad as "Waiting to send",
// and sent again when the connection returns or the app is opened again.
// Each one carries the request id it was first sent with, so a retry after
// an answer that never arrived is the same entry on the server, never a
// second one. The person can remove one that is waiting.
//
// A waiting payment is this device's own, not server data: it never joins
// an Entries list or a total until the server confirms it, and then the
// page refreshes through its data owner (onSaved).
//
// Ships in Ask's lazy chunk (ask-panel.jsx re-exports flushCashQueue); App.jsx
// loads that chunk only when this device has something waiting (CASH_QUEUE_KEY).

// This device's storage, or null when the browser blocks it (the same
// guard as device-storage.js, kept here so this lazy file does not split
// that one out of the first screen's chunks).
/** @returns {Storage | null} */
export function deviceStorage() {
  try {
    const host = typeof window !== "undefined" && window ? window : globalThis;
    return host.localStorage ?? null;
  } catch {
    return null;
  }
}

export const CASH_QUEUE_KEY = "monies.cashWaiting.v1";
export const CASH_CREATE_ENDPOINT = "/api/cash-entries/create";
// An Ask card saved with no connection waits in the same list (docs/flows/
// ask-flow.md "No connection"): only a plain expense, one create request
// whose `ask:<card id>` reference makes a repeat return the entry it
// already made. Splits, transfers and income never wait.
export const ENTRY_CREATE_ENDPOINT = "/api/entries/create";
const QUEUE_ENDPOINTS = new Set([CASH_CREATE_ENDPOINT, ENTRY_CREATE_ENDPOINT]);
export const CASH_DEFAULTS_ENDPOINT = "/api/cash-entries/defaults";
const SEND_TIMEOUT_MS = 12_000;
// The pad never keeps more than this many waiting payments on a device.
const MAX_WAITING = 50;

const listeners = new Set();

/**
 * @typedef {{ requestId: string, body: Record<string, any>, label: { description: string, amountMinor: number, currency: string }, queuedAt: string, error?: string, endpoint?: string }} WaitingCash
 */

/** @returns {WaitingCash[]} */
export function readCashQueue(storage = deviceStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(CASH_QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.requestId === "string" && item.body && typeof item.body === "object" && (item.endpoint === undefined || QUEUE_ENDPOINTS.has(item.endpoint)))
      : [];
  } catch {
    return [];
  }
}

function writeCashQueue(items, storage = deviceStorage()) {
  try {
    if (items.length) {
      storage?.setItem(CASH_QUEUE_KEY, JSON.stringify(items.slice(-MAX_WAITING)));
    } else {
      storage?.removeItem(CASH_QUEUE_KEY);
    }
  } catch {
    // A full or blocked store: the pad still shows the payment for as long
    // as it is open, and says it could not keep it.
  }
  for (const listener of listeners) listener(items);
}

/** Keeps one payment waiting (or updates it), by its request id. */
export function keepWaitingCash(item, storage = deviceStorage()) {
  const items = readCashQueue(storage);
  const index = items.findIndex((existing) => existing.requestId === item.requestId);
  // An update keeps its place, so the oldest payment still sends first.
  writeCashQueue(index === -1 ? [...items, item] : items.map((existing, at) => (at === index ? item : existing)), storage);
}

export function removeWaitingCash(requestId, storage = deviceStorage()) {
  writeCashQueue(readCashQueue(storage).filter((item) => item.requestId !== requestId), storage);
}

/** Calls `listener(items)` when the waiting list changes here or in another tab. */
export function subscribeCashQueue(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === CASH_QUEUE_KEY) listener(readCashQueue());
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const sentListeners = new Set();
// The payments sent from this page so far: a page that opens after the send
// can still tell a line that said "Waiting to send" that it went.
const sentRequestIds = new Set();

export function wasCashSent(requestId) {
  return sentRequestIds.has(requestId);
}

/**
 * Calls `listener(requestId)` each time a waiting payment is sent from this
 * page (a payment the person removed is not sent), so a line that said
 * "Waiting to send" can say it went.
 */
export function subscribeCashSent(listener) {
  sentListeners.add(listener);
  return () => {
    sentListeners.delete(listener);
  };
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * One send of a cash payment. Never throws.
 * - "saved": the server has it (new, or the same request saved before).
 * - "waiting": a network reason (offline, timeout, 5xx, 429, or no exchange
 *   rate yet, `error: "rate"`): try again later.
 * - "refused": the server said no (a 4xx); `needsWallet` asks which wallet,
 *   `offerTap` names the Apple Pay tap on that card it may be (nothing saved).
 * @returns {Promise<{ kind: "saved", entry: any } | { kind: "waiting", error: string } | { kind: "refused", error: string, needsWallet?: boolean, walletChoices?: any[], offerTap?: any }>}
 */
export async function sendCashEntry(body, { fetchImpl = fetch, timeoutMs = SEND_TIMEOUT_MS, endpoint = CASH_CREATE_ENDPOINT } = {}) {
  if (isOffline()) {
    return { kind: "waiting", error: "offline" };
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller?.signal,
      cache: "no-store"
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok && data?.ok && data.entry?.entryId) {
      return { kind: "saved", entry: data.entry };
    }
    // An Ask card's create answers with the entry's id (the one it already
    // made, for a repeat); the page needs its id and month.
    if (endpoint === ENTRY_CREATE_ENDPOINT && response.ok && typeof data?.entryId === "string") {
      return { kind: "saved", entry: { entryId: data.entryId, date: String(body.date ?? ""), description: String(body.description ?? "") } };
    }
    if (response.status >= 500 || response.status === 429 || response.status === 408 || data === null) {
      // "rate": the server has no exchange rate for the currency yet.
      return { kind: "waiting", error: data?.retry ? "rate" : String(response.status) };
    }
    return {
      kind: "refused",
      error: String(data?.error ?? "This couldn't be saved."),
      ...(data?.needsWallet ? { needsWallet: true, walletChoices: Array.isArray(data.walletChoices) ? data.walletChoices : [] } : {}),
      ...(data?.offerTap && typeof data.offerTap.id === "string" ? { offerTap: data.offerTap } : {})
    };
  } catch {
    return { kind: "waiting", error: "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let flushing = null;

/**
 * Sends every waiting payment, oldest first, one at a time. A saved one
 * leaves the list (onSaved), a refused one stays with its reason for the
 * person to see and remove, and the first that still cannot be sent stops
 * the round (the connection is still down). One round at a time.
 */
export function flushCashQueue({ fetchImpl = fetch, storage = deviceStorage(), onSaved = (_entry) => {} } = {}) {
  if (flushing) return flushing;
  const round = async () => {
    let sent = 0;
    for (const item of readCashQueue(storage)) {
      if (item.error) continue;
      const result = await sendCashEntry(item.body, { fetchImpl, endpoint: item.endpoint ?? CASH_CREATE_ENDPOINT });
      if (result.kind === "waiting") break;
      if (result.kind === "saved") {
        removeWaitingCash(item.requestId, storage);
        sent += 1;
        onSaved(result.entry);
        sentRequestIds.add(item.requestId);
        for (const listener of sentListeners) listener(item.requestId);
      } else {
        keepWaitingCash({ ...item, error: result.error }, storage);
      }
    }
    return sent;
  };
  // Cleared after the round settles (a microtask later), never before it is
  // stored: an empty list finishes at once, and a clear inside the round
  // would run before this assignment and leave a finished round in place.
  flushing = round().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** A request id for one Save: kept for every retry of that payment. */
export function newCashRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `cash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * What the cash pad opens with (GET /api/cash-entries/defaults). Fails soft:
 * null when it cannot be read, and the pad uses what it last read on this
 * device (rememberCashDefaults), so it opens with no signal too.
 */
export async function requestCashDefaults(personId, { fetchImpl = fetch, signal = undefined } = {}) {
  try {
    const response = await fetchImpl(`${CASH_DEFAULTS_ENDPOINT}?person=${encodeURIComponent(personId)}`, { signal, cache: "no-store" });
    const data = await response.json();
    return response.ok && data?.ok && data.defaults ? data.defaults : null;
  } catch {
    return null;
  }
}

const DEFAULTS_KEY = "monies.cashDefaults.v1";

// The last defaults read for each person on this device: the pad opens on
// them when the read fails (bad signal). Names and the currency only, never
// amounts: the Again chips are left out.
export function rememberCashDefaults(defaults, storage = deviceStorage()) {
  try {
    const all = JSON.parse(storage?.getItem(DEFAULTS_KEY) ?? "{}") ?? {};
    all[defaults.personId] = { ...defaults, again: [], undescribed: [] };
    storage?.setItem(DEFAULTS_KEY, JSON.stringify(all));
  } catch {
    // Not remembered: the pad still works when it can read them.
  }
}

export function rememberedCashDefaults(personId, storage = deviceStorage()) {
  try {
    const all = JSON.parse(storage?.getItem(DEFAULTS_KEY) ?? "{}") ?? {};
    return all[personId] ?? null;
  } catch {
    return null;
  }
}
