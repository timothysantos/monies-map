import { parseCitibankCreditCardStatement } from "./statement-import/citibank";
import {
  canParseCitibankActivityCsv,
  parseCitibankActivityCsv
} from "./statement-import/citibank-activity-csv";
import {
  canParseOcbcActivityCsv,
  parseOcbcActivityCsv
} from "./statement-import/ocbc-activity-csv";
import { parseOcbc360Statement, parseOcbcCreditCardStatement } from "./statement-import/ocbc";
import {
  getPdfLayoutLines,
  getPdfSpacedLayoutLines,
  statementRowsToCsv,
  type ParsedStatementImport,
  type StatementCheckpointDraft
} from "./statement-import/shared";
import { parseUobCreditCardStatement, parseUobSavingsStatement } from "./statement-import/uob";
import { parseCurrentTransactionSpreadsheet } from "./statement-import/xls";

export {
  canParseCitibankActivityCsv,
  canParseOcbcActivityCsv,
  parseCitibankActivityCsv,
  parseCurrentTransactionSpreadsheet,
  parseOcbcActivityCsv,
  statementRowsToCsv
};
export type { ParsedStatementImport, StatementCheckpointDraft };

export function parseStatementText(text: string, fileName?: string): ParsedStatementImport {
  const normalizedText = text.replace(/\r/g, "\n");
  const rawText = normalizedText.split("__PDF_LAYOUT_TEXT__")[0] ?? normalizedText;
  const layoutLines = getPdfLayoutLines(normalizedText);
  const spacedLayoutLines = getPdfSpacedLayoutLines(normalizedText);
  if (layoutLines.some((line) => /^TRANSACTIONSFORCITI/i.test(line))) {
    return parseCitibankCreditCardStatement(layoutLines, fileName);
  }

  if (spacedLayoutLines.some((line) => /^OCBC 365 CREDIT CARD$/i.test(line))) {
    return parseOcbcCreditCardStatement(spacedLayoutLines, fileName);
  }

  if (spacedLayoutLines.some((line) => /^360 ACCOUNT\b/i.test(line))) {
    return parseOcbc360Statement(spacedLayoutLines, fileName);
  }

  if (/Credit Card\(s\) Statement/i.test(rawText) || /TOTAL BALANCE FOR/i.test(rawText)) {
    return parseUobCreditCardStatement(rawText, fileName);
  }

  if (/Statement of Account/i.test(rawText) && /Account Transaction Details/i.test(rawText)) {
    return parseUobSavingsStatement(rawText, fileName);
  }

  throw new Error("Unsupported statement PDF. This importer currently recognizes UOB, Citi Rewards, Citi Miles, OCBC 365, and OCBC 360 statement text.");
}
