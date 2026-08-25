import {
  compactDescription,
  compareImportRowsByDate,
  dateFromShortParts,
  formatDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  MONTHS,
  type ParsedStatementImport
} from "./shared";

interface OcrWord {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}

interface OcrLine {
  page: number;
  top: number;
  words: OcrWord[];
  text: string;
}

interface HsbcOcrAmount {
  minor: number;
  isCredit: boolean;
  raw: string;
}

const HSBC_OCR_REFERENCE_WIDTH = 1820;
const HSBC_OCR_REFERENCE_HEIGHT = 2572;
const HSBC_SHORT_MONTHS_BY_NUMBER = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseHsbcVisaRevolutionOcrTsv(tsv: string, fileName?: string): ParsedStatementImport {
  const words = parseTsvWords(tsv);
  const lines = groupOcrLines(words);
  if (!lines.some((line) => /HSBC\s+VISA\s+REVOLUTION/i.test(line.text))) {
    throw new Error("This OCR text does not look like an HSBC Visa Revolution statement.");
  }

  const period = findStatementPeriod(lines);
  if (!period) {
    throw new Error("Could not find the HSBC statement period.");
  }

  const accountName = "HSBC Visa Revolution";
  const transactionLines = getHsbcTransactionTableLines(lines);
  const rows: Record<string, string>[] = [];
  let previousBalanceMinor: number | undefined;
  let expenseMinor = 0;
  let incomeMinor = 0;
  let minPostDate: string | undefined;
  const missingAmountTransactions: Array<{
    postDate: string;
    transactionDate: string;
    description: string;
  }> = [];

  for (let index = 0; index < transactionLines.length; index += 1) {
    const line = transactionLines[index];
    if (/Previous\s+Statement\s+Balance/i.test(line.text) && line.words.some((word) => word.left < 1120)) {
      previousBalanceMinor = findAmountInRange(line.words, 950, 1140)?.minor;
      continue;
    }

    const postDate = readDateFromRange(line.words, 125, 245, period.endDate);
    const transactionDate = readDateFromRange(line.words, 240, 390, period.endDate);
    const amount = findAmountInRange(line.words, 930, 1140);
    if (!postDate || !transactionDate) {
      continue;
    }

    const descriptionParts = [];
    const description = wordsToHsbcTransactionDescription(line.words, false);
    const previousDescription = transactionLines[index - 1];
    if (!description && previousDescription && isHsbcMerchantContinuationLine(previousDescription, line, -35)) {
      descriptionParts.push(wordsToHsbcTransactionDescription(previousDescription.words, true));
    }
    if (description) {
      descriptionParts.push(description);
    }
    for (let cursor = index + 1; cursor < transactionLines.length; cursor += 1) {
      const candidate = transactionLines[cursor];
      if (readDateFromRange(candidate.words, 125, 245, period.endDate) || /Total\s+Due|Minimum\s+Payment|Total\s+Account\s+Balance/i.test(candidate.text)) {
        break;
      }
      if (!isHsbcMerchantContinuationLine(candidate, line, 85)) {
        break;
      }
      const continuation = wordsToHsbcTransactionDescription(candidate.words, true);
      if (continuation) {
        descriptionParts.push(continuation);
      }
      index = cursor;
    }

    const cleanDescription = cleanHsbcDescription(descriptionParts.join(" "));
    if (!cleanDescription) {
      continue;
    }
    if (!amount) {
      missingAmountTransactions.push({ postDate, transactionDate, description: cleanDescription });
      continue;
    }
    if (amount.minor === 0) {
      continue;
    }

    const row = buildHsbcRow({ accountName, postDate, transactionDate, description: cleanDescription, amount });
    if (row.income) {
      incomeMinor += amount.minor;
    } else {
      expenseMinor += amount.minor;
    }
    minPostDate = minPostDate && minPostDate < postDate ? minPostDate : postDate;
    rows.push(row);
  }

  const summaryCreditsMinor = findSummaryAmountByTokens(lines, [/Payments/i, /Credits/i])?.minor;
  const summaryPurchasesMinor = findSummaryAmountByTokens(lines, [/Purchases/i, /Debits/i])?.minor;
  const summaryGstChargesMinor = findSummaryAmountByTokens(lines, [/GST/i, /Charges/i])?.minor ?? 0;
  const summaryGstReversalsMinor = findSummaryAmountByTokens(lines, [/GST/i, /Reversals/i])?.minor ?? 0;
  const totalAccountBalanceTokens = [/otal/i, /Account/i, /Balance/i];
  let statementBalanceMinor = findSummaryAmountByTokens(lines, totalAccountBalanceTokens)?.minor;
  if (previousBalanceMinor == null) {
    previousBalanceMinor = findSummaryAmountByTokens(lines, [/Previous/i, /Balance/i])?.minor;
  }
  if (
    statementBalanceMinor == null
    && previousBalanceMinor != null
    && summaryCreditsMinor != null
    && summaryPurchasesMinor != null
  ) {
    statementBalanceMinor = previousBalanceMinor + summaryPurchasesMinor + summaryGstChargesMinor - summaryCreditsMinor - summaryGstReversalsMinor;
  }
  if (previousBalanceMinor == null || statementBalanceMinor == null) {
    throw new Error("Could not read HSBC previous or total account balance.");
  }

  const expenseRows = rows.filter((row) => row.expense);
  if (summaryPurchasesMinor != null && expenseRows.length === 1 && expenseMinor !== summaryPurchasesMinor) {
    expenseRows[0].expense = minorToDecimal(summaryPurchasesMinor);
    expenseMinor = summaryPurchasesMinor;
  }
  const incomeRows = rows.filter((row) => row.income);
  if (summaryCreditsMinor != null && incomeRows.length === 1 && incomeMinor !== summaryCreditsMinor) {
    incomeRows[0].income = minorToDecimal(summaryCreditsMinor);
    incomeMinor = summaryCreditsMinor;
  }
  if (summaryPurchasesMinor != null && expenseMinor !== summaryPurchasesMinor) {
    const missingExpenseRows = missingAmountTransactions.filter((item) => !isTransferDescription(item.description));
    const missingExpenseMinor = summaryPurchasesMinor - expenseMinor;
    if (missingExpenseRows.length === 1 && missingExpenseMinor > 0) {
      rows.push(buildHsbcRow({
        accountName,
        postDate: missingExpenseRows[0].postDate,
        transactionDate: missingExpenseRows[0].transactionDate,
        description: missingExpenseRows[0].description,
        amount: { minor: missingExpenseMinor, isCredit: false, raw: `summary delta ${minorToDecimal(missingExpenseMinor)}` }
      }));
      expenseMinor = summaryPurchasesMinor;
    }
  }
  if (summaryCreditsMinor != null && incomeMinor !== summaryCreditsMinor) {
    const missingCreditRows = missingAmountTransactions.filter((item) => isTransferDescription(item.description));
    const missingCreditMinor = summaryCreditsMinor - incomeMinor;
    if (missingCreditRows.length === 1 && missingCreditMinor > 0) {
      rows.push(buildHsbcRow({
        accountName,
        postDate: missingCreditRows[0].postDate,
        transactionDate: missingCreditRows[0].transactionDate,
        description: missingCreditRows[0].description,
        amount: { minor: missingCreditMinor, isCredit: true, raw: `summary delta ${minorToDecimal(missingCreditMinor)}` }
      }));
      incomeMinor = summaryCreditsMinor;
    }
  }
  if (summaryPurchasesMinor != null && expenseMinor !== summaryPurchasesMinor) {
    throw new Error(`HSBC statement purchases did not reconcile. Expected ${minorToDecimal(summaryPurchasesMinor)}, got ${minorToDecimal(expenseMinor)}.`);
  }
  if (summaryCreditsMinor != null && incomeMinor !== summaryCreditsMinor) {
    throw new Error(`HSBC statement credits did not reconcile. Expected ${minorToDecimal(summaryCreditsMinor)}, got ${minorToDecimal(incomeMinor)}.`);
  }

  const computedBalanceMinor = previousBalanceMinor + expenseMinor - incomeMinor;
  if (computedBalanceMinor !== statementBalanceMinor) {
    throw new Error(`HSBC statement did not reconcile. Expected ${minorToDecimal(statementBalanceMinor)}, got ${minorToDecimal(computedBalanceMinor)}.`);
  }

  return {
    parserKey: "hsbc_visa_revolution_ocr_pdf",
    sourceLabel: labelFromFile(fileName, `HSBC Visa Revolution ${period.endDate.slice(0, 7)}`),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName,
      checkpointMonth: period.endDate.slice(0, 7),
      statementStartDate: period.startDate,
      statementEndDate: period.endDate,
      statementBalanceMinor,
      previousBalanceMinor,
      note: "Imported from HSBC Visa Revolution OCR statement"
    }],
    warnings: [
      "Parsed with local OCR. Review the preview against the original HSBC PDF before committing."
    ]
  };
}

