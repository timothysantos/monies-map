import {
  areOcrNoiseWords,
  cleanOcrDescriptionText,
  groupOcrLines,
  meanOcrConfidence,
  minOcrConfidence,
  ocrLegibilityScore,
  ocrWordsInColumn,
  ocrWordsToText,
  parseOcrAmount,
  readOcrDayMonth,
  readOcrTsvWords,
  resolveOcrAmountsAgainstTotals,
  splitOcrTsvPasses,
  withoutOcrNoise,
  type OcrAmount,
  type OcrAmountReading,
  type OcrLine,
  type OcrStatementPeriod,
  type OcrWord
} from "./ocr";
import {
  compactDescription,
  compareImportRowsByDate,
  formatDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  MONTHS,
  type ParsedStatementImport
} from "./shared";

// HSBC Visa Revolution statements are image-only PDFs. The app OCRs them in
// the browser (Tesseract TSV) once, and a second time with another page
// layout mode when the first reading is doubtful; each pass misreads
// different words. Rows from every pass are lined up by position, the most
// legible description is kept, and the statement's printed totals decide
// between amount readings (see ocr.ts).

const HSBC_OCR_REFERENCE = { referenceWidth: 1820, referenceHeight: 2572 };
const HSBC_SHORT_MONTHS_BY_NUMBER = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Below this confidence a description word is probably misread, so the first
// pass asks for a second one.
const LEGIBLE_WORD_CONFIDENCE = 60;
// Rows from two passes of the same page image are the same row when their
// tops are this close.
const SAME_ROW_TOP_DISTANCE = 20;

interface HsbcSummaryReading {
  previousBalanceMinor?: number;
  purchasesMinor?: number;
  creditsMinor?: number;
  statementBalanceMinor?: number;
}

interface HsbcRowCandidate {
  pass: number;
  page: number;
  top: number;
  postDate?: string;
  transactionDate?: string;
  description: string;
  descriptionScore: number;
  descriptionMeanConfidence: number | null;
  descriptionMinConfidence: number | null;
  amount?: OcrAmount;
}

interface HsbcPassReading {
  rows: HsbcRowCandidate[];
  summary: HsbcSummaryReading;
}

export interface HsbcOcrReview {
  passCount: number;
  // Amounts no pass could read, filled from the statement's printed total.
  inferredAmounts: Array<{ date: string; description: string; amount: string }>;
  // The first pass needed an inferred amount or has barely legible text, so
  // the app should OCR the PDF again before showing the preview.
  wantsSecondPass: boolean;
}

