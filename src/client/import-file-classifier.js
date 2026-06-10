export function classifyImportFile({ fileName, fileType, text, activityContext }) {
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
