export const IMPORT_HEADERS = ["date", "description", "expense", "income", "account", "category", "note", "type"];

export const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12
};

export interface StatementCheckpointDraft {
  accountName: string;
  checkpointMonth: string;
  statementStartDate?: string;
  statementEndDate?: string;
  statementBalanceMinor: number;
  note?: string;
}

export interface ParsedStatementImport {
  parserKey: string;
  sourceLabel: string;
  rows: Record<string, string>[];
  checkpoints: StatementCheckpointDraft[];
  warnings: string[];
}

export interface SpreadsheetCell {
  row: number;
  column: number;
  value: string | number;
}

export function statementRowsToCsv(rows: Record<string, string>[]) {
  const lines = [IMPORT_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(IMPORT_HEADERS.map((header) => csvCell(row[header] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function cleanLines(text: string) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && line !== "•");
}

export function getPdfLayoutLines(text: string) {
  const markerIndex = text.indexOf("__PDF_LAYOUT_TEXT__");
  if (markerIndex < 0) {
    return [];
  }
  const endIndex = text.indexOf("__PDF_SPACED_LAYOUT_TEXT__", markerIndex);
  const layoutText = endIndex >= 0
    ? text.slice(markerIndex + "__PDF_LAYOUT_TEXT__".length, endIndex)
    : text.slice(markerIndex + "__PDF_LAYOUT_TEXT__".length);
  return cleanLines(layoutText);
}

export function getPdfSpacedLayoutLines(text: string) {
  const markerIndex = text.indexOf("__PDF_SPACED_LAYOUT_TEXT__");
  if (markerIndex < 0) {
    return [];
  }
  return cleanLines(text.slice(markerIndex + "__PDF_SPACED_LAYOUT_TEXT__".length));
}

export function findDateAfter(lines: string[], label: string) {
  const index = lines.findIndex((line) => line === label);
  if (index < 0) {
    return undefined;
  }
  return findLongDate(lines.slice(index + 1, index + 6));
}

export function findLongDate(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^(\d{2}) ([A-Z]{3}) (\d{4})$/);
    if (match) {
      return formatDate(Number(match[3]), MONTHS[match[2]], Number(match[1]));
    }
  }
  return undefined;
}

export function isShortStatementDate(value: string) {
  return /^\d{2} [A-Z]{3}$/.test(value);
}

export function isSavingsDateLine(value: string) {
  return /^\d{2} [A-Za-z]{3}$/.test(value);
}

export function dateFromShortStatementDate(value: string, statementYear: number, statementMonth: number) {
  const [day, monthLabel] = value.split(" ");
  const month = MONTHS[monthLabel.toUpperCase()];
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

export function dateFromCompactStatementDate(day: string, monthLabel: string, statementYear: number, statementMonth: number) {
  const month = MONTHS[monthLabel.toUpperCase()];
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

export function dateFromNumericStatementDate(day: string, monthValue: string, statementYear: number, statementMonth: number) {
  const month = Number(monthValue);
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

export function dateFromShortParts(day: string, monthLabel: string, statementYear: number, statementMonth: number) {
  return dateFromCompactStatementDate(day, monthLabel, statementYear, statementMonth);
}

export function dateFromSavingsDate(value: string, year: string) {
  const [day, monthLabel] = value.split(" ");
  return formatDate(Number(year), MONTHS[monthLabel.toUpperCase()], Number(day));
}

export function findStatementMonthFromFileName(fileName?: string) {
  const match = fileName?.match(/(?:^|[-_])(January|February|March|April|May|June|July|August|September|October|November|December)-(\d{4})/i);
  if (!match) {
    return undefined;
  }
  const month = {
    JANUARY: 1,
    FEBRUARY: 2,
    MARCH: 3,
    APRIL: 4,
    MAY: 5,
    JUNE: 6,
    JULY: 7,
    AUGUST: 8,
    SEPTEMBER: 9,
    OCTOBER: 10,
    NOVEMBER: 11,
    DECEMBER: 12
  }[match[1].toUpperCase()];
  return month ? `${match[2]}-${String(month).padStart(2, "0")}` : undefined;
}

export function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getMonthEndDateFromMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isMoneyLine(value: string) {
  return /^\d{1,3}(?:,\d{3})*\.\d{2}(?: CR)?$/i.test(value) || /^\d+\.\d{2}(?: CR)?$/i.test(value);
}

export function parseMoneyLineToMinor(value?: string) {
  if (!value || !isMoneyLine(value)) {
    return undefined;
  }
  return Math.round(Number(value.replace(/,/g, "").replace(/\s*CR$/i, "")) * 100);
}

export function cellMoneyToMinor(value: string | number | undefined) {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const normalized = cellString(value).replace(/[$,\s]/g, "");
  if (!normalized || normalized === "-") {
    return 0;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function parseCitibankMoneyToMinor(value: string) {
  return Math.round(Number(value.replace(/[-(),]/g, "")) * 100);
}

export function parseCitibankSignedMoneyToMinor(value: string) {
  const normalized = value.trim();
  const isNegative = normalized.startsWith("-") || /^\(.+\)$/.test(normalized) || normalized.endsWith(")");
  const minor = parseCitibankMoneyToMinor(value);
  return isNegative ? -minor : minor;
}

export function parseCitibankLastSignedMoney(value: string) {
  const moneyMatches = Array.from(value.matchAll(/-?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g));
  const match = moneyMatches.at(-1)?.[0];
  return match ? parseCitibankSignedMoneyToMinor(match) : undefined;
}

export function parseOcbcMoneyToMinor(value: string) {
  return Math.round(Number(value.replace(/[(),\s]/g, "")) * 100);
}

export function parseOcbcLastMoney(value: string) {
  const moneyMatches = Array.from(value.matchAll(/\(?\s*\d{1,3}(?:\s*,\s*\d{3})*\s*\.\s*\d{2}\s*\)?/g));
  const match = moneyMatches.at(-1)?.[0];
  return match ? parseOcbcMoneyToMinor(match) : undefined;
}

export function parseCitibankGrandTotalFromPreviousLines(lines: string[], grandTotalIndex: number) {
  for (let index = grandTotalIndex - 1; index >= Math.max(0, grandTotalIndex - 8); index -= 1) {
    const amount = parseCitibankLastSignedMoney(lines[index]);
    if (amount != null) {
      return amount;
    }
  }
  return undefined;
}

export function minorToDecimal(value: number) {
  return (value / 100).toFixed(2);
}

export function compactDescription(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function cleanUobSavingsDescription(value: string) {
  return compactDescription(value
    .replace(/\s+Please note that\b.*$/i, "")
    .replace(/\s+omissions or unauthorised debits\b.*$/i, "")
    .replace(/\s+the entries above shall be deemed\b.*$/i, "")
    .replace(/\s+Account Transaction Details\b.*$/i, "")
    .replace(/\s+Date Description Withdrawals SGD\b.*$/i, "")
    .replace(/\s+United Overseas Bank\b.*$/i, "")
    .replace(/\s+Page \d+ of \d+\b.*$/i, "")
    .replace(/\s+may match \d{4}-\d{2}-\d{2}\b.*$/i, ""));
}

export function cleanOcbcDescription(value: string) {
  return compactDescription(value
    .replace(/-\s*\d{4}\s+/g, "")
    .replace(/\bSINGAPORE\s+SG\b/gi, "")
    .replace(/\bSG\b$/i, ""));
}

export function findUobSavingsPeriod(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^Period: (\d{2}) ([A-Za-z]{3}) (\d{4}) to (\d{2}) ([A-Za-z]{3}) (\d{4})$/);
    if (!match) {
      continue;
    }
    return {
      startDate: formatDate(Number(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
      endDate: formatDate(Number(match[6]), MONTHS[match[5].toUpperCase()], Number(match[4]))
    };
  }
  return undefined;
}

export function parseSavingsOverviewBalance(lines: string[]) {
  const index = lines.findIndex((line) => /^Account Overview as at /i.test(line));
  if (index < 0) {
    return undefined;
  }
  for (let cursor = index; cursor < Math.min(lines.length, index + 30); cursor += 1) {
    if (lines[cursor] === "Deposits") {
      const amount = parseMoneyLineToMinor(lines[cursor + 1]);
      if (amount != null) {
        return amount;
      }
    }
  }
  return undefined;
}

export function parseSavingsOpeningBalance(lines: string[]) {
  const index = lines.findIndex((line) => /^BALANCE B\/F$/i.test(line));
  return index >= 0 ? parseMoneyLineToMinor(lines[index + 1]) : undefined;
}

export function findOcbcStatementDate(lines: string[]) {
  const index = lines.findIndex((line) => /^STATEMENT DATE\b/i.test(line));
  const candidate = index >= 0 ? lines[index + 1] : lines.find((line) => /^\d{2}\s*-\s*\d{2}\s*-\s*\d{4}\b/.test(line));
  const match = candidate?.match(/^(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{4})/);
  return match ? formatDate(Number(match[3]), Number(match[2]), Number(match[1])) : undefined;
}

export function findOcbc360Period(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^360 ACCOUNT\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+TO\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/i);
    if (!match) {
      continue;
    }
    return {
      startDate: formatDate(Number(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
      endDate: formatDate(Number(match[6]), MONTHS[match[5].toUpperCase()], Number(match[4]))
    };
  }
  return undefined;
}

export function parseLongDateCell(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) {
    return undefined;
  }

  const month = MONTHS[match[2].slice(0, 3).toUpperCase()];
  return month ? formatDate(Number(match[3]), month, Number(match[1])) : undefined;
}

export function cellString(value: string | number | undefined) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\r/g, "\n").trim();
}

export function isTransferDescription(description: string) {
  const normalized = description.replace(/\s+/g, "");
  return /PAYMT THRU E-BANK|Bill Payment|mBK-|Funds Transfer|MONEYSEND|PAYMENT BY INTERNET|PAYMENT VIA|FAST PAYMENT|INB|OTHR Transfer/i.test(description)
    || /PAYMENTVIA|FASTPAYMENT|PAYMTTHRUE-BANK|PAYMENTBYINTERNET|TSFTO/i.test(normalized);
}

export function inferCategory(description: string, isIncome: boolean) {
  const normalized = description.toUpperCase();
  if (/PAYNOW-FAST.*WISE ASIA-PACIFIC/.test(normalized)) {
    return "Family & Personal";
  }
  if (isIncome && /SALA|SALARY/.test(normalized)) {
    return "Salary";
  }
  if (/NEW CREATION CHURCH/.test(normalized)) {
    return "Church";
  }
  if (/CONVERSION ?FEE|CONVERSIONFEES?/.test(normalized)) {
    return "Fees";
  }
  if (/SINGLIFE|INCOMEINSURANCE/.test(normalized)) {
    return "Insurance";
  }
  if (/AXSPTELTD|KEPPEL ELECTRIC|M1LIMITED|M1APP/.test(normalized)) {
    return "Bills";
  }
  if (/JOSEPHPRINCE/.test(normalized)) {
    return "Subscriptions MO";
  }
  if (/BUS\/MRT/.test(normalized)) {
    return "Public Transport";
  }
  if (/GRAB\*|TADA|GOPAY-GOJEK/.test(normalized)) {
    return "Taxi";
  }
  if (/FAIRPRICE|CS FRESH|FINEST|MARKET PLACE|DON DON DONKI|GROCER|NITORI/.test(normalized)) {
    return "Groceries";
  }
  if (/APPLE\.COM\/BILL|GOOGLE\*?YOUTUBE|YOUTUBEPREMIUM|OPENAI|VIVIFI|STARHUB/.test(normalized)) {
    return "Subscriptions MO";
  }
  if (/KINOKUNIYA|BOOK/.test(normalized)) {
    return "Education";
  }
  if (/DAILY CUT|SALON|BEAUTY/.test(normalized)) {
    return "Beauty";
  }
  if (/SHAW THEATRES|SHAW CONCESSIONS|GOLDENVILLAGE|GOLDEN VILLAGE/.test(normalized)) {
    return "Entertainment";
  }
  if (/IKEA|MUJI|HANDS|TAKASHIMAYA|TOOBUKU|THINK|SHOPEE|AMAZON|AMZON/.test(normalized)) {
    return "Shopping";
  }
  if (/TAX/.test(normalized)) {
    return "Tax";
  }
  if (/AMAZE\*|JALAIRLINE|JAPAN AIRLINES|TWAYAIR|TWAY AIR|TWAYAIRLINES/.test(normalized)) {
    return "Travel";
  }
  if (/RESTAURANT|CUIS|THAI|TOAST|FOOD|YTF|BAGUETTE|SUSHI|ELEVEN|GOCHISO|CHOCOLATE|GYG|GASTRONOMIA|COFFEE|LANTERN|KENNY ROGERS|YAKINIKU|WINGSTOP|MCDONALD|SUBWAY|HAWKERS|STARBUCKS|DIN TAI FUNG|TORI-Q|NANTSUTTEI|SABAI|FR WISMA/.test(normalized)) {
    return "Food & Drinks";
  }
  if (isIncome) {
    return "Other - Income";
  }
  return "Other";
}

export function compareImportRowsByDate(left: Record<string, string>, right: Record<string, string>) {
  return `${left.date}|${left.account}|${left.description}`.localeCompare(`${right.date}|${right.account}|${right.description}`);
}

export function labelFromFile(fileName: string | undefined, fallback: string) {
  return fileName ? fileName.replace(/\.(?:csv|pdf|xls|xlsx)$/i, "") : fallback;
}

function csvCell(value: string) {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}
