import {
  cleanOcbcDescription,
  compareImportRowsByDate,
  dateFromNumericStatementDate,
  dateFromShortParts,
  findOcbc360Period,
  findOcbcStatementDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  parseOcbcLastMoney,
  parseOcbcMoneyToMinor,
  type ParsedStatementImport
} from "./shared";

interface OcbcStatementSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minDate?: string;
  maxDate?: string;
  rows: Record<string, string>[];
}

export function parseOcbcCreditCardStatement(lines: string[], fileName?: string): ParsedStatementImport {
  const statementDate = findOcbcStatementDate(lines);
  if (!statementDate) {
    throw new Error("Could not find the OCBC credit card statement date.");
  }

  const section = parseOcbcCreditCardSection(lines, statementDate);
  const checkpointMonth = statementDate.slice(0, 7);
  return {
    parserKey: "ocbc_365_credit_card_pdf",
    sourceLabel: labelFromFile(fileName, `OCBC 365 statement ${checkpointMonth}`),
    rows: section.rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName: section.accountName,
      checkpointMonth,
      statementStartDate: section.minDate,
      statementEndDate: statementDate,
      statementBalanceMinor: section.totalBalanceMinor,
      note: "Imported from OCBC credit card statement"
    }],
    warnings: []
  };
}

export function parseOcbc360Statement(lines: string[], fileName?: string): ParsedStatementImport {
  const period = findOcbc360Period(lines);
  if (!period) {
    throw new Error("Could not find the OCBC 360 statement period.");
  }

  const accountName = "OCBC 360";
  const previousIndex = lines.findIndex((line) => /^BALANCE B\/F\b/i.test(line));
  if (previousIndex < 0) {
    throw new Error("Could not find the OCBC 360 opening balance.");
  }

  const previousBalanceMinor = parseOcbcLastMoney(lines[previousIndex]);
  if (previousBalanceMinor == null) {
    throw new Error("Could not read the OCBC 360 opening balance.");
  }

  const rows: Record<string, string>[] = [];
  let runningBalanceMinor = previousBalanceMinor;
  let finalBalanceMinor: number | undefined;
  let minDate: string | undefined;
  let maxDate: string | undefined;
  const statementYear = Number(period.endDate.slice(0, 4));
  const statementMonth = Number(period.endDate.slice(5, 7));

  for (let index = previousIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^BALANCE C\/F\b/i.test(line)) {
      finalBalanceMinor = parseOcbcLastMoney(line);
      break;
    }

    const parsedHeader = parseOcbc360TransactionHeader(line, statementYear, statementMonth);
    if (!parsedHeader) {
      continue;
    }

    const continuationLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !isOcbc360TransactionBoundary(lines[cursor])) {
      continuationLines.push(lines[cursor]);
      cursor += 1;
    }
    index = cursor - 1;

    const isIncome = parsedHeader.balanceMinor > runningBalanceMinor;
    const amountMinor = Math.abs(parsedHeader.balanceMinor - runningBalanceMinor);
    if (amountMinor !== parsedHeader.amountMinor) {
      throw new Error(`OCBC 360 row did not reconcile around ${parsedHeader.date}. Expected row amount ${minorToDecimal(amountMinor)}, got ${minorToDecimal(parsedHeader.amountMinor)}.`);
    }

    const description = cleanOcbcDescription([parsedHeader.description, ...continuationLines].join(" "));
    const type = !isIncome && isTransferDescription(description) ? "transfer" : isIncome && isTransferDescription(description) ? "transfer" : isIncome ? "income" : "expense";
    rows.push({
      date: parsedHeader.date,
      description,
      expense: isIncome ? "" : minorToDecimal(amountMinor),
      income: isIncome ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isIncome),
      note: parsedHeader.valueDate === parsedHeader.date ? "" : `value date: ${parsedHeader.valueDate}`,
      type
    });
    minDate = minDate && minDate < parsedHeader.date ? minDate : parsedHeader.date;
    maxDate = maxDate && maxDate > parsedHeader.date ? maxDate : parsedHeader.date;
    runningBalanceMinor = parsedHeader.balanceMinor;
  }

  if (finalBalanceMinor == null) {
    throw new Error("Could not read the OCBC 360 closing balance.");
  }
  if (runningBalanceMinor !== finalBalanceMinor) {
    throw new Error(`OCBC 360 statement did not reconcile. Expected ${minorToDecimal(finalBalanceMinor)}, got ${minorToDecimal(runningBalanceMinor)}.`);
  }

  return {
    parserKey: "ocbc_360_pdf",
    sourceLabel: labelFromFile(fileName, `OCBC 360 statement ${period.endDate.slice(0, 7)}`),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName,
      checkpointMonth: period.endDate.slice(0, 7),
      statementStartDate: period.startDate,
      statementEndDate: period.endDate,
      statementBalanceMinor: finalBalanceMinor,
      note: "Imported from OCBC 360 statement"
    }],
    warnings: []
  };
}

