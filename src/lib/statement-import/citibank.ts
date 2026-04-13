import {
  compactDescription,
  compareImportRowsByDate,
  dateFromCompactStatementDate,
  findStatementMonthFromFileName,
  formatDate,
  getMonthEndDateFromMonth,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  parseCitibankGrandTotalFromPreviousLines,
  parseCitibankLastSignedMoney,
  parseCitibankMoneyToMinor,
  previousMonth,
  type ParsedStatementImport
} from "./shared";

interface CitibankCreditCardSection {
  accountName: string;
  previousBalanceMinor: number;
  totalBalanceMinor: number;
  minDate?: string;
  maxDate?: string;
  rows: Record<string, string>[];
}

export function parseCitibankCreditCardStatement(lines: string[], fileName?: string): ParsedStatementImport {
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
