// Transfer purpose (DOMAIN.md "Transfer Purpose";
// docs/proposals/transfer-purpose.md). A transfer out to another person of
// the household can say what it pays for: a spending category, such as Home
// for Tim's monthly $450 towards the house loan Joyce's account pays.
//
// The household view never changes: the entry stays a transfer and adds
// nothing to spending or income. A person view reads the sending entry:
// - the sender: an expense in the purpose category at its full amount, so
//   it counts in their Spent, category totals, budget lines and the dated
//   plan line it is linked to;
// - the person the money went to: a payback in that category (the existing
//   category offset), which lowers their spending there by the amount;
// - anyone else: not theirs.
// Both readings come from the one sending entry and its date, so for every
// category and month the people's views add up to the household's, to the
// cent, even when the other side lands in another month or is never
// imported.
//
// Pure and shared: the Worker's page builders and stored month totals and
// the browser's Entries figures read entries through readEntriesForView.

import type { EntryDto, TransferPurposeDto } from "../types/dto";

// Categories that are not spending, so a transfer cannot be "for" them:
// Transfer (it already is one), Savings and Investments (their own money
// jobs and the Invested rule), and the uncategorised Other. Loans is
// allowed: a loan repayment is spending (money-jobs), though money in under
// Loans is not a payback (category-offset.ts); the reading marks the
// receiver's side as a payback itself.
const NOT_A_PURPOSE = new Set(["transfer", "savings", "investments", "other"]);

export function isTransferPurposeCategoryName(name?: string | null) {
  const normalized = String(name ?? "").trim().toLowerCase();
  return Boolean(normalized)
    && !NOT_A_PURPOSE.has(normalized)
    && !/\bincome\b/.test(normalized)
    && normalized !== "salary";
}

// The person who sent the money: the sending entry's owner.
export function transferPurposeSenderId(entry: Pick<EntryDto, "splits">): string | null {
  return entry.splits.length === 1 ? entry.splits[0].personId : null;
}

// Whether the entry's purpose counts: a transfer out with an owner, to
// someone else, not linked to Splits. The loader only sends a purpose that
// is stored; this is the reader's own guard, so a purpose left on an entry
// that later stopped being a transfer out counts nowhere.
export function hasCountingTransferPurpose(entry: EntryDto): entry is EntryDto & { transferPurpose: TransferPurposeDto } {
  const purpose = entry.transferPurpose;
  if (!purpose || entry.entryType !== "transfer" || entry.transferDirection !== "out" || entry.linkedSplitExpenseId) {
    return false;
  }
  const senderId = transferPurposeSenderId(entry);
  return Boolean(senderId) && senderId !== purpose.toPersonId && isTransferPurposeCategoryName(purpose.categoryName);
}

// One entry as a person's view counts it. The household view and entries
// without a counting purpose come back as the same object.
export function readEntryForPerson(entry: EntryDto, personId: string): EntryDto {
  if (personId === "household" || !hasCountingTransferPurpose(entry)) {
    return entry;
  }
  const purpose = entry.transferPurpose;
  if (personId === transferPurposeSenderId(entry)) {
    return {
      ...entry,
      entryType: "expense",
      categoryName: purpose.categoryName,
      offsetsCategory: false,
      transferPurpose: { ...purpose, role: "sent", ledgerCategoryName: entry.categoryName }
    };
  }
  if (personId === purpose.toPersonId) {
    return {
      ...entry,
      entryType: "income",
      categoryName: purpose.categoryName,
      offsetsCategory: true,
      // ownerName stays the sender's: the row still says whose money it was.
      splits: [{
        personId: purpose.toPersonId,
        personName: purpose.toPersonName,
        ratioBasisPoints: 10000,
        amountMinor: entry.amountMinor
      }],
      transferPurpose: { ...purpose, role: "received", ledgerCategoryName: entry.categoryName }
    };
  }
  return entry;
}

// Every entry as the view counts it. The household view gets the same
// array back, so its figures cannot change.
export function readEntriesForView(entries: EntryDto[], viewId: string): EntryDto[] {
  if (viewId === "household" || !entries.some((entry) => entry.transferPurpose)) {
    return entries;
  }
  return entries.map((entry) => readEntryForPerson(entry, viewId));
}

// Why a purpose cannot be set on this transfer, in plain words, or null.
// `counterpart` is the linked other side when there is one.
export interface TransferPurposeSubject {
  entryType: string;
  transferDirection: string | null;
  ownerPersonId: string | null;
  accountKind: string | null;
  currency: string | null;
  linkedToSplits: boolean;
  usedAsSettleUp: boolean;
  counterpart: {
    ownerPersonId: string | null;
    accountKind: string | null;
    currency: string | null;
    usedAsSettleUp: boolean;
  } | null;
}

export const TRANSFER_PURPOSE_COPY = {
  notATransferOut: "Only money sent to someone in the household can say what it is for. Open the sending side of this transfer.",
  noOwner: "Choose whose money this is first.",
  needsOtherSide: "Match this transfer with the account it went to first, so the app knows who it was for.",
  noReceiver: "Choose whose money came in on the other side first.",
  ownAccounts: "A move between your own accounts stays a transfer.",
  investments: "Money moved into or out of investments keeps its own rule.",
  currencies: "Both sides need the same currency.",
  onSplits: "This entry is on Splits, so it is shared there instead.",
  settleUp: "This transfer is a settle-up on Splits. Remove it from the settle-up first.",
  notSpending: (categoryName: string) => `${categoryName} is not spending, so a transfer can't be for it. Choose a category like Home.`,
  unknownCategory: "Choose a category from the list.",
  isPurpose: (categoryName: string) => `This transfer pays for ${categoryName}. Clear "What is this for?" first to use it as a settle-up.`
} as const;

export function transferPurposeRefusal(subject: TransferPurposeSubject, receiverPersonId: string | null): string | null {
  if (subject.entryType !== "transfer" || subject.transferDirection !== "out") {
    return TRANSFER_PURPOSE_COPY.notATransferOut;
  }
  if (!subject.ownerPersonId) {
    return TRANSFER_PURPOSE_COPY.noOwner;
  }
  if (subject.linkedToSplits) {
    return TRANSFER_PURPOSE_COPY.onSplits;
  }
  if (subject.usedAsSettleUp || subject.counterpart?.usedAsSettleUp) {
    return TRANSFER_PURPOSE_COPY.settleUp;
  }
  if (subject.accountKind === "investment" || subject.counterpart?.accountKind === "investment") {
    return TRANSFER_PURPOSE_COPY.investments;
  }
  if (subject.counterpart && (subject.counterpart.currency ?? "SGD") !== (subject.currency ?? "SGD")) {
    return TRANSFER_PURPOSE_COPY.currencies;
  }
  if (!subject.counterpart && !receiverPersonId) {
    return TRANSFER_PURPOSE_COPY.needsOtherSide;
  }
  if (!receiverPersonId) {
    return TRANSFER_PURPOSE_COPY.noReceiver;
  }
  if (receiverPersonId === subject.ownerPersonId) {
    return TRANSFER_PURPOSE_COPY.ownAccounts;
  }
  return null;
}
