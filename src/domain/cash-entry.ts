// Cash entry (DOMAIN.md "Cash Entry"): a cash payment logged with just an
// amount, from the cash pad in the app or the "Log cash" Shortcut. Every
// other field is decided before the person types, from facts the household
// already has:
// - the wallet: the person's cash wallet (DOMAIN.md "Payment Way");
// - the currency: the trip or event on today that has a currency, else the
//   currency of the person's last cash payment in the last 7 days, else the
//   wallet's own currency;
// - the day: today; the person: whose pad or whose Shortcut key it is;
// - the category: the deterministic Category Guess, else Other.
//
// Pure: storage and the save are in app-repository-cash-entries.ts. The
// client imports the currency list, the amount reader and the formatter
// from here, so the pad and the server read amounts the same way.

// Currencies whose notes and coins have no cents in daily use: the pad shows
// "000" and no decimal key, and an amount with cents is refused. ISO 4217's
// zero-decimal codes, plus IDR, whose cent (sen) is not used in practice.
// One config list: add a code here and the pad, the server and the Shortcut
// follow.
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = Object.freeze([
  "BIF", "CLP", "DJF", "GNF", "IDR", "ISK", "JPY", "KMF", "KRW", "LAK", "MMK",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

// How far back "the last currency used for cash" and the Again chips look
// when no trip is on today.
export const CASH_RECENT_DAYS = 7;
export const CASH_AGAIN_LIMIT = 4;
// The description an amount-only payment is saved with.
export const CASH_DEFAULT_DESCRIPTION = "Cash";
export const CASH_DESCRIPTION_MAX_LENGTH = 120;
export const CASH_NOTE_MAX_LENGTH = 500;
// Ten million in any currency is far beyond a cash payment (and well inside
// the ledger's integer range even in IDR minor units).
export const CASH_MAX_AMOUNT_MINOR = 100_000_000_000;
// The external reference prefix (DOMAIN.md "Added by"): a retried save with
// the same request id is the same entry.
export const CASH_REFERENCE_PREFIX = "cash:";

const CURRENCY_CODE = /^[A-Z]{3}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function isZeroDecimalCurrency(currency: string | null | undefined): boolean {
  return ZERO_DECIMAL_CURRENCIES.includes(String(currency ?? "").toUpperCase());
}

export function readCashCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_CODE.test(code) ? code : null;
}

export function readCashRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

export function cashEntryReference(requestId: string) {
  return `${CASH_REFERENCE_PREFIX}${requestId}`;
}

// A positive whole number of minor units (cents) the currency can hold: no
// cents in a zero-decimal currency, nothing over the cap.
export function isValidCashAmountMinor(amountMinor: unknown, currency: string): amountMinor is number {
  return typeof amountMinor === "number"
    && Number.isInteger(amountMinor)
    && amountMinor > 0
    && amountMinor <= CASH_MAX_AMOUNT_MINOR
    && (!isZeroDecimalCurrency(currency) || amountMinor % 100 === 0);
}

export interface CashTripFact {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
  putAway?: boolean;
}

export interface CashRecentFact {
  date: string;
  // The currency the person paid in: the kept original currency of a foreign
  // amount, else the wallet's own.
  currency: string;
}

export type CashCurrencyReason = "trip" | "recent" | "wallet";

export interface CashCurrencyChoice {
  currency: string;
  reason: CashCurrencyReason;
  trip: { id: string; name: string } | null;
}

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The trip or event on today: dated, not put away, today within its dates.
// With several, the one that started last (then by name), so a weekend away
// inside a long stay wins.
export function tripOnToday(trips: readonly CashTripFact[], today: string): CashTripFact | null {
  const on = trips.filter((trip) => !trip.putAway && trip.startDate && trip.endDate && trip.startDate <= today && today <= trip.endDate);
  on.sort((left, right) => String(right.startDate).localeCompare(String(left.startDate)) || left.name.localeCompare(right.name));
  return on[0] ?? null;
}

// The currency the pad opens in: the trip on today's currency, else the
// person's last cash currency in the last 7 days, else the wallet's.
export function chooseCashCurrency(input: {
  today: string;
  trips: readonly CashTripFact[];
  recentCash: readonly CashRecentFact[];
  walletCurrency: string;
}): CashCurrencyChoice {
  const trip = tripOnToday(input.trips, input.today);
  const tripCurrency = readCashCurrency(trip?.currency);
  if (trip && tripCurrency) {
    return { currency: tripCurrency, reason: "trip", trip: { id: trip.id, name: trip.name } };
  }
  const since = addDays(input.today, -CASH_RECENT_DAYS);
  const recent = [...input.recentCash]
    .filter((row) => row.date >= since && row.date <= input.today && readCashCurrency(row.currency))
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (recent) {
    return { currency: readCashCurrency(recent.currency)!, reason: "recent", trip: trip ? { id: trip.id, name: trip.name } : null };
  }
  return { currency: readCashCurrency(input.walletCurrency) ?? "SGD", reason: "wallet", trip: trip ? { id: trip.id, name: trip.name } : null };
}

// "coffee" → "Coffee"; spaces collapsed; "" when nothing is left.
export function tidyCashDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim().slice(0, CASH_DESCRIPTION_MAX_LENGTH);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// The few currency codes a typed or dictated "35000 IDR coffee" may name.
const NAMED_CURRENCY_WORDS: Record<string, string> = {
  rp: "IDR", rupiah: "IDR", idr: "IDR",
  won: "KRW", krw: "KRW",
  yen: "JPY", jpy: "JPY",
  dong: "VND", vnd: "VND",
  baht: "THB", thb: "THB",
  ringgit: "MYR", rm: "MYR", myr: "MYR",
  sgd: "SGD", usd: "USD", eur: "EUR", gbp: "GBP", aud: "AUD", hkd: "HKD", php: "PHP", twd: "TWD", cny: "CNY", inr: "INR"
};

// One figure as typed: "35000", "35,000", "35.000" (a dot as the thousands
// mark, groups of three only), "3.50", "1,234.50". In a zero-decimal
// currency a figure with cents is refused. Returns minor units (x100).
export function readCashFigure(text: string, currency: string): number | null {
  const figure = text.trim();
  if (!/^\d[\d,.]*$/.test(figure)) return null;
  const zero = isZeroDecimalCurrency(currency);
  let major: number;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(figure) || /^\d+(\.\d{1,2})?$/.test(figure)) {
    // "1,234.50", "35000", "3.5". A lone dot with three figures after it in
    // a zero-decimal currency is the thousands mark ("35.000").
    if (zero && /^\d{1,3}\.\d{3}$/.test(figure)) {
      major = Number(figure.replace(".", ""));
    } else {
      major = Number(figure.replace(/,/g, ""));
    }
  } else if (/^\d{1,3}(\.\d{3})+$/.test(figure)) {
    // "1.234.567": dots as thousands marks.
    major = Number(figure.replace(/\./g, ""));
  } else {
    return null;
  }
  if (!Number.isFinite(major)) return null;
  const minor = Math.round(major * 100);
  return isValidCashAmountMinor(minor, currency) ? minor : null;
}