export function parseHsbcVisaRevolutionOcrTsv(text: string, fileName?: string): ParsedStatementImport & { ocrReview: HsbcOcrReview } {
  const passLines = splitOcrTsvPasses(text).map((tsv) => groupOcrLines(readOcrTsvWords(tsv, HSBC_OCR_REFERENCE)));
  if (!passLines.some((lines) => lines.some((line) => /HSBC\s+VISA\s+REVOLUTION/i.test(line.text)))) {
    throw new Error("This OCR text does not look like an HSBC Visa Revolution statement.");
  }

  const period = passLines.map(findStatementPeriod).find(Boolean);
  if (!period) {
    throw new Error("Could not find the HSBC statement period.");
  }

  const accountName = "HSBC Visa Revolution";
  const passes = passLines.map((lines, pass) => readHsbcPass(lines, pass, period));
  const mergedRows = alignRowsAcrossPasses(passes.map((reading) => reading.rows));
  const rows = mergedRows
    .map((candidates) => describeMergedRow(candidates))
    .filter((row) => row.description);

  const summaries = buildSummaryCandidates(passes.map((reading) => reading.summary));
  if (!summaries.length) {
    throw new Error("Could not read HSBC previous or total account balance.");
  }

  const resolved = resolveOcrAmountsAgainstTotals({
    rows: rows.map((row) => ({ readings: row.readings, creditWhenUnread: isTransferDescription(row.description) })),
    summaries,
    totalsOf: (summary) => ({ debitMinor: summary.purchasesMinor, creditMinor: summary.creditsMinor }),
    isSummaryConsistent: (summary, debitMinor, creditMinor) => (
      summary.previousBalanceMinor! + debitMinor - creditMinor === summary.statementBalanceMinor
    )
  });
  if (!resolved) {
    throw new Error(describeReconciliationFailure(rows, summaries[0]));
  }

  const importRows = rows.map((row, index) => buildHsbcRow({
    accountName,
    postDate: row.postDate,
    transactionDate: row.transactionDate,
    description: row.description,
    amount: resolved.amounts[index]
  }));
  const inferredAmounts = resolved.inferredRowIndexes.map((index) => ({
    date: importRows[index].date,
    description: importRows[index].description,
    amount: minorToDecimal(resolved.amounts[index].minor)
  }));
  const isFirstPassDoubtful = inferredAmounts.length > 0
    || rows.some((row) => !row.transactionDate || (row.minConfidence != null && row.minConfidence < LEGIBLE_WORD_CONFIDENCE));

  return {
    parserKey: "hsbc_visa_revolution_ocr_pdf",
    sourceLabel: labelFromFile(fileName, `HSBC Visa Revolution ${period.endDate.slice(0, 7)}`),
    rows: importRows.sort(compareImportRowsByDate),
    checkpoints: [{
      accountName,
      checkpointMonth: period.endDate.slice(0, 7),
      statementStartDate: period.startDate,
      statementEndDate: period.endDate,
      statementBalanceMinor: resolved.summary.statementBalanceMinor!,
      previousBalanceMinor: resolved.summary.previousBalanceMinor!,
      note: "Imported from HSBC Visa Revolution OCR statement"
    }],
    warnings: [
      "Parsed with local OCR. Review the preview against the original HSBC PDF before committing."
    ],
    ocrReview: {
      passCount: passLines.length,
      inferredAmounts,
      wantsSecondPass: passLines.length === 1 && isFirstPassDoubtful
    }
  };
}

function readHsbcPass(rawLines: OcrLine[], pass: number, period: OcrStatementPeriod): HsbcPassReading {
  const lines = withoutOcrNoise(rawLines);
  const transactionLines = getHsbcTransactionTableLines(lines);
  const rows: HsbcRowCandidate[] = [];
  let tablePreviousBalanceMinor: number | undefined;

  for (let index = 0; index < transactionLines.length; index += 1) {
    const line = transactionLines[index];
    if (/Previous\s+Statement\s+Balance/i.test(line.text) && line.words.some((word) => word.left < 1120)) {
      tablePreviousBalanceMinor = findAmountInRange(line.words, 950, 1140)?.minor;
      continue;
    }

    const postDate = readHsbcDate(line.words, 125, 245, period, 0);
    const transactionDate = readHsbcDate(line.words, 240, 390, period, 31);
    if (!postDate && !transactionDate) {
      continue;
    }

    const descriptionParts: string[] = [];
    const descriptionWords: OcrWord[] = [];
    const description = wordsToHsbcTransactionDescription(line.words, false);
    const previousLine = transactionLines[index - 1];
    if (!description && previousLine && isHsbcMerchantContinuationLine(previousLine, line, -35)) {
      descriptionParts.push(wordsToHsbcTransactionDescription(previousLine.words, true));
      descriptionWords.push(...ocrWordsInColumn(previousLine.words, 400, 930));
    }
    if (description) {
      descriptionParts.push(description);
      descriptionWords.push(...ocrWordsInColumn(line.words, 400, 930));
    }
    for (let cursor = index + 1; cursor < transactionLines.length; cursor += 1) {
      const candidate = transactionLines[cursor];
      // Only the table's side of the page can end a row: the summary column
      // on the right has its own "Total Account Balance".
      const tableText = ocrWordsToText(candidate.words.filter((word) => word.left < 1120));
      if (
        readHsbcDate(candidate.words, 125, 245, period, 0)
        || /Total\s+Due|Minimum\s+Payment|Total\s+Account\s+Balance/i.test(tableText)
        || !isHsbcMerchantContinuationLine(candidate, line, 85)
      ) {
        break;
      }
      const continuation = wordsToHsbcTransactionDescription(candidate.words, true);
      if (continuation) {
        descriptionParts.push(continuation);
        descriptionWords.push(...ocrWordsInColumn(candidate.words, 150, 930));
      }
      index = cursor;
    }

    rows.push({
      pass,
      page: line.page,
      top: line.top,
      postDate,
      transactionDate,
      description: cleanHsbcDescription(descriptionParts.join(" ")),
      descriptionScore: ocrLegibilityScore(descriptionWords),
      descriptionMeanConfidence: meanOcrConfidence(descriptionWords),
      descriptionMinConfidence: minOcrConfidence(descriptionWords),
      amount: findAmountInRange(line.words, 930, 1140)
    });
  }

  const summaryPreviousBalanceMinor = findSummaryAmountByTokens(lines, [/Previous/i, /Balance/i])?.minor;
  const creditsMinor = findSummaryAmountByTokens(lines, [/Payments/i, /Credits/i])?.minor;
  const purchasesMinor = findSummaryAmountByTokens(lines, [/Purchases/i, /Debits/i])?.minor;
  const gstChargesMinor = findSummaryAmountByTokens(lines, [/GST/i, /Charges/i])?.minor ?? 0;
  const gstReversalsMinor = findSummaryAmountByTokens(lines, [/GST/i, /Reversals/i])?.minor ?? 0;
  const previousBalanceMinor = tablePreviousBalanceMinor ?? summaryPreviousBalanceMinor;
  let statementBalanceMinor = findSummaryAmountByTokens(lines, [/otal/i, /Account/i, /Balance/i])?.minor;
  if (statementBalanceMinor == null && previousBalanceMinor != null && creditsMinor != null && purchasesMinor != null) {
    statementBalanceMinor = previousBalanceMinor + purchasesMinor + gstChargesMinor - creditsMinor - gstReversalsMinor;
  }

  return {
    rows,
    summary: { previousBalanceMinor, purchasesMinor, creditsMinor, statementBalanceMinor }
  };
}

