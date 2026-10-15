// StashAway monthly "Statement of Account" (an investment account, not a bank
// account). The statement is read from pdf.js text items in reading order (the
// raw view of `extractPdfText`), one item per cell.
//
// What it gives the app:
// - the account's closing balance on the period's last day, kept as the
//   account's statement market value (never a bank balance, never reconciled);
// - the month's deposits and withdrawals, as transfers on the investment
//   account: the dated rows of the TRANSACTIONS page when they add up to the
//   printed cashflow, otherwise one entry for the net cashflow dated the last
//   day of the period;
// - the opening balance, returns and fees, carried on the value so the import
//   can say when a statement does not start where the earlier one ended.
// Buys, dividends, currency conversions and the management fee all happen
// inside the portfolio and move no cash across a bank, so they are never rows.
//
// Only the account summary page is read for figures: its "Total" row is
// opening, cashflow, total returns, fees and closing balance, in the reporting
// currency. Every statement seen so far shows a cashflow of $0.00, so the
// layout of a deposit or withdrawal row is inferred, not seen (see
// readDatedCashflowRows).

import {
  compareImportRowsByDate,
  formatDate,
  getMonthEndDateFromMonth,
  labelFromFile,
  minorToDecimal,
  MONTHS,
  type ParsedStatementImport
} from "./shared";

export const STASHAWAY_PARSER_KEY = "stashaway_pdf";

const AMOUNT_TOKEN = /-?\$[\d,]+\.\d{2}/g;
const AMOUNT_CELL = /^-?\$[\d,]+\.\d{2}$/;
const PERIOD_PATTERN = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) - (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/;
const SECTION_HEADING = /^(?:ACCOUNT SUMMARY|PORTFOLIO SUMMARY|PORTFOLIO DETAILS|TRANSACTIONS|FEE CALCULATIONS|APPENDIX|NOTICE AND DISCLAIMER)\b/;

// A bank statement can name StashAway as a payee, so the company name alone is
// not enough: the statement's own labels must be there too.
export function canParseStashawayStatement(rawText: string) {
  if (!/Asia Wealth Platform Pte/i.test(rawText)) {
    return false;
  }
  const lines = readRawLines(rawText);
  return lines.some((line) => /^Account Reference Code:/i.test(line) || /^(?:PORTFOLIO SUMMARY|PORTFOLIO DETAILS|FEE CALCULATIONS)\b/.test(line));
}

export function parseStashawayStatement(rawText: string, fileName?: string): ParsedStatementImport {
  const lines = readRawLines(rawText);

  const summaryStart = lines.findIndex((line) => line === "ACCOUNT SUMMARY");
  if (summaryStart < 0) {
    throw new Error(cutShortMessage);
  }

  const period = readPeriod(lines);
  const currency = readReportingCurrency(lines, summaryStart);
  if (currency !== "SGD") {
    throw new Error(`This StashAway statement is in ${currency}. Only Singapore dollar (SGD) statements can be imported.`);
  }
  const summary = readSummaryTotal(lines, summaryStart);
  if (!summary) {
    throw new Error(cutShortMessage);
  }

  const warnings: string[] = [];
  if (summary.openingMinor + summary.cashflowMinor + summary.returnsMinor + summary.feesMinor !== summary.closingMinor) {
    warnings.push("The statement's opening balance, cashflow, returns and fees do not add up to its closing balance; the printed closing balance was used.");
  }
  const portfolioClosings = readPortfolioClosings(lines);
  if (portfolioClosings.length > 1 && portfolioClosings.reduce((sum, value) => sum + value, 0) !== summary.closingMinor) {
    warnings.push("The portfolios' closing balances do not add up to the statement's total; the total was used.");
  }

  const owner = readLabelled(lines, "Account Owner:");
  const reference = readLabelled(lines, "Account Reference Code:");
  const accountName = owner ? `${owner} StashAway` : "StashAway";
  const reference4 = reference.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-4);

  const rows = readCashflowRows({ lines, accountName, period, cashflowMinor: summary.cashflowMinor, warnings });

  return {
    parserKey: STASHAWAY_PARSER_KEY,
    sourceLabel: labelFromFile(fileName, `StashAway statement ${period.checkpointMonth}`),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName,
      checkpointMonth: period.checkpointMonth,
      statementStartDate: period.startDate,
      statementEndDate: period.endDate,
      statementBalanceMinor: summary.closingMinor,
      accountLast4: reference4.length === 4 ? reference4 : undefined,
      investmentValue: {
        accountReference: reference,
        currency: "SGD",
        totalAssetsMinor: summary.closingMinor,
        marketValueMinor: summary.closingMinor,
        cashMinor: 0,
        incomeMinor: 0,
        openingMinor: summary.openingMinor,
        cashflowMinor: summary.cashflowMinor,
        returnsMinor: summary.returnsMinor,
        feesMinor: summary.feesMinor
      },
      note: "Imported from StashAway statement"
    }],
    warnings
  };
}

