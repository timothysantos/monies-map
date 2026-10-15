// iFAST Financial "Wrap" monthly statement (an investment account, not a bank
// account). The statement is read from pdf.js text items in reading order (the
// raw view of `extractPdfText`); the visual-line views would split the account
// summary row, whose Total Assets cell is centred between two lines.
//
// What it gives the app:
// - the statement's total assets at month end, kept as the account's
//   statement market value (never a bank balance, never reconciled);
// - the plan-level cash movements ("INVESTMENT TRANSACTION": a contribution
//   paid by eGIRO or cash, or a redemption back to the bank), as transfers on
//   the investment account;
// - the income summary, kept on the value for the record.
// Unit-level rows (switches, reinvested dividends, per-fund RSP buys) move no
// cash across the bank, so they are never rows.

import {
  compareImportRowsByDate,
  formatDate,
  getMonthEndDateFromMonth,
  labelFromFile,
  minorToDecimal,
  MONTHS,
  type ParsedStatementImport
} from "./shared";

const HEADER_PATTERN = /^STATEMENT FOR ([A-Z]+) (\d{4}) \((P\d+)\)$/i;
const AMOUNT_PATTERN = /^([A-Z]{3}) (-?[\d,]+\.\d{2})$/;
const DATE_PATTERN = /^(\d{2}) ([A-Za-z]{3}) (\d{4})$/;
const FULL_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

export const IFAST_PARSER_KEY = "ifast_wrap_pdf";

export function canParseIfastStatement(rawText: string) {
  return /STATEMENT FOR [A-Z]+ \d{4} \(P\d+\)/i.test(rawText)
    && /iFAST Financial Pte Ltd/i.test(rawText)
    && /ACCOUNT SUMMARY/.test(rawText);
}

export function parseIfastWrapStatement(rawText: string, fileName?: string): ParsedStatementImport {
  const lines = readRawLines(rawText);

  const header = lines.map((line) => line.match(HEADER_PATTERN)).find(Boolean);
  const monthIndex = header ? FULL_MONTHS.indexOf(header[1].toUpperCase()) : -1;
  if (!header || monthIndex < 0) {
    throw new Error("Could not find the iFAST statement period.");
  }
  const year = Number(header[2]);
  const accountReference = header[3].toUpperCase();
  const checkpointMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  const currency = readStatementCurrency(lines);
  if (currency !== "SGD") {
    throw new Error(`This iFAST statement is in ${currency}. Only Singapore dollar (SGD) statements can be imported.`);
  }

  if (!lines.some((line) => /^INVESTMENT TRANSACTION\b/.test(line))) {
    throw new Error("This iFAST statement looks cut short: its transaction page is missing. Download the full statement again and add it.");
  }

  const summary = readAccountSummary(lines, accountReference);
  if (!summary) {
    throw new Error("Could not read the iFAST account summary (market value and total assets).");
  }
  const income = readIncomeSummary(lines);

  const accountName = summary.holder ? `${summary.holder} iFAST` : "iFAST";
  const warnings: string[] = [];
  if (summary.totalAssetsMinor !== summary.marketValueMinor + summary.cashMinor) {
    warnings.push("The statement's total assets are not its market value plus cash; the printed total assets were used.");
  }

  const rows = readPlanMovements(lines, accountName, warnings);

  return {
    parserKey: IFAST_PARSER_KEY,
    sourceLabel: labelFromFile(fileName, `iFAST Wrap statement ${checkpointMonth}`),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName,
      checkpointMonth,
      statementStartDate: `${checkpointMonth}-01`,
      statementEndDate: getMonthEndDateFromMonth(checkpointMonth),
      statementBalanceMinor: summary.totalAssetsMinor,
      accountLast4: /\d{4}$/.test(accountReference) ? accountReference.slice(-4) : undefined,
      investmentValue: {
        accountReference,
        currency: "SGD",
        totalAssetsMinor: summary.totalAssetsMinor,
        marketValueMinor: summary.marketValueMinor,
        cashMinor: summary.cashMinor,
        incomeMinor: income
      },
      note: "Imported from iFAST Wrap statement"
    }],
    warnings
  };
}

// The raw items, one per line, with a currency split from its amount ("SGD"
// then "141.0256" on the next item) put back together.
function readRawLines(rawText: string) {
  const text = rawText.replace(/\r/g, "\n");
  const raw = (text.split("__PDF_LAYOUT_TEXT__")[0] ?? text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (/^[A-Z]{3}$/.test(raw[index]) && /^-?[\d,]+\.\d+/.test(raw[index + 1] ?? "")) {
      lines.push(`${raw[index]} ${raw[index + 1]}`);
      index += 1;
    } else {
      lines.push(raw[index]);
    }
  }
  return lines;
}

