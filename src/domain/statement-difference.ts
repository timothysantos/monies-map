// Why a saved statement and the entries up to its last day differ.
//
// Two causes can be read from the ledger without the statement file:
//  - "billed next": entries dated inside (or before) this statement that a
//    LATER statement confirmed. The bank had not billed them yet, so the
//    difference is only timing.
//  - "not on statement": unconfirmed entries dated inside the statement's
//    period whose amounts add up to what is left. The bank never listed them.
// An entry is only named when the sums fit exactly; anything else stays as
// `remainingMinor` with no entry blamed.
import type {
  StatementDifferenceDto,
  StatementDifferenceEntryDto
} from "../types/dto";

export type StatementDifferenceCandidate = StatementDifferenceEntryDto & {
  // The month of the statement that confirmed this entry, when one did.
  certifiedByMonth?: string;
};

const SHOWN_ENTRIES = 5;
// Subset search is bounded: only the newest unconfirmed entries, at most 3
// together, so one statement can never cost more than a few thousand sums.
const MAX_UNCONFIRMED_CANDIDATES = 24;
const MAX_SUBSET_SIZE = 3;

export function explainStatementDifference(input: {
  statement: { month: string; startDate?: string; endDate: string };
  // Ledger balance minus statement balance, as on AccountCheckpointDto.
  deltaMinor: number;
  entries: StatementDifferenceCandidate[];
}): StatementDifferenceDto | undefined {
  if (!input.deltaMinor) {
    return undefined;
  }

  const { statement } = input;
  const countedEntries = input.entries
    .filter((entry) => entry.date <= statement.endDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.entryId.localeCompare(right.entryId));

  let remainingMinor = input.deltaMinor;
  let billedNext: StatementDifferenceDto["billedNext"];

  const billedNextEntries = countedEntries.filter((entry) =>
    entry.certifiedByMonth != null && entry.certifiedByMonth > statement.month);
  const billedNextTotal = sum(billedNextEntries);
  if (billedNextEntries.length && fitsInside(billedNextTotal, remainingMinor)) {
    billedNext = {
      totalMinor: billedNextTotal,
      entryCount: billedNextEntries.length,
      entries: billedNextEntries.slice(0, SHOWN_ENTRIES).map(toDto)
    };
    remainingMinor -= billedNextTotal;
  }

  let notOnStatement: StatementDifferenceDto["notOnStatement"];
  if (remainingMinor) {
    const unconfirmed = countedEntries
      .filter((entry) => entry.certifiedByMonth == null
        && (!statement.startDate || entry.date >= statement.startDate))
      .slice(-MAX_UNCONFIRMED_CANDIDATES);
    const match = findUnconfirmedMatch(unconfirmed, remainingMinor);
    if (match) {
      notOnStatement = {
        totalMinor: remainingMinor,
        entryCount: match.entries.length,
        oneOf: match.oneOf,
        entries: match.entries.slice(0, SHOWN_ENTRIES).map(toDto)
      };
      remainingMinor = 0;
    }
  }

  return {
    remainingMinor,
    ...(billedNext ? { billedNext } : {}),
    ...(notOnStatement ? { notOnStatement } : {})
  };
}

function findUnconfirmedMatch(
  entries: StatementDifferenceCandidate[],
  targetMinor: number
): { entries: StatementDifferenceCandidate[]; oneOf: boolean } | undefined {
  // One entry of exactly the amount. Several of the same amount: any one
  // of them would close the gap, so offer them all as "one of these".
  const singles = entries.filter((entry) => entry.signedAmountMinor === targetMinor);
  if (singles.length) {
    return { entries: singles, oneOf: singles.length > 1 };
  }

  // Every unconfirmed entry in the period together.
  if (entries.length > MAX_SUBSET_SIZE && sum(entries) === targetMinor) {
    return { entries, oneOf: false };
  }

  // A small group, only when exactly one group fits.
  for (let size = 2; size <= Math.min(MAX_SUBSET_SIZE, entries.length); size += 1) {
    const groups = subsetsOfSize(entries, size).filter((group) => sum(group) === targetMinor);
    if (groups.length === 1) {
      return { entries: groups[0], oneOf: false };
    }
    if (groups.length > 1) {
      return undefined;
    }
  }

  return undefined;
}

function subsetsOfSize<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === size) {
      result.push(picked);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      walk(index + 1, [...picked, items[index]]);
    }
  };
  walk(0, []);
  return result;
}

// Same direction as the difference and no larger than it.
function fitsInside(partMinor: number, wholeMinor: number) {
  return partMinor !== 0
    && Math.sign(partMinor) === Math.sign(wholeMinor)
    && Math.abs(partMinor) <= Math.abs(wholeMinor);
}

function sum(entries: StatementDifferenceCandidate[]) {
  return entries.reduce((total, entry) => total + entry.signedAmountMinor, 0);
}

function toDto(entry: StatementDifferenceCandidate): StatementDifferenceEntryDto {
  return {
    entryId: entry.entryId,
    date: entry.date,
    description: entry.description,
    signedAmountMinor: entry.signedAmountMinor
  };
}
