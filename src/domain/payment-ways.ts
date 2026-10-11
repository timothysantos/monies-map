// Payment ways (DOMAIN.md "Payment Way"): for each person, the account their
// PayNow and bank transfers come from and their cash wallet, chosen in
// Settings -> Payment ways. The entry draft uses them when a sentence says
// how it was paid ("paynow", "NETS", "cash") but names no account.
//
// Pure: storage is app-repository-payment-ways.ts.

import type { AccountDto, PaymentWayDto, PersonDto } from "../types/dto";

export type PaymentWayKind = "bank_transfer" | "cash";

// What app_settings keeps under PAYMENT_WAYS_SETTINGS_KEY. A person with no
// entry has never chosen: their PayNow account is the default below. A
// person with an entry keeps exactly what they chose, "" (none) included.
export interface StoredPaymentWays {
  people: Record<string, { bankTransferAccountId: string; cashAccountId: string }>;
}

export const PAYMENT_WAYS_SETTINGS_KEY = "payment_ways";

// PayNow, FAST, GIRO and NETS all take money from a bank account. Any
// active bank account may be chosen, a joint one or another person's
// included: people do pay from a shared or a partner's account.
export function isBankTransferAccount(account: AccountDto) {
  return account.isActive && account.kind === "bank";
}

export function isCashWalletAccount(account: AccountDto) {
  return account.isActive && account.kind === "cash";
}

// The person's own first bank account in Default account priority (a joint
// account is never assumed), else none.
export function defaultBankTransferAccountId(personId: string, accounts: AccountDto[], priorityIds: string[]) {
  const own = accounts.filter((account) => isBankTransferAccount(account) && !account.isJoint && account.ownerPersonId === personId);
  const rank = (account: AccountDto) => {
    const index = priorityIds.indexOf(account.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return own.slice().sort((left, right) => rank(left) - rank(right))[0]?.id ?? "";
}

// Every person's effective payment ways. A chosen account that is no longer
// active (archived, or changed to another kind) counts as not chosen: the
// PayNow account goes back to the default and the cash wallet to none.
export function resolvePaymentWays(
  stored: StoredPaymentWays,
  input: { accounts: AccountDto[]; people: PersonDto[]; priorityIds: string[] }
): PaymentWayDto[] {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  return input.people.map((person) => {
    const chosen = stored.people[person.id];
    const defaultBank = defaultBankTransferAccountId(person.id, input.accounts, input.priorityIds);
    if (!chosen) {
      return { personId: person.id, bankTransferAccountId: defaultBank, cashAccountId: "" };
    }
    const bank = chosen.bankTransferAccountId ? byId.get(chosen.bankTransferAccountId) : undefined;
    const cash = chosen.cashAccountId ? byId.get(chosen.cashAccountId) : undefined;
    return {
      personId: person.id,
      bankTransferAccountId: !chosen.bankTransferAccountId
        ? ""
        : bank && isBankTransferAccount(bank) ? bank.id : defaultBank,
      cashAccountId: cash && isCashWalletAccount(cash) ? cash.id : ""
    };
  });
}

export function paymentWayAccountId(ways: PaymentWayDto[] | undefined, personId: string | undefined, kind: PaymentWayKind) {
  const way = personId ? ways?.find((candidate) => candidate.personId === personId) : undefined;
  if (!way) {
    return undefined;
  }
  return (kind === "cash" ? way.cashAccountId : way.bankTransferAccountId) || undefined;
}

export function parseStoredPaymentWays(value?: string | null): StoredPaymentWays {
  if (!value) {
    return { people: {} };
  }
  try {
    const parsed = JSON.parse(value) as { people?: unknown };
    const people: StoredPaymentWays["people"] = {};
    if (parsed.people && typeof parsed.people === "object" && !Array.isArray(parsed.people)) {
      for (const [personId, entry] of Object.entries(parsed.people as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const record = entry as { bankTransferAccountId?: unknown; cashAccountId?: unknown };
        people[personId] = {
          bankTransferAccountId: typeof record.bankTransferAccountId === "string" ? record.bankTransferAccountId : "",
          cashAccountId: typeof record.cashAccountId === "string" ? record.cashAccountId : ""
        };
      }
    }
    return { people };
  } catch {
    return { people: {} };
  }
}
