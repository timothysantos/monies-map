// The no-AI receipt reader. When optional AI is off, missing, over its
// allowance or failing, the client runs the existing in-browser Tesseract
// helpers (src/client/import-helpers.js) on the receipt image and passes
// the text here. This turns it into the same ReceiptReadDto the AI route
// returns, using only patterns: a TOTAL-style label, a printed date, a
// currency marker, a masked card ending and priced item lines. Everything
// goes through finalizeReceiptRead, so validation and questions are the
// same as for an AI read. Pure: no network, no storage.

import type { ReceiptReadDto } from "../types/dto";
import { finalizeReceiptRead } from "./receipt-read";

const LARGE_UNIT_CURRENCIES = new Set(["IDR", "JPY", "KRW", "VND"]);
// Day-first unless the receipt's currency says month-first.
const MONTH_FIRST_CURRENCIES = new Set(["USD"]);

// Explicit currency markers, most specific first.
const CURRENCY_MARKERS: Array<[RegExp, string]> = [
  [/US\$/, "USD"],
  [/S\$/, "SGD"],
  [/HK\$/, "HKD"],
  [/NT\$/, "TWD"],
  [/A\$/, "AUD"],
  [/\bRp\.?\s?\d/, "IDR"],
  [/\bRM\s?\d/, "MYR"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/฿/, "THB"],
  [/₱/, "PHP"],
  [/₩/, "KRW"],
  [/₫/, "VND"],
  [/\b(SGD|USD|IDR|MYR|EUR|GBP|JPY|THB|PHP|KRW|VND|AUD|NZD|HKD|TWD|CNY|INR|CHF|CAD)\b/, ""]
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TOTAL_WORD = "T[O0]TA[L1I]";
const TOTAL_LABELS: Array<[RegExp, number]> = [
  [new RegExp(`\\bGRAND\\s*${TOTAL_WORD}\\b`, "i"), 3],
  [new RegExp(`\\b(?:${TOTAL_WORD}\\s*DUE|AMOUNT\\s*DUE|BALANCE\\s*DUE|AMOUNT\\s*PAYABLE)\\b`, "i"), 2],
  [new RegExp(`\\b${TOTAL_WORD}\\b`, "i"), 1]
];
const NOT_TOTAL = new RegExp(`SUB\\s*-?\\s*${TOTAL_WORD}|${TOTAL_WORD}\\s*:?\\s*(?:ITEMS?|QTY|SAVINGS?|DISC\\w*|TAX|GST|VAT)`, "i");
// The first line that ends the item list.
const ITEMS_END = new RegExp(`SUB\\s*-?\\s*${TOTAL_WORD}|${TOTAL_WORD}|AMOUNT\\s*DUE|BALANCE\\s*DUE`, "i");
const NOT_ITEM = /\b(GST|TAX|VAT|PB1|SVC|SERVICE|ROUNDING|CHANGE|CASH|TUNAI|KEMBALI|VISA|MASTER\w*|AMEX|NETS|PAYNOW|TENDER\w*)\b/i;
const NOT_MERCHANT = /TAX\s*INVOICE|RECEIPT|INVOICE|^TEL\b|^PHONE|GST\s*REG|\bUEN\b|^BLK\b|^#|^\d|^JL\.|WELCOME|^NO\b/i;
const AMOUNT_AT_END = /(?:^|\s)(-)?\s*(?:US\$|S\$|HK\$|NT\$|A\$|\$|Rp\.?|RM|IDR|SGD|USD|MYR|€|£|¥|฿)?\s*(-)?(\d[\d.,]*\d|\d)\s*$/;

export function readReceiptOcrText(
  text: string,
  options: { today: string; defaultCurrency?: string }
): ReceiptReadDto | null {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const printedCurrency = findPrintedCurrency(lines.join("\n"));
  const currency = printedCurrency ?? options.defaultCurrency?.toUpperCase() ?? null;
  const largeUnit = currency ? LARGE_UNIT_CURRENCIES.has(currency) : false;

  const merchant = findMerchant(lines);
  const date = findDate(lines, { monthFirst: currency ? MONTH_FIRST_CURRENCIES.has(currency) : false, orderKnown: Boolean(printedCurrency) });
  const total = findTotal(lines, largeUnit);

  return finalizeReceiptRead({
    merchant: merchant?.value ?? null,
    merchantConfidence: merchant?.confidence ?? "low",
    date: date?.value ?? null,
    dateConfidence: date ? "medium" : "low",
    dateAlternatives: date?.alternatives ?? [],
    totalAmount: total?.amount ?? null,
    currency,
    totalConfidence: total?.confidence ?? "low",
    cardDigits: findCardLast4(lines),
    lineItems: findLineItems(lines, largeUnit)
  }, { today: options.today, source: "ocr" });
}

function findPrintedCurrency(text: string) {
  for (const [pattern, code] of CURRENCY_MARKERS) {
    const match = pattern.exec(text);
    if (match) {
      return code || match[1];
    }
  }
  return null;
}

function findMerchant(lines: string[]) {
  const candidates = lines.slice(0, 4);
  for (let index = 0; index < candidates.length; index += 1) {
    const line = candidates[index];
    const letters = line.replace(/[^A-Za-z]/g, "").length;
    if (letters >= 3 && letters / line.length > 0.5 && !NOT_MERCHANT.test(line) && !AMOUNT_AT_END.test(line.replace(/\b\d{1,2}\b/g, ""))) {
      return { value: line, confidence: index < 2 ? "medium" : "low" };
    }
  }
  return null;
}

function findDate(lines: string[], order: { monthFirst: boolean; orderKnown: boolean }) {
  for (const line of lines) {
    const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(line);
    if (iso) {
      return { value: isoDate(iso[1], iso[2], iso[3]), alternatives: [] };
    }
    const dayName = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})[a-z]*\\.?,?\\s+(\\d{4})\\b`, "i").exec(line);
    if (dayName) {
      return { value: isoDate(dayName[3], String(MONTHS.indexOf(dayName[2].toLowerCase()) + 1), dayName[1]), alternatives: [] };
    }
    const nameDay = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i").exec(line);
    if (nameDay) {
      return { value: isoDate(nameDay[3], String(MONTHS.indexOf(nameDay[1].toLowerCase()) + 1), nameDay[2]), alternatives: [] };
    }
    const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(line);
    if (numeric) {
      const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
      const [first, second] = [Number(numeric[1]), Number(numeric[2])];
      const dayFirst = isoDate(year, String(second), String(first));
      const monthFirst = isoDate(year, String(first), String(second));
      const primary = order.monthFirst ? monthFirst : dayFirst;
      const other = order.monthFirst ? dayFirst : monthFirst;
      // Both readings are real dates and no printed currency says which
      // order the shop uses: offer both instead of guessing.
      const alternatives = !order.orderKnown && first !== second && other ? [other] : [];
      return { value: primary ?? other, alternatives: primary ? alternatives : [] };
    }
  }
  return null;
}

function findTotal(lines: string[], largeUnit: boolean) {
  let best: { amount: string; priority: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (NOT_TOTAL.test(line)) {
      continue;
    }
    const priority = TOTAL_LABELS.find(([pattern]) => pattern.test(line))?.[1];
    if (!priority || (best && best.priority >= priority)) {
      continue;
    }
    const amount = readLineAmount(line, largeUnit) ?? readLineAmount(lines[index + 1] ?? "", largeUnit);
    if (amount && !amount.value.startsWith("-")) {
      best = { amount: amount.value, priority };
    }
  }
  if (best) {
    return { amount: best.amount, confidence: "medium" };
  }
  // No label: offer the largest amount, flagged so the user checks it.
  const amounts = lines
    .map((line) => readLineAmount(line, largeUnit)?.value)
    .filter((value): value is string => Boolean(value) && !value!.startsWith("-"));
  if (!amounts.length) {
    return null;
  }
  return { amount: amounts.reduce((max, value) => (Number(value) > Number(max) ? value : max)), confidence: "low" };
}

function findCardLast4(lines: string[]) {
  for (const line of lines) {
    const masked = /[*Xx•#]{4,}[\s*Xx•#-]*(\d{4})\b/.exec(line);
    if (masked) {
      return masked[1];
    }
    if (/\b(VISA|MASTER\w*|AMEX|CARD|DEBIT|CREDIT)\b/i.test(line)) {
      const full = /\b(?:\d{4}[ -]?){3}\d{1,7}\b/.exec(line);
      if (full) {
        return full[0].replace(/\D/g, "").slice(-4);
      }
    }
  }
  return null;
}

function findLineItems(lines: string[], largeUnit: boolean) {
  const items: Array<{ description: string; amount: string; quantity: number | null }> = [];
  for (const line of lines) {
    if (ITEMS_END.test(line)) {
      break;
    }
    if (NOT_ITEM.test(line)) {
      continue;
    }
    const amount = readLineAmount(line, largeUnit);
    if (!amount) {
      continue;
    }
    let description = amount.before;
    let quantity: number | null = null;
    const leading = /^(\d{1,2})\s*[xX]?\s+(.+)$/.exec(description);
    const trailing = /^(.+?)\s+(\d{1,2})\s*[xX]$/.exec(description);
    if (leading) {
      quantity = Number(leading[1]);
      description = leading[2];
    } else if (trailing) {
      quantity = Number(trailing[2]);
      description = trailing[1];
    }
    if (description.replace(/[^A-Za-z]/g, "").length >= 2) {
      items.push({ description, amount: amount.value, quantity: quantity && quantity > 0 ? quantity : null });
    }
  }
  return items;
}

// The amount printed at the end of a line, as a plain decimal string in
// major units ("21.95", "143000"), and the text before it.
function readLineAmount(line: string, largeUnit: boolean) {
  const match = AMOUNT_AT_END.exec(line);
  if (!match) {
    return null;
  }
  const value = normalizeAmount(match[3], largeUnit);
  if (!value) {
    return null;
  }
  const negative = Boolean(match[1] || match[2]);
  return { value: negative ? `-${value}` : value, before: line.slice(0, match.index).trim() };
}

function normalizeAmount(token: string, largeUnit: boolean) {
  if (largeUnit) {
    // Rp 143.000 and 143,000 are both whole rupiah; a trailing two-digit
    // group after the last separator is cents.
    const cents = /^(\d{1,3}(?:[.,]\d{3})*)[.,](\d{2})$/.exec(token);
    if (cents && /[.,]\d{3}/.test(cents[1])) {
      return `${cents[1].replace(/[.,]/g, "")}.${cents[2]}`;
    }
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(token)) {
      return token.replace(/[.,]/g, "");
    }
    return /^[1-9]\d{2,}$/.test(token) ? token : null;
  }
  if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(token)) {
    return token.replace(/,/g, "");
  }
  if (/^\d+\.\d{2}$/.test(token)) {
    return token;
  }
  if (/^\d+,\d{2}$/.test(token)) {
    return token.replace(",", ".");
  }
  return null;
}

function isoDate(year: string, month: string, day: string) {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
