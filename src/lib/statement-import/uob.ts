import {
  cleanLines,
  cleanUobSavingsDescription,
  compactDescription,
  compareImportRowsByDate,
  dateFromSavingsDate,
  dateFromShortStatementDate,
  findDateAfter,
  findLongDate,
  findUobSavingsPeriod,
  inferCategory,
  isMoneyLine,
  isSavingsDateLine,
  isShortStatementDate,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  parseMoneyLineToMinor,
  parseSavingsOpeningBalance,
  parseSavingsOverviewBalance,
  type ParsedStatementImport
} from "./shared";

interface CreditCardSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minPostDate?: string;
  rows: Record<string, string>[];
}

export function parseUobCreditCardStatement(text: string, fileName?: string): ParsedStatementImport {
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

export function parseUobSavingsStatement(text: string, fileName?: string): ParsedStatementImport {
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

function isUobSavingsNoiseLine(value: string) {
  return /Please note|United Overseas Bank|Reg\. No\.|www\.uob\.com\.sg|Page \d+ of \d+|不得向本行索取赔偿|本行|UOB Group/i.test(value);
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

function sectionEndIndex(lines: string[], previousBalanceIndex: number) {
  for (let index = previousBalanceIndex; index < lines.length; index += 1) {
    if (lines[index].startsWith("TOTAL BALANCE FOR") || /End of Transaction Details/i.test(lines[index])) {
      return index;
    }
  }
  return previousBalanceIndex;
}
