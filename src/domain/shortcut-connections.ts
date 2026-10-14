// Apple Pay Shortcut connections, one per person (DOMAIN.md "Shortcut
// connection"). Pure rules only: where a connection is stored, how a stored
// record reads, and how a connection's Default account order is built. The
// reads and writes are in app-repository-shortcuts.ts.
//
// Storage is the household's key/value settings (app_settings), so no table
// changed: the household's original connection stays under "shortcut_api" and
// becomes the first person's (the household's owner); every other person's is
// "shortcut_api_person_<personId>". A key that was installed before there
// were connections therefore keeps working with no reinstall.

import type { AccountDto } from "../types/dto";

export const SHORTCUT_SETTINGS_KEY = "shortcut_api";
export const SHORTCUT_PERSON_SETTINGS_PREFIX = "shortcut_api_person_";

export interface StoredShortcutConnection {
  apiKey: string;
  defaultAccountPriorityIds: string[];
  defaultParams: string;
  // The card a Wallet purchase in another currency goes to when the
  // Shortcut names no card (an Amaze card abroad charges the linked card).
  foreignCurrencyAccountId: string;
  // Set by Revoke: the connection stays revoked even when a Worker secret
  // (SHORTCUT_INGEST_TOKEN) would otherwise answer for the first person.
  revoked: boolean;
}

// The settings key a person's connection is stored under.
export function shortcutSettingsKey(personId: string, firstPersonId: string) {
  return personId === firstPersonId ? SHORTCUT_SETTINGS_KEY : `${SHORTCUT_PERSON_SETTINGS_PREFIX}${personId}`;
}

// The person a stored settings key belongs to ("" when it is not one).
export function shortcutKeyPersonId(key: string, firstPersonId: string) {
  if (key === SHORTCUT_SETTINGS_KEY) {
    return firstPersonId;
  }
  return key.startsWith(SHORTCUT_PERSON_SETTINGS_PREFIX) ? key.slice(SHORTCUT_PERSON_SETTINGS_PREFIX.length) : "";
}

export function parseStoredShortcutConnection(value?: string | null): StoredShortcutConnection {
  const empty: StoredShortcutConnection = {
    apiKey: "",
    defaultAccountPriorityIds: [],
    defaultParams: "",
    foreignCurrencyAccountId: "",
    revoked: false
  };
  if (!value) {
    return empty;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredShortcutConnection> | null;
    if (!parsed || typeof parsed !== "object") {
      return empty;
    }
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
      defaultAccountPriorityIds: Array.isArray(parsed.defaultAccountPriorityIds)
        ? parsed.defaultAccountPriorityIds.filter((item): item is string => typeof item === "string")
        : [],
      defaultParams: typeof parsed.defaultParams === "string" ? parsed.defaultParams.trim() : "",
      foreignCurrencyAccountId: typeof parsed.foreignCurrencyAccountId === "string" ? parsed.foreignCurrencyAccountId : "",
      revoked: parsed.revoked === true
    };
  } catch {
    return empty;
  }
}

// The Default account order for a person's connection with nothing saved:
// their own cards first, then shared and other accounts, each group cards
// before banks before cash.
export function buildDefaultShortcutAccountPriorityIds(accounts: AccountDto[], personId?: string) {
  const ownerRank = (account: AccountDto) => {
    if (!personId) {
      return 0;
    }
    return account.ownerPersonId === personId ? 0 : account.isJoint || !account.ownerPersonId ? 1 : 2;
  };
  return accounts
    .filter((account) => account.isActive)
    .slice()
    .sort((left, right) => (
      ownerRank(left) - ownerRank(right)
      || accountKindRank(left.kind) - accountKindRank(right.kind)
      || left.institution.localeCompare(right.institution)
      || left.name.localeCompare(right.name)
    ))
    .map((account) => account.id);
}

// The saved order (active accounts only) followed by every other active
// account in the default order, so a new account is never missing.
export function completeShortcutPriorityIds(accounts: AccountDto[], savedIds: string[], personId?: string) {
  const activeIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));
  const saved = savedIds.filter((accountId) => activeIds.has(accountId));
  return [
    ...saved,
    ...buildDefaultShortcutAccountPriorityIds(accounts, personId).filter((accountId) => !saved.includes(accountId))
  ];
}

function accountKindRank(kind?: string) {
  if (kind === "credit_card") {
    return 0;
  }
  if (kind === "bank") {
    return 1;
  }
  if (kind === "cash") {
    return 2;
  }
  return 3;
}
