export function classifyImportFile({ fileName, fileType, text, activityContext }) {
  if (/\.hsbc-ocr\.tsv$/i.test(fileName) || text.startsWith("__OCR_TSV__")) {
    return "ocr-statement";
  }

  if (/\.pdf$/i.test(fileName) || fileType === "application/pdf") {
    return "pdf";
  }

  if (/\.xls$/i.test(fileName) || fileType === "application/vnd.ms-excel") {
    return "xls";
  }

  if (/\.csv$/i.test(fileName) && canParseCitibankActivityCsv(fileName, activityContext)) {
    return "citibank-activity-csv";
  }

  if (/\.csv$/i.test(fileName) && canRecognizeOcbcActivityCsv(text, fileName, activityContext)) {
    return "ocbc-activity-csv";
  }

  return "unknown";
}

import { canParseCitibankActivityCsv } from "../lib/statement-import/citibank-activity-csv";
import { canRecognizeOcbcActivityCsv } from "../lib/statement-import/ocbc-activity-csv";
