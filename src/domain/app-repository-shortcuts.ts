import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import { ensureAppSettingsTable } from "./app-settings-table";
import {
  buildDefaultShortcutAccountPriorityIds,
  completeShortcutPriorityIds,
  parseStoredShortcutConnection,
  SHORTCUT_PERSON_SETTINGS_PREFIX,
  SHORTCUT_SETTINGS_KEY,
  shortcutKeyPersonId,
  shortcutSettingsKey,
  type StoredShortcutConnection
} from "./shortcut-connections";
import type { AccountDto, ShortcutConnectionDto, ShortcutSettingsDto } from "../types/dto";

export { buildDefaultShortcutAccountPriorityIds };
export const SHORTCUT_ENDPOINT_PATH = "/api/shortcuts/entries/create";

export interface ShortcutAccountSelection {
  id: string;
  name: string;
  currency: string;
  resolution: "explicit" | "wallet_name" | "priority" | "foreign_currency";
}

// One person's connection as the Worker reads it: who it is for, the key it
// answers to (from the app, else for the first person a Worker secret) and
// what was saved for it. The first person's is the household's original.
export interface ShortcutConnectionRecord {
  personId: string;
  personName: string;
  isFirstPerson: boolean;
  apiKey: string;
  apiKeySource: ShortcutConnectionDto["apiKeySource"];
  stored: StoredShortcutConnection;
  // The household's (first person's) card for other currencies, used when
  // this person has not chosen one.
  householdForeignCurrencyAccountId: string;
}

// The first active person (the household owner) holds the original
// connection; the rest follow in household order.
async function loadShortcutPeople(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT id, display_name
      FROM people
      WHERE household_id = ? AND is_active = 1
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at, id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();
  return result.results.map((row) => ({ id: row.id, name: row.display_name }));
}

// Every person's connection with its stored settings: two reads (the
// settings rows, the people). Callers pass the Worker secret so the first
// person's connection can still answer to it.
export async function loadShortcutConnectionRecords(
  db: D1Database,
  environmentToken?: string | null
): Promise<ShortcutConnectionRecord[]> {
  await ensureAppSettingsTable(db);
  const [people, settingRows] = await Promise.all([
    loadShortcutPeople(db),
    db
      .prepare("SELECT key, value_json FROM app_settings WHERE key = ? OR substr(key, 1, ?) = ?")
      .bind(SHORTCUT_SETTINGS_KEY, SHORTCUT_PERSON_SETTINGS_PREFIX.length, SHORTCUT_PERSON_SETTINGS_PREFIX)
      .all<{ key: string; value_json: string }>()
  ]);
  const firstPersonId = people[0]?.id ?? "";
  const storedByPerson = new Map<string, StoredShortcutConnection>();
  for (const row of settingRows.results) {
    const personId = shortcutKeyPersonId(row.key, firstPersonId);
    if (personId) {
      storedByPerson.set(personId, parseStoredShortcutConnection(row.value_json));
    }
  }
  const fallbackToken = environmentToken?.trim() ?? "";
  const householdForeignCurrencyAccountId = storedByPerson.get(firstPersonId)?.foreignCurrencyAccountId ?? "";
  return people.map((person, index) => {
    const stored = storedByPerson.get(person.id) ?? parseStoredShortcutConnection(null);
    const isFirstPerson = index === 0;
    const environmentKey = isFirstPerson && !stored.revoked ? fallbackToken : "";
    return {
      personId: person.id,
      personName: person.name,
      isFirstPerson,
      apiKey: stored.apiKey || environmentKey,
      apiKeySource: stored.apiKey ? "app" : environmentKey ? "environment" : "none",
      stored,
      householdForeignCurrencyAccountId
    };
  });
}

// The connection's Default account order: what was saved, then every other
// active account. The first person's keeps the household order; another
// person's starts with their own accounts.
export function shortcutConnectionPriorityIds(accounts: AccountDto[], record: ShortcutConnectionRecord) {
  return completeShortcutPriorityIds(
    accounts,
    record.stored.defaultAccountPriorityIds,
    record.isFirstPerson ? undefined : record.personId
  );
}

function buildConnectionDto(accounts: AccountDto[], record: ShortcutConnectionRecord): ShortcutConnectionDto {
  const activeAccountIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));
  const foreignId = record.stored.foreignCurrencyAccountId;
  return {
    personId: record.personId,
    personName: record.personName,
    apiKey: record.apiKey,
    apiKeySource: record.apiKeySource,
    defaultAccountPriorityIds: shortcutConnectionPriorityIds(accounts, record),
    defaultParams: record.stored.defaultParams,
    foreignCurrencyAccountId: foreignId && (!accounts.length || activeAccountIds.has(foreignId)) ? foreignId : ""
  };
}

// The first person's settings, flat: what the app shell and the entry draft
// read as the household's Default account order. One read of one row.
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
  const stored = parseStoredShortcutConnection(row?.value_json);
  const activeAccountIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));
  const fallbackToken = stored.revoked ? "" : environmentToken?.trim() ?? "";

  return {
    endpointPath,
    apiKey: stored.apiKey || fallbackToken,
    apiKeySource: stored.apiKey ? "app" : fallbackToken ? "environment" : "none",
    defaultAccountPriorityIds: completeShortcutPriorityIds(accounts, stored.defaultAccountPriorityIds),
    defaultParams: stored.defaultParams,
    foreignCurrencyAccountId: stored.foreignCurrencyAccountId
      && (!accounts.length || activeAccountIds.has(stored.foreignCurrencyAccountId))
      ? stored.foreignCurrencyAccountId
      : ""
  };
}

