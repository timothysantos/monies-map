const IMPORT_HEADERS = ["date", "description", "expense", "income", "account", "category", "note", "type"];

const MONTHS: Record<string, number> = {
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

interface SpreadsheetCell {
  row: number;
  column: number;
  value: string | number;
}

interface CreditCardSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minPostDate?: string;
  rows: Record<string, string>[];
}

interface CitibankCreditCardSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minDate?: string;
  maxDate?: string;
  rows: Record<string, string>[];
}

interface OcbcStatementSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minDate?: string;
  maxDate?: string;
  rows: Record<string, string>[];
}

export function parseStatementText(text: string, fileName?: string): ParsedStatementImport {
  const normalizedText = text.replace(/\r/g, "\n");
  const layoutLines = getPdfLayoutLines(normalizedText);
  const spacedLayoutLines = getPdfSpacedLayoutLines(normalizedText);
  if (layoutLines.some((line) => /TRANSACTIONSFORCITI(?:REWARDSWORLDMASTERCARD|PREMIERMILE(?:S|SWORLDMASTER)CARD)/i.test(line))) {
    return parseCitibankCreditCardStatement(layoutLines, fileName);
  }

  if (spacedLayoutLines.some((line) => /^OCBC 365 CREDIT CARD$/i.test(line))) {
    return parseOcbcCreditCardStatement(spacedLayoutLines, fileName);
  }

  if (spacedLayoutLines.some((line) => /^360 ACCOUNT\b/i.test(line))) {
    return parseOcbc360Statement(spacedLayoutLines, fileName);
  }

  if (/Credit Card\(s\) Statement/i.test(normalizedText) || /TOTAL BALANCE FOR/i.test(normalizedText)) {
    return parseUobCreditCardStatement(normalizedText, fileName);
  }

  if (/Statement of Account/i.test(normalizedText) && /Account Transaction Details/i.test(normalizedText)) {
    return parseUobSavingsStatement(normalizedText, fileName);
  }

  throw new Error("Unsupported statement PDF. This importer currently recognizes UOB, Citibank Rewards, Citibank Miles, OCBC 365, and OCBC 360 statement text.");
}

