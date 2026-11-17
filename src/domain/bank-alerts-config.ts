// Every rule the "Bank alert to Monies Map" Shortcut's reader runs on
// (DOMAIN.md "Bank Alert"; docs/audits/waiting-taps.md "Bank alerts"), in
// one place, so a new bank's wording is one entry in BANK_ALERT_WORDINGS and
// the owner can change a window with a deploy and no reinstall.
//
// Why a bank alert: Singapore card issuers send a real-time alert for every
// card payment with its amount and currency, time and shop name (MAS
// E-Payments User Protection Guidelines, para 4.10), by SMS, email or app
// notification. When a "choose your currency" terminal leaves an Apple Pay
// tap without its amount (a Waiting Tap), the bank's alert for the same
// payment can supply it. The reader is deterministic, never AI.
//
// UNVERIFIED WORDING: no bank's real alert text was available when this was
// built. Every wording below is a structure-faithful guess from public
// descriptions of the alerts, with invented shops, amounts and card digits.
// The reader is tolerant on purpose and harmless when it reads nothing: an
// alert it cannot read changes nothing. Replace a guess with the bank's real
// wording (sanitized) when the owner has one, and add it to
// tests/bank-alerts.test.mjs.

export const BANK_ALERT_PATH = "/api/shortcuts/alerts/bank";

// The Shortcut posts { text, receivedAt, requestId, clientVersion }. Alerts
// are a few hundred characters; an email body with its footer a few KB.
// Anything past BANK_ALERT_MAX_BODY_BYTES is refused (413) before parsing.
export const BANK_ALERT_MAX_BODY_BYTES = 8 * 1024;
// Only this much of the text is read at all; the rest is dropped unread.
export const BANK_ALERT_MAX_TEXT_CHARS = 4000;
// The alert itself is at the top. Amounts and the "not a payment" words are
// looked for only in this first part, so an email's footer (a promotion, a
// limit, a disclaimer) never changes the reading.
export const BANK_ALERT_READ_CHARS = 600;

// A waiting tap fits an alert that arrives from 10 minutes before the tap
// (the bank was quicker than Wallet's record) to 30 minutes after it (a slow
// SMS or email).
export const BANK_ALERT_MATCH_BEFORE_SECONDS = 10 * 60;
export const BANK_ALERT_MATCH_AFTER_SECONDS = 30 * 60;
// The phone's receivedAt is used only when it is this close to the
// server's clock; otherwise the server's own time is the alert's time.
export const BANK_ALERT_CLOCK_TRUST_SECONDS = 60 * 60;

// Currency codes the reader accepts (a three-letter word that is not one of
// these is not money: "REF 1234", "OTP 1234").
export const BANK_ALERT_CURRENCY_CODES: readonly string[] = [
  "SGD", "USD", "EUR", "GBP", "AUD", "NZD", "CAD", "CHF", "HKD", "CNY", "JPY", "KRW", "TWD", "THB", "MYR",
  "IDR", "PHP", "VND", "INR", "AED", "SAR", "SEK", "NOK", "DKK", "MOP", "LKR", "NPR", "ZAR"
];

// Signs written before or after an amount, and the code each one means.
// A bare "$" in a Singapore bank's alert is Singapore dollars.
export const BANK_ALERT_CURRENCY_SIGNS: Readonly<Record<string, string>> = {
  "S$": "SGD", "SG$": "SGD", "$": "SGD", "US$": "USD", "HK$": "HKD", "A$": "AUD", "NZ$": "NZD",
  "RP": "IDR", "RP.": "IDR", "RM": "MYR", "€": "EUR", "£": "GBP", "¥": "JPY", "₩": "KRW", "฿": "THB", "₫": "VND", "₱": "PHP"
};

// Currencies written with no decimals, where "150.000" is a hundred and
// fifty thousand (Rupiah, Yen, Won, Dong).
export const BANK_ALERT_ZERO_DECIMAL_CURRENCIES: readonly string[] = ["IDR", "JPY", "KRW", "VND"];

// A payment app's prefix on the shop's name ("AMAZE*WARUNG MADE"), dropped
// before the shop is compared with the tap's (the import's AMAZE* rule,
// statement-row-matching.ts).
export const BANK_ALERT_MERCHANT_PREFIXES: readonly RegExp[] = [/^\s*(?:AMAZE|AMZ)\s*\*\s*/i];

// A one-time code: one of these words and a 6 to 8 figure code. The whole
// text is dropped before anything is read from it.
export const BANK_ALERT_ONE_TIME_CODE_WORDS =
  /\b(?:OTP|one[- ]?time (?:password|passcode|pin|code)|verification code|security code|authentication code|passcode|TAC)\b/i;
export const BANK_ALERT_ONE_TIME_CODE = /(?<!\d|\d[.,])\d{6,8}(?!\d|[.,]\d)/;

