import {
  areOcrNoiseWords,
  cleanOcrDescriptionText,
  groupOcrLines,
  meanOcrConfidence,
  minOcrConfidence,
  OCR_CELL_CHARACTERS,
  ocrLegibilityScore,
  ocrWordsInColumn,
  ocrWordsToText,
  parseOcrAmount,
  readOcrDayMonth,
  readOcrTsvWords,
  resolveOcrAmountsAgainstTotals,
  splitOcrTsvPassesWithKinds,
  withoutOcrNoise,
  type OcrAmount,
  type OcrAmountReading,
  type OcrCellRegion,
  type OcrPassKind,
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
  type ParsedStatementImport,
  type StatementReconciliationCandidate,
  type StatementReconciliationDiagnostic
} from "./shared";

// HSBC Visa Revolution statements are image-only PDFs. The app OCRs them in
// the browser (Tesseract TSV) once, and a second time with another page
// layout mode when the first reading is doubtful; each pass misreads
// different words. Rows from every pass are lined up by position, the most
// legible description is kept, and the statement's printed totals decide
// between amount readings (see ocr.ts).

const HSBC_OCR_REFERENCE = { referenceWidth: 1820, referenceHeight: 2572 };
const HSBC_REFERENCE_SIZE = { width: HSBC_OCR_REFERENCE.referenceWidth, height: HSBC_OCR_REFERENCE.referenceHeight };
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
  kind: OcrPassKind;
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

// An amount read in the amount column on a line no row could claim (its
// dates and merchant were unreadable). It may be the missing row.
interface HsbcLeftoverAmount {
  page: number;
  top: number;
  amount: OcrAmount;
  description: string;
}

interface HsbcPassReading {
  rows: HsbcRowCandidate[];
  leftovers: HsbcLeftoverAmount[];
  summary: HsbcSummaryReading;
}

export interface HsbcOcrReview {
  passCount: number;
  // Amounts no pass could read, filled from the statement's printed total.
  inferredAmounts: Array<{ date: string; description: string; amount: string }>;
  // The first pass needed an inferred amount or has barely legible text, so
  // the app should OCR the PDF again before showing the preview.
  wantsSecondPass: boolean;
  // With wantsSecondPass: each row's date and amount cells, and each line
  // with an amount but unreadable dates, for the app to OCR one by one.
  cellRegions?: OcrCellRegion[];
  referenceSize?: { width: number; height: number };
}

// The HSBC Visa Revolution table's date and amount cells, around a line top.
const HSBC_CELL_COLUMNS: Array<{ left: number; right: number; characters: OcrCellRegion["characters"] }> = [
  { left: 160, right: 270, characters: "date" },
  { left: 290, right: 400, characters: "date" },
  { left: 960, right: 1160, characters: "amount" }
];