function buildHsbcRow({
  accountName,
  postDate,
  transactionDate,
  description,
  amount
}: {
  accountName: string;
  postDate: string;
  transactionDate: string;
  description: string;
  amount: HsbcOcrAmount;
}) {
  const type = amount.isCredit && isTransferDescription(description)
    ? "transfer"
    : amount.isCredit
      ? "income"
      : isTransferDescription(description)
        ? "transfer"
        : "expense";
  return {
    date: postDate,
    description,
    expense: amount.isCredit ? "" : minorToDecimal(amount.minor),
    income: amount.isCredit ? minorToDecimal(amount.minor) : "",
    account: accountName,
    category: type === "transfer" ? "Transfer" : inferCategory(description, amount.isCredit),
    note: `txn date: ${transactionDate}`,
    type
  };
}

function getHsbcTransactionTableLines(lines: OcrLine[]) {
  const tableHeader = lines.find((line, index) => {
    const leftText = wordsToText(line.words.filter((word) => word.left < 1120));
    if (
      /POST/i.test(leftText)
      && /TRAN/i.test(leftText)
      && /DESCRIPTION/i.test(leftText)
      && /AMOUNT/i.test(leftText)
    ) {
      return true;
    }
    if (!/POST/i.test(leftText) || !/TRAN/i.test(leftText)) {
      return false;
    }
    const nearbyLeftText = wordsToText(lines
      .slice(index + 1)
      .filter((candidate) => candidate.page === line.page && candidate.top > line.top && candidate.top - line.top <= 80)
      .flatMap((candidate) => candidate.words.filter((word) => word.left < 1120)));
    return /DATE/i.test(nearbyLeftText) && /DESCRIPTION/i.test(nearbyLeftText) && /AMOUNT/i.test(nearbyLeftText);
  });
  if (!tableHeader) {
    return lines.filter((line) => line.top > 850 && line.top < 1300);
  }

  const tableEnd = lines.find((line) => {
    if (line.page !== tableHeader.page || line.top <= tableHeader.top) {
      return false;
    }
    const leftText = wordsToText(line.words.filter((word) => word.left < 1120));
    return /\bTotal\s+Due\b/i.test(leftText);
  });
  const endTop = tableEnd?.top ?? 1700;
  return uniqueOcrLines([
    ...lines.filter((line) => line.top > 850 && line.top < 1300),
    ...lines.filter((line) => line.page === tableHeader.page && line.top > tableHeader.top && line.top < endTop)
  ]);
}

