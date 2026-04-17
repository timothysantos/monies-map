import { parseCsvMatrix } from "../csv";
import {
  compactDescription,
  compareImportRowsByDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  type ParsedStatementImport
} from "./shared";

interface CitibankActivityContext {
  accountName?: string;
  accountKind?: string;
  institution?: string;
}

interface CitibankActivityCandidate {
  date: string;
  description: string;
  amountMinor: number;
  cardEnding?: string;
}

export function canParseCitibankActivityCsv(fileName: string | undefined, context?: CitibankActivityContext) {
  return isCitibankCreditCardContext(context) && isCitibankActivityFileName(fileName);
}

export function parseCitibankActivityCsv(
  text: string,
  fileName?: string,
  context?: CitibankActivityContext
): ParsedStatementImport {
  if (!canParseCitibankActivityCsv(fileName, context)) {
    throw new Error("Citibank activity CSV needs a Citibank credit card account selected.");
  }

  const rows = parseCsvMatrix(text).map(parseCitibankActivityRow).filter((row): row is CitibankActivityCandidate => Boolean(row));
  if (!rows.length) {
    throw new Error("No Citibank activity rows were found.");
  }

  const accountName = resolveCitibankActivityAccountName(fileName, context);
  const importRows = rows.map((row) => {
    const isCredit = row.amountMinor > 0;
    const amountMinor = Math.abs(row.amountMinor);
    const type = isTransferDescription(row.description)
      ? "transfer"
      : isCredit
        ? "income"
        : "expense";

    return {
      date: row.date,
      description: row.description,
      expense: isCredit ? "" : minorToDecimal(amountMinor),
      income: isCredit ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(row.description, isCredit),
      note: row.cardEnding ? `card ending: ${row.cardEnding}` : "",
      type
    };
  }).sort(compareImportRowsByDate);

  return {
    parserKey: "citibank_credit_card_activity_csv",
    sourceLabel: labelFromFile(fileName, "Citibank card activity"),
    rows: importRows,
    checkpoints: [],
    warnings: []
  };
}

function parseCitibankActivityRow(cells: string[]) {
  if (cells.length < 3) {
    return undefined;
  }

  const date = parseCitibankActivityDate(cleanCsvCell(cells[0]));
  const description = cleanCitibankActivityDescription(cells[1]);
  const amountMinor = parseSignedAmountMinor(cells[2]);
  if (!date || !description || amountMinor == null || amountMinor === 0) {
    return undefined;
  }

  return {
    date,
    description,
    amountMinor,
    cardEnding: parseCardEnding(cells.at(-1))
  };
}

function parseCitibankActivityDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseSignedAmountMinor(value: string) {
  const normalized = cleanCsvCell(value).replace(/,/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return undefined;
  }

  return Math.round(Number(normalized) * 100);
}

function parseCardEnding(value?: string) {
  const digits = cleanCsvCell(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function cleanCitibankActivityDescription(value: string) {
  return compactDescription(cleanCsvCell(value)
    .replace(/\bSINGAPORE\s+SG\b/gi, "")
    .replace(/\bSG\b$/i, ""));
}

function cleanCsvCell(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^'+|'+$/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function resolveCitibankActivityAccountName(fileName?: string, context?: CitibankActivityContext) {
  if (isCitibankCreditCardContext(context) && context?.accountName) {
    return context.accountName;
  }
  if (/-rewards\.csv$/i.test(fileName ?? "")) {
    return "Citi Rewards";
  }
  if (/-miles\.csv$/i.test(fileName ?? "")) {
    return "Citi Miles";
  }
  return context?.accountName || "Citibank card";
}

function isCitibankActivityFileName(fileName?: string) {
  return /^ACCT_\d+_\d{2}_\d{2}_\d{4}-(?:rewards|miles)\.csv$/i.test(fileName ?? "");
}

function isCitibankCreditCardContext(context?: CitibankActivityContext) {
  return context?.accountKind === "credit_card" && /citi/i.test(context.institution ?? context.accountName ?? "");
}
