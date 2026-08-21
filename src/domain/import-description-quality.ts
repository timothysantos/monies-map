const IMPORT_DESCRIPTION_MAX_LENGTH = 500;

const STATEMENT_BOILERPLATE_PATTERNS = [
  /\bDeposit Insurance Scheme\b/i,
  /\bTRANSACTION CODE DESCRIPTION\b/i,
  /\bOversea-Chinese Banking Corporation Limited\b/i,
  /\bOCBC Bank\s+65 Chulia Street\b/i,
  /\bSTATEMENT OF ACCOUNT\b/i,
  /\bAPPLICATIONS FOR (?:INDIVIDUALS|BUSINESSES)\b/i,
  /\bContact for Consumer Banking\b/i,
  /\bTransaction Value Date Date Description\b/i
];

export function getImportDescriptionQualityIssue(description: string) {
  const compactDescription = description.replace(/\s+/g, " ").trim();

  if (compactDescription.length > IMPORT_DESCRIPTION_MAX_LENGTH) {
    return "Description is unusually long for a bank transaction. The row was blocked before import so statement footer text cannot enter the ledger.";
  }

  if (STATEMENT_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(compactDescription))) {
    return "Description looks like statement boilerplate rather than a bank transaction. The row was blocked before import.";
  }

  return undefined;
}

export function assertImportDescriptionQuality(description: string, rowIndex: number) {
  const issue = getImportDescriptionQualityIssue(description);
  if (issue) {
    throw new Error(`Import validation failed. Row ${rowIndex}: ${issue}`);
  }
}
