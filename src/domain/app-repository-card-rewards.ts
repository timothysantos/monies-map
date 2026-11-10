import { buildAuditEventStatement } from "./app-repository-audit";
import { ensureAppSettingsTable } from "./app-settings-table";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { CardRewardRulesRefused, readCardRewardRules, type CardRewardRules } from "./card-rewards";
import { presetByKey, presetForAccountName, rulesFromPreset } from "./card-reward-presets";

// Card reward rules in storage (DOMAIN.md "Card reward rule";
// `card_reward_rules`, one JSON object per credit card).
//
// - Reading tolerates the table missing: every card then has its preset's
//   rules, in memory only.
// - The first read of a card with no row copies its preset in (a card no
//   preset matches stays "not set up"). It reads once and writes only the
//   missing rows, with one audit event, in one db.batch().
// - Each change (save, reset to the usual rules, restore for Undo) reads
//   the card and its row first, then writes the row (or deletes it) and its
//   `card_reward_rules_changed` audit event in one db.batch(). Nothing here
//   writes to entries, so there are no month refresh markers.

export class CardRewardChangeRefused extends Error {}

export type CardRewardAction = "save" | "reset" | "restore";
const ACTIONS: readonly CardRewardAction[] = ["save", "reset", "restore"];

export interface CreditCardAccountRow {
  id: string;
  account_name: string;
  owner_person_id: string | null;
  is_joint: number;
  is_active: number;
}

export interface StoredCardRewardRules {
  rules: CardRewardRules;
  updatedAt: string | null;
  // Rules that come from the preset in memory (no row, or no table).
  fromPreset: boolean;
}

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

export const CREDIT_CARD_ACCOUNTS_SQL = `
  SELECT id, account_name, owner_person_id, is_joint, is_active
  FROM accounts
  WHERE household_id = ? AND account_kind = 'credit_card'
  ORDER BY account_name, id
`;

// The day after each card's latest statement ended: its statement day.
export const CARD_STATEMENT_DAYS_SQL = `
  SELECT account_balance_checkpoints.account_id, MAX(account_balance_checkpoints.statement_end_date) AS end_date
  FROM account_balance_checkpoints
  JOIN accounts ON accounts.id = account_balance_checkpoints.account_id
  WHERE account_balance_checkpoints.household_id = ? AND accounts.account_kind = 'credit_card'
  GROUP BY account_balance_checkpoints.account_id
`;