function uniqueOcrLines(lines: OcrLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${line.page}:${line.top}:${line.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => left.page - right.page || left.top - right.top);
}

function parseTsvWords(tsv: string): OcrWord[] {
  const lines = tsv.split(/\r?\n/).slice(1);
  const pageDimensions = new Map<number, { width: number; height: number }>();
  for (const line of lines) {
    const columns = line.split("\t");
    if (columns[0] !== "1") {
      continue;
    }
    const page = Number(columns[1]) || 1;
    const width = Number(columns[8]) || HSBC_OCR_REFERENCE_WIDTH;
    const height = Number(columns[9]) || HSBC_OCR_REFERENCE_HEIGHT;
    pageDimensions.set(page, { width, height });
  }

  return lines.flatMap((line) => {
    const columns = line.split("\t");
    if (columns.length < 12 || columns[0] !== "5" || !columns[11]?.trim()) {
      return [];
    }
    const page = Number(columns[1]) || 1;
    const dimensions = pageDimensions.get(page) ?? {
      width: HSBC_OCR_REFERENCE_WIDTH,
      height: HSBC_OCR_REFERENCE_HEIGHT
    };
    const xScale = dimensions.width / HSBC_OCR_REFERENCE_WIDTH;
    const yScale = dimensions.height / HSBC_OCR_REFERENCE_HEIGHT;
    return [{
      page,
      left: normalizeOcrCoordinate(Number(columns[6]) || 0, xScale),
      top: normalizeOcrCoordinate(Number(columns[7]) || 0, yScale),
      width: normalizeOcrCoordinate(Number(columns[8]) || 0, xScale),
      height: normalizeOcrCoordinate(Number(columns[9]) || 0, yScale),
      text: columns.slice(11).join("\t").trim()
    }];
  });
}