function parseOcbcCreditCardSection(lines: string[], statementDate: string): OcbcStatementSection {
  const statementYear = Number(statementDate.slice(0, 4));
  const statementMonth = Number(statementDate.slice(5, 7));
  const accountName = "OCBC 365 Credit Card";
  const previousIndex = lines.findIndex((line) => /^LAST MONTH '? S BALANCE\b/i.test(line));
  if (previousIndex < 0) {
    throw new Error("Could not find the OCBC card previous balance.");
  }

  const previousBalanceMinor = parseOcbcLastMoney(lines[previousIndex]);
  if (previousBalanceMinor == null) {
    throw new Error("Could not read the OCBC card previous balance.");
  }

  let totalBalanceMinor: number | undefined;
  let expenseMinor = 0;
  let incomeMinor = 0;
  let minDate: string | undefined;
  let maxDate: string | undefined;
  const rows: Record<string, string>[] = [];

  for (let index = previousIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^SUBTOTAL\b/i.test(line)) {
      totalBalanceMinor = parseOcbcLastMoney(line);
      break;
    }

    const parsedRow = parseOcbcCardTransactionLine(line, accountName, statementYear, statementMonth);
    if (!parsedRow) {
      continue;
    }

    if (parsedRow.isCredit) {
      incomeMinor += parsedRow.amountMinor;
    } else {
      expenseMinor += parsedRow.amountMinor;
    }
    minDate = minDate && minDate < parsedRow.date ? minDate : parsedRow.date;
    maxDate = maxDate && maxDate > parsedRow.date ? maxDate : parsedRow.date;
    rows.push(parsedRow.row);
  }

  if (totalBalanceMinor == null) {
    throw new Error("Could not read the OCBC card total balance.");
  }

  const computedBalanceMinor = previousBalanceMinor + expenseMinor - incomeMinor;
  if (computedBalanceMinor !== totalBalanceMinor) {
    throw new Error(`OCBC card section did not reconcile. Expected ${minorToDecimal(totalBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return { accountName, previousBalanceMinor, totalBalanceMinor, minDate, maxDate, rows };
}

function parseOcbcCardTransactionLine(line: string, accountName: string, statementYear: number, statementMonth: number) {
  const match = line.match(/^(\d{2})\s*\/\s*(\d{2})\s+(.+?)\s+(\(?\s*\d{1,3}(?:\s*,\s*\d{3})*\s*\.\s*\d{2}\s*\)?)$/);
  if (!match) {
    return null;
  }

  const date = dateFromNumericStatementDate(match[1], match[2], statementYear, statementMonth);
  const amountText = match[4];
  const amountMinor = parseOcbcMoneyToMinor(amountText);
  if (!amountMinor) {
    return null;
  }

  const isCredit = /^\s*\(/.test(amountText);
  const description = cleanOcbcDescription(match[3]);
  const type = isCredit && isTransferDescription(description) ? "transfer" : isCredit ? "income" : isTransferDescription(description) ? "transfer" : "expense";

  return {
    date,
    amountMinor,
    isCredit,
    row: {
      date,
      description,
      expense: isCredit ? "" : minorToDecimal(amountMinor),
      income: isCredit ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isCredit),
      note: "",
      type
    }
  };
}

function parseOcbc360TransactionHeader(line: string, statementYear: number, statementMonth: number) {
  const match = line.match(/^(\d{2})\s+([A-Z]{3})\s+(\d{2})\s+([A-Z]{3})\s+(.+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s+(\d{1,3}(?:,\d{3})*\.\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    date: dateFromShortParts(match[1], match[2], statementYear, statementMonth),
    valueDate: dateFromShortParts(match[3], match[4], statementYear, statementMonth),
    description: match[5],
    amountMinor: parseOcbcMoneyToMinor(match[6]),
    balanceMinor: parseOcbcMoneyToMinor(match[7])
  };
}

function isOcbc360TransactionBoundary(line: string) {
  return /^(\d{2})\s+[A-Z]{3}\s+\d{2}\s+[A-Z]{3}\s+/.test(line)
    || /^BALANCE C\/F\b/i.test(line)
    || /^Total Withdrawals\/Deposits\b/i.test(line);
}
