// The currency signs the Apple Pay Shortcut's Wallet amount can carry, and
// the currency each one means (DOMAIN.md "Foreign Currency Estimate").
//
// Wallet hands the Shortcut the amount as the phone writes money: a phone
// set to English (Singapore) writes "$12.34" for Singapore dollars,
// "IDR 159,000" for rupiah and "JP¥965" for yen (Intl en-SG / CLDR); English
// (US) writes "¥965" and Japanese "￥965" (read as "¥"). A three-letter code
// is always read as itself; these are the signs that are not codes. Add a
// sign here when a trip shows a new one: a sign the server does not know is
// refused (never saved as Singapore dollars).
//
// A bare "$" is not here: it is the card's own currency, as before.
// A bare "¥" is the yen (English and Japanese phones); the yuan is "CN¥".
export const WALLET_AMOUNT_CURRENCY_SIGNS: Readonly<Record<string, string>> = {
  "S$": "SGD",
  "SG$": "SGD",
  "US$": "USD",
  "RP": "IDR",
  "JP¥": "JPY",
  "¥": "JPY",
  "CN¥": "CNY",
  "RMB": "CNY",
  "HK$": "HKD",
  "NT$": "TWD",
  "A$": "AUD",
  "AU$": "AUD",
  "NZ$": "NZD",
  "CA$": "CAD",
  "MX$": "MXN",
  "R$": "BRL",
  "RM": "MYR",
  "€": "EUR",
  "£": "GBP",
  "₩": "KRW",
  "฿": "THB",
  "₫": "VND",
  "₱": "PHP",
  "₹": "INR",
  "₪": "ILS"
};