const cutShortMessage = "This StashAway statement looks cut short: its account summary is missing. Download the full statement again and add it.";

// The raw items, one per line. Space-only items between cells are dropped.
function readRawLines(rawText: string) {
  const text = rawText.replace(/\r/g, "\n");
  return (text.split("__PDF_LAYOUT_TEXT__")[0] ?? text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function readPeriod(lines: string[]) {
  const start = lines.findIndex((line) => /^Statement of Account$/i.test(line));
  const end = lines.findIndex((line, index) => index > start && /^Account Owner:/i.test(line));
  const joined = start >= 0 ? lines.slice(start + 1, end > start ? end : start + 6).join(" ") : "";
  const match = joined.match(PERIOD_PATTERN);
  const startMonth = match ? MONTHS[match[2].toUpperCase()] : undefined;
  const endMonth = match ? MONTHS[match[5].toUpperCase()] : undefined;
  if (!match || !startMonth || !endMonth) {
    throw new Error("Could not find the StashAway statement period.");
  }
  if (match[3] !== match[6] || startMonth !== endMonth) {
    throw new Error("This StashAway statement covers more than one calendar month. Only a statement for one calendar month can be imported.");
  }
  const checkpointMonth = `${match[6]}-${String(endMonth).padStart(2, "0")}`;
  return {
    checkpointMonth,
    startDate: formatDate(Number(match[3]), startMonth, Number(match[1])),
    endDate: formatDate(Number(match[6]), endMonth, Number(match[4])),
    endLabel: `${Number(match[4])} ${match[5]} ${match[6]}`,
    monthLabel: `${match[5]} ${match[6]}`
  };
}

function readReportingCurrency(lines: string[], summaryStart: number) {
  const index = lines.findIndex((line, at) => at > summaryStart && /^Reporting Currency:/i.test(line));
  const value = index >= 0
    ? (lines[index].replace(/^Reporting Currency:\s*/i, "") || lines[index + 1])
    : undefined;
  if (!value || !/^[A-Z]{3}$/.test(value)) {
    throw new Error("Could not read the StashAway reporting currency.");
  }
  return value;
}

function toMinor(token: string) {
  const negative = token.startsWith("-");
  const minor = Math.round(Number(token.replace(/[-$,]/g, "")) * 100);
  return negative ? -minor : minor;
}

// The account summary's "Total" row: opening, cashflow, total returns, fees
// (negative when charged) and closing balance.
function readSummaryTotal(lines: string[], summaryStart: number) {
  const end = lines.findIndex((line, index) => index > summaryStart && /^(?:PORTFOLIO SUMMARY|Opening balance is based)/i.test(line));
  const section = lines.slice(summaryStart + 1, end > summaryStart ? end : undefined);
  // "Total" alone, or glued to its figures; never the "Total Returns" heading.
  const totalAt = section.findIndex((line) => /^Total(?:\s+-?\$[\d,]+\.\d{2})*$/.test(line));
  if (totalAt < 0) {
    return undefined;
  }
  const tokens: string[] = [];
  const rest = section[totalAt].replace(/^Total/, "");
  tokens.push(...(rest.match(AMOUNT_TOKEN) ?? []));
  for (let index = totalAt + 1; index < section.length && tokens.length < 5; index += 1) {
    if (!AMOUNT_CELL.test(section[index])) {
      break;
    }
    tokens.push(section[index]);
  }
  if (tokens.length < 5) {
    return undefined;
  }
  const [openingMinor, cashflowMinor, returnsMinor, feesMinor, closingMinor] = tokens.slice(0, 5).map(toMinor);
  return { openingMinor, cashflowMinor, returnsMinor, feesMinor, closingMinor };
}

// The closing balance of each portfolio on the PORTFOLIO SUMMARY page: runs of
// five cells (opening, cashflow, returns, fees, closing) where a zero cashflow
// prints "-".
function readPortfolioClosings(lines: string[]) {
  const start = lines.findIndex((line) => /^PORTFOLIO SUMMARY\b/.test(line));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /^(?:Opening balance is based|PORTFOLIO DETAILS)/i.test(line));
  const closings: number[] = [];
  let run: string[] = [];
  const flush = () => {
    for (let at = 0; at + 5 <= run.length; at += 5) {
      closings.push(toMinor(run[at + 4]));
    }
    run = [];
  };
  for (const line of lines.slice(start + 1, end > start ? end : undefined)) {
    const inline = line.match(/^(.*?)((?:\s+(?:-|-?\$[\d,]+\.\d{2})){5})$/);
    const cells = inline ? inline[2].trim().split(/\s+/) : (line === "-" || AMOUNT_CELL.test(line) ? [line] : []);
    if (cells.length) {
      run.push(...cells);
    } else {
      flush();
    }
  }
  flush();
  return closings;
}

// The text after a label such as "Account Owner:", up to the next label. A
// name or code wrapped over several items is joined.
function readLabelled(lines: string[], label: string) {
  const index = lines.findIndex((line) => line === label);
  if (index < 0) {
    return "";
  }
  const parts: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (/:$/.test(line) || SECTION_HEADING.test(line)) {
      break;
    }
    parts.push(line);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ---- Deposits and withdrawals ----------------------------------------------

// The month's cash across the bank: dated rows when the TRANSACTIONS page lists
// them and they add up to the printed cashflow; otherwise one entry for the net
// cashflow dated the last day of the period, with a warning that says so.
function readCashflowRows(input: {
  lines: string[];
  accountName: string;
  period: ReturnType<typeof readPeriod>;
  cashflowMinor: number;
  warnings: string[];
}) {
  const dated = readDatedCashflowRows(input.lines);
  const datedNetMinor = dated.reduce((sum, row) => sum + (row.direction === "in" ? row.amountMinor : -row.amountMinor), 0);
  const toRow = (date: string, description: string, direction: "in" | "out", amountMinor: number) => ({
    date,
    description,
    expense: direction === "out" ? minorToDecimal(amountMinor) : "",
    income: direction === "in" ? minorToDecimal(amountMinor) : "",
    account: input.accountName,
    category: "Transfer",
    note: "",
    type: "transfer"
  });

  if (dated.length && datedNetMinor === input.cashflowMinor) {
    return dated.map((row) => toRow(row.date, `StashAway ${row.direction === "in" ? "deposit" : "withdrawal"}`, row.direction, row.amountMinor));
  }
  if (!input.cashflowMinor) {
    if (dated.length) {
      input.warnings.push(`StashAway's deposit and withdrawal rows do not add up to its cashflow of ${formatMoney(0)}, so they were not imported.`);
    }
    return [];
  }

  const direction = input.cashflowMinor > 0 ? "in" : "out";
  const amountMinor = Math.abs(input.cashflowMinor);
  input.warnings.push(dated.length
    ? `StashAway's deposit and withdrawal rows do not add up to its cashflow of ${formatMoney(input.cashflowMinor)}, so one entry for the month's net ${direction === "in" ? "deposits" : "withdrawals"} is dated ${input.period.endLabel} instead.`
    : `StashAway printed no dated deposits or withdrawals for this month, only the net ${formatMoney(amountMinor)}, so one entry for it is dated ${input.period.endLabel}.`);
  return [toRow(input.period.endDate, `StashAway net ${direction === "in" ? "deposits" : "withdrawals"}, ${input.period.monthLabel}`, direction, amountMinor)];
}

function formatMoney(minor: number) {
  const value = Math.abs(minor) / 100;
  return `${minor < 0 ? "-" : ""}$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Rows of the TRANSACTIONS page whose transaction reads Deposit or Withdrawal,
// like the management fee row: date, transaction, "-" for units, then the
// Singapore dollar amount as the last amount cell (inferred layout; the sign
// is taken from the word, not the minus sign).
function readDatedCashflowRows(lines: string[]) {
  const start = lines.findIndex((line) => /^TRANSACTIONS\b/.test(line));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /^(?:FEE CALCULATIONS|APPENDIX|NOTICE AND DISCLAIMER)\b/.test(line));
  const section = lines.slice(start + 1, end > start ? end : undefined);

  const rows: Array<{ date: string; direction: "in" | "out"; amountMinor: number }> = [];
  for (let index = 0; index < section.length; index += 1) {
    const date = readDateAt(section, index);
    if (!date) {
      continue;
    }
    const cells: string[] = [];
    let cursor = index + date.span;
    for (; cursor < section.length && !readDateAt(section, cursor); cursor += 1) {
      cells.push(section[cursor]);
    }
    index = cursor - 1;
    const kind = cells[0]?.match(/^(Deposit|Withdraw)/i)?.[1]?.toLowerCase();
    const amountCell = [...cells].reverse().find((cell) => AMOUNT_CELL.test(cell));
    if (!kind || !amountCell) {
      continue;
    }
    rows.push({ date: date.value, direction: kind === "deposit" ? "in" : "out", amountMinor: Math.abs(toMinor(amountCell)) });
  }
  return rows;
}

// A row's date is one item ("04 Sep 2026") or two ("04" then "Sep 2026").
function readDateAt(section: string[], index: number) {
  const whole = section[index].match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  const split = /^\d{1,2}$/.test(section[index]) ? section[index + 1]?.match(/^([A-Za-z]{3}) (\d{4})$/) : null;
  const parts = whole
    ? { day: whole[1], month: whole[2], year: whole[3], span: 1 }
    : split ? { day: section[index], month: split[1], year: split[2], span: 2 } : null;
  const month = parts ? MONTHS[parts.month.toUpperCase()] : undefined;
  return parts && month ? { value: formatDate(Number(parts.year), month, Number(parts.day)), span: parts.span } : null;
}
