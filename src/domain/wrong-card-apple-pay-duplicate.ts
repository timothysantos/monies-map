// Wrong-card Apple Pay duplicate (DOMAIN.md): an Apple Pay entry the card's
// own file should list and does not, because the purchase was paid with
// another card of the household and that card's bank rows already hold it.
// The purchase is counted twice until the stray entry is removed.
//
// Pure rules only. Nothing here reads the database or removes anything: the
// loader (import-wrong-card-duplicates.ts) feeds the facts in, the preview
// shows what comes out, and only an explicit confirmation removes an entry.
//
// False positives cost more than misses, so an offer needs every gate to
// hold (HIGH); a near miss is only mentioned (MEDIUM); anything else is
// silent (LOW). docs/audits/wrong-card-apple-pay-duplicate.md walks through
// the rules and what each one guards against.
import { daysBetween, normalizeDescriptionForMatch } from "./app-repository-helpers";

export type WrongCardConfidence = "high" | "medium" | "low";

// The household's usual gap between an Apple Pay purchase and the bank
// listing it. A card's own history can only lengthen it.
export const DEFAULT_POSTING_LAG_DAYS = 3;
export const MAX_POSTING_LAG_DAYS = 7;
// The widest gap between the Apple Pay entry's date and the twin's date.
export const TWIN_MAX_DAY_DISTANCE = 3;
// HIGH needs the dates at most this far apart.
export const HIGH_MAX_DAY_DISTANCE = 2;

// An Apple Pay entry that may be on the wrong card: saved by the Shortcut,
// provisional, never matched to a bank row, not a transfer.
export interface ApplePayEntryFact {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  // A foreign currency estimate: its amount is a guess at the day's rate.
  originalCurrency: string | null;
  ownerPersonId: string | null;
  // The entry is linked to a split, a settlement or a plan row.
  hasLinks: boolean;
}

// Any other ledger entry near the Apple Pay entries, with the same amount.
export interface LedgerEntryFact {
  id: string;
  accountId: string;
  date: string;
  postDate: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  entryType: "expense" | "income" | "transfer";
  transferGroupId: string | null;
  originalCurrency: string | null;
  // The row came from a bank export or statement, not from the user.
  isBankRow: boolean;
  // Something else already stands behind the row (an Apple Pay or Ask
  // entry it was matched to), so it is not a loose bank row.
  isPaired: boolean;
  // A provisional Apple Pay entry no bank row has matched yet.
  isOpenApplePay: boolean;
  importedAt: string | null;
}

// A new row of the file being imported, as the preview reports it.
export interface FileRowFact {
  rowId: string;
  accountId: string;
  // The purchase day, and the day the bank posted it when the row says both.
  date: string;
  postDate: string | null;
  description: string;
  amountMinor: number;
  currency: string;
}

// The dates an export covers for one card, and the day it could first have
// known about the purchase: today for the file being imported, the import's
// own day for an earlier one.
export interface CoverageFact {
  accountId: string;
  first: string;
  last: string;
  referenceDate: string;
  kind: "this_file" | "earlier_import";
  importedAt?: string;
}

export interface AccountFact {
  id: string;
  name: string;
  ownerPersonId: string | null;
  isJoint: boolean;
  currency: string;
}

export interface WrongCardTwin {
  kind: "ledger" | "this_file";
  // The ledger entry's id, or the preview row's id.
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  importedAt: string | null;
}

export interface WrongCardAssessment {
  entryId: string;
  confidence: WrongCardConfidence;
  // 0 to 100. HIGH never scores under 75; it is read by people and tests,
  // the tier is what decides.
  score: number;
  // What held, as codes.
  reasons: string[];
  // What did not: any hard one makes the tier LOW, any soft one MEDIUM.
  blockers: string[];
  twin: WrongCardTwin | null;
  coverage: Pick<CoverageFact, "kind" | "importedAt"> | null;
}

export interface WrongCardInput {
  entries: ApplePayEntryFact[];
  ledger: LedgerEntryFact[];
  fileRows: FileRowFact[];
  listedEntryIds: ReadonlySet<string>;
  coverages: CoverageFact[];
  accounts: ReadonlyMap<string, AccountFact>;
  postingLagDays: (accountId: string) => number;
}

const HARD_BLOCKERS = [
  "listed_in_file",
  "not_covered_by_file",
  "within_posting_lag",
  "same_amount_row_on_card",
  "several_twins",
  "twin_contested"
] as const;

// Words that say nothing about the shop.
const NOISE_TOKENS = new Set([
  "the", "and", "of", "co", "pte", "ltd", "inc", "llp", "llc", "www", "com", "pos", "nets", "visa", "purchase", "payment", "ref"
]);

export function readMerchantTokens(description: string) {
  const tokens = normalizeDescriptionForMatch(description)
    .split(" ")
    // A long run of digits is a terminal or reference number, not a shop.
    .filter((token) => token && !NOISE_TOKENS.has(token) && !/^\d{4,}$/.test(token));
  return Array.from(new Set(tokens));
}

export interface MerchantMatch {
  matched: number;
  strength: number;
  strong: boolean;
}

