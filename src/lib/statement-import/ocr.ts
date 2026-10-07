// Bank-independent helpers for statements that only exist as images and are
// read with Tesseract in the browser. A bank parser decides where its columns
// and summary sit; these helpers turn Tesseract's TSV into positioned words
// and lines, read OCR-damaged dates and amounts, drop scanner noise, and use
// the statement's own totals as a checksum to choose between OCR passes.
//
// Principles:
// - A value that was read is never replaced by a guess.
// - A missing amount is filled from a printed total only when it is the one
//   unknown that total leaves; two unknowns are an error, not a guess.
// - Dates are resolved against the statement period, so a damaged month
//   ("0ct", "Jui", "Ju") or a missing one still lands on one real date.

import { formatDate } from "./shared";

export const OCR_TSV_MARKER = "__OCR_TSV__";

export interface OcrWord {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
  // Tesseract's word confidence (0-100); null when the TSV has none.
  confidence: number | null;
  text: string;
}

export interface OcrLine {
  page: number;
  // The median top of the line's words, so one tall word does not move it.
  top: number;
  bottom: number;
  words: OcrWord[];
  text: string;
}

export interface OcrAmount {
  minor: number;
  isCredit: boolean;
  raw: string;
}

export interface OcrStatementPeriod {
  startDate: string;
  endDate: string;
}

// One OCR pass per TSV, primary pass first. The package format is the marker
// line followed by the pass's TSV, repeated for each pass.
export function joinOcrTsvPasses(passes: string[]) {
  return passes.map((tsv) => `${OCR_TSV_MARKER}\n${tsv.replace(new RegExp(`^${OCR_TSV_MARKER}\\n?`), "").trim()}`).join("\n");
}

export function splitOcrTsvPasses(text: string) {
  return text
    .split(new RegExp(`(?:^|\\n)${OCR_TSV_MARKER}[^\\n]*`))
    .map((pass) => pass.trim())
    .filter(Boolean);
}

// Coordinates are scaled to a reference page size so a parser's column
// ranges hold whatever resolution the page was rendered at.
export function readOcrTsvWords(tsv: string, { referenceWidth, referenceHeight }: { referenceWidth: number; referenceHeight: number }): OcrWord[] {
  const rows = tsv.split(/\r?\n/).map((line) => line.split("\t"));
  const pageSizes = new Map<number, { width: number; height: number }>();
  for (const columns of rows) {
    if (columns[0] === "1") {
      pageSizes.set(Number(columns[1]) || 1, {
        width: Number(columns[8]) || referenceWidth,
        height: Number(columns[9]) || referenceHeight
      });
    }
  }

  return rows.flatMap((columns) => {
    const text = columns.slice(11).join("\t").trim();
    if (columns.length < 12 || columns[0] !== "5" || !text) {
      return [];
    }
    const page = Number(columns[1]) || 1;
    const size = pageSizes.get(page) ?? { width: referenceWidth, height: referenceHeight };
    const xScale = size.width / referenceWidth || 1;
    const yScale = size.height / referenceHeight || 1;
    const confidence = Number(columns[10]);
    return [{
      page,
      left: Math.round((Number(columns[6]) || 0) / xScale),
      top: Math.round((Number(columns[7]) || 0) / yScale),
      width: Math.round((Number(columns[8]) || 0) / xScale),
      height: Math.round((Number(columns[9]) || 0) / yScale),
      confidence: Number.isFinite(confidence) && confidence >= 0 ? confidence : null,
      text
    }];
  });
}