export async function loadCreditCardAccounts(db: D1Database) {
  return (await db.prepare(CREDIT_CARD_ACCOUNTS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<CreditCardAccountRow>()).results;
}

/** The stored rows, or null when the table is missing. A row that no longer reads is left out (the card shows as not set up). */
export async function loadCardRewardRows(db: D1Database): Promise<Map<string, { rules: CardRewardRules; updatedAt: string }> | null> {
  try {
    const result = await db.prepare("SELECT account_id, preset_key, rules_json, updated_at FROM card_reward_rules WHERE household_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ account_id: string; preset_key: string | null; rules_json: string; updated_at: string }>();
    const rows = new Map<string, { rules: CardRewardRules; updatedAt: string }>();
    for (const row of result.results) {
      try {
        rows.set(row.account_id, { rules: { ...readCardRewardRules(JSON.parse(row.rules_json)), presetKey: row.preset_key }, updatedAt: row.updated_at });
      } catch {
        // A row that no longer reads is left out rather than breaking the card.
      }
    }
    return rows;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function loadCardStatementDays(db: D1Database): Promise<Map<string, number>> {
  try {
    const result = await db.prepare(CARD_STATEMENT_DAYS_SQL).bind(DEFAULT_HOUSEHOLD_ID).all<{ account_id: string; end_date: string | null }>();
    const days = new Map<string, number>();
    for (const row of result.results) {
      const statementDay = statementDayAfter(row.end_date);
      if (statementDay) days.set(row.account_id, statementDay);
    }
    return days;
  } catch (error) {
    if (isMissingTable(error)) return new Map();
    throw error;
  }
}

// A statement that ends on the 17th starts the next on the 18th; one that
// ends on the last day of a month starts on the 1st. Days after the 28th
// are treated as the 1st (a reset day must exist in every month).
export function statementDayAfter(endDate: string | null | undefined): number | null {
  if (!endDate || !/^\d{4}-\d\d-\d\d$/.test(endDate)) return null;
  const next = new Date(`${endDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const day = next.getUTCDate();
  return day <= 28 ? day : 1;
}

const rulesJson = (rules: CardRewardRules) => JSON.stringify({ ...rules, presetKey: undefined });

function presetRules(account: CreditCardAccountRow, statementDays: Map<string, number>) {
  const preset = presetForAccountName(account.account_name);
  return preset ? rulesFromPreset(preset, statementDays.get(account.id) ?? null) : null;
}

/**
 * Every credit card's rules, copying in the preset for a card that has no
 * row yet (one batch of only the missing rows and one audit event). With
 * the table missing, the presets are returned without writing.
 */
export async function ensureCardRewardRules(
  db: D1Database,
  input: { accounts: CreditCardAccountRow[]; rows: Map<string, { rules: CardRewardRules; updatedAt: string }> | null; statementDays: Map<string, number> }
): Promise<Map<string, StoredCardRewardRules>> {
  const result = new Map<string, StoredCardRewardRules>();
  const missing: Array<{ account: CreditCardAccountRow; rules: CardRewardRules }> = [];
  for (const account of input.accounts) {
    const row = input.rows?.get(account.id);
    if (row) {
      result.set(account.id, { rules: row.rules, updatedAt: row.updatedAt, fromPreset: false });
      continue;
    }
    const rules = presetRules(account, input.statementDays);
    if (!rules) continue;
    result.set(account.id, { rules, updatedAt: null, fromPreset: true });
    missing.push({ account, rules });
  }
  if (input.rows && missing.length) {
    await db.batch([
      ...missing.map(({ account, rules }) => db.prepare(`
        INSERT OR IGNORE INTO card_reward_rules (household_id, account_id, preset_key, rules_json, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(DEFAULT_HOUSEHOLD_ID, account.id, rules.presetKey, rulesJson(rules))),
      buildAuditEventStatement(db, {
        entityType: "card_reward_rules",
        entityId: missing.map(({ account }) => account.id).join(",").slice(0, 400),
        action: "card_reward_rules_seeded",
        detail: `Cards and rewards: the usual rules copied in for ${missing.map(({ account }) => account.account_name).join(", ")}.`.slice(0, 600)
      })
    ]);
    for (const { account } of missing) {
      const item = result.get(account.id)!;
      result.set(account.id, { ...item, fromPreset: false });
    }
  }
  return result;
}

export interface CardRewardChangeResult {
  accountId: string;
  previous: CardRewardRules | null;
  current: CardRewardRules | null;
}

/**
 * Save new rules for one card, reset it to the usual rules (its preset; a
 * card with no preset goes back to not set up), or restore the rules a
 * change reported as `previous` (Undo; null: not set up).
 */
export async function changeCardRewardRules(
  db: D1Database,
  input: { accountId: unknown; action: unknown; rules?: unknown; personId?: string | null }
): Promise<CardRewardChangeResult> {
  const accountId = typeof input.accountId === "string" ? input.accountId : "";
  if (!accountId || accountId.length > 120) throw new CardRewardChangeRefused("That card was not found.");
  if (!ACTIONS.includes(input.action as CardRewardAction)) throw new CardRewardChangeRefused("That is not a change the card list knows.");
  const action = input.action as CardRewardAction;

  const [account, row, statementDays] = await Promise.all([
    db.prepare("SELECT id, account_name, owner_person_id, is_joint, is_active FROM accounts WHERE household_id = ? AND id = ? AND account_kind = 'credit_card'")
      .bind(DEFAULT_HOUSEHOLD_ID, accountId)
      .first<CreditCardAccountRow>(),
    db.prepare("SELECT preset_key, rules_json FROM card_reward_rules WHERE household_id = ? AND account_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, accountId)
      .first<{ preset_key: string | null; rules_json: string }>()
      .catch((error: unknown) => {
        if (isMissingTable(error)) throw new CardRewardChangeRefused("Cards and rewards is not ready yet. Try again later.");
        throw error;
      }),
    loadCardStatementDays(db)
  ]);
  if (!account) throw new CardRewardChangeRefused("That card was not found.");

  let previous: CardRewardRules | null = null;
  if (row) {
    try {
      previous = { ...readCardRewardRules(JSON.parse(row.rules_json)), presetKey: row.preset_key };
    } catch {
      previous = null;
    }
  }

  let current: CardRewardRules | null;
  try {
    if (action === "save") {
      const read = readCardRewardRules(input.rules);
      // Edited rules keep the preset they started from, for "Reset".
      current = { ...read, presetKey: previous?.presetKey ?? presetForAccountName(account.account_name)?.key ?? null };
    } else if (action === "reset") {
      current = presetRules(account, statementDays);
    } else {
      current = input.rules === null || input.rules === undefined ? null : readCardRewardRules(input.rules);
      if (current && current.presetKey && !presetByKey(current.presetKey)) current = { ...current, presetKey: null };
    }
  } catch (error) {
    if (error instanceof CardRewardRulesRefused) throw new CardRewardChangeRefused(error.message);
    throw error;
  }

  const write = current
    ? db.prepare(`
        INSERT INTO card_reward_rules (household_id, account_id, preset_key, rules_json, updated_by_person_id, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (household_id, account_id) DO UPDATE SET
          preset_key = excluded.preset_key,
          rules_json = excluded.rules_json,
          updated_by_person_id = excluded.updated_by_person_id,
          updated_at = CURRENT_TIMESTAMP
      `).bind(DEFAULT_HOUSEHOLD_ID, accountId, current.presetKey, rulesJson(current), input.personId ?? null)
    : db.prepare("DELETE FROM card_reward_rules WHERE household_id = ? AND account_id = ?").bind(DEFAULT_HOUSEHOLD_ID, accountId);
  const what = action === "save" ? "changed" : action === "reset" ? "reset to the usual rules" : "put back";
  await db.batch([
    write,
    buildAuditEventStatement(db, {
      entityType: "card_reward_rules",
      entityId: accountId,
      action: "card_reward_rules_changed",
      detail: `Cards and rewards: ${account.account_name} ${what}${current ? ` (${current.unit}, ${current.bonuses.length} bonus${current.bonuses.length === 1 ? "" : "es"})` : " (not set up)"}.`
    })
  ]);
  return { accountId, previous, current };
}

// ---- "Suggest cards from" (owner decision, 2026-11-10) ---------------------

// The household pools its miles: by default a suggestion may name any
// household card for anyone's spending ("household"); "own" keeps each
// person to their own cards. Stored in app_settings like the household's
// other settings; an absent or unreadable value (or no table) reads as
// "household".
export type CardRewardSuggestFrom = "household" | "own";
export const CARD_REWARD_SUGGEST_FROM_KEY = "card_rewards_suggest_from";
// The chooser id the engine uses for the household's pooled cards.
export const CARD_REWARD_HOUSEHOLD_CHOICE = "household";

export async function loadCardRewardSuggestFrom(db: D1Database): Promise<CardRewardSuggestFrom> {
  try {
    const row = await db.prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .bind(CARD_REWARD_SUGGEST_FROM_KEY)
      .first<{ value_json: string }>();
    return row && JSON.parse(row.value_json)?.from === "own" ? "own" : "household";
  } catch {
    return "household";
  }
}

export async function saveCardRewardSuggestFrom(db: D1Database, input: { from: unknown }): Promise<{ previous: CardRewardSuggestFrom; current: CardRewardSuggestFrom }> {
  if (input.from !== "household" && input.from !== "own") {
    throw new CardRewardChangeRefused("Suggest cards from the whole household or each person's own cards.");
  }
  const current: CardRewardSuggestFrom = input.from;
  await ensureAppSettingsTable(db);
  const previous = await loadCardRewardSuggestFrom(db);
  await db.batch([
    db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
    `).bind(CARD_REWARD_SUGGEST_FROM_KEY, JSON.stringify({ from: current })),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: CARD_REWARD_SUGGEST_FROM_KEY,
      action: "card_rewards_suggest_from_updated",
      detail: current === "household" ? "Cards and rewards: suggest cards from the whole household." : "Cards and rewards: suggest each person's own cards."
    })
  ]);
  return { previous, current };
}