export function statementRowsToCsv(rows: Record<string, string>[]) {
  const lines = [IMPORT_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(IMPORT_HEADERS.map((header) => csvCell(row[header] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function parseCurrentTransactionSpreadsheet(data: ArrayBuffer, fileName?: string): ParsedStatementImport {
  const cells = parseBiff8XlsCells(data);
  const rowsByIndex = new Map<number, Map<number, string | number>>();
  for (const cell of cells) {
    if (!rowsByIndex.has(cell.row)) {
      rowsByIndex.set(cell.row, new Map());
    }
    rowsByIndex.get(cell.row)?.set(cell.column, cell.value);
  }

  const flattenedRows = Array.from(rowsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([rowIndex, values]) => ({
      rowIndex,
      values
    }));

  const accountType = cellString(flattenedRows.find((row) => /^Account Type:$/i.test(cellString(row.values.get(0))))?.values.get(1));
  const accountName = /One Account/i.test(accountType) ? "UOB One" : accountType ? `UOB ${accountType}` : "UOB Account";
  const period = cellString(flattenedRows.find((row) => /^Statement Period:$/i.test(cellString(row.values.get(0))))?.values.get(1));
  const headerRow = flattenedRows.find((row) => (
    /^Transaction Date$/i.test(cellString(row.values.get(0)))
    && /^Transaction Description$/i.test(cellString(row.values.get(1)))
    && /^Withdrawal$/i.test(cellString(row.values.get(2)))
    && /^Deposit$/i.test(cellString(row.values.get(3)))
  ));

  if (!headerRow) {
    throw new Error("Unsupported XLS transaction history. Could not find the UOB transaction history header row.");
  }

  const rows: Record<string, string>[] = [];
  for (const row of flattenedRows.filter((candidate) => candidate.rowIndex > headerRow.rowIndex)) {
    const date = parseLongDateCell(cellString(row.values.get(0)));
    const rawDescription = cellString(row.values.get(1));
    if (!date || !rawDescription) {
      continue;
    }

    const withdrawalMinor = cellMoneyToMinor(row.values.get(2));
    const depositMinor = cellMoneyToMinor(row.values.get(3));
    if (!withdrawalMinor && !depositMinor) {
      continue;
    }

    const isIncome = Boolean(depositMinor);
    const amountMinor = depositMinor || withdrawalMinor || 0;
    const description = cleanUobSavingsDescription(compactDescription(rawDescription));
    const type = isTransferDescription(description) ? "transfer" : isIncome ? "income" : "expense";
    rows.push({
      date,
      description,
      expense: isIncome ? "" : minorToDecimal(amountMinor),
      income: isIncome ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isIncome),
      note: "",
      type
    });
  }

  if (!rows.length) {
    throw new Error("No UOB current transaction rows were found in this XLS file.");
  }

  return {
    parserKey: "uob_current_transactions_xls",
    sourceLabel: labelFromFile(fileName, period ? `UOB current transactions ${period}` : "UOB current transactions"),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [],
    warnings: []
  };
}

function parseUobCreditCardStatement(text: string, fileName?: string): ParsedStatementImport {
  const lines = cleanLines(text);
  const statementDate = findDateAfter(lines, "Statement Date") ?? findLongDate(lines);
  if (!statementDate) {
    throw new Error("Could not find the UOB credit card statement date.");
  }

  const statementYear = Number(statementDate.slice(0, 4));
  const statementMonth = Number(statementDate.slice(5, 7));
  const sections: CreditCardSection[] = [];
  let currentAccountName = "";

  for (let index = 0; index < lines.length; index += 1) {
    const accountName = normalizeUobCardAccountName(lines[index]);
    if (accountName && /^\d{4}-\d{4}-\d{4}-\d{4}/.test(lines[index + 1] ?? "")) {
      currentAccountName = accountName;
      continue;
    }

    if (lines[index] !== "PREVIOUS BALANCE") {
      continue;
    }

    if (!currentAccountName) {
      throw new Error("Found a UOB card transaction section without a card account heading.");
    }

    const section = parseUobCreditCardSection(lines, index, currentAccountName, statementYear, statementMonth);
    sections.push(section);
    index = sectionEndIndex(lines, index);
  }

  if (!sections.length) {
    throw new Error("No UOB credit card transaction sections were found.");
  }

  const rows = sections.flatMap((section) => section.rows).sort(compareImportRowsByDate);
  const checkpoints = sections.map((section) => ({
    accountName: section.accountName,
    checkpointMonth: statementDate.slice(0, 7),
    statementStartDate: section.minPostDate,
    statementEndDate: statementDate,
    statementBalanceMinor: section.totalBalanceMinor,
    note: "Imported from UOB credit card statement"
  }));

  return {
    parserKey: "uob_credit_card_pdf",
    sourceLabel: labelFromFile(fileName, `UOB card statement ${statementDate.slice(0, 7)}`),
    rows,
    checkpoints,
    warnings: []
  };
}

function parseUobCreditCardSection(
  lines: string[],
  previousBalanceIndex: number,
  accountName: string,
  statementYear: number,
  statementMonth: number
): CreditCardSection {
  const previousBalanceMinor = parseMoneyLineToMinor(lines[previousBalanceIndex + 1]);
  if (previousBalanceMinor == null) {
    throw new Error(`Could not read previous balance for ${accountName}.`);
  }

  const rows: Record<string, string>[] = [];
  let expenseMinor = 0;
  let incomeMinor = 0;
  let minPostDate: string | undefined;
  let index = previousBalanceIndex + 2;

  for (; index < lines.length; index += 1) {
    if (lines[index] === "SUB TOTAL" || lines[index].startsWith("TOTAL BALANCE FOR") || /End of Transaction Details/i.test(lines[index])) {
      break;
    }

    if (!isShortStatementDate(lines[index]) || !isShortStatementDate(lines[index + 1] ?? "")) {
      continue;
    }

    const postDate = dateFromShortStatementDate(lines[index], statementYear, statementMonth);
    const transDate = dateFromShortStatementDate(lines[index + 1], statementYear, statementMonth);
    const descriptionLines: string[] = [];
    let reference = "";
    let amountLine = "";
    let cursor = index + 2;

    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isMoneyLine(line)) {
        amountLine = line;
        break;
      }
      if (line.startsWith("Ref No.")) {
        reference = line.replace(/^Ref No\.\s*:\s*/i, "").trim();
        continue;
      }
      descriptionLines.push(line);
    }

    if (!amountLine) {
      throw new Error(`Could not read amount for ${accountName} transaction on ${postDate}.`);
    }

    const amountMinor = parseMoneyLineToMinor(amountLine);
    if (!amountMinor) {
      throw new Error(`Could not parse amount for ${accountName} transaction on ${postDate}.`);
    }

    const isCredit = /\bCR$/i.test(amountLine);
    if (isCredit) {
      incomeMinor += amountMinor;
    } else {
      expenseMinor += amountMinor;
    }
    minPostDate = minPostDate && minPostDate < postDate ? minPostDate : postDate;

    const description = cleanUobSavingsDescription(compactDescription(descriptionLines.join(" ")));
    const type = isCredit && isTransferDescription(description) ? "transfer" : isCredit ? "income" : isTransferDescription(description) ? "transfer" : "expense";
    rows.push({
      date: postDate,
      description,
      expense: isCredit ? "" : minorToDecimal(amountMinor),
      income: isCredit ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isCredit),
      note: `txn date: ${transDate}`,
      type,
      reference
    });

    index = cursor;
  }

  const totalIndex = lines.findIndex((line, candidateIndex) => candidateIndex >= index && line === `TOTAL BALANCE FOR ${denormalizeUobCardAccountName(accountName)}`);
  const totalBalanceMinor = totalIndex >= 0 ? parseMoneyLineToMinor(lines[totalIndex + 1]) : undefined;
  if (totalBalanceMinor == null) {
    throw new Error(`Could not read total balance for ${accountName}.`);
  }

  const computedBalanceMinor = previousBalanceMinor + expenseMinor - incomeMinor;
  if (computedBalanceMinor !== totalBalanceMinor) {
    throw new Error(`UOB card section did not reconcile for ${accountName}. Expected ${minorToDecimal(totalBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return {
    accountName,
    previousBalanceMinor,
    totalBalanceMinor,
    minPostDate,
    rows
  };
}

function parseUobSavingsStatement(text: string, fileName?: string): ParsedStatementImport {
  const lines = cleanLines(text);
  const period = findUobSavingsPeriod(lines);
  if (!period) {
    throw new Error("Could not find the UOB savings statement period.");
  }

  const accountName = /One Account/i.test(text) ? "UOB One" : "UOB Savings";
  const rows: Record<string, string>[] = [];
  const startIndex = lines.findIndex((line) => line === "Account Transaction Details");
  if (startIndex < 0) {
    throw new Error("Could not find UOB savings transaction details.");
  }

  let previousBalanceMinor: number | undefined;
  let endBalanceMinor: number | undefined;
  let withdrawalsMinor = 0;
  let depositsMinor = 0;
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (/^Total$/i.test(line) || /End of Transaction Details/i.test(line)) {
      break;
    }
    if (!isSavingsDateLine(line)) {
      index += 1;
      continue;
    }

    const recordStart = index;
    index += 1;
    while (index < lines.length && !isSavingsDateLine(lines[index]) && !/^Total$/i.test(lines[index]) && !/End of Transaction Details/i.test(lines[index])) {
      index += 1;
    }

    const record = lines.slice(recordStart, index);
    const moneyValues = record.map((item) => parseMoneyLineToMinor(item)).filter((value): value is number => value != null);
    const date = dateFromSavingsDate(record[0], period.endDate.slice(0, 4));
    const descriptionLines = record.slice(1).filter((item) => parseMoneyLineToMinor(item) == null && !isUobSavingsNoiseLine(item));
    const description = cleanUobSavingsDescription(compactDescription(descriptionLines.join(" ")));

    if (/^BALANCE B\/F$/i.test(description)) {
      previousBalanceMinor = moneyValues.at(-1);
      endBalanceMinor = previousBalanceMinor;
      continue;
    }

    if (previousBalanceMinor == null || moneyValues.length < 2) {
      throw new Error(`Could not read UOB savings amount and balance for ${date}.`);
    }

    const amountMinor = moneyValues[moneyValues.length - 2];
    const balanceMinor = moneyValues[moneyValues.length - 1];
    const depositMatches = previousBalanceMinor + amountMinor === balanceMinor;
    const withdrawalMatches = previousBalanceMinor - amountMinor === balanceMinor;
    if (!depositMatches && !withdrawalMatches) {
      throw new Error(`UOB savings running balance did not reconcile for ${date} ${description}.`);
    }

    const isDeposit = depositMatches;
    const type = isTransferDescription(description) ? "transfer" : isDeposit ? "income" : "expense";
    rows.push({
      date,
      description,
      expense: isDeposit ? "" : minorToDecimal(amountMinor),
      income: isDeposit ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isDeposit),
      note: "",
      type
    });

    if (isDeposit) {
      depositsMinor += amountMinor;
    } else {
      withdrawalsMinor += amountMinor;
    }
    previousBalanceMinor = balanceMinor;
    endBalanceMinor = balanceMinor;
  }

  const statementBalanceMinor = parseSavingsOverviewBalance(lines) ?? endBalanceMinor;
  if (statementBalanceMinor == null || endBalanceMinor == null) {
    throw new Error("Could not read UOB savings statement ending balance.");
  }
  const computedBalanceMinor = (parseSavingsOpeningBalance(lines) ?? 0) + depositsMinor - withdrawalsMinor;
  if (computedBalanceMinor !== statementBalanceMinor) {
    throw new Error(`UOB savings statement did not reconcile. Expected ${minorToDecimal(statementBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return {
    parserKey: "uob_savings_pdf",
    sourceLabel: labelFromFile(fileName, `UOB savings statement ${period.endDate.slice(0, 7)}`),
    rows,
    checkpoints: [{
      accountName,
      checkpointMonth: period.endDate.slice(0, 7),
      statementStartDate: period.startDate,
      statementEndDate: period.endDate,
      statementBalanceMinor,
      note: "Imported from UOB savings statement"
    }],
    warnings: []
  };
}

function parseCitibankCreditCardStatement(lines: string[], fileName?: string): ParsedStatementImport {
  const fallbackMonth = findStatementMonthFromFileName(fileName);
  const dueDate = findCitibankDueDate(lines);
  const checkpointMonth = dueDate ? previousMonth(dueDate.slice(0, 7)) : fallbackMonth;
  if (!checkpointMonth) {
    throw new Error("Could not infer the Citibank statement month.");
  }

  const statementYear = Number(checkpointMonth.slice(0, 4));
  const statementMonth = Number(checkpointMonth.slice(5, 7));
  const sections: CitibankCreditCardSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const accountName = normalizeCitibankCardAccountName(lines[index]);
    if (!accountName || !lines[index].startsWith("TRANSACTIONSFOR")) {
      continue;
    }

    const section = parseCitibankCreditCardSection(lines, index, accountName, statementYear, statementMonth);
    sections.push(section);
  }

  if (!sections.length) {
    throw new Error("No Citibank credit card transaction sections were found.");
  }

  const rows = sections.flatMap((section) => section.rows).sort(compareImportRowsByDate);
  const checkpoints = sections.map((section) => ({
    accountName: section.accountName,
    checkpointMonth,
    statementStartDate: section.minDate,
    statementEndDate: section.maxDate ?? getMonthEndDateFromMonth(checkpointMonth),
    statementBalanceMinor: section.totalBalanceMinor,
    note: "Imported from Citibank credit card statement"
  }));

  return {
    parserKey: "citibank_credit_card_pdf",
    sourceLabel: labelFromFile(fileName, `Citibank card statement ${checkpointMonth}`),
    rows,
    checkpoints,
    warnings: []
  };
}

function parseCitibankCreditCardSection(
  lines: string[],
  sectionStartIndex: number,
  accountName: string,
  statementYear: number,
  statementMonth: number
): CitibankCreditCardSection {
  let previousBalanceMinor: number | undefined;
  let totalBalanceMinor: number | undefined;
  let expenseMinor = 0;
  let incomeMinor = 0;
  let minDate: string | undefined;
  let maxDate: string | undefined;
  const rows: Record<string, string>[] = [];

  for (let index = sectionStartIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("TRANSACTIONSFOR") && index > sectionStartIndex + 1) {
      break;
    }
    if (/^YOURCITI/i.test(line)) {
      break;
    }
    if (line.startsWith("BALANCEPREVIOUSSTATEMENT")) {
      previousBalanceMinor = parseCitibankLastSignedMoney(line);
      continue;
    }
    if (line.startsWith("GRANDTOTAL")) {
      totalBalanceMinor = parseCitibankLastSignedMoney(line) ?? parseCitibankGrandTotalFromPreviousLines(lines, index);
      break;
    }

    const parsedRow = parseCitibankTransactionLine(line, accountName, statementYear, statementMonth);
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

  if (previousBalanceMinor == null || totalBalanceMinor == null) {
    throw new Error(`Could not read Citibank balances for ${accountName}.`);
  }

  const computedBalanceMinor = previousBalanceMinor + expenseMinor - incomeMinor;
  if (computedBalanceMinor !== totalBalanceMinor) {
    throw new Error(`Citibank card section did not reconcile for ${accountName}. Expected ${minorToDecimal(totalBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return {
    accountName,
    previousBalanceMinor,
    totalBalanceMinor,
    minDate,
    maxDate,
    rows
  };
}

function parseCitibankTransactionLine(line: string, accountName: string, statementYear: number, statementMonth: number) {
  const match = line.match(/^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
  if (!match) {
    return null;
  }

  const moneyMatch = findCitibankTransactionMoneyMatch(line);
  if (!moneyMatch) {
    return null;
  }

  const amountMinor = parseCitibankMoneyToMinor(moneyMatch.value);
  if (!amountMinor) {
    return null;
  }

  const date = dateFromCompactStatementDate(match[1], match[2], statementYear, statementMonth);
  const rawDescription = line.slice(match[0].length, moneyMatch.index);
  const description = cleanCitibankDescription(rawDescription);
  const isCredit = /^\(.+\)$/.test(moneyMatch.value);
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

function parseOcbcCreditCardStatement(lines: string[], fileName?: string): ParsedStatementImport {
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

function parseOcbc360Statement(lines: string[], fileName?: string): ParsedStatementImport {
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

function findCitibankTransactionMoneyMatch(line: string) {
  const moneyMatches = Array.from(line.matchAll(/\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g));
  const match = moneyMatches.at(-1);
  if (!match?.[0] || match.index == null) {
    return undefined;
  }

  // Citibank layout text can glue an "account ending ####" suffix directly to
  // a four-digit amount, e.g. ENDING63491,208.20. In that case the broad money
  // regex sees 491,208.20; keep the shortest valid comma amount at the end.
  if (!match[0].startsWith("(") && match[0].includes(",") && match.index > 0 && /\d/.test(line[match.index - 1])) {
    const compactAmount = match[0].match(/\d,\d{3}\.\d{2}\)?$/)?.[0];
    if (compactAmount && compactAmount !== match[0]) {
      return {
        value: compactAmount,
        index: match.index + match[0].lastIndexOf(compactAmount)
      };
    }
  }

  return {
    value: match[0],
    index: match.index
  };
}

function cleanLines(text: string) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && line !== "•");
}

function getPdfLayoutLines(text: string) {
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

function getPdfSpacedLayoutLines(text: string) {
  const markerIndex = text.indexOf("__PDF_SPACED_LAYOUT_TEXT__");
  if (markerIndex < 0) {
    return [];
  }
  return cleanLines(text.slice(markerIndex + "__PDF_SPACED_LAYOUT_TEXT__".length));
}

function csvCell(value: string) {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function findDateAfter(lines: string[], label: string) {
  const index = lines.findIndex((line) => line === label);
  if (index < 0) {
    return undefined;
  }
  return findLongDate(lines.slice(index + 1, index + 6));
}

function findLongDate(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^(\d{2}) ([A-Z]{3}) (\d{4})$/);
    if (match) {
      return formatDate(Number(match[3]), MONTHS[match[2]], Number(match[1]));
    }
  }
  return undefined;
}

function isUobSavingsNoiseLine(value: string) {
  return /Please note|United Overseas Bank|Reg\. No\.|www\.uob\.com\.sg|Page \d+ of \d+|不得向本行索取赔偿|本行|UOB Group/i.test(value);
}

function cleanUobSavingsDescription(value: string) {
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

function findUobSavingsPeriod(lines: string[]) {
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

function parseSavingsOverviewBalance(lines: string[]) {
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

function parseSavingsOpeningBalance(lines: string[]) {
  const index = lines.findIndex((line) => /^BALANCE B\/F$/i.test(line));
  return index >= 0 ? parseMoneyLineToMinor(lines[index + 1]) : undefined;
}

function isShortStatementDate(value: string) {
  return /^\d{2} [A-Z]{3}$/.test(value);
}

function isSavingsDateLine(value: string) {
  return /^\d{2} [A-Za-z]{3}$/.test(value);
}

function dateFromShortStatementDate(value: string, statementYear: number, statementMonth: number) {
  const [day, monthLabel] = value.split(" ");
  const month = MONTHS[monthLabel.toUpperCase()];
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

function dateFromCompactStatementDate(day: string, monthLabel: string, statementYear: number, statementMonth: number) {
  const month = MONTHS[monthLabel.toUpperCase()];
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

function dateFromNumericStatementDate(day: string, monthValue: string, statementYear: number, statementMonth: number) {
  const month = Number(monthValue);
  const year = month > statementMonth ? statementYear - 1 : statementYear;
  return formatDate(year, month, Number(day));
}

function dateFromShortParts(day: string, monthLabel: string, statementYear: number, statementMonth: number) {
  return dateFromCompactStatementDate(day, monthLabel, statementYear, statementMonth);
}

function dateFromSavingsDate(value: string, year: string) {
  const [day, monthLabel] = value.split(" ");
  return formatDate(Number(year), MONTHS[monthLabel.toUpperCase()], Number(day));
}

function findCitibankDueDate(lines: string[]) {
  const months: Record<string, number> = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12
  };
  for (const line of lines) {
    const match = line.match(/PaymentDueDate:?([A-Za-z]+)(\d{2}),(\d{4})/);
    if (match && months[match[1]]) {
      return formatDate(Number(match[3]), months[match[1]], Number(match[2]));
    }
  }
  return undefined;
}

function findStatementMonthFromFileName(fileName?: string) {
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

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthEndDateFromMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isMoneyLine(value: string) {
  return /^\d{1,3}(?:,\d{3})*\.\d{2}(?: CR)?$/i.test(value) || /^\d+\.\d{2}(?: CR)?$/i.test(value);
}

function parseMoneyLineToMinor(value?: string) {
  if (!value || !isMoneyLine(value)) {
    return undefined;
  }
  return Math.round(Number(value.replace(/,/g, "").replace(/\s*CR$/i, "")) * 100);
}

function cellMoneyToMinor(value: string | number | undefined) {
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

function parseCitibankMoneyToMinor(value: string) {
  return Math.round(Number(value.replace(/[-(),]/g, "")) * 100);
}

function parseCitibankLastMoney(value: string) {
  const moneyMatches = Array.from(value.matchAll(/\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g));
  const match = moneyMatches.at(-1)?.[0];
  return match ? parseCitibankMoneyToMinor(match) : undefined;
}

function parseCitibankSignedMoneyToMinor(value: string) {
  const isNegative = value.startsWith("-") || /^\(.+\)$/.test(value);
  const minor = parseCitibankMoneyToMinor(value);
  return isNegative ? -minor : minor;
}

function parseCitibankLastSignedMoney(value: string) {
  const moneyMatches = Array.from(value.matchAll(/-?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g));
  const match = moneyMatches.at(-1)?.[0];
  return match ? parseCitibankSignedMoneyToMinor(match) : undefined;
}

function parseOcbcMoneyToMinor(value: string) {
  return Math.round(Number(value.replace(/[(),\s]/g, "")) * 100);
}

function parseBiff8XlsCells(data: ArrayBuffer): SpreadsheetCell[] {
  const bytes = new Uint8Array(data);
  const workbook = readCompoundDocumentWorkbook(bytes);
  const sharedStrings: string[] = [];
  const cells: SpreadsheetCell[] = [];
  let offset = 0;

  while (offset + 4 <= workbook.length) {
    const recordType = readUInt16(workbook, offset);
    const recordLength = readUInt16(workbook, offset + 2);
    const recordStart = offset + 4;
    const recordEnd = recordStart + recordLength;
    if (recordEnd > workbook.length) {
      break;
    }

    if (recordType === 0x00fc) {
      sharedStrings.splice(0, sharedStrings.length, ...readSharedStringTable(workbook.slice(recordStart, recordEnd)));
    } else if (recordType === 0x00fd && recordLength >= 10) {
      const sharedStringIndex = readUInt32(workbook, recordStart + 6);
      cells.push({
        row: readUInt16(workbook, recordStart),
        column: readUInt16(workbook, recordStart + 2),
        value: sharedStrings[sharedStringIndex] ?? ""
      });
    } else if (recordType === 0x0203 && recordLength >= 14) {
      cells.push({
        row: readUInt16(workbook, recordStart),
        column: readUInt16(workbook, recordStart + 2),
        value: readFloat64(workbook, recordStart + 6)
      });
    }

    offset = recordEnd;
  }

  return cells;
}

function readCompoundDocumentWorkbook(bytes: Uint8Array) {
  if (bytes.length < 512 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf || bytes[2] !== 0x11 || bytes[3] !== 0xe0) {
    throw new Error("Unsupported XLS file. Expected an old Excel binary workbook.");
  }

  const sectorSize = 2 ** readUInt16(bytes, 30);
  const fatSectorCount = readUInt32(bytes, 44);
  const firstDirectorySector = readInt32(bytes, 48);
  const difatSectors: number[] = [];
  for (let offset = 76; offset < 512; offset += 4) {
    const sector = readInt32(bytes, offset);
    if (sector >= 0) {
      difatSectors.push(sector);
    }
  }

  const fat: number[] = [];
  for (const sector of difatSectors.slice(0, fatSectorCount)) {
    const sectorOffset = compoundSectorOffset(sector, sectorSize);
    for (let offset = sectorOffset; offset < sectorOffset + sectorSize && offset + 4 <= bytes.length; offset += 4) {
      fat.push(readInt32(bytes, offset));
    }
  }

  const directory = readCompoundSectorChain(bytes, fat, firstDirectorySector, sectorSize);
  let workbookStartSector = -1;
  let workbookSize = 0;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = readUInt16(directory, offset + 64);
    if (!nameLength) {
      continue;
    }
    const name = decodeUtf16Le(directory.slice(offset, offset + nameLength - 2));
    if (name !== "Workbook" && name !== "Book") {
      continue;
    }
    workbookStartSector = readInt32(directory, offset + 116);
    workbookSize = readUInt32(directory, offset + 120);
    break;
  }

  if (workbookStartSector < 0 || workbookSize <= 0) {
    throw new Error("Unsupported XLS file. Could not find the workbook stream.");
  }

  return readCompoundSectorChain(bytes, fat, workbookStartSector, sectorSize).slice(0, workbookSize);
}

function readCompoundSectorChain(bytes: Uint8Array, fat: number[], firstSector: number, sectorSize: number) {
  const chunks: Uint8Array[] = [];
  const seen = new Set<number>();
  let sector = firstSector;
  while (sector >= 0 && sector < fat.length && !seen.has(sector)) {
    seen.add(sector);
    const offset = compoundSectorOffset(sector, sectorSize);
    chunks.push(bytes.slice(offset, offset + sectorSize));
    sector = fat[sector];
    if (sector === -2) {
      break;
    }
  }

  return concatBytes(chunks);
}

function compoundSectorOffset(sector: number, sectorSize: number) {
  return (sector + 1) * sectorSize;
}

function readSharedStringTable(data: Uint8Array) {
  const strings: string[] = [];
  const uniqueCount = readUInt32(data, 4);
  let offset = 8;
  for (let index = 0; index < uniqueCount && offset < data.length; index += 1) {
    const result = readBiffString(data, offset);
    strings.push(result.value);
    offset = result.offset;
  }
  return strings;
}

function readBiffString(data: Uint8Array, offset: number) {
  const characterCount = readUInt16(data, offset);
  let cursor = offset + 2;
  const flags = data[cursor];
  cursor += 1;
  const hasAsianPhonetics = Boolean(flags & 0x04);
  const hasRichText = Boolean(flags & 0x08);
  const isUtf16 = Boolean(flags & 0x01);
  let richTextRunCount = 0;
  let asianPhoneticByteCount = 0;
  if (hasRichText) {
    richTextRunCount = readUInt16(data, cursor);
    cursor += 2;
  }
  if (hasAsianPhonetics) {
    asianPhoneticByteCount = readUInt32(data, cursor);
    cursor += 4;
  }

  const byteLength = isUtf16 ? characterCount * 2 : characterCount;
  const value = isUtf16
    ? decodeUtf16Le(data.slice(cursor, cursor + byteLength))
    : decodeSingleByteString(data.slice(cursor, cursor + byteLength));
  cursor += byteLength + richTextRunCount * 4 + asianPhoneticByteCount;

  return { value, offset: cursor };
}

function concatBytes(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function decodeUtf16Le(bytes: Uint8Array) {
  return new TextDecoder("utf-16le").decode(bytes);
}

function decodeSingleByteString(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function readUInt16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readInt32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function readFloat64(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
}

function parseOcbcLastMoney(value: string) {
  const moneyMatches = Array.from(value.matchAll(/\(?\s*\d{1,3}(?:\s*,\s*\d{3})*\s*\.\s*\d{2}\s*\)?/g));
  const match = moneyMatches.at(-1)?.[0];
  return match ? parseOcbcMoneyToMinor(match) : undefined;
}

function parseCitibankGrandTotalFromPreviousLines(lines: string[], grandTotalIndex: number) {
  for (let index = grandTotalIndex - 1; index >= Math.max(0, grandTotalIndex - 8); index -= 1) {
    const amount = parseCitibankLastSignedMoney(lines[index]);
    if (amount != null) {
      return amount;
    }
  }
  return undefined;
}

function minorToDecimal(value: number) {
  return (value / 100).toFixed(2);
}

function normalizeUobCardAccountName(value: string) {
  if (/^UOB ONE CARD$/i.test(value)) {
    return "UOB One Card";
  }
  if (/^LADY'S CARD$/i.test(value)) {
    return "UOB Lady's Card";
  }
  return "";
}

function denormalizeUobCardAccountName(accountName: string) {
  if (accountName === "UOB One" || accountName === "UOB One Card") {
    return "UOB ONE CARD";
  }
  if (accountName === "UOB Lady's" || accountName === "UOB Lady's Card") {
    return "LADY'S CARD";
  }
  return accountName;
}

function normalizeCitibankCardAccountName(value: string) {
  if (/CITIREWARDSWORLDMASTERCARD/i.test(value)) {
    return "Citibank Rewards";
  }
  if (/CITIPREMIERMILE(?:S|SWORLDMASTER)CARD/i.test(value)) {
    return "Citibank Miles";
  }
  return "";
}

function cleanCitibankDescription(value: string) {
  return compactDescription(value
    .replace(/SINGAPORESG$/i, "")
    .replace(/SingaporeSG$/i, "")
    .replace(/SG$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function cleanOcbcDescription(value: string) {
  return compactDescription(value
    .replace(/-\s*\d{4}\s+/g, "")
    .replace(/\bSINGAPORE\s+SG\b/gi, "")
    .replace(/\bSG\b$/i, ""));
}

function findOcbcStatementDate(lines: string[]) {
  const index = lines.findIndex((line) => /^STATEMENT DATE\b/i.test(line));
  const candidate = index >= 0 ? lines[index + 1] : lines.find((line) => /^\d{2}\s*-\s*\d{2}\s*-\s*\d{4}\b/.test(line));
  const match = candidate?.match(/^(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{4})/);
  return match ? formatDate(Number(match[3]), Number(match[2]), Number(match[1])) : undefined;
}

function findOcbc360Period(lines: string[]) {
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

function sectionEndIndex(lines: string[], previousBalanceIndex: number) {
  for (let index = previousBalanceIndex; index < lines.length; index += 1) {
    if (lines[index].startsWith("TOTAL BALANCE FOR") || /End of Transaction Details/i.test(lines[index])) {
      return index;
    }
  }
  return previousBalanceIndex;
}

function compactDescription(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseLongDateCell(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) {
    return undefined;
  }

  const month = MONTHS[match[2].slice(0, 3).toUpperCase()];
  return month ? formatDate(Number(match[3]), month, Number(match[1])) : undefined;
}

function cellString(value: string | number | undefined) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\r/g, "\n").trim();
}

function isTransferDescription(description: string) {
  const normalized = description.replace(/\s+/g, "");
  return /PAYMT THRU E-BANK|Bill Payment|mBK-|Funds Transfer|MONEYSEND|PAYMENT BY INTERNET|PAYMENT VIA|FAST PAYMENT|INB|OTHR Transfer/i.test(description)
    || /PAYMENTVIA|FASTPAYMENT|PAYMTTHRUE-BANK|PAYMENTBYINTERNET/i.test(normalized);
}

function inferCategory(description: string, isIncome: boolean) {
  const normalized = description.toUpperCase();
  if (/PAYNOW-FAST.*WISE ASIA-PACIFIC/.test(normalized)) {
    return "Family & Personal";
  }
  if (isIncome) {
    if (/SALA|SALARY/.test(normalized)) {
      return "Salary";
    }
    return "Other - Income";
  }
  if (/NEW CREATION CHURCH/.test(normalized)) {
    return "Church";
  }
  if (/BUS\/MRT|NETS Debit-Consumer/.test(description) && /BUS|MRT|TRANSIT|MR BEAN|JOO HENG|FATTY CHEON/.test(normalized) === false) {
    return "Public Transport";
  }
  if (/BUS\/MRT|HELLO RIDE|ANYWHEEL/.test(normalized)) {
    return "Public Transport";
  }
  if (/GRAB\*/.test(normalized)) {
    return "Taxi";
  }
  if (/FAIRPRICE|CS FRESH|FINEST|MARKET PLACE|DON DON DONKI|GROCER|NITORI/.test(normalized)) {
    return "Groceries";
  }
  if (/APPLE\.COM\/BILL|OPENAI|VIVIFI|STARHUB/.test(normalized)) {
    return "Subscriptions MO";
  }
  if (/KINOKUNIYA|BOOK/.test(normalized)) {
    return "Education";
  }
  if (/DAILY CUT|SALON|BEAUTY/.test(normalized)) {
    return "Beauty";
  }
  if (/SHAW THEATRES|SHAW CONCESSIONS/.test(normalized)) {
    return "Entertainment";
  }
  if (/IKEA|MUJI|HANDS|TAKASHIMAYA|TOOBUKU|THINK/.test(normalized)) {
    return "Shopping";
  }
  if (/TAX/.test(normalized)) {
    return "Tax";
  }
  if (/RESTAURANT|CUIS|THAI|TOAST|FOOD|YTF|BAGUETTE|SUSHI|ELEVEN|GOCHISO|CHOCOLATE|GYG|GASTRONOMIA|COFFEE|LANTERN|KENNY ROGERS|YAKINIKU|WINGSTOP|MCDONALD|SUBWAY|HAWKERS|STARBUCKS|DIN TAI FUNG|TORI-Q|NANTSUTTEI|SABAI|FR WISMA/.test(normalized)) {
    return "Food & Drinks";
  }
  return "Other";
}

function compareImportRowsByDate(left: Record<string, string>, right: Record<string, string>) {
  return `${left.date}|${left.account}|${left.description}`.localeCompare(`${right.date}|${right.account}|${right.description}`);
}

function labelFromFile(fileName: string | undefined, fallback: string) {
  return fileName ? fileName.replace(/\.(?:csv|pdf|xls|xlsx)$/i, "") : fallback;
}
