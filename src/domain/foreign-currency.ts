// Foreign-currency Wallet amounts (DOMAIN.md, "Foreign Currency Estimate").
// A card in one currency can be charged in another: an Amaze card in
// Singapore turns a purchase in Bali (IDR) into an SGD charge on the linked
// card. The Apple Pay Shortcut only sees the IDR amount, so the entry is
// saved in the card's currency at the day's exchange rate, and the original
// amount is kept for the statement to settle later.
//
// Rates come from free, keyless public sources (European Central Bank rates
// through Frankfurter first, ExchangeRate-API's open endpoint second). Only
// the two currency codes are sent. The last rate per pair is saved so a
// network failure on holiday does not lose the purchase.
export class FxRateUnavailableError extends Error {}

export interface ForeignAmountConversion {
  amountMinor: number;
  // How many units of the foreign currency one unit of the account's
  // currency buys, as published (1 SGD = 14,025 IDR).
  quotePerBase: number;
  rateDate: string;
  source: "frankfurter" | "open.er-api";
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

// A saved rate is used without asking the network for this long, and as a
// fallback when every source is down for this long.
const FRESH_RATE_MS = 12 * 60 * 60 * 1000;
const FALLBACK_RATE_MS = 14 * 24 * 60 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 3000;

export async function convertForeignAmount(db: D1Database, input: {
  amountMinor: number;
  fromCurrency: string;
  toCurrency: string;
  fetchImpl?: FetchImpl;
  offline?: boolean;
  now?: number;
}): Promise<ForeignAmountConversion> {
  const base = input.toCurrency.toUpperCase();
  const quote = input.fromCurrency.toUpperCase();
  const now = input.now ?? Date.now();
  await ensureFxRatesTable(db);
  const saved = await db
    .prepare("SELECT quote_per_base, rate_date, source, fetched_at FROM fx_rates WHERE base_currency = ? AND quote_currency = ?")
    .bind(base, quote)
    .first<{ quote_per_base: number; rate_date: string; source: ForeignAmountConversion["source"]; fetched_at: string }>();
  const savedAge = saved ? now - Date.parse(saved.fetched_at) : Infinity;

  let rate = saved && savedAge <= FRESH_RATE_MS
    ? { quotePerBase: Number(saved.quote_per_base), rateDate: saved.rate_date, source: saved.source }
    : undefined;
  if (!rate && !input.offline) {
    rate = await fetchRate(base, quote, input.fetchImpl ?? ((url, init) => fetch(url, init)));
    if (rate) {
      await db
        .prepare(`
          INSERT OR REPLACE INTO fx_rates (base_currency, quote_currency, quote_per_base, rate_date, source, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(base, quote, rate.quotePerBase, rate.rateDate, rate.source, new Date(now).toISOString())
        .run();
    }
  }
  if (!rate && saved && savedAge <= FALLBACK_RATE_MS) {
    rate = { quotePerBase: Number(saved.quote_per_base), rateDate: saved.rate_date, source: saved.source };
  }
  if (!rate) {
    throw new FxRateUnavailableError(`Couldn't get today's ${quote} to ${base} exchange rate. Nothing was saved. Run the Shortcut again in a minute.`);
  }

  return { ...rate, amountMinor: Math.max(1, Math.round(input.amountMinor / rate.quotePerBase)) };
}

// The note saved on the entry, in plain words.
export function describeForeignAmount(input: {
  originalAmountMinor: number;
  originalCurrency: string;
  accountCurrency: string;
  conversion: ForeignAmountConversion;
}) {
  const rate = new Intl.NumberFormat("en-SG", { maximumFractionDigits: input.conversion.quotePerBase >= 100 ? 0 : 4 }).format(input.conversion.quotePerBase);
  return `Paid ${formatForeignAmount(input.originalAmountMinor, input.originalCurrency)}. Saved as about ${formatForeignAmount(input.conversion.amountMinor, input.accountCurrency, 2)} at 1 ${input.accountCurrency} = ${rate} ${input.originalCurrency} (${formatRateDate(input.conversion.rateDate)}). Your card's ${input.accountCurrency} amount may differ.`;
}

// "IDR 159,000": whole units when the amount has no cents.
export function formatForeignAmount(amountMinor: number, currency: string, fixedDigits?: number) {
  const major = amountMinor / 100;
  const digits = fixedDigits ?? (Number.isInteger(major) ? 0 : 2);
  return `${currency} ${new Intl.NumberFormat("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major)}`;
}

async function fetchRate(base: string, quote: string, fetchImpl: FetchImpl) {
  // 1 base = N quote keeps full precision for weak currencies (1 SGD =
  // 14,025 IDR, not 1 IDR = 0.000071 SGD).
  const sources: [ForeignAmountConversion["source"], string, (body: Record<string, unknown>) => { quotePerBase?: number; rateDate?: string }][] = [
    ["frankfurter", `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`, (body) => ({
      quotePerBase: Number((body.rates as Record<string, unknown> | undefined)?.[quote]),
      rateDate: typeof body.date === "string" ? body.date : undefined
    })],
    ["open.er-api", `https://open.er-api.com/v6/latest/${base}`, (body) => ({
      quotePerBase: body.result === "success" ? Number((body.rates as Record<string, unknown> | undefined)?.[quote]) : undefined,
      rateDate: typeof body.time_last_update_utc === "string" ? new Date(body.time_last_update_utc).toISOString().slice(0, 10) : undefined
    })]
  ];
  for (const [source, url, read] of sources) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), headers: { accept: "application/json" } });
      if (!response.ok) {
        continue;
      }
      const { quotePerBase, rateDate } = read(await response.json() as Record<string, unknown>);
      if (quotePerBase && Number.isFinite(quotePerBase) && quotePerBase > 0 && rateDate && /^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
        return { quotePerBase, rateDate, source };
      }
    } catch {
      // Try the next source.
    }
  }
  return undefined;
}

function formatRateDate(rateDate: string) {
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${rateDate}T00:00:00Z`));
}

async function ensureFxRatesTable(db: D1Database) {
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS fx_rates (
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        quote_per_base REAL NOT NULL,
        rate_date TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (base_currency, quote_currency)
      )
    `)
    .run();
}
