import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { recordAuditEvent } from "./app-repository-audit";
import type { AccountDto, ShortcutSettingsDto } from "../types/dto";

const SHORTCUT_SETTINGS_KEY = "shortcut_api";
export const SHORTCUT_ENDPOINT_PATH = "/api/shortcuts/entries/create";

interface StoredShortcutSettings {
  apiKey?: string;
  defaultAccountPriorityIds?: string[];
  defaultParams?: string;
}

export interface ShortcutAccountSelection {
  id: string;
  name: string;
  currency: string;
  resolution: "explicit" | "wallet_name" | "priority";
}

export async function ensureAppSettingsTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export function buildDefaultShortcutAccountPriorityIds(accounts: AccountDto[]) {
  return accounts
    .filter((account) => account.isActive)
    .slice()
    .sort((left, right) => (
      accountKindRank(left.kind) - accountKindRank(right.kind)
      || left.institution.localeCompare(right.institution)
      || left.name.localeCompare(right.name)
    ))
    .map((account) => account.id);
}

export async function loadShortcutSettings(
  db: D1Database,
  accounts: AccountDto[] = [],
  environmentToken?: string | null,
  endpointPath = SHORTCUT_ENDPOINT_PATH
): Promise<ShortcutSettingsDto> {
  await ensureAppSettingsTable(db);
  const row = await db
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .bind(SHORTCUT_SETTINGS_KEY)
    .first<{ value_json: string }>();
  const stored = parseShortcutSettings(row?.value_json);
  const activeAccountIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));
  const storedPriorityIds = (stored.defaultAccountPriorityIds ?? []).filter((accountId) => activeAccountIds.has(accountId));
  const defaultPriorityIds = buildDefaultShortcutAccountPriorityIds(accounts);
  const priorityIds = [
    ...storedPriorityIds,
    ...defaultPriorityIds.filter((accountId) => !storedPriorityIds.includes(accountId))
  ];
  const appApiKey = stored.apiKey?.trim() ?? "";
  const fallbackToken = environmentToken?.trim() ?? "";

  return {
    endpointPath,
    apiKey: appApiKey || fallbackToken,
    apiKeySource: appApiKey ? "app" : fallbackToken ? "environment" : "none",
    defaultAccountPriorityIds: priorityIds,
    defaultParams: stored.defaultParams?.trim() ?? ""
  };
}

export async function saveShortcutSettings(
  db: D1Database,
  input: {
    apiKey: string;
    defaultAccountPriorityIds: string[];
    defaultParams?: string;
  }
) {
  await ensureAppSettingsTable(db);
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("Shortcut API key is required.");
  }

  const activeRows = await db
    .prepare("SELECT id FROM accounts WHERE household_id = ? AND is_active = 1")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();
  const activeAccountIds = new Set(activeRows.results.map((row) => row.id));
  const defaultAccountPriorityIds = dedupe(input.defaultAccountPriorityIds)
    .filter((accountId) => activeAccountIds.has(accountId));
  if (!defaultAccountPriorityIds.length) {
    throw new Error("Choose at least one active default shortcut account.");
  }

  const value: StoredShortcutSettings = {
    apiKey,
    defaultAccountPriorityIds,
    defaultParams: input.defaultParams?.trim() ?? ""
  };
  await db
    .prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(SHORTCUT_SETTINGS_KEY, JSON.stringify(value))
    .run();

  await recordAuditEvent(db, {
    entityType: "settings",
    entityId: SHORTCUT_SETTINGS_KEY,
    action: "shortcut_settings_updated",
    detail: `Updated shortcut API key and ${defaultAccountPriorityIds.length} default account priorities.`
  });

  return { updated: true };
}

export async function resolveShortcutDefaultAccountId(db: D1Database) {
  const accounts = await loadShortcutAccountReferences(db);
  const settings = await loadShortcutSettings(db, accounts);
  return settings.defaultAccountPriorityIds[0] ?? null;
}

export async function resolveShortcutAccountSelection(
  db: D1Database,
  input: {
    accountId?: string;
    accountName?: string;
    walletName?: string;
  }
): Promise<ShortcutAccountSelection | null> {
  const accounts = await loadShortcutAccountReferences(db);
  const settings = await loadShortcutSettings(db, accounts);
  const selected = selectShortcutAccount(
    accounts,
    settings.defaultAccountPriorityIds,
    input
  );
  if (selected.error) {
    throw new Error(selected.error);
  }
  return selected.account;
}