// A word belongs to a line when its top is close to the line's, or when one
// sits vertically inside the other: Tesseract often boxes a dash, a URL or a
// word with descenders a few pixels off its row. Boxes taller than about two
// text lines are borders, stamps or redactions read as words; they only count
// as `maxTextHeight` tall, so they never pull neighbouring lines together.
export function groupOcrLines(words: OcrWord[], { topTolerance = 10, maxTextHeight = 50 } = {}): OcrLine[] {
  const groups: Array<{ page: number; anchorTop: number; minTop: number; maxBottom: number; words: OcrWord[] }> = [];
  const sorted = [...words].sort((left, right) => left.page - right.page || left.top - right.top || left.left - right.left);
  for (const word of sorted) {
    const textHeight = word.height > maxTextHeight ? Math.min(word.height, 30) : word.height;
    const wordCenter = word.top + textHeight / 2;
    const wordBottom = word.top + textHeight;
    let group = groups.find((candidate) => candidate.page === word.page && (
      Math.abs(candidate.anchorTop - word.top) <= topTolerance
      || (wordCenter >= candidate.minTop && wordCenter <= candidate.maxBottom)
    ));
    if (!group) {
      group = { page: word.page, anchorTop: word.top, minTop: word.top, maxBottom: wordBottom, words: [] };
      groups.push(group);
    }
    group.words.push(word);
    group.minTop = Math.min(group.minTop, word.top);
    group.maxBottom = Math.max(group.maxBottom, wordBottom);
  }

  return groups
    .map((group) => {
      const lineWords = [...group.words].sort((left, right) => left.left - right.left);
      const tops = lineWords.map((word) => word.top).sort((left, right) => left - right);
      return {
        page: group.page,
        top: tops[Math.floor(tops.length / 2)],
        bottom: group.maxBottom,
        words: lineWords,
        text: ocrWordsToText(lineWords)
      };
    })
    .sort((left, right) => left.page - right.page || left.top - right.top);
}

export function ocrWordsToText(words: OcrWord[]) {
  return words.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}

export function ocrWordsInColumn(words: OcrWord[], leftMin: number, leftMax: number) {
  return words.filter((word) => word.left >= leftMin && word.left <= leftMax);
}

