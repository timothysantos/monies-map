// The reference a UOB PayNow-FAST bank line carries (DOMAIN.md "PayNow
// Reference"). Pure and deterministic: no lookups, no AI, no reads.
//
//   PAYNOW-FAST OTHR SBA-202627699C PIB26100120520761 86 SLEEK TECH PTE LTD
//
// - `PIB<YYMMDD><HHMMSS>...` is the moment of the purchase (the date and the
//   Singapore clock time), so an imported bank row can have a time of day.
// - `<letters>-<UEN>` is the payee's company registration number (UEN): it
//   stays the same for a shop while the trailing payee name varies, so it is a
//   steadier shop key than the description.
//
// Only this one UOB format is read. OCBC's PayNow lines ("FAST PAYMENT ...
// via PayNow-Mobile ... to <payee>") carry no timestamp or code, so they give
// nothing. Anything that does not check out gives null, never a guess.

export interface PayNowReference {
  // The PIB purchase date (YYYY-MM-DD) and clock time (HH:MM:SS), or null when
  // there is none, it is not a real moment, or it is not within
  // PAYNOW_REFERENCE_DATE_TOLERANCE_DAYS of the row's own date.
  date: string | null;
  time: string | null;
  // The UEN from the "<letters>-<UEN>" token, upper case.
  merchantCode?: string;
  // The name text after the timestamp (its sequence digits dropped).
  payeeText?: string;
}

export const PAYNOW_REFERENCE_DATE_TOLERANCE_DAYS = 3;

// The documented UEN shapes: a local company (4-digit year, 5 digits, check
// letter), a business (8 digits, check letter) and an entity with a T, S or R
// prefix (T08LL1234A).
const UEN = String.raw`(?:(?:19|20)\d{7}[A-Z]|\d{8}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])`;
const CODE_TOKEN = new RegExp(String.raw`(?<![A-Z0-9])[A-Z]{2,5}-(${UEN})(?![A-Z0-9])`);
const PIB_TOKEN = /(?<![A-Za-z0-9])PIB(\d{12,24})(?!\d)/i;
const MS_PER_DAY = 86_400_000;

export function readPayNowReference(description: string | null | undefined, transactionDate?: string | null): PayNowReference | null {
  const text = typeof description === "string" ? description.replace(/\s+/g, " ").trim() : "";
  if (!/\bPAYNOW\b/i.test(text)) return null;

  const code = CODE_TOKEN.exec(text.toUpperCase());
  const pib = PIB_TOKEN.exec(text);
  if (!code && !pib) return null;

  const moment = pib ? readMoment(pib[1], transactionDate) : null;
  const result: PayNowReference = { date: moment?.date ?? null, time: moment?.time ?? null };
  if (code) result.merchantCode = code[1];
  if (pib) {
    // The digits right after the timestamp are the bank's sequence number.
    const tokens = text.slice(pib.index + pib[0].length).trim().split(" ");
    while (tokens.length && /^\d{1,4}$/.test(tokens[0])) tokens.shift();
    const payee = tokens.join(" ");
    if (/[A-Za-z]/.test(payee)) result.payeeText = payee;
  }
  return result;
}

// The PIB digits are YYMMDDHHMMSS then a sequence number. A moment counts
// only when it is a real date and time and sits within a few days of the row's
// own date (a stale or mis-read reference must not stamp a wrong time).
function readMoment(digits: string, transactionDate: string | null | undefined): { date: string; time: string } | null {
  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return null;
  const [year, month, day, hours, minutes, seconds] = [0, 2, 4, 6, 8, 10].map((start) => Number(digits.slice(start, start + 2)));
  const fullYear = 2000 + year;
  const instant = Date.UTC(fullYear, month - 1, day);
  const real = new Date(instant);
  if (real.getUTCFullYear() !== fullYear || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const rowInstant = Date.parse(`${transactionDate}T00:00:00Z`);
  if (Number.isNaN(rowInstant) || Math.abs(instant - rowInstant) > PAYNOW_REFERENCE_DATE_TOLERANCE_DAYS * MS_PER_DAY) return null;
  const two = (value: number) => String(value).padStart(2, "0");
  return { date: `${fullYear}-${two(month)}-${two(day)}`, time: `${two(hours)}:${two(minutes)}:${two(seconds)}` };
}

// "20:52" for the entry's transaction_time, or null.
export function payNowEntryTime(description: string | null | undefined, transactionDate: string): string | null {
  return readPayNowReference(description, transactionDate)?.time?.slice(0, 5) ?? null;
}

// The shop key for history and habits: the UEN, or null.
export function payNowMerchantCode(description: string | null | undefined): string | null {
  return readPayNowReference(description)?.merchantCode ?? null;
}