function readStatementCurrency(lines: string[]) {
  const index = lines.findIndex((line) => /^Statement Currency$/i.test(line));
  const value = index >= 0 ? lines[index + 1] : undefined;
  if (!value || !/^[A-Z]{3}$/.test(value)) {
    throw new Error("Could not read the iFAST statement currency.");
  }
  return value;
}

function parseAmount(line: string | undefined) {
  const match = line?.match(AMOUNT_PATTERN);
  return match ? Math.round(Number(match[2].replace(/,/g, "")) * 100) : undefined;
}

function readAccountSummary(lines: string[], accountReference: string) {
  const start = lines.findIndex((line) => /^ACCOUNT SUMMARY$/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^INCOME SUMMARY$/.test(line));
  if (start < 0 || end < 0) {
    return undefined;
  }
  const section = lines.slice(start + 1, end);
  const numberIndex = section.findIndex((line) => line.toUpperCase() === accountReference);
  if (numberIndex < 0) {
    return undefined;
  }
  const amounts = section.slice(numberIndex + 1).map(parseAmount).filter((value): value is number => value !== undefined);
  if (amounts.length < 2) {
    return undefined;
  }
  const [marketValueMinor, cashMinor] = amounts;
  const totalAssetsMinor = amounts[2] ?? marketValueMinor + cashMinor;

  // "Wrap Personal" then "<name> TOP Account" sit between the column
  // headings and the account number.
  const headingEnd = section.findIndex((line) => /^Total Assets$/i.test(line));
  const nameLines = section.slice(headingEnd + 1, numberIndex);
  const holder = nameLines
    .map((line) => line.match(/^(.+?)\s+(?:TOP\s+)?Account$/i)?.[1]?.trim())
    .find(Boolean) ?? "";
  return { marketValueMinor, cashMinor, totalAssetsMinor, holder };
}

// Dividend payout, coupon payout, total income; only the total is kept.
function readIncomeSummary(lines: string[]) {
  const start = lines.findIndex((line) => /^INCOME SUMMARY$/.test(line));
  if (start < 0) {
    return 0;
  }
  const amounts: number[] = [];
  for (const line of lines.slice(start + 1, start + 14)) {
    if (/^INVESTMENT HOLDINGS/.test(line)) {
      break;
    }
    const amount = parseAmount(line);
    if (amount !== undefined) {
      amounts.push(amount);
    }
  }
  return amounts[2] ?? amounts[0] ?? 0;
}

// The plan-level table of INVESTMENT TRANSACTION: date, product, type,
// payment method, amount. The tables of underlying unit rows that follow it
// (and the same heading continued on later pages) are skipped.
function readPlanMovements(lines: string[], accountName: string, warnings: string[]) {
  const rows: Record<string, string>[] = [];
  let inTransactions = false;
  let inPlanTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^INVESTMENT TRANSACTION\b/.test(line)) {
      inTransactions = true;
      inPlanTable = false;
      continue;
    }
    if (!inTransactions) {
      continue;
    }
    if (/^(FOREIGN EXCHANGE RATE|GENERAL$|Total transactional fees)/i.test(line)) {
      inTransactions = false;
      inPlanTable = false;
      continue;
    }
    if (/^Payment Method$/i.test(line)) {
      inPlanTable = true;
      continue;
    }
    if (/^(Underlying Products|Product Type)$/i.test(line)) {
      inPlanTable = false;
      continue;
    }
    const date = inPlanTable ? line.match(DATE_PATTERN) : null;
    if (!date) {
      continue;
    }
    const cells: string[] = [];
    let amountMinor: number | undefined;
    let cursor = index + 1;
    for (; cursor < lines.length && cursor <= index + 8; cursor += 1) {
      if (DATE_PATTERN.test(lines[cursor])) {
        break;
      }
      const amount = parseAmount(lines[cursor]);
      if (amount !== undefined) {
        amountMinor = amount;
        break;
      }
      cells.push(lines[cursor]);
    }
    const month = MONTHS[date[2].toUpperCase()];
    if (amountMinor === undefined || cells.length < 3 || !month) {
      warnings.push(`Could not read the iFAST transaction dated ${line}.`);
      continue;
    }
    index = cursor;
    const method = cells[cells.length - 1];
    const type = cells[cells.length - 2];
    const product = cells.slice(0, -2).join(" ");
    if (/switch/i.test(type)) {
      continue;
    }
    const isWithdrawal = /redemption|withdraw|sell/i.test(type);
    const amount = minorToDecimal(Math.abs(amountMinor));
    rows.push({
      date: formatDate(Number(date[3]), month, Number(date[1])),
      description: `iFAST ${type} via ${method}, ${product}`,
      expense: isWithdrawal ? amount : "",
      income: isWithdrawal ? "" : amount,
      account: accountName,
      category: "Transfer",
      note: "",
      type: "transfer"
    });
  }
  return rows;
}