export function selectShortcutAccount(
  accounts: AccountDto[],
  defaultAccountPriorityIds: string[],
  input: {
    accountId?: string;
    accountName?: string;
    walletName?: string;
  }
): { account: ShortcutAccountSelection | null; error?: string } {
  const activeAccounts = accounts.filter((account) => account.isActive);
  if (input.accountId) {
    const account = activeAccounts.find((candidate) => candidate.id === input.accountId);
    return account
      ? { account: toShortcutAccountSelection(account, "explicit") }
      : { account: null, error: `Unknown or inactive account: ${input.accountId}` };
  }

  if (input.accountName) {
    const account = findShortcutAccountByName(activeAccounts, input.accountName);
    return account
      ? { account: toShortcutAccountSelection(account, "explicit") }
      : { account: null, error: `Unknown or inactive account: ${input.accountName}` };
  }

  const walletAccount = findShortcutAccountByName(activeAccounts, input.walletName);
  if (walletAccount) {
    return { account: toShortcutAccountSelection(walletAccount, "wallet_name") };
  }

  const priorityAccount = defaultAccountPriorityIds
    .map((accountId) => activeAccounts.find((account) => account.id === accountId))
    .find((account): account is AccountDto => Boolean(account));
  return {
    account: priorityAccount
      ? toShortcutAccountSelection(priorityAccount, "priority")
      : null
  };
}

async function loadShortcutAccountReferences(db: D1Database): Promise<AccountDto[]> {
  const result = await db
    .prepare(`
      SELECT
        accounts.id,
        accounts.institution_id,
        institutions.name AS institution_name,
        accounts.owner_person_id,
        people.display_name AS owner_name,
        accounts.account_name,
        accounts.account_kind,
        accounts.currency,
        accounts.opening_balance_minor,
        accounts.is_joint,
        accounts.is_active
      FROM accounts
      INNER JOIN institutions ON institutions.id = accounts.institution_id
      LEFT JOIN people ON people.id = accounts.owner_person_id
      WHERE accounts.household_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      institution_id: string;
      institution_name: string;
      owner_person_id: string | null;
      owner_name: string | null;
      account_name: string;
      account_kind: string;
      currency: string;
      opening_balance_minor: number;
      is_joint: number;
      is_active: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    institutionId: row.institution_id,
    ownerPersonId: row.owner_person_id ?? undefined,
    name: row.account_name,
    institution: row.institution_name,
    kind: row.account_kind,
    ownerLabel: row.owner_name ?? "Shared",
    currency: row.currency,
    openingBalanceMinor: Number(row.opening_balance_minor ?? 0),
    isJoint: Boolean(row.is_joint),
    isActive: Boolean(row.is_active)
  }));
}

function findShortcutAccountByName(accounts: AccountDto[], value?: string) {
  const normalizedValue = normalizeShortcutAccountName(value);
  if (!normalizedValue) {
    return undefined;
  }
  const matches = accounts.filter((account) => (
    normalizeShortcutAccountName(account.name) === normalizedValue
    || normalizeShortcutAccountName(`${account.institution} ${account.name}`) === normalizedValue
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeShortcutAccountName(value?: string) {
  return value
    ?.normalize("NFKC")
    .toLocaleLowerCase("en-SG")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function toShortcutAccountSelection(
  account: AccountDto,
  resolution: ShortcutAccountSelection["resolution"]
): ShortcutAccountSelection {
  return {
    id: account.id,
    name: account.name,
    currency: account.currency.toUpperCase(),
    resolution
  };
}

function parseShortcutSettings(value?: string | null): StoredShortcutSettings {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as StoredShortcutSettings;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      defaultAccountPriorityIds: Array.isArray(parsed.defaultAccountPriorityIds)
        ? parsed.defaultAccountPriorityIds.filter((item): item is string => typeof item === "string")
        : [],
      defaultParams: typeof parsed.defaultParams === "string" ? parsed.defaultParams : ""
    };
  } catch {
    return {};
  }
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

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}
