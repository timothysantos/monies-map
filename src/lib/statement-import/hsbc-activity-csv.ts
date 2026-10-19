import { parseCsvMatrix } from "../csv";
import { compactDescription, compareImportRowsByDate, inferCategory, isTransferDescription, labelFromFile, minorToDecimal, type ParsedStatementImport } from "./shared";

interface HsbcActivityAccount {
  name: string;
  kind?: string;
  institution?: string;
}

interface HsbcActivityContext {
  accountName?: string;
  accountKind?: string;
  institution?: string;
  // The household's accounts, to find the file's card by its last four digits.
  accounts?: HsbcActivityAccount[];
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

  const accountName = resolveHsbcActivityAccountName(rows, context);
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

// The account the rows go to: the HSBC card selected for the upload; else the
// household's HSBC card whose name carries the file's last four digits; else
// its only HSBC card, when that name carries no other card number. Otherwise
// what the file says ("HSBC card ending 1234"), never a made-up account: the
// preview lists it as an account to choose before saving.
function resolveHsbcActivityAccountName(rows: HsbcActivityCandidate[], context?: HsbcActivityContext) {
  if (isHsbcCardContext(context) && context?.accountName) return context.accountName;
  const endings = [...new Set(rows.map((row) => row.cardEnding).filter((ending): ending is string => Boolean(ending)))];
  const ending = endings.length === 1 ? endings[0] : undefined;
  const cards = (context?.accounts ?? []).filter((account) => isHsbcCardContext({ accountName: account.name, accountKind: account.kind, institution: account.institution }));
  const carries = (name: string, digits: string) => new RegExp(`(?:^|\\D)${digits}(?:\\D|$)`).test(name);
  if (ending) {
    const exact = cards.filter((account) => carries(account.name, ending));
    if (exact.length === 1) return exact[0].name;
    if (exact.length > 1) return detectedHsbcCardName(ending);
  }
  if (cards.length === 1 && !/(?:^|\D)\d{4}(?:\D|$)/.test(cards[0].name)) return cards[0].name;
  return detectedHsbcCardName(ending);
}

function detectedHsbcCardName(ending?: string) {
  return ending ? `HSBC card ending ${ending}` : "HSBC card";
}

function isHsbcCardContext(context?: HsbcActivityContext) {
  return context?.accountKind === "credit_card" && /hsbc/i.test(context.institution ?? context.accountName ?? "");
}