// Settings -> Apple Pay shortcut: the first person's settings flat (as the
// app shell reads them) and one connection per person.
export async function loadShortcutSettingsWithConnections(
  db: D1Database,
  accounts: AccountDto[],
  environmentToken?: string | null,
  endpointPath = SHORTCUT_ENDPOINT_PATH
): Promise<ShortcutSettingsDto> {
  const records = await loadShortcutConnectionRecords(db, environmentToken);
  const connections = records.map((record) => buildConnectionDto(accounts, record));
  const first = connections[0];
  return {
    endpointPath,
    apiKey: first?.apiKey ?? "",
    apiKeySource: first?.apiKeySource ?? "none",
    defaultAccountPriorityIds: first?.defaultAccountPriorityIds ?? buildDefaultShortcutAccountPriorityIds(accounts),
    defaultParams: first?.defaultParams ?? "",
    foreignCurrencyAccountId: first?.foreignCurrencyAccountId ?? "",
    connections
  };
}

// Saves one person's connection (the first person's when no person is
// named, as before connections) and its audit event in one batch, after
// checking the person, the accounts and that no other person already uses
// the key: two phones with one key could not be told apart.
export async function saveShortcutSettings(
  db: D1Database,
  input: {
    personId?: string;
    apiKey: string;
    defaultAccountPriorityIds: string[];
    defaultParams?: string;
    foreignCurrencyAccountId?: string;
  },
  environmentToken?: string | null
) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("Shortcut API key is required.");
  }

  const records = await loadShortcutConnectionRecords(db, environmentToken);
  const record = findConnectionRecord(records, input.personId);
  if (records.some((other) => other.personId !== record.personId && other.apiKey === apiKey)) {
    throw new Error("Another person's phone already uses this key. Generate a new key for this one.");
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
  const foreignCurrencyAccountId = input.foreignCurrencyAccountId?.trim() ?? "";
  if (foreignCurrencyAccountId && !activeAccountIds.has(foreignCurrencyAccountId)) {
    throw new Error("Choose an active card for purchases in another currency.");
  }

  const value = {
    apiKey,
    defaultAccountPriorityIds,
    defaultParams: input.defaultParams?.trim() ?? "",
    ...(foreignCurrencyAccountId ? { foreignCurrencyAccountId } : {})
  };
  const settingsKey = shortcutSettingsKey(record.personId, records[0].personId);
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(settingsKey, JSON.stringify(value)),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: settingsKey,
      action: "shortcut_settings_updated",
      detail: `Updated ${record.personName}'s shortcut API key and ${defaultAccountPriorityIds.length} default account priorities.`
    })
  ]);

  return { updated: true };
}

// Stops one person's connection answering: its key is removed and stays
// removed even when a Worker secret exists. Their account order is kept for
// the next key. The change merges into the stored settings inside the
// statement, so it cannot undo a save made at the same moment.
export async function revokeShortcutConnection(
  db: D1Database,
  input: { personId?: string },
  environmentToken?: string | null
) {
  const records = await loadShortcutConnectionRecords(db, environmentToken);
  const record = findConnectionRecord(records, input.personId);
  const settingsKey = shortcutSettingsKey(record.personId, records[0].personId);
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = json_patch(CASE WHEN json_valid(app_settings.value_json) THEN app_settings.value_json ELSE '{}' END, excluded.value_json),
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(settingsKey, JSON.stringify({ apiKey: "", revoked: true })),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: settingsKey,
      action: "shortcut_connection_revoked",
      detail: `Revoked ${record.personName}'s shortcut key.`
    })
  ]);
  return { revoked: true };
}

function findConnectionRecord(records: ShortcutConnectionRecord[], personId?: string) {
  const wanted = personId?.trim();
  const record = wanted ? records.find((candidate) => candidate.personId === wanted) : records[0];
  if (!record) {
    throw new Error("Choose a person in this household.");
  }
  return record;
}

// Where a Shortcut purchase goes when the Shortcut names no card, for one
// person's connection: the card for other currencies falls back to the
// household's (the first person's) when this person has none.
export async function resolveShortcutAccountSelection(
  db: D1Database,
  connection: ShortcutConnectionRecord,
  input: {
    accountId?: string;
    accountName?: string;
    walletName?: string;
    amountCurrency?: string;
  }
): Promise<ShortcutAccountSelection | null> {
  const accounts = await loadShortcutAccountReferences(db);
  const selected = selectShortcutAccount(
    accounts,
    shortcutConnectionPriorityIds(accounts, connection),
    input,
    { foreignCurrencyAccountId: connection.stored.foreignCurrencyAccountId || connection.householdForeignCurrencyAccountId }
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
    // The Wallet amount's currency, when it names one.
    amountCurrency?: string;
  },
  options: { foreignCurrencyAccountId?: string } = {}
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
  // A purchase in another currency than the first priority card's goes to
  // the card chosen for other currencies, when one is set and active.
  const foreignCurrencyAccount = options.foreignCurrencyAccountId
    ? activeAccounts.find((account) => account.id === options.foreignCurrencyAccountId)
    : undefined;
  if (
    foreignCurrencyAccount
    && input.amountCurrency
    && input.amountCurrency.toUpperCase() !== (priorityAccount?.currency ?? "").toUpperCase()
  ) {
    return { account: toShortcutAccountSelection(foreignCurrencyAccount, "foreign_currency") };
  }
  return {
    account: priorityAccount
      ? toShortcutAccountSelection(priorityAccount, "priority")
      : null
  };
}

// The household's accounts without balances or checkpoints: what account
// selection needs (the Shortcut, and the entry draft's wallet matching).
export async function loadShortcutAccountReferences(db: D1Database): Promise<AccountDto[]> {
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
