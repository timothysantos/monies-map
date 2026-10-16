import { parseCsvMatrix } from "../csv";
import { compactDescription, compareImportRowsByDate, inferCategory, isTransferDescription, labelFromFile, minorToDecimal, type ParsedStatementImport } from "./shared";

interface HsbcActivityContext {
  accountName?: string;
  accountKind?: string;
  institution?: string;
}

interface HsbcActivityCandidate {
  date: string;
  transactionDate?: string;
  description: string;
  amountMinor: number;
  originalAmount?: string;
  cardEnding?: string;
}

// HSBC's mid-cycle Transaction History export is headerless. Its first amount
// is the purchase currency; the final column is the posted SGD amount.
export function canRecognizeHsbcActivityCsv(text: string, fileName?: string, context?: HsbcActivityContext) {
  return (isHsbcActivityFileName(fileName) || isHsbcCardContext(context))
    && parseCsvMatrix(text).map(parseHsbcActivityRow).filter(Boolean).length >= 2;
}

export function parseHsbcActivityCsv(text: string, fileName?: string, context?: HsbcActivityContext): ParsedStatementImport {
  if (!canRecognizeHsbcActivityCsv(text, fileName, context)) {
    throw new Error("HSBC activity CSV needs an HSBC credit card selected.");
  }

  const rows = parseCsvMatrix(text).map(parseHsbcActivityRow).filter((row): row is HsbcActivityCandidate => Boolean(row));
  if (!rows.length) throw new Error("No HSBC activity rows were found.");

  const accountName = isHsbcCardContext(context) && context?.accountName ? context.accountName : "HSBC Visa Revolution";
  return {
    parserKey: "hsbc_credit_card_activity_csv",
    sourceLabel: labelFromFile(fileName, "HSBC card activity"),
    rows: rows.map((row) => {
      const isCredit = row.amountMinor > 0;
      const amountMinor = Math.abs(row.amountMinor);
      const type = isTransferDescription(row.description) ? "transfer" : isCredit ? "income" : "expense";
      const note = [
        row.transactionDate && row.transactionDate !== row.date ? `txn date: ${row.transactionDate}` : "",
        row.cardEnding ? `card ending: ${row.cardEnding}` : "",
        row.originalAmount ? `original: ${row.originalAmount}` : ""
      ].filter(Boolean).join("; ");
      return {
        date: row.date,
        description: row.description,
        expense: isCredit ? "" : minorToDecimal(amountMinor),
        income: isCredit ? minorToDecimal(amountMinor) : "",
        account: accountName,
        category: type === "transfer" ? "Transfer" : inferCategory(row.description, isCredit),
        note,
        type
      };
    }).sort(compareImportRowsByDate),
    checkpoints: [],
    warnings: []
  };
}

function parseHsbcActivityRow(cells: string[]): HsbcActivityCandidate | undefined {
  if (cells.length !== 3) return undefined;
  const date = parseDate(cells[0]);
  const amountMinor = parseAmount(cells[2]);
  const detail = clean(cells[1]);
  const description = compactDescription(detail
    .replace(/\s+[A-Z]{2}\s+\d{2}\/\d{2}\/\d{4}\s+.*$/i, "")
    .replace(/\s+\d{2}\/\d{2}\/\d{4}\s+.*$/i, ""));
  if (!date || amountMinor == null || !description) return undefined;
  const transactionDate = detail.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1];
  const original = detail.match(/\s(-?\d+(?:\.\d{1,2})?)\s+([A-Z]{3})\s*$/i);
  const cardEnding = detail.match(/[•*]{2,}\s*(\d{4})\s+[-+]?\d/)?.[1];
  return {
    date,
    ...(transactionDate ? { transactionDate: parseDate(transactionDate) } : {}),
    description,
    amountMinor,
    ...(cardEnding ? { cardEnding } : {}),
    ...(original ? { originalAmount: `${original[1]} ${original[2].toUpperCase()}` } : {})
  };
}

function parseDate(value: string) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function parseAmount(value: string) {
  const normalized = clean(value).replace(/,/g, "");
  return /^-?\d+(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : undefined;
}

function clean(value: string) {
  return value.replace(/^\uFEFF/, "").trim().replace(/^'+|'+$/g, "").replace(/^"+|"+$/g, "").trim();
}

function isHsbcActivityFileName(fileName = "") {
  return /hsbc.*(?:midcycle[_ -]?)?transactionhistory.*\.csv$/i.test(fileName);
}

function isHsbcCardContext(context?: HsbcActivityContext) {
  return context?.accountKind === "credit_card" && /hsbc/i.test(context.institution ?? context.accountName ?? "");
}