// How alike two merchant texts are. Apple Pay shows a shortened name
// ("Cold Storage-Star Vist") where the bank prints its own ("COLD
// STORAGE-STAR VISTA"), so a word counts when it is the same or one cut
// short of the other (four letters at least).
export function matchMerchants(left: string, right: string): MerchantMatch {
  const leftTokens = readMerchantTokens(left);
  const rightTokens = readMerchantTokens(right);
  if (!leftTokens.length || !rightTokens.length) {
    return { matched: 0, strength: 0, strong: false };
  }
  const unused = new Set(rightTokens);
  let matched = 0;
  let longest = 0;
  for (const token of leftTokens) {
    const partner = [...unused].find((candidate) => candidate === token || isCutShort(token, candidate));
    if (partner) {
      unused.delete(partner);
      matched += 1;
      longest = Math.max(longest, token.length);
    }
  }
  let strength = matched / Math.min(leftTokens.length, rightTokens.length);
  // One name run into the other ("fairprice" and "fair price").
  const leftCompact = leftTokens.join("");
  const rightCompact = rightTokens.join("");
  const shorter = leftCompact.length <= rightCompact.length ? leftCompact : rightCompact;
  const longer = leftCompact.length <= rightCompact.length ? rightCompact : leftCompact;
  if (shorter.length >= 6 && longer.includes(shorter)) {
    matched = Math.max(matched, 1);
    longest = Math.max(longest, shorter.length);
    strength = Math.max(strength, 0.9);
  }
  // Strong: two shop words in common, or the only word the shorter text has.
  const strong = (matched >= 2 && strength >= 0.6) || (matched >= 1 && strength >= 0.99 && longest >= 5);
  return { matched, strength: Math.min(1, strength), strong };
}

function isCutShort(left: string, right: string) {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && long.startsWith(short);
}

// The gap between the Apple Pay entry's purchase day and a row's, read on
// both of the row's dates (an export row carries the purchase day and the
// day the bank posted it).
function dayDistance(entryDate: string, row: { date: string; postDate?: string | null }) {
  const distances = [Math.abs(daysBetween(entryDate, row.date))];
  if (row.postDate) {
    distances.push(Math.abs(daysBetween(entryDate, row.postDate)));
  }
  return Math.min(...distances);
}

