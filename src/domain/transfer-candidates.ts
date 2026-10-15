// The one set of rules for "which entry is the other side of this transfer":
// the same amount in another wallet, ranked by opposite direction, then by
// how close the dates are, then by wallet. The Entries transfer dialog (its
// loaded rows and its Recheck matches), the settings review and Ask all use
// these functions, so they can never disagree about what is offered.

export interface TransferCandidateSubject {
  id?: string;
  date: string;
  accountId?: string | null;
  accountName?: string;
  amountMinor: number;
  transferDirection?: "in" | "out" | null;
}

export interface TransferCandidateRow {
  id: string;
  date: string;
  accountId?: string | null;
  accountName: string;
  accountOwnerLabel?: string;
  amountMinor: number;
  totalAmountMinor?: number;
  transferDirection?: "in" | "out" | null;
}

// How many days either side of the entry the other side is looked for.
const WINDOW_DAYS = 31;
export const TRANSFER_CANDIDATE_LIMIT = 10;

export function transferCandidateWindow(date: string): { start: string; endExclusive: string } {
  return { start: shiftDate(date, -WINDOW_DAYS), endExclusive: shiftDate(date, WINDOW_DAYS + 1) };
}

export function selectTransferCandidates<T extends TransferCandidateRow>(
  subject: TransferCandidateSubject,
  entries: T[],
  limit = TRANSFER_CANDIDATE_LIMIT
): T[] {
  return entries
    .filter((candidate) => {
      if (subject.id !== undefined && candidate.id === subject.id) {
        return false;
      }
      if ((candidate.totalAmountMinor ?? candidate.amountMinor) !== subject.amountMinor) {
        return false;
      }
      if (candidate.accountId && subject.accountId) {
        return candidate.accountId !== subject.accountId;
      }
      return !(!candidate.accountId && !subject.accountId && subject.accountName !== undefined && candidate.accountName === subject.accountName);
    })
    .sort((left, right) => {
      const leftOpposite = isOpposite(subject, left);
      const rightOpposite = isOpposite(subject, right);
      if (leftOpposite !== rightOpposite) {
        return leftOpposite ? -1 : 1;
      }
      const leftGap = Math.abs(daysBetween(subject.date, left.date));
      const rightGap = Math.abs(daysBetween(subject.date, right.date));
      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }
      return `${left.accountName} ${left.accountOwnerLabel ?? ""}`.localeCompare(`${right.accountName} ${right.accountOwnerLabel ?? ""}`);
    })
    .slice(0, limit);
}

function isOpposite(subject: TransferCandidateSubject, candidate: TransferCandidateRow) {
  return Boolean(candidate.transferDirection && subject.transferDirection && candidate.transferDirection !== subject.transferDirection);
}

// What a card offers out of the ranked list: the best match first (the
// one pre-selected), at most `maxOthers` more. When the person named a
// wallet, only that wallet's rows are offered; if it has none the others
// are still offered and `walletMissed` says so. `date` narrows to a day
// the person named.
export function chooseTransferOptions<T extends { accountId?: string | null; date: string }>(
  candidates: T[],
  { walletId = null, date = null, maxOthers = 3 }: { walletId?: string | null; date?: string | null; maxOthers?: number } = {}
): { options: T[]; walletMissed: boolean } {
  const onDay = date ? candidates.filter((candidate) => candidate.date === date) : candidates;
  const inWallet = walletId ? onDay.filter((candidate) => candidate.accountId === walletId) : onDay;
  const walletMissed = Boolean(walletId) && inWallet.length === 0;
  const shown = walletMissed ? onDay : inWallet;
  return { options: shown.slice(0, maxOthers + 1), walletMissed };
}

export function daysBetween(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---- Investment statements ------------------------------------------------
// An investment provider's statement prints its own account number, and the
// bank row that paid it ("IBG GIRO COLL P0000194 IFAST FINANCIAL PL-") carries
// the same number. That is the strong signal; the ranking above (amount,
// opposite direction, closest date) is still the one matcher.

export interface ReferencedTransferCandidateRow extends TransferCandidateRow {
  description: string;
}

const REFERENCE_WINDOW_DAYS = 31;
const UNREFERENCED_WINDOW_DAYS = 10;

function squashReference(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function describesAccountReference(description: string, reference: string) {
  const wanted = squashReference(reference);
  return wanted.length > 0 && squashReference(description).includes(wanted);
}

// Another provider account number (P plus six or more digits) in the text:
// the row pays a different account of the same provider.
function namesOtherReference(description: string, reference: string) {
  const wanted = squashReference(reference);
  return (squashReference(description).match(/p\d{6,}/g) ?? []).some((found) => found !== wanted);
}

/**
 * The bank entry that is the other side of one statement movement, or
 * undefined. A row naming the statement's account number wins (the closest
 * date among them); without one, a lone same-amount row within ten days is
 * offered and two plausible rows are not guessed between. `claimedIds` are
 * entries another movement of the same import already took.
 */
export function pickReferencedTransferCandidate<T extends ReferencedTransferCandidateRow>(
  subject: TransferCandidateSubject,
  entries: T[],
  reference: string,
  claimedIds: ReadonlySet<string> = new Set()
): { candidate: T; basis: "reference" | "amount_and_date" } | undefined {
  const opposite = entries.filter((entry) => (
    !claimedIds.has(entry.id)
    && entry.transferDirection
    && subject.transferDirection
    && entry.transferDirection !== subject.transferDirection
    && !namesOtherReference(entry.description, reference)
    && Math.abs(daysBetween(subject.date, entry.date)) <= REFERENCE_WINDOW_DAYS
  ));
  const ranked = selectTransferCandidates(subject, opposite, opposite.length || 1);
  const named = ranked.find((entry) => describesAccountReference(entry.description, reference));
  if (named) {
    return { candidate: named, basis: "reference" };
  }
  const near = ranked.filter((entry) => Math.abs(daysBetween(subject.date, entry.date)) <= UNREFERENCED_WINDOW_DAYS);
  return near.length === 1 ? { candidate: near[0], basis: "amount_and_date" } : undefined;
}