// Lines up each pass's rows with the first pass's by position on the page.
// A row only a later pass could date is added in its place.
function alignRowsAcrossPasses(passRows: HsbcRowCandidate[][]) {
  const merged: HsbcRowCandidate[][] = (passRows[0] ?? []).map((row) => [row]);
  for (const rows of passRows.slice(1)) {
    const claimed = new Set<number>();
    for (const row of rows) {
      let bestIndex = -1;
      let bestDistance = Infinity;
      merged.forEach((group, index) => {
        const anchor = group[0];
        const distance = Math.abs(anchor.top - row.top);
        if (!claimed.has(index) && anchor.page === row.page && distance <= SAME_ROW_TOP_DISTANCE && distance < bestDistance) {
          bestIndex = index;
          bestDistance = distance;
        }
      });
      if (bestIndex >= 0) {
        claimed.add(bestIndex);
        merged[bestIndex].push(row);
      } else {
        merged.push([row]);
        claimed.add(merged.length - 1);
      }
    }
  }
  return merged.sort((left, right) => left[0].page - right[0].page || left[0].top - right[0].top);
}

function describeMergedRow(candidates: HsbcRowCandidate[]) {
  const legible = [...candidates]
    .filter((candidate) => candidate.description)
    .sort((left, right) => (
      right.descriptionScore - left.descriptionScore
      || (right.descriptionMeanConfidence ?? 0) - (left.descriptionMeanConfidence ?? 0)
      || left.pass - right.pass
    ))[0];
  const readings: OcrAmountReading[] = [];
  for (const candidate of candidates) {
    const amount = candidate.amount;
    if (amount && amount.minor !== 0 && !readings.some((reading) => reading.minor === amount.minor && reading.isCredit === amount.isCredit)) {
      readings.push({ minor: amount.minor, isCredit: amount.isCredit });
    }
  }
  return {
    postDate: candidates.find((candidate) => candidate.postDate)?.postDate,
    transactionDate: candidates.find((candidate) => candidate.transactionDate)?.transactionDate,
    description: legible?.description ?? "",
    minConfidence: legible?.descriptionMinConfidence ?? null,
    readings
  };
}