// What the "Log cash" Shortcut was given: an amount (from its number pad)
// and/or words ("35000 coffee", "coffee 35,000", "35000 rupiah coffee").
// The first figure is the amount; a currency word next to it names the
// currency; the other words are the description.
export function readCashSpokenText(text: string, defaultCurrency: string): { amountMinor: number; currency: string; description: string } | null {
  const tokens = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let currency = readCashCurrency(defaultCurrency) ?? "SGD";
  const words: string[] = [];
  let figure: string | null = null;
  for (const token of tokens) {
    const lower = token.toLowerCase().replace(/[^a-z]/g, "");
    // "Rp35.000": a currency sign stuck to the figure.
    const stuck = token.match(/^(rp|rm|\$|s\$)([\d][\d,.]*)$/i);
    if (stuck && figure === null) {
      const sign = stuck[1].toLowerCase();
      if (sign === "rp") currency = "IDR";
      else if (sign === "rm") currency = "MYR";
      figure = stuck[2];
      continue;
    }
    if (figure === null && /^\d[\d,.]*$/.test(token)) {
      figure = token;
      continue;
    }
    if (lower && NAMED_CURRENCY_WORDS[lower] && token.length <= 7) {
      currency = NAMED_CURRENCY_WORDS[lower];
      continue;
    }
    words.push(token);
  }
  if (figure === null) return null;
  const amountMinor = readCashFigure(figure.replace(/[.,]$/, ""), currency);
  if (amountMinor === null) return null;
  return { amountMinor, currency, description: tidyCashDescription(words.join(" ")) };
}