// Dotted leader rules and table borders come out as runs of e, s, n, c and
// other round letters at near-zero confidence. Real words can score low too
// (an all-caps merchant name at 0% is common), so a word is only noise when
// its confidence is low AND it looks like a rule rather than a word.
export function isOcrNoiseWord(word: OcrWord) {
  if (word.confidence == null || word.confidence >= 30) {
    return false;
  }
  const text = word.text;
  if (/^(.)\1*$/i.test(text) || /^[^A-Za-z0-9]+$/.test(text)) {
    return true;
  }
  // A long or very wide low-confidence "word" made almost only of short round
  // letters is a dotted rule ("eceececeee…"); a long real name
  // ("KINOKUNIYA-TAKASHIMAYA") is not.
  return word.confidence < 20 && (
    /^[a-z:;.,'"=~_-]+$/.test(text)
    || word.width > 600
    || ((text.length >= 12 || word.width > 300) && roundLetterShare(text) >= 0.85)
  );
}

function roundLetterShare(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length ? letters.replace(/[^acemnorsuvwxz]/gi, "").length / letters.length : 0;
}

// Words where none reaches a usable confidence are a rule, a smudge or a
// border, never statement text. Check one column's words when a line spans
// several (a dotted rule in the table can share a line with a summary title).
export function areOcrNoiseWords(words: OcrWord[]) {
  const scored = words.filter((word) => word.confidence != null);
  return scored.length > 0 && scored.length === words.length && scored.every((word) => (word.confidence ?? 0) < 30);
}

export function isOcrNoiseLine(line: OcrLine) {
  return areOcrNoiseWords(line.words);
}

export function withoutOcrNoise(lines: OcrLine[]): OcrLine[] {
  return lines
    .filter((line) => !isOcrNoiseLine(line))
    .map((line) => {
      const words = line.words.filter((word) => !isOcrNoiseWord(word));
      return { ...line, words, text: ocrWordsToText(words) };
    })
    .filter((line) => line.words.length > 0);
}

// Tesseract reads a capital I set apart from the next word as "|", and draws
// "|" for gaps between columns. A "|" opening a description before a
// capitalized word is the I; any other standalone "|" is dropped.
export function cleanOcrDescriptionText(value: string) {
  return value
    .replace(/^\|\s+(?=[A-Z])/, "I ")
    .replace(/(^|\s)\|(?=\s|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// How much legible text some words carry: each word counts by its confidence
// (capped at 90, ignoring near-zero guesses), so a reading that kept the
// merchant's name outscores a shorter one that lost it, and a stray junk word
// adds almost nothing.
export function ocrLegibilityScore(words: OcrWord[]) {
  return words.reduce((total, word) => {
    const confidence = word.confidence ?? 90;
    return total + (confidence < 10 ? 0 : Math.min(confidence, 90));
  }, 0);
}

export function meanOcrConfidence(words: OcrWord[]) {
  const scored = words.filter((word) => word.confidence != null);
  if (!scored.length) {
    return null;
  }
  return scored.reduce((total, word) => total + (word.confidence ?? 0), 0) / scored.length;
}

export function minOcrConfidence(words: OcrWord[]) {
  const scored = words.filter((word) => word.confidence != null);
  return scored.length ? Math.min(...scored.map((word) => word.confidence ?? 0)) : null;
}

// Reads a money amount with exactly two decimals. Handles OCR's letter O for
// zero, a comma read in place of the decimal point ("0,00", "34,000,00"),
// thousands separators, a currency prefix, stray quotes at the edges, and
// credit markers that OCR damages (CR, cR, ¢R, 6R, 0R, OR). Any other letter
// inside the number makes it unreadable: "6A.7O" is not 6.70.
export function parseOcrAmount(value: string): OcrAmount | undefined {
  const raw = value.trim();
  const creditPattern = /(?:CR|¢R|6R|0R|OR|C\.R\.?)$/i;
  const edges = /^[“”"'‘’«»|(~]+|[“”"'‘’«»|)~]+$/g;
  const unquoted = raw.replace(edges, "");
  const isCredit = creditPattern.test(unquoted);
  let text = unquoted
    .replace(creditPattern, "")
    .replace(/^(?:S?\$|SGD)/i, "")
    .replace(/[Oo]/g, "0");
  if (!/^[0-9.,]+$/.test(text)) {
    return undefined;
  }
  if (/[.,]\d{2}$/.test(text)) {
    text = `${text.slice(0, -3).replace(/[.,]/g, "")}.${text.slice(-2)}`;
  }
  if (!/^\d+\.\d{2}$/.test(text)) {
    return undefined;
  }
  return { minor: Math.round(Number(text) * 100), isCredit, raw };
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Letters Tesseract swaps for one another in month names; a swap from this
// list costs half an ordinary substitution.
const OCR_CONFUSABLE_LETTERS = [["i", "l"], ["l", "1"], ["o", "0"], ["n", "h"], ["u", "v"], ["c", "e"], ["g", "q"], ["a", "o"], ["n", "r"]];

function letterSubstitutionCost(left: string, right: string) {
  if (left === right) {
    return 0;
  }
  return OCR_CONFUSABLE_LETTERS.some(([one, two]) => (left === one && right === two) || (left === two && right === one)) ? 0.5 : 1;
}

// Months a damaged month token could be, with a cost (0 = exact). Only the
// months within half a substitution of the best spelling are kept, so an
// exact "Dec" never falls back to January. A missing or one-letter token
// could be any month; the statement period decides.
function monthCandidates(token: string) {
  const normalized = token
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[1|]/g, "l")
    .replace(/5/g, "s")
    .replace(/[^a-z]/g, "");
  if (normalized.length < 2) {
    return MONTH_NAMES.map((_, index) => ({ month: index + 1, cost: 2 }));
  }
  const three = normalized.slice(0, 3);
  const candidates = MONTH_NAMES.map((name, index) => {
    if (three.length < 3) {
      return { month: index + 1, cost: name.startsWith(three) ? 1 : 2 };
    }
    let cost = 0;
    for (let position = 0; position < 3; position += 1) {
      cost += letterSubstitutionCost(three[position], name[position]);
    }
    return { month: index + 1, cost: Math.min(cost, 2) };
  });
  const bestCost = Math.min(...candidates.map((candidate) => candidate.cost));
  return candidates.filter((candidate) => candidate.cost <= bestCost + 0.5);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Reads "05Oct", "5 Oct", "010ct", "25Jui", "07 Ju" or a bare "28" as a date
// inside the statement period (or up to `earlierDays` before it, for
// transaction dates that precede posting). Day digits must be real digits;
// only O/o and l/I/| are read as 0 and 1 next to a real digit. Returns
// undefined rather than a date the text cannot support.
export function readOcrDayMonth(value: string, period: OcrStatementPeriod, { earlierDays = 31 } = {}) {
  const text = value.replace(/[\s.,“”"'‘’_—–-]/g, "");
  const dayMatch = text.match(/^([0-9OoIl|]{1,3})(.*)$/);
  if (!dayMatch || !/\d/.test(dayMatch[1])) {
    return undefined;
  }

  const windowStart = addDays(period.startDate, -earlierDays);
  const endYear = Number(period.endDate.slice(0, 4));
  const options: Array<{ date: string; inPeriod: boolean; cost: number }> = [];
  // A two-digit day wins when it gives any date ("25d" is the 25th, never
  // the 2nd); one digit is tried only when two cannot be a day ("5Oct").
  for (const dayLength of [2, 1]) {
    const dayText = dayMatch[1].slice(0, dayLength);
    // "45Oct" is not the 4th: a digit after a one-digit day means the day had
    // two digits.
    if (dayText.length !== dayLength || options.length || (dayLength === 1 && /^[1-9]/.test(text.slice(1)))) {
      continue;
    }
    const day = Number(dayText.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1"));
    const monthToken = dayMatch[1].slice(dayLength) + dayMatch[2];
    for (const { month, cost } of monthCandidates(monthToken)) {
      for (const year of [endYear, endYear - 1]) {
        if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
          continue;
        }
        const date = formatDate(year, month, day);
        if (date < windowStart || date > period.endDate) {
          continue;
        }
        options.push({ date, inPeriod: date >= period.startDate, cost });
      }
    }
  }
  if (!options.length) {
    return undefined;
  }

  // The best reading is the most likely month spelling; among equals, a date
  // inside the period beats one before it.
  options.sort((left, right) => left.cost - right.cost || Number(right.inPeriod) - Number(left.inPeriod));
  const [best, next] = options;
  if (next && next.date !== best.date && next.cost === best.cost && next.inPeriod === best.inPeriod) {
    return undefined;
  }
  return best.date;
}

export interface OcrAmountReading {
  minor: number;
  isCredit: boolean;
}

export interface OcrResolvableRow {
  // Distinct readings across passes, preferred pass first; empty when no pass
  // could read the amount.
  readings: OcrAmountReading[];
  // Whether an unread row is a credit (for example a payment), from its
  // description.
  creditWhenUnread: boolean;
}

export interface OcrTotals {
  debitMinor?: number;
  creditMinor?: number;
}

export interface OcrResolvedAmounts<TSummary> {
  amounts: OcrAmountReading[];
  inferredRowIndexes: number[];
  summary: TSummary;
}

// Chooses one reading per row, and one summary reading, so that the rows add
// up to the statement's printed totals and the summary is internally
// consistent. A row no pass could read is filled from a total only when it is
// that total's single unknown. Prefers no inferred amounts, then the most
// readings from earlier passes. Returns undefined when nothing reconciles.
export function resolveOcrAmountsAgainstTotals<TSummary>({
  rows,
  summaries,
  totalsOf,
  isSummaryConsistent,
  maxCombinations = 4096
}: {
  rows: OcrResolvableRow[];
  summaries: TSummary[];
  totalsOf: (summary: TSummary) => OcrTotals;
  isSummaryConsistent: (summary: TSummary, debitMinor: number, creditMinor: number) => boolean;
  maxCombinations?: number;
}): OcrResolvedAmounts<TSummary> | undefined {
  const choiceCounts = rows.map((row) => Math.max(row.readings.length, 1));
  const combinations = choiceCounts.reduce((total, count) => total * count, 1) * Math.max(summaries.length, 1);
  if (combinations > maxCombinations) {
    return undefined;
  }

  // First every reading as read; only when nothing reconciles may the lone
  // row of a kind take its total (see tryCombination).
  return searchCombinations(rows, summaries, totalsOf, isSummaryConsistent, choiceCounts, false)
    ?? searchCombinations(rows, summaries, totalsOf, isSummaryConsistent, choiceCounts, true);
}

function searchCombinations<TSummary>(
  rows: OcrResolvableRow[],
  summaries: TSummary[],
  totalsOf: (summary: TSummary) => OcrTotals,
  isSummaryConsistent: (summary: TSummary, debitMinor: number, creditMinor: number) => boolean,
  choiceCounts: number[],
  correctLoneRows: boolean
): OcrResolvedAmounts<TSummary> | undefined {
  let best: (OcrResolvedAmounts<TSummary> & { laterPicks: number }) | undefined;
  for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex += 1) {
    const summary = summaries[summaryIndex];
    const totals = totalsOf(summary);
    const picks = rows.map(() => 0);
    for (;;) {
      const candidate = tryCombination(rows, picks, totals, correctLoneRows);
      if (candidate && isSummaryConsistent(summary, candidate.debitMinor, candidate.creditMinor)) {
        const laterPicks = summaryIndex + picks.reduce((total, pick) => total + pick, 0);
        if (
          !best
          || candidate.inferredRowIndexes.length < best.inferredRowIndexes.length
          || (candidate.inferredRowIndexes.length === best.inferredRowIndexes.length && laterPicks < best.laterPicks)
        ) {
          best = { amounts: candidate.amounts, inferredRowIndexes: candidate.inferredRowIndexes, summary, laterPicks };
        }
      }
      let position = 0;
      while (position < picks.length && picks[position] + 1 >= choiceCounts[position]) {
        picks[position] = 0;
        position += 1;
      }
      if (position === picks.length) {
        break;
      }
      picks[position] += 1;
    }
  }
  if (!best) {
    return undefined;
  }
  return { amounts: best.amounts, inferredRowIndexes: best.inferredRowIndexes, summary: best.summary };
}

// With correctLoneRows, a kind (debits or credits) that has exactly one row
// may replace that row's reading with the kind's total: the total is then
// the row's amount, provided the summary still balances. With two or more
// rows the total cannot say which reading is wrong, so nothing is replaced.
function tryCombination(rows: OcrResolvableRow[], picks: number[], totals: OcrTotals, correctLoneRows: boolean) {
  const amounts: Array<OcrAmountReading | undefined> = rows.map((row, index) => row.readings[picks[index]]);
  const fill = (isCredit: boolean, total: number | undefined) => {
    const ofKind = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => (amounts[index] ? amounts[index]!.isCredit : row.creditWhenUnread) === isCredit);
    if (correctLoneRows && total != null && ofKind.length === 1 && amounts[ofKind[0].index]?.minor !== total) {
      amounts[ofKind[0].index] = undefined;
    }
    const unknown = ofKind.filter(({ index }) => !amounts[index]);
    const known = amounts.reduce((sum, amount) => sum + (amount && amount.isCredit === isCredit ? amount.minor : 0), 0);
    if (total == null) {
      return unknown.length === 0 ? { ok: true, sum: known, inferred: [] as number[] } : { ok: false, sum: known, inferred: [] as number[] };
    }
    if (unknown.length === 0) {
      return { ok: known === total, sum: known, inferred: [] as number[] };
    }
    const missing = total - known;
    if (unknown.length > 1 || missing <= 0) {
      return { ok: false, sum: known, inferred: [] as number[] };
    }
    amounts[unknown[0].index] = { minor: missing, isCredit };
    return { ok: true, sum: total, inferred: [unknown[0].index] };
  };
  const debits = fill(false, totals.debitMinor);
  const credits = fill(true, totals.creditMinor);
  if (!debits.ok || !credits.ok) {
    return undefined;
  }
  return {
    amounts: amounts as OcrAmountReading[],
    inferredRowIndexes: [...debits.inferred, ...credits.inferred].sort((left, right) => left - right),
    debitMinor: debits.sum,
    creditMinor: credits.sum
  };
}
