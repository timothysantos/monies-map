import { parseCsvMatrix } from "../csv";
import {
  cleanOcbcDescription,
  compareImportRowsByDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  type ParsedStatementImport
} from "./shared";

interface OcbcActivityContext {
  accountName?: string;
  accountKind?: string;
  institution?: string;
}

interface OcbcActivityCandidate {
  date: string;
  valueDate?: string;
  description: string;
  amountMinor: number;
  isCredit: boolean;
}

export function canParseOcbcActivityCsv(fileName: string | undefined, context?: OcbcActivityContext) {
  return isOcbcActivityFileName(fileName)
    && (isOcbcAccountContext(context) || /ocbc-(?:cards|360)/i.test(fileName ?? ""));
}

export function canRecognizeOcbcActivityCsv(
  text: string,
  fileName?: string,
  context?: OcbcActivityContext
) {
  return canParseOcbcActivityCsv(fileName, context)
    || (isOcbcActivityFileName(fileName) && hasOcbcActivitySignature(text));
}

export function parseOcbcActivityCsv(
  text: string,
  fileName?: string,
  context?: OcbcActivityContext
): ParsedStatementImport {
  if (!canRecognizeOcbcActivityCsv(text, fileName, context)) {
    throw new Error("OCBC activity CSV needs an OCBC account selected.");
  }

  const matrix = parseCsvMatrix(text);
  const isBankActivity = isOcbc360Activity(matrix, fileName, context);
  const cardEnding = findOcbcActivityCardEnding(matrix);
  const rows = matrix.map((row) => parseOcbcActivityRow(row, isBankActivity)).filter((row): row is OcbcActivityCandidate => Boolean(row));
  if (!rows.length) {
    throw new Error("No OCBC activity rows were found.");
  }

  const accountName = resolveOcbcActivityAccountName(isBankActivity, context);
  const importRows = rows.map((row) => {
    const type = isTransferDescription(row.description)
      ? "transfer"
      : row.isCredit
        ? "income"
        : "expense";

    return {
      date: row.date,
      description: row.description,
      expense: row.isCredit ? "" : minorToDecimal(row.amountMinor),
      income: row.isCredit ? minorToDecimal(row.amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(row.description, row.isCredit),
      note: buildOcbcActivityNote({ cardEnding: isBankActivity ? undefined : cardEnding, date: row.date, valueDate: row.valueDate }),
      type
    };
  }).sort(compareImportRowsByDate);

  return {
    parserKey: isBankActivity ? "ocbc_360_activity_csv" : "ocbc_credit_card_activity_csv",
    sourceLabel: labelFromFile(fileName, isBankActivity ? "OCBC 360 activity" : "OCBC card activity"),
    rows: importRows,
    checkpoints: [],
    warnings: []
  };
}

function parseOcbcActivityRow(cells: string[], isBankActivity: boolean) {
  const dateIndex = 0;
  const valueDateIndex = isBankActivity ? 1 : undefined;
  const descriptionIndex = isBankActivity ? 2 : 1;
  const withdrawalIndex = isBankActivity ? 3 : 2;
  const depositIndex = isBankActivity ? 4 : 3;
  if (cells.length <= depositIndex) {
    return undefined;
  }

  const date = parseOcbcActivityDate(cleanCsvCell(cells[dateIndex]));
  const valueDate = valueDateIndex == null ? undefined : parseOcbcActivityDate(cleanCsvCell(cells[valueDateIndex]));
  const description = cleanOcbcDescription(cleanCsvCell(cells[descriptionIndex]));
  const withdrawalMinor = parseOcbcActivityAmount(cells[withdrawalIndex]);
  const depositMinor = parseOcbcActivityAmount(cells[depositIndex]);
  if (!date || !description) {
    return undefined;
  }
  if (withdrawalMinor != null && depositMinor != null) {
    throw new Error(`OCBC card activity row has both withdrawal and deposit amounts for ${date}.`);
  }
  if (withdrawalMinor == null && depositMinor == null) {
    return undefined;
  }

  return {
    date,
    valueDate,
    description,
    amountMinor: withdrawalMinor ?? depositMinor ?? 0,
    isCredit: depositMinor != null
  };
}

function parseOcbcActivityDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseOcbcActivityAmount(value: string) {
  const normalized = cleanCsvCell(value)
    .replace(/^SGD\s*/i, "")
    .replace(/,/g, "");
  if (!normalized) {
    return undefined;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return undefined;
  }

  return Math.round(Number(normalized) * 100);
}

function findOcbcActivityCardEnding(rows: string[][]) {
  for (const row of rows) {
    const text = row.join(" ");
    const match = text.match(/\b(\d{4})-(\d{4})-(\d{4})-(\d{4})\b/);
    if (match) {
      return match[4];
    }
  }
  return undefined;
}

function resolveOcbcActivityAccountName(isBankActivity: boolean, context?: OcbcActivityContext) {
  if (isOcbcAccountContext(context) && context?.accountName) {
    return context.accountName;
  }
  return isBankActivity ? "OCBC 360" : "OCBC 365 Credit Card";
}

function isOcbcActivityFileName(fileName?: string) {
  return /^(?:TrxHistory|TransactionHistory)_\d+(?:-[\w-]+)?\.csv$/i.test(fileName ?? "");
}

function hasOcbcActivitySignature(text: string) {
  return /Account details for:/i.test(text)
    && /Transaction history/i.test(text)
    && (
      /Main credit card OCBC/i.test(text)
      || /Transaction date,Description,Withdrawals \(SGD\),Deposits \(SGD\)/i.test(text)
      || /Transaction date,Value date,Description,Withdrawals \(SGD\),Deposits \(SGD\),Balance \(SGD\)/i.test(text)
    );
}

function isOcbcAccountContext(context?: OcbcActivityContext) {
  return /ocbc/i.test(context?.institution ?? context?.accountName ?? "");
}

function isOcbc360Activity(rows: string[][], fileName?: string, context?: OcbcActivityContext) {
  if (/ocbc-360/i.test(fileName ?? "")) {
    return true;
  }
  if (context?.accountKind && context.accountKind !== "credit_card") {
    return true;
  }
  return rows.some((row) => row.join(" ").toUpperCase().includes("360 ACCOUNT"));
}

function buildOcbcActivityNote(input: { cardEnding?: string; date: string; valueDate?: string }) {
  const notes = [];
  if (input.cardEnding) {
    notes.push(`card ending: ${input.cardEnding}`);
  }
  if (input.valueDate && input.valueDate !== input.date) {
    notes.push(`value date: ${input.valueDate}`);
  }
  return notes.join("; ");
}

function cleanCsvCell(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^'+|'+$/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}
