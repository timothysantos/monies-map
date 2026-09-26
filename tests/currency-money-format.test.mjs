import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrencyMinor } from "../src/domain/split-currency.ts";
import { money, moneyWithCurrency } from "../src/client/formatters.js";

// Split amounts are stored in hundredths of their own currency whatever its
// minor unit (a ¥12,000 expense is amountMinor 1_200_000, see DOMAIN.md
// `split currency`). Display must use the currency's own fraction digits.

test("a yen amount shows whole yen, not dollars or hundredths", () => {
  assert.equal(formatCurrencyMinor(1_200_000, "JPY"), "JP¥12,000");
  assert.equal(formatCurrencyMinor(600_000, "JPY"), "JP¥6,000");
  assert.equal(formatCurrencyMinor(-600_000, "JPY"), "-JP¥6,000");
  assert.equal(formatCurrencyMinor(1_200_000, "KRW"), "₩12,000");
});

test("a home-currency amount keeps two decimals and the $ symbol", () => {
  assert.equal(formatCurrencyMinor(1_200_000, "SGD"), "$12,000.00");
  assert.equal(formatCurrencyMinor(26_025, "SGD"), "$260.25");
  assert.equal(formatCurrencyMinor(1_234, "USD"), "US$12.34");
});

test("a three-decimal currency shows its third decimal", () => {
  assert.equal(formatCurrencyMinor(123_450, "KWD"), "KWD 1,234.500");
  assert.equal(formatCurrencyMinor(123_450, "BHD"), "BHD 1,234.500");
});

test("stored hundredths that are not whole units are never hidden", () => {
  // A yen record typed as 12000.50 keeps its stored half yen on screen
  // instead of silently rounding to JP¥12,001.
  assert.equal(formatCurrencyMinor(1_200_050, "JPY"), "JP¥12,000.50");
  // The smallest stored step, used by the odd-cent choice.
  assert.equal(formatCurrencyMinor(1, "JPY"), "JP¥0.01");
  assert.equal(formatCurrencyMinor(1, "SGD"), "$0.01");
  assert.equal(formatCurrencyMinor(1, "KWD"), "KWD 0.010");
});

test("the currency code is normalized the way the server stores it", () => {
  assert.equal(formatCurrencyMinor(1_200_000, " jpy "), "JP¥12,000");
  // A malformed or missing code (for example a half-typed "JP") falls back to
  // the home currency, like normalizeSplitCurrency, instead of throwing.
  assert.equal(formatCurrencyMinor(1_200_000, "JP"), "$12,000.00");
  assert.equal(formatCurrencyMinor(1_200_000, undefined), "$12,000.00");
  assert.equal(formatCurrencyMinor(1_200_000, null), "$12,000.00");
});

test("moneyWithCurrency formats in the given currency and money stays in SGD", () => {
  assert.equal(moneyWithCurrency(1_200_000, "JPY"), "JP¥12,000");
  assert.equal(moneyWithCurrency(1_200_000), "$12,000.00");
  assert.equal(money(1_200_000), "$12,000.00");
});

test("money privacy still hides group-currency and home-currency amounts", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: { moneyPrivacy: "hidden" } } };
  try {
    assert.equal(moneyWithCurrency(1_200_000, "JPY"), "••••");
    assert.equal(moneyWithCurrency(123_450, "KWD"), "••••");
    assert.equal(money(1_200_000), "••••");
    globalThis.document.documentElement.dataset.moneyPrivacy = "visible";
    assert.equal(moneyWithCurrency(1_200_000, "JPY"), "JP¥12,000");
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});
