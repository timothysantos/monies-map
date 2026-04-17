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
  description: string;
  amountMinor: number;
  isCredit: boolean;
}

export function canParseOcbcActivityCsv(fileName: string | undefined, context?: OcbcActivityContext) {
  return isOcbcActivityFileName(fileName)
    && (isOcbcCreditCardContext(context) || /ocbc-cards/i.test(fileName ?? ""));
}

export function parseOcbcActivityCsv(
  text: string,
  fileName?: string,
  context?: OcbcActivityContext
): ParsedStatementImport {
  if (!canParseOcbcActivityCsv(fileName, context)) {
    throw new Error("OCBC card activity CSV needs an OCBC credit card account selected.");
  }

  const matrix = parseCsvMatrix(text);
  const cardEnding = findOcbcActivityCardEnding(matrix);
  const rows = matrix.map(parseOcbcActivityRow).filter((row): row is OcbcActivityCandidate => Boolean(row));
  if (!rows.length) {
    throw new Error("No OCBC card activity rows were found.");
  }

  const accountName = resolveOcbcActivityAccountName(context);
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
      note: cardEnding ? `card ending: ${cardEnding}` : "",
      type
    };
  }).sort(compareImportRowsByDate);

  return {
    parserKey: "ocbc_credit_card_activity_csv",
    sourceLabel: labelFromFile(fileName, "OCBC card activity"),
    rows: importRows,
    checkpoints: [],
    warnings: []
  };
}

function parseOcbcActivityRow(cells: string[]) {
  if (cells.length < 4) {
    return undefined;
  }

  const date = parseOcbcActivityDate(cleanCsvCell(cells[0]));
  const description = cleanOcbcDescription(cleanCsvCell(cells[1]));
  const withdrawalMinor = parseOcbcActivityAmount(cells[2]);
  const depositMinor = parseOcbcActivityAmount(cells[3]);
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

function resolveOcbcActivityAccountName(context?: OcbcActivityContext) {
  if (isOcbcCreditCardContext(context) && context?.accountName) {
    return context.accountName;
  }
  return "OCBC 365 Credit Card";
}

function isOcbcActivityFileName(fileName?: string) {
  return /^TrxHistory_\d+(?:-[\w-]+)?\.csv$/i.test(fileName ?? "");
}

function isOcbcCreditCardContext(context?: OcbcActivityContext) {
  return context?.accountKind === "credit_card" && /ocbc/i.test(context.institution ?? context.accountName ?? "");
}

function cleanCsvCell(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^'+|'+$/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}