// The first pass's summary per field, then any other pass's for fields the
// first could not read, then each pass's summary as printed.
function buildSummaryCandidates(summaries: HsbcSummaryReading[]) {
  const fields = ["previousBalanceMinor", "purchasesMinor", "creditsMinor", "statementBalanceMinor"] as const;
  const combined: HsbcSummaryReading = {};
  for (const field of fields) {
    combined[field] = summaries.map((summary) => summary[field]).find((value) => value != null);
  }
  const candidates = [combined, ...summaries]
    .filter((summary) => summary.previousBalanceMinor != null && summary.statementBalanceMinor != null);
  return candidates.filter((summary, index) => candidates.findIndex((other) => JSON.stringify(other) === JSON.stringify(summary)) === index);
}

function describeReconciliationFailure(rows: Array<{ readings: OcrAmountReading[] }>, summary: HsbcSummaryReading) {
  const firstReading = rows.map((row) => row.readings[0]);
  const debitMinor = firstReading.reduce((total, reading) => total + (reading && !reading.isCredit ? reading.minor : 0), 0);
  const creditMinor = firstReading.reduce((total, reading) => total + (reading?.isCredit ? reading.minor : 0), 0);
  if (summary.purchasesMinor != null && debitMinor !== summary.purchasesMinor) {
    return `HSBC statement purchases did not reconcile. Expected ${minorToDecimal(summary.purchasesMinor)}, got ${minorToDecimal(debitMinor)}.`;
  }
  if (summary.creditsMinor != null && creditMinor !== summary.creditsMinor) {
    return `HSBC statement credits did not reconcile. Expected ${minorToDecimal(summary.creditsMinor)}, got ${minorToDecimal(creditMinor)}.`;
  }
  const computedBalanceMinor = summary.previousBalanceMinor! + debitMinor - creditMinor;
  return `HSBC statement did not reconcile. Expected ${minorToDecimal(summary.statementBalanceMinor!)}, got ${minorToDecimal(computedBalanceMinor)}.`;
}

function buildHsbcRow({
  accountName,
  postDate,
  transactionDate,
  description,
  amount
}: {
  accountName: string;
  postDate?: string;
  transactionDate?: string;
  description: string;
  amount: OcrAmountReading;
}) {
  const type = amount.isCredit && isTransferDescription(description)
    ? "transfer"
    : amount.isCredit
      ? "income"
      : isTransferDescription(description)
        ? "transfer"
        : "expense";
  return {
    date: postDate ?? transactionDate ?? "",
    description,
    expense: amount.isCredit ? "" : minorToDecimal(amount.minor),
    income: amount.isCredit ? minorToDecimal(amount.minor) : "",
    account: accountName,
    category: type === "transfer" ? "Transfer" : inferCategory(description, amount.isCredit),
    note: transactionDate ? `txn date: ${transactionDate}` : "",
    type
  };
}