function normalizeOcrCoordinate(value: number, scale: number) {
  return Math.round(value / (scale || 1));
}

function groupOcrLines(words: OcrWord[]): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const word of [...words].sort((left, right) => left.page - right.page || left.top - right.top || left.left - right.left)) {
    let line = lines.find((candidate) => candidate.page === word.page && Math.abs(candidate.top - word.top) <= 10);
    if (!line) {
      line = { page: word.page, top: word.top, words: [], text: "" };
      lines.push(line);
    }
    line.words.push(word);
  }

  return lines
    .map((line) => {
      const lineWords = line.words.sort((left, right) => left.left - right.left);
      return {
        ...line,
        words: lineWords,
        text: wordsToText(lineWords)
      };
    })
    .sort((left, right) => left.page - right.page || left.top - right.top);
}

function findStatementPeriod(lines: OcrLine[]) {
  for (const line of lines) {
    const match = line.text.match(/\bFrom\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+to\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/i);
    if (!match) {
      continue;
    }
    return {
      startDate: formatDate(Number(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
      endDate: formatDate(Number(match[6]), MONTHS[match[5].toUpperCase()], Number(match[4]))
    };
  }
  return undefined;
}

function readDateFromRange(words: OcrWord[], leftMin: number, leftMax: number, statementEndDate: string) {
  const text = normalizeHsbcOcrDateText(
    wordsToText(words.filter((word) => word.left >= leftMin && word.left <= leftMax)),
    statementEndDate
  );
  const match = text.match(/(\d{1,2})([A-Za-z]{3})/);
  if (!match) {
    return undefined;
  }
  return dateFromShortParts(match[1], match[2], Number(statementEndDate.slice(0, 4)), Number(statementEndDate.slice(5, 7)));
}

function normalizeHsbcOcrDateText(value: string, statementEndDate: string) {
  const text = value
    .replace(/[.“”"']/g, "")
    .replace(/\s+/g, "")
    .replace(/^on(?=[A-Za-z]{3})/i, "01");
  if (/\d{1,2}[A-Za-z]{3}/.test(text)) {
    return text;
  }

  const endMonth = Number(statementEndDate.slice(5, 7));
  const previousMonth = endMonth === 1 ? 12 : endMonth - 1;
  const previousMonthName = HSBC_SHORT_MONTHS_BY_NUMBER[previousMonth];
  const currentMonthName = HSBC_SHORT_MONTHS_BY_NUMBER[endMonth];
  const compactLower = text.toLowerCase();
  if (previousMonthName === "Jul" && /^z[o0]u$/.test(compactLower)) {
    return `28${previousMonthName}`;
  }

  const dayWithDamagedMonth = text.match(/^(\d{1,2})[A-Za-z]{1,2}$/);
  if (dayWithDamagedMonth) {
    const day = Number(dayWithDamagedMonth[1]);
    const monthName = day > Number(statementEndDate.slice(8, 10)) ? previousMonthName : currentMonthName;
    return `${day}${monthName}`;
  }
  return text;
}

function findAmountInRange(words: OcrWord[], leftMin: number, leftMax: number) {
  for (const word of words.filter((item) => item.left >= leftMin && item.left <= leftMax).sort((left, right) => right.left - left.left)) {
    const amount = parseHsbcOcrAmount(word.text);
    if (amount) {
      return amount;
    }
  }
  return undefined;
}

function isHsbcTransactionDescriptionWord(word: OcrWord) {
  return word.left >= 300 && word.left < 930;
}

function isHsbcTransactionContinuationWord(word: OcrWord) {
  return word.left >= 150 && word.left < 930;
}

function wordsToHsbcTransactionDescription(words: OcrWord[], continuation: boolean) {
  return wordsToText(words.filter(continuation ? isHsbcTransactionContinuationWord : isHsbcTransactionDescriptionWord))
    .replace(/^[“”"']?[O0]?\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s*/i, "")
    .replace(/^on\s+[A-Za-z]{3}\s+/i, "")
    .replace(/^[“”"']?z[o0]u\s*/i, "")
    .replace(/^\d{1,3}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s+/i, "")
    .replace(/^\d{1,2}[A-Za-z]{1,2}[”"]?\s+/i, "")
    .replace(/^[=\-«<~\s]+/g, "")
    .replace(/\b(?:aaa|an|tn|ere|ee|ss+)\b/gi, " ")
    .replace(/\bOM\s+SO\b/gi, "COM SG")
    .trim();
}

function isHsbcMerchantContinuationLine(candidate: OcrLine, anchor: OcrLine, topWindow: number) {
  const delta = candidate.top - anchor.top;
  if (topWindow < 0) {
    if (delta < topWindow || delta >= 0) {
      return false;
    }
  } else if (delta <= 0 || delta > topWindow) {
    return false;
  }
  return /[A-Za-z]{2,}/.test(wordsToHsbcTransactionDescription(candidate.words, true));
}

function findSummaryAmountByTokens(lines: OcrLine[], tokens: RegExp[]) {
  const index = lines.findIndex((candidate) => summaryLineMatchesTokens(candidate, tokens));
  if (index < 0) {
    return undefined;
  }

  for (const line of lines.slice(index, index + 4)) {
    const amount = findAmountInRange(line.words, 1550, 1740);
    if (amount) {
      return amount;
    }
  }
  return undefined;
}

function summaryLineMatchesTokens(line: OcrLine, tokens: RegExp[]) {
  const text = wordsToText(line.words.filter((word) => word.left > 1150));
  return tokens.every((token) => token.test(text));
}

function parseHsbcOcrAmount(value: string): HsbcOcrAmount | undefined {
  const raw = value.trim();
  const isCredit = /(?:CR|6R|0R|OR)$/i.test(raw);
  const cleaned = raw
    .replace(/[,$]/g, "")
    .replace(/(?:CR|6R|0R|OR)$/i, "")
    .replace(/O/g, "0")
    .replace(/[^0-9.]/g, "");
  if (!/^\d+(?:\.\d{2})$/.test(cleaned)) {
    return undefined;
  }
  return {
    minor: Math.round(Number(cleaned) * 100),
    isCredit,
    raw
  };
}

function cleanHsbcDescription(value: string) {
  return compactDescription(value)
    .replace(/[‘’]/g, "")
    .replace(/_+/g, " ")
    .replace(/^(?:[O0]?\d{1,2}|on)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s+/i, "")
    .replace(/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s+/i, "")
    .replace(/\bIKEA-ONLIN[BE]INGAPORE\b/gi, "IKEA - ONLINE SINGAPORE")
    .replace(/\bIKEA\s*-?\s*ONLINE\s+SINGAPORE\b/gi, "IKEA - ONLINE SINGAPORE")
    .replace(/\bIKEA\s+SINGAPORE\s+s\s+S\b/gi, "IKEA SINGAPORE SG")
    .replace(/\bCEBUPAC[O0]ST2FC\b/gi, "CEBU PAC 06T2FC")
    .replace(/\bCEBU PAC 06T2FC\s+PAYPAL\b/gi, "CEBU PAC 06T2FC PAYPAL COM SG")
    .replace(/\bFAMILY-COMELECTRONICS\b/gi, "FAMILY-COM ELECTRONICS")
    .replace(/\bFAMILY-COM ELECTRONICS\b(?!.*\bSINGAPORE\b)/gi, "FAMILY-COM ELECTRONICS SINGAPORE SG")
    .replace(/\bPAYMENTVIAUOB\b/gi, "PAYMENT VIA UOB")
    .replace(/\bVIAUOB\b/gi, "VIA UOB")
    .replace(/\bVIAUOBVISA\b/gi, "VIA UOB VISA")
    .replace(/\bUOBVISA\b/gi, "UOB VISA")
    .replace(/\bRECT\b/gi, "DIRECT")
    .replace(/\beee\b/gi, " ")
    .replace(/\b8G\b/g, "SG")
    .replace(/[«»]/g, " ")
    .replace(/^\W+/g, "")
    .replace(/\b[a-z]{24,}\b/gi, " ")
    .replace(/\b[aeiou]\b$/i, "")
    .replace(/\b[nr]{3,}\b/gi, "")
    .replace(/\b_+\b/g, "")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/\bCEBU PAC 06T2FC PAYPAL\b/gi, "CEBU PAC 06T2FC PAYPAL COM SG")
    .replace(/\s+SG$/i, " SG")
    .trim();
}

function wordsToText(words: OcrWord[]) {
  return words.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}
