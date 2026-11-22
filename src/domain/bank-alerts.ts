// Bank alerts (DOMAIN.md "Bank Alert"): the pure reader for the text of a
// bank's payment alert, and which waiting tap it finishes. Deterministic,
// never AI. Nothing here keeps the text: callers get only the amount, its
// currency and a scrubbed shop name, or "nothing" with a reason code.
// Every pattern and window lives in bank-alerts-config.ts.

import { redactText, scrubName } from "./ask-turn";
import {
  BANK_ALERT_CURRENCY_CODES,
  BANK_ALERT_CURRENCY_SIGNS,
  BANK_ALERT_MATCH_AFTER_SECONDS,
  BANK_ALERT_MATCH_BEFORE_SECONDS,
  BANK_ALERT_MAX_TEXT_CHARS,
  BANK_ALERT_MERCHANT_PREFIXES,
  BANK_ALERT_NOT_A_PAYMENT,
  BANK_ALERT_NOT_THE_PAYMENT_BEFORE,
  BANK_ALERT_NOT_THE_PAYMENT_LOOKBACK_CHARS,
  BANK_ALERT_ONE_TIME_CODE,
  BANK_ALERT_ONE_TIME_CODE_WORDS,
  BANK_ALERT_READ_CHARS,
  BANK_ALERT_WORDINGS,
  BANK_ALERT_ZERO_DECIMAL_CURRENCIES,
  type BankAlertWording
} from "./bank-alerts-config";
import { isCardMerchantPrefixMatch } from "./statement-row-matching";
import { normalizeShortcutAmount } from "./shortcut-entry-contract";
import { merchantsAgree, secondsBetween, type WaitingTapFact } from "./waiting-taps";

export type BankAlertNothingReason =
  | "empty"
  | "one_time_code"
  | "not_a_payment"
  | "no_amount"
  | "several_amounts"
  | "unknown_wording"
  | "no_merchant";

export type BankAlertReading =
  | {
    kind: "payment";
    currency: string;
    // The amount as plain figures ("150000", "12.34"), read the way the
    // Shortcut's own amounts are ("IDR 150000" through normalizeShortcutAmount).
    amountText: string;
    amountMinor: number;
    // The shop as the alert names it, digits scrubbed; prefixes kept.
    merchant: string;
    wordingId: string;
  }
  | { kind: "nothing"; reason: BankAlertNothingReason };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SIGNS = Object.keys(BANK_ALERT_CURRENCY_SIGNS).sort((left, right) => right.length - left.length);
const CURRENCY = `(?:${[...BANK_ALERT_CURRENCY_CODES, ...SIGNS].map(escape).join("|")})`;
const NUMBER = String.raw`(?:\d{1,3}(?:[,.]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d])`;
const MONEY = String.raw`(?:(?<![A-Za-z])${CURRENCY}\s?${NUMBER}|(?<![\d.,])${NUMBER}\s?${CURRENCY}(?![A-Za-z]))`;
// A converted figure in brackets right after the payment: "(≈ SGD 12.80)".
const CONVERTED = String.raw`\s*\(\s*(?:≈|~|approx\.?|about)?\s*${MONEY}\s*\)`;
const MERCHANT_END = String.raw`(?=\s+(?:on|with|using|via|for)\s|\.(?:\s|$)|;|\s*\n|\s*$)`;

function compileWording(wording: BankAlertWording) {
  const source = wording.pattern
    .replace("{money}", `(?<money>${MONEY})(?:${CONVERTED})?`)
    .replace("{merchantLine}", String.raw`(?<merchant>[^\n]+)`)
    .replace("{merchant}", String.raw`(?<merchant>[^\n]+?)${MERCHANT_END}`);
  return { wording, regex: new RegExp(source, "i") };
}

const COMPILED = BANK_ALERT_WORDINGS.map(compileWording);
const MONEY_PARTS = new RegExp(String.raw`^(?:(${CURRENCY})\s?(${NUMBER})|(${NUMBER})\s?(${CURRENCY}))$`, "i");

// "SGD 1,234.50", "Rp150.000", "12.34 USD": the currency code and the
// amount as plain figures, or null when it is not money this reader trusts.
export function readMoney(text: string): { currency: string; amountText: string; amountMinor: number } | null {
  const parts = MONEY_PARTS.exec(text.trim());
  if (!parts) {
    return null;
  }
  const mark = (parts[1] ?? parts[4]).toUpperCase();
  const figures = parts[2] ?? parts[3];
  const currency = BANK_ALERT_CURRENCY_CODES.includes(mark) ? mark : BANK_ALERT_CURRENCY_SIGNS[mark];
  if (!currency) {
    return null;
  }
  let amountText: string;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(figures) && (figures.split(".").length > 2 || BANK_ALERT_ZERO_DECIMAL_CURRENCIES.includes(currency))) {
    amountText = figures.replace(/\./g, "");
  } else if (figures.includes(",")) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(figures)) {
      return null;
    }
    amountText = figures.replace(/,/g, "");
  } else if (/^\d+(?:\.\d{1,2})?$/.test(figures)) {
    amountText = figures;
  } else {
    return null;
  }
  const normalized = normalizeShortcutAmount(undefined, `${currency} ${amountText}`);
  if (!normalized || normalized.currency !== currency) {
    return null;
  }
  return { currency, amountText, amountMinor: normalized.amountMinor };
}