function getHsbcTransactionTableLines(lines: OcrLine[]) {
  const tableHeader = lines.find((line, index) => {
    const leftText = ocrWordsToText(line.words.filter((word) => word.left < 1120));
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
    const nearbyLeftText = ocrWordsToText(lines
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
    const leftText = ocrWordsToText(line.words.filter((word) => word.left < 1120));
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

function findStatementPeriod(lines: OcrLine[]): OcrStatementPeriod | undefined {
  for (const line of lines) {
    const match = line.text.match(/\bFrom\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+to\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/i);
    if (!match || !MONTHS[match[2].toUpperCase()] || !MONTHS[match[5].toUpperCase()]) {
      continue;
    }
    return {
      startDate: formatDate(Number(match[3]), MONTHS[match[2].toUpperCase()], Number(match[1])),
      endDate: formatDate(Number(match[6]), MONTHS[match[5].toUpperCase()], Number(match[4]))
    };
  }
  return undefined;
}

// Two HSBC-specific misreads seen in real statements come first ("on Aug"
// for "01 Aug", "zou" for "28 Jul"); everything else is the general reader.
function readHsbcDate(words: OcrWord[], leftMin: number, leftMax: number, period: OcrStatementPeriod, earlierDays: number) {
  const text = ocrWordsToText(ocrWordsInColumn(words, leftMin, leftMax))
    .replace(/[.“”"']/g, "")
    .replace(/\s+/g, "")
    .replace(/^on(?=[A-Za-z]{3})/i, "01");
  const endMonth = Number(period.endDate.slice(5, 7));
  const previousMonthName = HSBC_SHORT_MONTHS_BY_NUMBER[endMonth === 1 ? 12 : endMonth - 1];
  const normalized = previousMonthName === "Jul" && /^z[o0]u$/i.test(text) ? `28${previousMonthName}` : text;
  return readOcrDayMonth(normalized, period, { earlierDays });
}

function findAmountInRange(words: OcrWord[], leftMin: number, leftMax: number) {
  for (const word of ocrWordsInColumn(words, leftMin, leftMax).sort((left, right) => right.left - left.left)) {
    const amount = parseOcrAmount(word.text);
    if (amount) {
      return amount;
    }
  }
  return undefined;
}

// The description column starts at about x=430, right of the transaction
// date column (x=300-390), so date residue such as "14Aug_—s" stays out.
function isHsbcTransactionDescriptionWord(word: OcrWord) {
  return word.left >= 400 && word.left < 930;
}

function isHsbcTransactionContinuationWord(word: OcrWord) {
  return word.left >= 150 && word.left < 930;
}

function wordsToHsbcTransactionDescription(words: OcrWord[], continuation: boolean) {
  return ocrWordsToText(words.filter(continuation ? isHsbcTransactionContinuationWord : isHsbcTransactionDescriptionWord))
    .replace(/^[“”"']?[O0]?\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s*/i, "")
    .replace(/^[O0]?\d{1,2}[0O]ct\s*/i, "")
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
  if (areOcrNoiseWords(candidate.words.filter(isHsbcTransactionContinuationWord))) {
    return false;
  }
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
  const text = ocrWordsToText(line.words.filter((word) => word.left > 1150));
  return tokens.every((token) => token.test(text));
}

// Known misreads of merchant names from real HSBC statements. They only
// rewrite text that can only have come from these merchants.
const HSBC_KNOWN_MISREADS: Array<[RegExp, string]> = [
  [/\bIKEA-ONLIN[BE]INGAPORE\b/gi, "IKEA - ONLINE SINGAPORE"],
  [/\bIKEA\s*-?\s*ONLINE\s+SINGAPORE\b/gi, "IKEA - ONLINE SINGAPORE"],
  [/\bIKEA\s+SINGAPORE\s+s\s+S\b/gi, "IKEA SINGAPORE SG"],
  [/\bCEBUPAC[O0]ST2FC\b/gi, "CEBU PAC 06T2FC"],
  [/\bFAMILY-COMELECTRONICS\b/gi, "FAMILY-COM ELECTRONICS"],
  [/\bPAYMENTVIAUOB\b/gi, "PAYMENT VIA UOB"],
  [/\bVIAUOBVISA\b/gi, "VIA UOB VISA"],
  [/\bVIAUOB\b/gi, "VIA UOB"],
  [/\bUOBVISA\b/gi, "UOB VISA"],
  [/\bRECT\b/gi, "DIRECT"]
];

function cleanHsbcDescription(value: string) {
  let text = cleanOcrDescriptionText(compactDescription(value));
  for (const [pattern, replacement] of HSBC_KNOWN_MISREADS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/[‘’]/g, "")
    .replace(/_+/g, " ")
    .replace(/^(?:[O0]?\d{1,2}|on)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s+/i, "")
    .replace(/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Ju|Aug|Au|Sep|Se|Oct|Nov|Dec)\.?\s+/i, "")
    .replace(/\b(PAYMENT VIA UOB VISA DIRECT SG)\b.*$/i, "$1")
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
    .replace(/\s+SG$/i, " SG")
    // HSBC prints the merchant's location on a second line; when OCR loses
    // it these merchants' known locations are restored.
    .replace(/\bCEBU PAC 06T2FC PAYPAL\b(?!\s+COM\s+SG)/gi, "CEBU PAC 06T2FC PAYPAL COM SG")
    .replace(/\bFAMILY-COM ELECTRONICS\b(?!.*\bSINGAPORE\b)/gi, "FAMILY-COM ELECTRONICS SINGAPORE SG")
    .trim();
}