// The pad's typed keys as minor units: "35000" → 3,500,000; "3.5" → 350.
// Empty or "0" is null (nothing to save).
export function padTextToMinor(padText: string, currency: string): number | null {
  if (!padText || padText === "." ) return null;
  const minor = readCashFigure(padText.endsWith(".") ? padText.slice(0, -1) : padText, currency);
  return minor && minor > 0 ? minor : null;
}

// One key on the pad: digits, "000", "." and backspace. Keeps the text a
// figure the currency can hold: no decimal key in a zero-decimal currency,
// at most two figures after the dot, no leading zeros, at most 12 figures.
export function pressCashPadKey(padText: string, key: string, currency: string): string {
  const zero = isZeroDecimalCurrency(currency);
  if (key === "back") return padText.slice(0, -1);
  if (key === "clear") return "";
  if (key === ".") {
    if (zero || padText.includes(".")) return padText;
    return padText ? `${padText}.` : "0.";
  }
  if (!/^(\d|000)$/.test(key)) return padText;
  const [whole, cents] = padText.split(".");
  if (cents !== undefined) {
    return cents.length >= 2 || key === "000" ? padText : `${padText}${key}`;
  }
  if (!whole || whole === "0") {
    return key === "000" || key === "0" ? "" : key;
  }
  const next = `${whole}${key}`;
  return next.length > 12 ? padText : next;
}

// The pad's big number as typed, grouped: "35000" → "35,000", "3.5" → "3.5".
export function groupCashPadText(padText: string): string {
  if (!padText) return "0";
  const [whole, cents] = padText.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === undefined ? grouped : `${grouped}.${cents}`;
}

// "Rp 35,000", "₩35,000", "$3.50", "US$3.50": the narrow sign where it is
// unambiguous in Singapore, whole units in a zero-decimal currency.
export function formatCashAmount(amountMinor: number, currency: string): string {
  const code = readCashCurrency(currency) ?? "SGD";
  const digits = isZeroDecimalCurrency(code) ? 0 : 2;
  const options = (display: "narrowSymbol" | "symbol") => new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: code,
    currencyDisplay: display,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  try {
    const narrow = options("narrowSymbol").format(amountMinor / 100);
    // "$" is Singapore's dollar here; any other dollar keeps its own sign.
    const shown = code !== "SGD" && narrow.startsWith("$") ? options("symbol").format(amountMinor / 100) : narrow;
    // A plain space, so a notification or a test reads "Rp 35,000".
    return shown.replace(/[  ]/g, " ");
  } catch {
    return `${code} ${(amountMinor / 100).toFixed(digits)}`;
  }
}

// An Again chip's amount without the sign: "35,000", "3.50".
export function formatCashFigure(amountMinor: number, currency: string): string {
  const digits = isZeroDecimalCurrency(currency) ? 0 : 2;
  return new Intl.NumberFormat("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / 100);
}

export interface CashAgainSource {
  date: string;
  description: string;
  // In the currency paid: the kept original amount of a foreign one.
  amountMinor: number;
  currency: string;
  categoryName: string | null;
  note: string | null;
}

export interface CashAgainChip {
  description: string;
  amountMinor: number;
  currency: string;
  categoryName: string | null;
  note: string | null;
}

// Up to four recent cash payments to repeat, newest first, each shop and
// amount once. Rows come already limited to this person, this trip (or the
// last 7 days) and their cash wallet.
export function buildCashAgainChips(rows: readonly CashAgainSource[]): CashAgainChip[] {
  const seen = new Set<string>();
  const chips: CashAgainChip[] = [];
  const sorted = [...rows].sort((left, right) => right.date.localeCompare(left.date));
  for (const row of sorted) {
    if (!row.description || !(row.amountMinor > 0)) continue;
    // A plain "Cash" in Other says nothing worth repeating.
    if (row.description === CASH_DEFAULT_DESCRIPTION && (!row.categoryName || row.categoryName === "Other")) continue;
    const key = `${row.description.toLowerCase()}|${row.amountMinor}|${row.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ description: row.description, amountMinor: row.amountMinor, currency: row.currency, categoryName: row.categoryName, note: row.note });
    if (chips.length >= CASH_AGAIN_LIMIT) break;
  }
  return chips;
}

// The Shortcut's reply notification: "Saved: Coffee, Rp 35,000 cash".
export function describeSavedCash(input: { description: string; amountMinor: number; currency: string }) {
  return `Saved: ${input.description}, ${formatCashAmount(input.amountMinor, input.currency)} cash`;
}