// The longest gap the card's own Apple Pay entries took to reach its bank
// rows, newest first, never under the default and never over a week.
export function derivePostingLagDays(lagsNewestFirst: number[]) {
  const recent = lagsNewestFirst.slice(0, 20).filter((lag) => Number.isFinite(lag) && lag >= 0);
  return Math.min(MAX_POSTING_LAG_DAYS, Math.max(DEFAULT_POSTING_LAG_DAYS, ...recent));
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// The date today is in Singapore.
export function singaporeToday(now = Date.now()) {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

// A bank row that stands on its own: an export or statement row nothing
// else vouches for, whole (not an estimate, not a transfer).
function isLooseBankRow(row: LedgerEntryFact) {
  return row.isBankRow && !row.isPaired && !row.originalCurrency && !row.transferGroupId && row.entryType === "expense";
}

function readOwnerPersonId(account: AccountFact | undefined) {
  return account && !account.isJoint ? account.ownerPersonId : null;
}

export function assessWrongCardDuplicates(input: WrongCardInput): WrongCardAssessment[] {
  const twinPool: PoolTwin[] = [
    ...input.ledger.filter(isLooseBankRow).map((row) => ({
      kind: "ledger" as const,
      id: row.id,
      accountId: row.accountId,
      date: row.date,
      postDate: row.postDate,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: row.currency,
      importedAt: row.importedAt
    })),
    ...input.fileRows.map((row) => ({
      kind: "this_file" as const,
      id: row.rowId,
      accountId: row.accountId,
      date: row.date,
      postDate: row.postDate,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: row.currency,
      importedAt: null
    }))
  ];

  // Everything that could claim a bank row as its own purchase: every open
  // Apple Pay entry, wherever it sits and whatever the file says about it.
  const claimants = new Map<string, { id: string; date: string; description: string; amountMinor: number; currency: string }>();
  for (const entry of input.entries) {
    claimants.set(entry.id, entry);
  }
  for (const row of input.ledger) {
    if (row.isOpenApplePay && !claimants.has(row.id)) {
      claimants.set(row.id, { id: row.id, date: row.date, description: row.description, amountMinor: row.amountMinor, currency: row.currency });
    }
  }

  return input.entries.map((entry) => assessEntry(input, entry, twinPool, [...claimants.values()]));
}

type PoolTwin = WrongCardTwin & { postDate: string | null; currency: string };

function assessEntry(
  input: WrongCardInput,
  entry: ApplePayEntryFact,
  twinPool: PoolTwin[],
  claimants: { id: string; date: string; description: string; amountMinor: number; currency: string }[]
): WrongCardAssessment {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const outcome = (twin: WrongCardTwin | null, score: number, coverage: WrongCardAssessment["coverage"]): WrongCardAssessment => {
    const hasHardBlocker = blockers.some((blocker) => (HARD_BLOCKERS as readonly string[]).includes(blocker));
    const confidence: WrongCardConfidence = !twin || hasHardBlocker ? "low" : blockers.length ? "medium" : "high";
    return { entryId: entry.id, confidence, score: confidence === "low" ? Math.min(score, 60) : score, reasons, blockers, twin, coverage };
  };

  // 1. The card's own file should have listed it.
  if (input.listedEntryIds.has(entry.id)) {
    blockers.push("listed_in_file");
  }
  const lag = input.postingLagDays(entry.accountId);
  const covering = input.coverages
    .filter((coverage) => coverage.accountId === entry.accountId && coverage.first <= entry.date && entry.date <= coverage.last)
    // The file that knew about the day the longest, this one first.
    .sort((left, right) => left.referenceDate.localeCompare(right.referenceDate) || Number(left.kind !== "this_file") - Number(right.kind !== "this_file"));
  const oldEnough = covering.find((coverage) => daysBetween(entry.date, coverage.referenceDate) >= lag);
  if (!covering.length) {
    blockers.push("not_covered_by_file");
  } else if (!oldEnough) {
    blockers.push("within_posting_lag");
  } else {
    reasons.push("file_covers_date", "older_than_posting_lag");
  }

  // A row of the same amount near the day on this very card may be the
  // purchase under other words: never guess against it.
  const sameAmountOnCard = input.ledger.some((row) => (
    row.id !== entry.id
    && row.accountId === entry.accountId
    && row.isBankRow
    && row.amountMinor === entry.amountMinor
    && dayDistance(entry.date, row) <= TWIN_MAX_DAY_DISTANCE
  )) || input.fileRows.some((row) => (
    row.accountId === entry.accountId
    && row.amountMinor === entry.amountMinor
    && dayDistance(entry.date, row) <= TWIN_MAX_DAY_DISTANCE
  ));
  if (sameAmountOnCard) {
    blockers.push("same_amount_row_on_card");
  } else {
    reasons.push("no_same_amount_row_on_card");
  }

  // 2. The same purchase on another card: same amount and currency, close
  //    in time, sharing a shop word.
  const twins = twinPool
    .filter((twin) => (
      twin.accountId !== entry.accountId
      && twin.amountMinor === entry.amountMinor
      && twin.currency === entry.currency
      && dayDistance(entry.date, twin) <= TWIN_MAX_DAY_DISTANCE
      && matchMerchants(entry.description, twin.description).matched >= 1
    ));
  const coverage = oldEnough ? { kind: oldEnough.kind, importedAt: oldEnough.importedAt } : null;
  if (!twins.length) {
    return outcome(null, 0, coverage);
  }
  reasons.push("exact_amount", "same_currency");
  if (twins.length > 1) {
    // A daily repeat looks like this: never pick one.
    blockers.push("several_twins");
    const [first] = twins;
    return outcome(toTwin(first), 0, coverage);
  }
  const [twin] = twins;
  const distance = dayDistance(entry.date, twin);
  const merchant = matchMerchants(entry.description, twin.description);

  // 3. The bank row has no other purchase claiming it.
  const contested = claimants.some((claimant) => (
    claimant.id !== entry.id
    && claimant.amountMinor === twin.amountMinor
    && claimant.currency === twin.currency
    && Math.abs(daysBetween(claimant.date, twin.date)) <= TWIN_MAX_DAY_DISTANCE
    && matchMerchants(claimant.description, twin.description).matched >= 1
  ));
  if (contested) {
    blockers.push("twin_contested");
  } else {
    reasons.push("twin_one_to_one");
  }

  // 4. Soft doubts keep the offer to a note.
  if (distance <= HIGH_MAX_DAY_DISTANCE) {
    reasons.push("date_within_2_days");
  } else {
    blockers.push("date_three_days_apart");
  }
  if (merchant.strong) {
    reasons.push("merchant_strong");
  } else {
    blockers.push("merchant_partial");
  }
  if (entry.hasLinks) {
    blockers.push("has_links");
  } else {
    reasons.push("no_splits_or_links");
  }
  if (entry.originalCurrency) {
    blockers.push("foreign_estimate");
  }
  const entryOwner = entry.ownerPersonId;
  const twinOwner = readOwnerPersonId(input.accounts.get(twin.accountId));
  if (entryOwner && twinOwner && entryOwner !== twinOwner) {
    blockers.push("different_owner");
  }

  const score = [0, 1, 2, 3].includes(distance) ? ([30, 26, 22, 8][distance]) : 0;
  const total = score
    + Math.round(40 * merchant.strength)
    + (blockers.includes("twin_contested") ? 0 : 15)
    + (blockers.some((blocker) => ["not_covered_by_file", "within_posting_lag", "same_amount_row_on_card", "listed_in_file"].includes(blocker)) ? 0 : 15);
  return outcome(toTwin(twin), Math.min(100, total), coverage);
}

function toTwin(twin: PoolTwin): WrongCardTwin {
  return { kind: twin.kind, id: twin.id, accountId: twin.accountId, date: twin.date, description: twin.description, amountMinor: twin.amountMinor, importedAt: twin.importedAt };
}
