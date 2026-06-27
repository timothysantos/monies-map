import {
  cleanOcbcDescription,
  compareImportRowsByDate,
  dateFromNumericStatementDate,
  findOcbc360Period,
  findOcbcStatementDate,
  formatDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  parseOcbcLastMoney,
  MONTHS,
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

  const accountName = findOcbcCreditCardAccountName(lines);
  if (!accountName) {
    throw new Error("Could not identify the OCBC credit card account.");
  }

  const section = parseOcbcCreditCardSection(lines, statementDate, accountName);
  const checkpointMonth = statementDate.slice(0, 7);
  return {
    parserKey: accountName === "OCBC 365 Credit Card"
      ? "ocbc_365_credit_card_pdf"
      : "ocbc_infinity_cashback_pdf",
    sourceLabel: labelFromFile(fileName, `${accountName} statement ${checkpointMonth}`),
    rows: section.rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName: section.accountName,
      checkpointMonth,
      statementStartDate: section.minDate,
      statementEndDate: statementDate,
      statementBalanceMinor: section.totalBalanceMinor,
      previousBalanceMinor: section.previousBalanceMinor,
      note: "Imported from OCBC credit card statement"
    }],
    warnings: []
  };
}

export function parseOcbcDepositStatement(lines: string[], fileName?: string): ParsedStatementImport {
  const accountHeader = findOcbcDepositAccountHeader(lines);
  if (!accountHeader) {
    throw new Error("Could not find the OCBC deposit account statement period.");
  }

  const previousIndex = lines.findIndex((line) => /^BALANCE B\/F\b/i.test(line));
  if (previousIndex < 0) {
    throw new Error("Could not find the OCBC deposit opening balance.");
  }

  const previousBalanceMinor = parseOcbcLastMoney(lines[previousIndex]);
  if (previousBalanceMinor == null) {
    throw new Error("Could not read the OCBC deposit opening balance.");
  }

  const closingIndex = lines.findIndex((line, index) => index > previousIndex && /^BALANCE C\/F\b/i.test(line));
  if (closingIndex < 0) {
    throw new Error("Could not find the OCBC deposit closing balance.");
  }

  const finalBalanceMinor = parseOcbcLastMoney(lines[closingIndex]);
  if (finalBalanceMinor == null) {
    throw new Error("Could not read the OCBC deposit closing balance.");
  }

  const rows = parseOcbcDepositRows(
    lines.slice(previousIndex + 1, closingIndex),
    accountHeader.accountName,
    previousBalanceMinor,
    accountHeader.startDate,
    accountHeader.endDate
  );
  const rowMovementMinor = rows.reduce((total, row) => {
    const incomeMinor = row.income ? parseOcbcMoneyToMinor(row.income) : 0;
    const expenseMinor = row.expense ? parseOcbcMoneyToMinor(row.expense) : 0;
    return total + incomeMinor - expenseMinor;
  }, 0);
  const computedBalanceMinor = previousBalanceMinor + rowMovementMinor;
  if (computedBalanceMinor !== finalBalanceMinor) {
    throw new Error(`OCBC deposit statement did not reconcile. Expected ${minorToDecimal(finalBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return {
    parserKey: "ocbc_cda_pdf",
    sourceLabel: labelFromFile(fileName, `${accountHeader.accountName} statement ${accountHeader.endDate.slice(0, 7)}`),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName: accountHeader.accountName,
      checkpointMonth: accountHeader.endDate.slice(0, 7),
      statementStartDate: accountHeader.startDate,
      statementEndDate: accountHeader.endDate,
      statementBalanceMinor: finalBalanceMinor,
      note: "Imported from OCBC deposit statement"
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
  for (let index = previousIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^BALANCE C\/F\b/i.test(line)) {
      finalBalanceMinor = parseOcbcLastMoney(line);
      break;
    }

    const parsedHeader = parseOcbc360TransactionHeader(line, period.startDate, period.endDate);
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
      note: parsedHeader.postDate === parsedHeader.date ? "" : `posted date: ${parsedHeader.postDate}`,
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

function parseOcbcCreditCardSection(lines: string[], statementDate: string, accountName: string): OcbcStatementSection {
  const statementYear = Number(statementDate.slice(0, 4));
  const statementMonth = Number(statementDate.slice(5, 7));
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

function findOcbcCreditCardAccountName(lines: string[]) {
  if (lines.some((line) => /^OCBC 365 CREDIT CARD$/i.test(line))) {
    return "OCBC 365 Credit Card";
  }
  if (lines.some((line) => /^OCBC INFINITY CASHBACK$/i.test(line))) {
    return "OCBC Infinity Cashback";
  }
  return undefined;
}

function findOcbcDepositAccountHeader(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^(CHILD DEVELOPMENT ACC \(CDA\))\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+TO\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/i);
    if (!match) {
      continue;
    }
    return {
      accountName: "Child Development Acc (CDA)",
      startDate: formatDate(Number(match[4]), MONTHS[match[3].toUpperCase()], Number(match[2])),
      endDate: formatDate(Number(match[7]), MONTHS[match[6].toUpperCase()], Number(match[5]))
    };
  }
  return undefined;
}

function parseOcbcDepositRows(
  lines: string[],
  accountName: string,
  openingBalanceMinor: number,
  statementStartDate: string,
  statementEndDate: string
) {
  const rows: Record<string, string>[] = [];
  let runningBalanceMinor = openingBalanceMinor;
  for (const line of lines) {
    const parsedRow = parseOcbcDepositTransactionLine(line, accountName, statementStartDate, statementEndDate);
    if (!parsedRow) {
      continue;
    }
    if (parsedRow.balanceMinor != null) {
      const expectedMovement = parsedRow.balanceMinor - runningBalanceMinor;
      const signedMovement = parsedRow.incomeMinor - parsedRow.expenseMinor;
      if (expectedMovement !== signedMovement) {
        throw new Error(`OCBC deposit row did not reconcile around ${parsedRow.row.date}. Expected row movement ${minorToDecimal(expectedMovement)}, got ${minorToDecimal(signedMovement)}.`);
      }
      runningBalanceMinor = parsedRow.balanceMinor;
    }
    rows.push(parsedRow.row);
  }
  return rows;
}

function parseOcbcDepositTransactionLine(
  line: string,
  accountName: string,
  statementStartDate: string,
  statementEndDate: string
) {
  const datePattern = "(\\d{1,2}\\s+[A-Z]{3})";
  const moneyPattern = "(\\d{1,3}(?:\\s*,\\s*\\d{3})*\\s*\\.\\s*\\d{2})";
  const match = line.match(new RegExp(`^${datePattern}\\s+${datePattern}\\s+(.+?)\\s+${moneyPattern}(?:\\s+${moneyPattern})?(?:\\s+${moneyPattern})?$`, "i"));
  if (!match) {
    return null;
  }

  const transactionDate = dateFromOcbc360StatementParts(match[1].split(/\s+/)[0], match[1].split(/\s+/)[1], statementStartDate, statementEndDate);
  const valueDate = dateFromOcbc360StatementParts(match[2].split(/\s+/)[0], match[2].split(/\s+/)[1], statementStartDate, statementEndDate);
  const moneyValues = Array.from(line.matchAll(/\d{1,3}(?:\s*,\s*\d{3})*\s*\.\s*\d{2}/g)).map((moneyMatch) => moneyMatch[0]);
  if (moneyValues.length < 2) {
    return null;
  }

  const balanceMinor = parseOcbcMoneyToMinor(moneyValues.at(-1) ?? "0.00");
  const depositMinor = moneyValues.length >= 3 ? parseOcbcMoneyToMinor(moneyValues.at(-2) ?? "0.00") : 0;
  const withdrawalMinor = moneyValues.length >= 3 ? parseOcbcMoneyToMinor(moneyValues.at(-3) ?? "0.00") : parseOcbcMoneyToMinor(moneyValues[0]);
  const isIncome = depositMinor > 0;
  const amountMinor = isIncome ? depositMinor : withdrawalMinor;
  const description = cleanOcbcDescription(match[3]);
  const type = isTransferDescription(description) ? "transfer" : isIncome ? "income" : "expense";

  return {
    incomeMinor: isIncome ? amountMinor : 0,
    expenseMinor: isIncome ? 0 : amountMinor,
    balanceMinor,
    row: {
      date: transactionDate,
      description,
      expense: isIncome ? "" : minorToDecimal(amountMinor),
      income: isIncome ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isIncome),
      note: valueDate === transactionDate ? "" : `value date: ${valueDate}`,
      type
    }
  };
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

function parseOcbc360TransactionHeader(line: string, statementStartDate: string, statementEndDate: string) {
  const match = line.match(/^(\d{2})\s+([A-Z]{3})\s+(\d{2})\s+([A-Z]{3})\s+(.+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s+(\d{1,3}(?:,\d{3})*\.\d{2})$/);
  if (!match) {
    return null;
  }
  const postDate = dateFromOcbc360StatementParts(match[1], match[2], statementStartDate, statementEndDate);
  const valueDate = dateFromOcbc360StatementParts(match[3], match[4], statementStartDate, statementEndDate);
  const date = postDate > statementEndDate && valueDate >= statementStartDate && valueDate <= statementEndDate
    ? valueDate
    : postDate;
  return {
    date,
    postDate,
    valueDate,
    description: match[5],
    amountMinor: parseOcbcMoneyToMinor(match[6]),
    balanceMinor: parseOcbcMoneyToMinor(match[7])
  };
}

function dateFromOcbc360StatementParts(day: string, monthLabel: string, statementStartDate: string, statementEndDate: string) {
  const month = MONTHS[monthLabel.toUpperCase()];
  const statementStartYear = Number(statementStartDate.slice(0, 4));
  const statementEndYear = Number(statementEndDate.slice(0, 4));
  const candidateYears = Array.from(new Set([
    statementStartYear - 1,
    statementStartYear,
    statementEndYear,
    statementEndYear + 1
  ]));
  const candidates = candidateYears.map((year) => formatDate(year, month, Number(day)));
  const inPeriod = candidates.find((date) => date >= statementStartDate && date <= statementEndDate);
  if (inPeriod) {
    return inPeriod;
  }

  return candidates.sort((left, right) => distanceFromDate(left, statementEndDate) - distanceFromDate(right, statementEndDate))[0];
}

function distanceFromDate(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`));
}

function isOcbc360TransactionBoundary(line: string) {
  return /^(\d{2})\s+[A-Z]{3}\s+\d{2}\s+[A-Z]{3}\s+/.test(line)
    || /^BALANCE C\/F\b/i.test(line)
    || /^Total Withdrawals\/Deposits\b/i.test(line);
}
