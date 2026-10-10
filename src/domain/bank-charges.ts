// Bank charges on a card statement: late charges, interest, annual fees and
// currency fees, and the reversals a bank posts when it waives one
// (DOMAIN.md "Bank charge"). Card statements print these as their own rows,
// worded differently per bank (Citi glues the words together), so they are
// recognised by their leading words, never by a word anywhere in a shop's
// name ("AMAZE*FEES" and "Cabcharge" are shops).

export type BankChargeKind = "late_fee" | "interest" | "annual_fee" | "fx_fee" | "other_fee";

export interface BankCharge {
  kind: BankChargeKind;
  isReversal: boolean;
}

// Each kind's wording, matched against the description with spaces and
// punctuation removed, from its start (after a reversal prefix).
const CHARGE_PATTERNS: Array<{ kind: BankChargeKind; pattern: RegExp }> = [
  { kind: "late_fee", pattern: /^LATE(?:PAYMENT)?(?:CHARGES?|FEES?)/ },
  { kind: "interest", pattern: /^(?:INTERESTS?(?:CHARGES?)?(?:REVERSAL|REV)?$|INTERESTCHARGE|FINANCECHARGES?)/ },
  { kind: "annual_fee", pattern: /^(?:GSTON)?(?:ANNUAL)?(?:CARD)?MEMBER(?:SHIP)?FEE|^(?:GSTON)?ANNUALFEE|^CARDMEMBERSHIPFEE/ },
  { kind: "fx_fee", pattern: /^(?:CCY)?CONVERSIONFEES?|^DCCFEE|^FOREIGN(?:TRANSACTION|CURRENCY)FEE/ },
  { kind: "other_fee", pattern: /^(?:OVERLIMIT|CASHADVANCE|RETURNEDPAYMENT|SERVICE)FEE/ }
];

// "CR LATE CHARGE" (UOB), "AUTOLATEFEEREVERSAL", "ANNUALMEMBERFEEREV" (Citi),
// "INTEREST REVERSAL" (OCBC), "LATE CHARGE WAIVER".
const REVERSAL_PREFIX = /^(?:CR|AUTO)(?=[A-Z])/;
const REVERSAL_WORDS = /(?:REVERSAL|REV|WAIVER|WAIVED|REFUND)$/;

export function classifyBankCharge(description: string): BankCharge | null {
  const original = String(description ?? "").trim().toUpperCase();
  if (!original) {
    return null;
  }
  // A "CR " prefix on UOB is its own word; Citi glues "AUTO" on.
  const hasCrPrefix = /^CR\s/.test(original);
  let compact = original.replace(/[^A-Z0-9]/g, "");
  let isReversal = hasCrPrefix;
  if (hasCrPrefix) {
    compact = compact.slice(2);
  } else if (/^AUTO/.test(compact)) {
    compact = compact.replace(REVERSAL_PREFIX, "");
  }
  // Citi prints the converted amount after the fee ("...FEESGD13.39").
  const words = compact.replace(/SGD\d.*$/, "");
  if (REVERSAL_WORDS.test(words)) {
    isReversal = true;
  }
  const stem = words.replace(REVERSAL_WORDS, "");
  for (const { kind, pattern } of CHARGE_PATTERNS) {
    if (pattern.test(stem) || pattern.test(words)) {
      return { kind, isReversal };
    }
  }
  return null;
}

export interface BankChargeEntry {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  // Money out of the card account (a charge) or in (a reversal).
  direction: "out" | "in";
}

export interface UnreversedBankCharge extends BankChargeEntry {
  kind: BankChargeKind;
}

// The charges no reversal has cancelled: each reversal cancels one charge of
// the same kind and amount on the same account, dated on or before it. A
// currency fee is the price of a foreign purchase, not a charge a bank
// waives, so it is never listed.
export function findUnreversedBankCharges(entries: BankChargeEntry[]): UnreversedBankCharge[] {
  const classified = entries
    .map((entry) => ({ entry, charge: classifyBankCharge(entry.description) }))
    .filter((item): item is { entry: BankChargeEntry; charge: BankCharge } => Boolean(item.charge))
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) || left.entry.id.localeCompare(right.entry.id));
  const open: UnreversedBankCharge[] = [];
  for (const { entry, charge } of classified) {
    const isReversal = charge.isReversal || entry.direction === "in";
    if (!isReversal) {
      if (charge.kind !== "fx_fee") {
        open.push({ ...entry, kind: charge.kind });
      }
      continue;
    }
    const index = open.findIndex((item) => (
      item.accountId === entry.accountId
      && item.kind === charge.kind
      && item.amountMinor === entry.amountMinor
      && item.date <= entry.date
    ));
    if (index >= 0) {
      open.splice(index, 1);
    }
  }
  return open;
}
