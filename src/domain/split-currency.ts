const CURRENCY_CODE = /^[A-Z]{3}$/;

export function normalizeSplitCurrency(value: unknown, fallback = "SGD") {
  const currency = String(value ?? "").trim().toUpperCase();
  return CURRENCY_CODE.test(currency) ? currency : fallback;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, fractionDigits?: number) {
  const key = `${currency}:${fractionDigits ?? "default"}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency,
      ...(fractionDigits === undefined ? {} : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

// Every stored amount is in hundredths of its own currency, whatever that
// currency's minor unit: ¥12,000 is amountMinor 1_200_000. Display uses the
// currency's own fraction digits (Intl resolves JPY to 0, SGD to 2, KWD to 3)
// and widens to two only when the stored hundredths are not whole units, so
// no stored precision is hidden. A malformed code falls back to SGD exactly
// as normalizeSplitCurrency stores it.
export function formatCurrencyMinor(amountMinor: number, currency: unknown) {
  const code = normalizeSplitCurrency(currency);
  const value = Number(amountMinor ?? 0);
  const formatter = currencyFormatter(code);
  const ownDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  if (ownDigits < 2 && value % 100 !== 0) {
    return currencyFormatter(code, 2).format(value / 100);
  }
  return formatter.format(value / 100);
}

export function convertMinorAmount(amountMinor: number, rateBasisPoints: number) {
  if (!Number.isSafeInteger(amountMinor) || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints <= 0) {
    throw new Error("FX conversion requires a positive integer rate.");
  }

  return Math.round((amountMinor * rateBasisPoints) / 10000);
}

export function calculateFxRateBasisPoints(foreignMinor: number, homeMinor: number) {
  if (!Number.isSafeInteger(foreignMinor) || foreignMinor <= 0 || !Number.isSafeInteger(homeMinor) || homeMinor <= 0) {
    throw new Error("FX conversion requires positive amounts.");
  }

  return Math.round((homeMinor * 10000) / foreignMinor);
}

export function isCurrencyMatch(left: unknown, right: unknown) {
  return normalizeSplitCurrency(left) === normalizeSplitCurrency(right);
}