// Card and account numbers out, before anything else is read: a full card,
// account or phone number (8 or more figures, even in groups), an NRIC, the
// last digits after "ending", "card", "a/c" or "account", and masked forms
// ("XXXX-1234", "*1234"). Line breaks stay, for alerts written as labels.
export function scrubAlertNumbers(text: string) {
  return text
    .split("\n")
    .map((line) => redactText(line, BANK_ALERT_MAX_TEXT_CHARS)
      .replace(/\[number\]/g, " ")
      .replace(/(?:(?:[xX*•·]{2,}|\*)[\s-]?)+\d{2,6}\b/g, " ")
      .replace(
        /\b(ending(?:\s+(?:in|with))?|card(?:\s+(?:no\.?|number))?|a\/c(?:\s+no\.?)?|acct\.?|account(?:\s+(?:no\.?|number))?)(\s*[:#]?\s*)\d[\d -]*\d\b/gi,
        "$1 "
      )
      .replace(/[ \t]+/g, " ")
      .trim())
    .join("\n");
}

// A one-time code (a word like "OTP" and a 6 to 8 figure code). Read only to
// drop the whole text.
export function looksLikeOneTimeCode(text: string) {
  return BANK_ALERT_ONE_TIME_CODE_WORDS.test(text) && BANK_ALERT_ONE_TIME_CODE.test(text);
}

// The distinct payment amounts in the alert's first part: a balance or limit
// and a converted figure in brackets right after an amount do not count.
function paymentAmounts(text: string) {
  const found = new Set<string>();
  let previousEnd = -1;
  for (const match of text.matchAll(new RegExp(MONEY, "gi"))) {
    const start = match.index ?? 0;
    const converted = previousEnd >= 0 && /^\s*\(\s*(?:≈|~|approx\.?|about)?\s*$/i.test(text.slice(previousEnd, start));
    previousEnd = start + match[0].length;
    if (converted || BANK_ALERT_NOT_THE_PAYMENT_BEFORE.test(text.slice(Math.max(0, start - BANK_ALERT_NOT_THE_PAYMENT_LOOKBACK_CHARS), start))) {
      continue;
    }
    const money = readMoney(match[0]);
    if (money) {
      found.add(`${money.currency} ${money.amountMinor}`);
    }
  }
  return found;
}

function cleanMerchant(value: string) {
  return scrubName(value.replace(/\s+/g, " ").replace(/[\s.,:;!-]+$/, "").trim());
}

/**
 * Reads a bank's payment alert: the payment's amount, currency and shop, or
 * nothing. A one-time code is dropped before anything is read; card and
 * account digits are scrubbed first; money in, sign-ins, refunds, declined
 * payments, transfers and promotions, two different amounts, or a wording no
 * entry in the config knows read as nothing.
 */
export function readBankAlert(input: string): BankAlertReading {
  const text = String(input ?? "").normalize("NFKC").replace(/\r\n?/g, "\n").slice(0, BANK_ALERT_MAX_TEXT_CHARS);
  if (!text.trim()) {
    return { kind: "nothing", reason: "empty" };
  }
  if (looksLikeOneTimeCode(text)) {
    return { kind: "nothing", reason: "one_time_code" };
  }
  const scrubbed = scrubAlertNumbers(text);
  const head = scrubbed.slice(0, BANK_ALERT_READ_CHARS);
  if (BANK_ALERT_NOT_A_PAYMENT.test(head)) {
    return { kind: "nothing", reason: "not_a_payment" };
  }
  const amounts = paymentAmounts(head);
  if (amounts.size === 0) {
    return { kind: "nothing", reason: "no_amount" };
  }
  if (amounts.size > 1) {
    return { kind: "nothing", reason: "several_amounts" };
  }
  for (const { wording, regex } of COMPILED) {
    const match = regex.exec(head);
    if (!match?.groups) {
      continue;
    }
    const money = readMoney(match.groups.money);
    if (!money) {
      continue;
    }
    const merchant = cleanMerchant(match.groups.merchant ?? "");
    if (!merchant) {
      return { kind: "nothing", reason: "no_merchant" };
    }
    return { kind: "payment", ...money, merchant, wordingId: wording.id };
  }
  return { kind: "nothing", reason: "unknown_wording" };
}

// The alert's shop and the tap's agree: the waiting-tap rule
// (merchantsAgree) once a payment app's prefix is dropped, or the import's
// AMAZE* rule on the name as the alert prints it.
export function alertMerchantAgrees(alertMerchant: string, tapMerchant: string) {
  const stripped = BANK_ALERT_MERCHANT_PREFIXES.reduce((name, prefix) => name.replace(prefix, ""), alertMerchant).trim();
  if (!stripped || !tapMerchant.trim()) {
    return false;
  }
  return merchantsAgree(stripped, tapMerchant) || isCardMerchantPrefixMatch(alertMerchant, tapMerchant);
}

export type BankAlertTapMatch =
  | { outcome: "one"; tap: WaitingTapFact }
  | { outcome: "none" }
  | { outcome: "several"; count: number };

// The waiting tap an alert finishes: the person's own, still waiting, from
// BANK_ALERT_MATCH_BEFORE_SECONDS before the tap to
// BANK_ALERT_MATCH_AFTER_SECONDS after it, at a shop that agrees. Only
// exactly one such tap counts; none or several change nothing.
export function findTapForBankAlert(
  taps: readonly WaitingTapFact[],
  alert: { personId: string; merchant: string; at: string }
): BankAlertTapMatch {
  const fits = taps.filter((tap) => {
    const seconds = secondsBetween(tap.receivedAt, alert.at);
    return tap.status === "waiting"
      && tap.personId === alert.personId
      && seconds >= -BANK_ALERT_MATCH_BEFORE_SECONDS
      && seconds <= BANK_ALERT_MATCH_AFTER_SECONDS
      && alertMerchantAgrees(alert.merchant, tap.merchant);
  });
  if (fits.length === 1) {
    return { outcome: "one", tap: fits[0] };
  }
  return fits.length ? { outcome: "several", count: fits.length } : { outcome: "none" };
}
