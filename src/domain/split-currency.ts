const CURRENCY_CODE = /^[A-Z]{3}$/;

export function normalizeSplitCurrency(value: unknown, fallback = "SGD") {
  const currency = String(value ?? "").trim().toUpperCase();
  return CURRENCY_CODE.test(currency) ? currency : fallback;
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
