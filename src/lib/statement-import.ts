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

  if (/Credit Card\(s\) Statement/i.test(normalizedText) || /TOTAL BALANCE FOR/i.test(normalizedText)) {
    return parseUobCreditCardStatement(normalizedText, fileName);
  }

  if (/Statement of Account/i.test(normalizedText) && /Account Transaction Details/i.test(normalizedText)) {
    return parseUobSavingsStatement(normalizedText, fileName);
  }

  throw new Error("Unsupported statement PDF. This importer currently recognizes UOB, Citi Rewards, Citi Miles, OCBC 365, and OCBC 360 statement text.");
}