function hsbcCellRegions(lines: Array<{ page: number; top: number }>): OcrCellRegion[] {
  const seen = new Set<string>();
  return lines.flatMap((line) => {
    const key = `${line.page}:${Math.round(line.top / 10)}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return HSBC_CELL_COLUMNS.map((column) => ({
      page: line.page,
      left: column.left,
      right: column.right,
      top: line.top - 10,
      bottom: line.top + 30,
      characters: column.characters,
      allowedCharacters: OCR_CELL_CHARACTERS[column.characters]
    }));
  });
}

export function parseHsbcVisaRevolutionOcrTsv(text: string, fileName?: string): ParsedStatementImport & { ocrReview: HsbcOcrReview } {
  const passInputs = splitOcrTsvPassesWithKinds(text);
  const passLines = passInputs.map((pass) => groupOcrLines(readOcrTsvWords(pass.tsv, HSBC_OCR_REFERENCE)));
  if (!passLines.some((lines) => lines.some((line) => /HSBC\s+VISA\s+REVOLUTION/i.test(line.text)))) {
    throw new Error("This OCR text does not look like an HSBC Visa Revolution statement.");
  }

  const period = passLines.map(findStatementPeriod).find(Boolean);
  if (!period) {
    throw new Error("Could not find the HSBC statement period.");
  }

  const accountName = "HSBC Visa Revolution";
  const passes = passLines.map((lines, pass) => readHsbcPass(lines, pass, period, passInputs[pass].kind));
  const mergedRows = alignRowsAcrossPasses(passes.map((reading) => reading.rows));
  // A line whose dates only a cell read could see takes its merchant from
  // the page pass's leftover line at the same height: the row is recovered.
  const pageLeftovers = distinctLeftovers(passes.flatMap((reading) => reading.leftovers));
  const claimedLeftovers = new Set<HsbcLeftoverAmount>();
  const rows = mergedRows
    .map((candidates) => describeMergedRow(candidates))
    .map((row) => {
      if (row.description) {
        return row;
      }
      const leftover = pageLeftovers.find((item) => (
        !claimedLeftovers.has(item) && item.page === row.page && Math.abs(item.top - row.top) <= SAME_ROW_TOP_DISTANCE && item.description
      ));
      if (!leftover) {
        return row;
      }
      claimedLeftovers.add(leftover);
      const readings = row.readings.some((reading) => reading.minor === leftover.amount.minor && reading.isCredit === leftover.amount.isCredit)
        ? row.readings
        : [...row.readings, { minor: leftover.amount.minor, isCredit: leftover.amount.isCredit }];
      return { ...row, description: leftover.description, readings };
    })
    .filter((row) => row.description);
  const pageRowLines = passes.flatMap((reading, pass) => passInputs[pass].kind === "page" ? reading.rows : []);
  const cellRegions = hsbcCellRegions([...pageRowLines, ...pageLeftovers]);

  const summaries = buildSummaryCandidates(passes.map((reading) => reading.summary));
  if (!summaries.length) {
    throw new Error("Could not read HSBC previous or total account balance.");
  }

  const leftovers = pageLeftovers.filter((leftover) => !claimedLeftovers.has(leftover));
  const resolved = resolveOcrAmountsAgainstTotals({
    rows: rows.map((row) => ({ readings: row.readings, creditWhenUnread: isTransferDescription(row.description) })),
    canInferKind: (isCredit) => !leftovers.some((leftover) => leftover.amount.isCredit === isCredit),
    summaries,
    totalsOf: (summary) => ({ debitMinor: summary.purchasesMinor, creditMinor: summary.creditsMinor }),
    isSummaryConsistent: (summary, debitMinor, creditMinor) => (
      summary.previousBalanceMinor! + debitMinor - creditMinor === summary.statementBalanceMinor
    )
  });
  if (!resolved) {
    // The readable rows go to review with the printed totals they must reach;
    // the import stays blocked until the rows in the preview add up.
    const summary = summaries[0];
    const reconciliation = buildReconciliationDiagnostic({
      rows,
      leftovers,
      summary,
      accountName,
      periodEndDate: period.endDate
    });
    const partialRows = rows
      .filter((row) => row.readings[0])
      .map((row) => buildHsbcRow({
        accountName,
        postDate: row.postDate,
        transactionDate: row.transactionDate,
        description: row.description,
        amount: row.readings[0]
      }));
    return {
      parserKey: "hsbc_visa_revolution_ocr_pdf",
      sourceLabel: labelFromFile(fileName, `HSBC Visa Revolution ${period.endDate.slice(0, 7)}`),
      rows: partialRows.sort(compareImportRowsByDate),
      checkpoints: [{
        accountName,
        checkpointMonth: period.endDate.slice(0, 7),
        statementStartDate: period.startDate,
        statementEndDate: period.endDate,
        statementBalanceMinor: summary.statementBalanceMinor!,
        previousBalanceMinor: summary.previousBalanceMinor!,
        note: "Imported from HSBC Visa Revolution OCR statement"
      }],
      warnings: [
        "Parsed with local OCR. Review the preview against the original HSBC PDF before committing."
      ],
      reconciliation,
      ocrReview: {
        passCount: passLines.length,
        inferredAmounts: [],
        wantsSecondPass: passLines.length === 1,
        ...(passLines.length === 1 ? { cellRegions, referenceSize: HSBC_REFERENCE_SIZE } : {})
      }
    };
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
      wantsSecondPass: passLines.length === 1 && isFirstPassDoubtful,
      ...(passLines.length === 1 && isFirstPassDoubtful ? { cellRegions, referenceSize: HSBC_REFERENCE_SIZE } : {})
    }
  };
}

// Candidates come only from evidence on the page: every amount read on a line
// no row claimed, and every dated row whose amount no pass could read. The
// app offers a leftover only while it exactly equals the current difference,
// and asks the user to type an unread row's amount from the PDF. Nothing here
// certifies anything: the preview stays blocked until its rows add up to the
// printed totals.
function buildReconciliationDiagnostic({
  rows,
  leftovers,
  summary,
  accountName,
  periodEndDate
}: {
  rows: Array<{ description: string; postDate?: string; transactionDate?: string; top: number; page: number; readings: OcrAmountReading[] }>;
  leftovers: HsbcLeftoverAmount[];
  summary: HsbcSummaryReading;
  accountName: string;
  periodEndDate: string;
}): StatementReconciliationDiagnostic {
  const expected = { debit: summary.purchasesMinor, credit: summary.creditsMinor };
  const candidates: StatementReconciliationCandidate[] = [];

  for (const row of rows.filter((item) => item.readings.length === 0 && item.description)) {
    candidates.push({
      id: `unread-amount-${row.page}-${row.top}`,
      evidence: "unread-amount",
      row: buildHsbcRowWithoutAmount({ accountName, postDate: row.postDate, transactionDate: row.transactionDate, description: row.description }),
      isCredit: isTransferDescription(row.description)
    });
  }

  for (const leftover of leftovers) {
    // The leftover's own dates were unreadable; the row printed just above it
    // is the best default, and the user confirms it against the PDF.
    const rowAbove = rows
      .filter((row) => row.page === leftover.page && row.top < leftover.top && row.postDate)
      .sort((left, right) => right.top - left.top)[0];
    candidates.push({
      id: `leftover-amount-${leftover.page}-${leftover.top}`,
      evidence: "leftover-amount",
      row: buildHsbcRowWithoutAmount({ accountName, postDate: rowAbove?.postDate ?? periodEndDate, description: leftover.description }),
      amountMinor: leftover.amount.minor,
      isCredit: leftover.amount.isCredit
    });
  }

  return {
    ...(expected.debit != null ? { expectedDebitMinor: expected.debit } : {}),
    ...(expected.credit != null ? { expectedCreditMinor: expected.credit } : {}),
    candidates
  };
}

// The same leftover read by two passes is one leftover; a zero amount is
// never a missing row.
function distinctLeftovers(leftovers: HsbcLeftoverAmount[]) {
  return leftovers.filter((leftover, index) => leftover.amount.minor > 0 && leftovers.findIndex((other) => (
    other.page === leftover.page
    && Math.abs(other.top - leftover.top) <= SAME_ROW_TOP_DISTANCE
    && other.amount.minor === leftover.amount.minor
    && other.amount.isCredit === leftover.amount.isCredit
  )) === index);
}

function buildHsbcRowWithoutAmount(input: { accountName: string; postDate?: string; transactionDate?: string; description: string }) {
  return { ...buildHsbcRow({ ...input, amount: { minor: 0, isCredit: false } }), expense: "", income: "" };
}

function readHsbcPass(rawLines: OcrLine[], pass: number, period: OcrStatementPeriod, kind: OcrPassKind): HsbcPassReading {
  if (kind === "cells") {
    return readHsbcCellPass(rawLines, pass, period);
  }
  const lines = withoutOcrNoise(rawLines);
  const transactionLines = getHsbcTransactionTableLines(lines);
  const rows: HsbcRowCandidate[] = [];
  const leftovers: HsbcLeftoverAmount[] = [];
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
      const leftoverAmount = findAmountInRange(line.words, 930, 1140);
      if (leftoverAmount && !isHsbcTableEndLine(line)) {
        leftovers.push({
          page: line.page,
          top: line.top,
          amount: leftoverAmount,
          description: cleanHsbcDescription(wordsToHsbcTransactionDescription(line.words, true))
        });
      }
      continue;
    }
    let amount = findAmountInRange(line.words, 930, 1140);

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
      // A line with its own amount under a row that already has one is the
      // next transaction with unreadable dates, not a merchant's second line.
      if (
        (amount && findAmountInRange(candidate.words, 930, 1140))
        || readHsbcDate(candidate.words, 125, 245, period, 0)
        || /Total\s+Due|Minimum\s+Payment|Total\s+Account\s+Balance/i.test(tableText)
        || !isHsbcMerchantContinuationLine(candidate, line, 85)
      ) {
        break;
      }
      // A row's amount can sit on its merchant's second line.
      amount ??= findAmountInRange(candidate.words, 930, 1140);
      const continuation = wordsToHsbcTransactionDescription(candidate.words, true);
      if (continuation) {
        descriptionParts.push(continuation);
        descriptionWords.push(...ocrWordsInColumn(candidate.words, 150, 930));
      }
      index = cursor;
    }

    rows.push({
      pass,
      kind: "page",
      page: line.page,
      top: line.top,
      postDate,
      transactionDate,
      description: cleanHsbcDescription(descriptionParts.join(" ")),
      descriptionScore: ocrLegibilityScore(descriptionWords),
      descriptionMeanConfidence: meanOcrConfidence(descriptionWords),
      descriptionMinConfidence: minOcrConfidence(descriptionWords),
      amount
    });
  }

  // OCR can box a row's amount a few pixels off its line; a leftover that
  // close to a row without an amount is that row's amount.
  for (const row of rows.filter((item) => !item.amount)) {
    const nearby = leftovers.findIndex((leftover) => leftover.page === row.page && Math.abs(leftover.top - row.top) <= 25);
    if (nearby >= 0) {
      row.amount = leftovers[nearby].amount;
      leftovers.splice(nearby, 1);
    }
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
    leftovers,
    summary: { previousBalanceMinor, purchasesMinor, creditsMinor, statementBalanceMinor }
  };
}

// A cells pass holds only what the app read cell by cell (dates and amounts,
// each restricted to its characters): every line with a date is a row's
// dates and amount, with no merchant and no summary.
function readHsbcCellPass(lines: OcrLine[], pass: number, period: OcrStatementPeriod): HsbcPassReading {
  const rows: HsbcRowCandidate[] = [];
  for (const line of lines) {
    const postDate = readHsbcDate(line.words, 125, 245, period, 0);
    const transactionDate = readHsbcDate(line.words, 240, 400, period, 31);
    if (!postDate && !transactionDate) {
      continue;
    }
    rows.push({
      pass,
      kind: "cells",
      page: line.page,
      top: line.top,
      postDate,
      transactionDate,
      description: "",
      descriptionScore: 0,
      descriptionMeanConfidence: null,
      descriptionMinConfidence: null,
      amount: findAmountInRange(line.words, 930, 1160)
    });
  }
  return { rows, leftovers: [], summary: {} };
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
  // A cell read is the most reliable reading of a date or an amount.
  const byReliability = [...candidates].sort((left, right) => Number(right.kind === "cells") - Number(left.kind === "cells") || left.pass - right.pass);
  const readings: OcrAmountReading[] = [];
  for (const candidate of byReliability) {
    const amount = candidate.amount;
    if (amount && amount.minor !== 0 && !readings.some((reading) => reading.minor === amount.minor && reading.isCredit === amount.isCredit)) {
      readings.push({ minor: amount.minor, isCredit: amount.isCredit });
    }
  }
  return {
    page: candidates[0].page,
    top: candidates[0].top,
    postDate: byReliability.find((candidate) => candidate.postDate)?.postDate,
    transactionDate: byReliability.find((candidate) => candidate.transactionDate)?.transactionDate,
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

function isHsbcTableEndLine(line: OcrLine) {
  return /Total\s+Due|Minimum\s+Payment|Total\s+Account\s+Balance|Previous\s+Statement\s+Balance/i
    .test(ocrWordsToText(line.words.filter((word) => word.left < 1120)));
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