// Words that make an alert something other than a card payment going out:
// money in, a refund, a sign-in, a declined or failed payment, a transfer, a
// promotion. Looked for in the first BANK_ALERT_READ_CHARS only.
export const BANK_ALERT_NOT_A_PAYMENT =
  /\b(?:refund(?:ed)?|reversal|reversed|credited|received|incoming|deposit(?:ed)?|log(?:ged)?[- ]?in|sign(?:ed)?[- ]?in|new device|declined|unsuccessful|failed|not successful|transfer(?:red)?|paynow|giro|cash ?back|promo(?:tion)?|enjoy|offer)\b/i;

// An amount right after one of these is a balance or limit, not the payment.
export const BANK_ALERT_NOT_THE_PAYMENT_BEFORE = /\b(?:balance|limit|available|avail\.?)\b[^\d]{0,20}$/i;

// One bank's alert sentence. `pattern` is a regular expression source where
// `{money}` stands for the payment's amount (with its currency before or
// after, and an optional converted figure in brackets after it) and
// `{merchant}` for the shop's name, read up to " on ", " with ", a full stop,
// a semicolon or the end of the line. Read in order; the first that matches
// wins. `sample` is the invented, unverified alert the tests read.
export interface BankAlertWording {
  id: string;
  bank: string;
  verified: boolean;
  pattern: string;
  sample: string;
}

export const BANK_ALERT_WORDINGS: readonly BankAlertWording[] = [
  {
    // DBS / POSB card transaction email and notification: labelled lines.
    id: "dbs-card-labels",
    bank: "DBS / POSB",
    verified: false,
    pattern: String.raw`\bAmount\s*:\s*{money}[\s\S]{0,240}?\bTo\s*:\s*{merchantLine}`,
    sample: "Card Transaction Alert\nTransaction Ref: 260117143200981\nDear Sir / Madam,\nWe refer to your card transaction request dated 17 Nov 14:32 (SGT).\nDate & Time: 17 Nov 14:32 (SGT)\nAmount: SGD12.34\nFrom: DBS/POSB card ending 4417\nTo: KOPITIAM SQUARE\nIf unauthorised, please call our hotline immediately."
  },
  {
    // UOB SMS: "A transaction of SGD 25.80 was made with your UOB Card ending
    // 1234 on 17/11/26 at FAIRPRICE FINEST."
    id: "uob-transaction-of",
    bank: "UOB",
    verified: false,
    pattern: String.raw`\btransaction of {money} was made\b[\s\S]{0,160}?\bat {merchant}`,
    sample: "A transaction of SGD 25.80 was made with your UOB Card ending 5521 on 17/11/26 at FAIRPRICE FINEST. If unauthorised, call 24/7 Fraud Hotline now."
  },
  {
    // Citi: "A SGD 45.00 transaction was made on your Citi card ending 1234
    // at GRAB* RIDES on 17-NOV-26."
    id: "citi-a-transaction",
    bank: "Citi",
    verified: false,
    pattern: String.raw`\bA {money} transaction was made\b[\s\S]{0,160}?\bat {merchant}`,
    sample: "Citi Alert: A SGD 45.00 transaction was made on your Citi Rewards card ending 8830 at GRAB* RIDES on 17-NOV-26 14:32 SGT. Not you? Call +65 6225 5225."
  },
  {
    // OCBC: "Your OCBC card ending 1234 was charged SGD 8.50 at STARBUCKS on
    // 17 Nov 2026."
    id: "ocbc-was-charged",
    bank: "OCBC",
    verified: false,
    pattern: String.raw`\bwas charged {money} at {merchant}`,
    sample: "OCBC: Your OCBC 365 Credit Card ending 2093 was charged SGD 8.50 at STARBUCKS @ VIVOCITY on 17 Nov 2026, 2.32PM. If unauthorised, call 6363 3333."
  },
  {
    // Amaze (Instarem) app notification: the amount in the currency paid,
    // sometimes the converted figure in brackets, the shop with AMAZE*.
    id: "amaze-spent",
    bank: "Amaze",
    verified: false,
    pattern: String.raw`\b(?:spent|paid) {money} (?:at|to) {merchant}`,
    sample: "Amaze: You spent IDR 150.000 (≈ SGD 12.80) at AMAZE*WARUNG MADE with your Amaze card."
  },
  {
    // Any other bank: a payment word, the amount, then "at" and the shop.
    id: "generic-payment-at",
    bank: "Other",
    verified: false,
    pattern: String.raw`\b(?:purchase|payment|transaction|spent|charged|debited|used)\b[^\n.]{0,80}?{money}[^\n]{0,80}?\bat {merchant}`,
    sample: "HSBC: Your card ending 7710 was used for a purchase of SGD 19.90 at UNIQLO ION ORCHARD on 17NOV."
  }
];
