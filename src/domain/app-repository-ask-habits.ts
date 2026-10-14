// Storage for Ask habits and the "Let Ask handle safe things" setting
// (DOMAIN.md "Ask Habit"; ask-habits.ts holds the rules). The table is
// additive (schema.sql "ask_habits"): every read and every learning write
// tolerates it being missing (the feature is simply off), and learning is
// best effort: it never fails or delays the command that triggered it.
//
// Learning writes are one upsert statement (so two racing confirmations
// cannot lose a count) and carry no audit event: they are derived counts,
// not a user command. The commands the person runs on habits themselves
// (edit, delete, forget everything, the setting) are all-or-nothing batches
// with an audit event.

import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { ensureAppSettingsTable } from "./app-settings-table";
import {
  ASK_CATCH_ALL_CATEGORIES,
  ASK_HANDLES_SAFE_SETTING_KEY,
  askHabitId,
  canonicalHabitValue,
  habitAliasKey,
  habitMerchantKey,
  type AskAliasHabitValue,
  type AskCategoryHabitValue,
  type AskHabit,
  type AskHabitKind,
  type AskHabitSource,
  type AskHabitValue,
  type AskSplitHabitValue
} from "./ask-habits";
import { todayInAppTimeZone } from "../lib/app-calendar";


// Habits kept at most; the least recently used are dropped past it.
const MAX_HABITS = 400;

interface HabitRow {
  kind: AskHabitKind;
  key: string;
  value_json: string;
  times_confirmed: number;
  times_overridden: number;
  last_used: string;
  source: AskHabitSource;
}

function readValue(kind: AskHabitKind, json: string): AskHabitValue | null {
  try {
    const value = JSON.parse(json);
    if (kind === "category" && typeof value?.categoryName === "string" && value.categoryName) return { categoryName: value.categoryName };
    if (kind === "split" && typeof value?.payerPersonId === "string" && Number.isInteger(value.payerShareBasisPoints)) {
      return { groupId: typeof value.groupId === "string" ? value.groupId : null, payerPersonId: value.payerPersonId, payerShareBasisPoints: value.payerShareBasisPoints };
    }
    if (kind === "alias" && typeof value?.personId === "string") return { personId: value.personId };
  } catch {
    // Unreadable value: no habit.
  }
  return null;
}

function toHabit(row: HabitRow): AskHabit | null {
  const value = readValue(row.kind, row.value_json);
  return value
    ? { id: askHabitId(row.kind, row.key), kind: row.kind, key: row.key, value, timesConfirmed: row.times_confirmed, timesOverridden: row.times_overridden, lastUsed: row.last_used, source: row.source }
    : null;
}

// The household's habits, most recently used first. `available: false`
// when the table does not exist yet (or cannot be read): callers treat that
// as the feature being off.
export async function loadAskHabits(db: D1Database): Promise<{ available: boolean; habits: AskHabit[] }> {
  try {
    const result = await db
      .prepare(`
        SELECT kind, key, value_json, times_confirmed, times_overridden, last_used, source
        FROM ask_habits
        WHERE household_id = ?
        ORDER BY last_used DESC, key
        LIMIT ${MAX_HABITS}
      `)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<HabitRow>();
    return { available: true, habits: result.results.map(toHabit).filter((habit): habit is AskHabit => habit !== null) };
  } catch {
    return { available: false, habits: [] };
  }
}

export async function loadAskHabit(db: D1Database, kind: AskHabitKind, key: string): Promise<AskHabit | null> {
  const { habits } = await loadAskHabits(db);
  return habits.find((habit) => habit.kind === kind && habit.key === key) ?? null;
}

// The upsert a confirmation runs: the same value counts one more consistent
// confirmation; a different value replaces the old one, counts as an
// override of it and starts again at one (confirmHabit in ask-habits.ts).
function confirmationStatement(db: D1Database, kind: AskHabitKind, key: string, valueJson: string, source: AskHabitSource) {
  return db
    .prepare(`
      INSERT INTO ask_habits (household_id, kind, key, value_json, times_confirmed, times_overridden, last_used, source)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?)
      ON CONFLICT (household_id, kind, key) DO UPDATE SET
        times_confirmed = CASE WHEN ask_habits.value_json = excluded.value_json THEN ask_habits.times_confirmed + 1 ELSE 1 END,
        times_overridden = CASE WHEN ask_habits.value_json = excluded.value_json THEN ask_habits.times_overridden ELSE ask_habits.times_overridden + 1 END,
        value_json = excluded.value_json,
        last_used = excluded.last_used,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, kind, key, valueJson, todayInAppTimeZone(), source);
}

async function confirmHabitValue(db: D1Database, kind: AskHabitKind, key: string, value: AskHabitValue, source: AskHabitSource) {
  if (!key) return;
  try {
    await confirmationStatement(db, kind, key, canonicalHabitValue(kind, value), source).run();
    await pruneHabits(db);
  } catch {
    // No table yet, or a transient failure: learning is best effort.
  }
}

async function pruneHabits(db: D1Database) {
  await db
    .prepare(`
      DELETE FROM ask_habits
      WHERE household_id = ? AND rowid IN (
        SELECT rowid FROM ask_habits WHERE household_id = ?
        ORDER BY last_used DESC, key LIMIT -1 OFFSET ${MAX_HABITS}
      )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .run();
}

// The person set this shop's category (Entries, an Ask change, a new entry's
// own category): one more confirmation, or an override if it differs.
export async function learnCategoryHabit(db: D1Database, input: { description: string; categoryName: string; source: AskHabitSource }) {
  const categoryName = input.categoryName.trim();
  if (!categoryName || ASK_CATCH_ALL_CATEGORIES.has(categoryName)) return;
  await confirmHabitValue(db, "category", habitMerchantKey(input.description), { categoryName } satisfies AskCategoryHabitValue, input.source);
}

// The same, for a saved entry (its shop is read from the entry).
export async function learnCategoryHabitForEntry(db: D1Database, input: { entryId: string; categoryName: string; source: AskHabitSource }) {
  try {
    const entry = await db
      .prepare("SELECT description FROM transactions WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
      .first<{ description: string }>();
    if (entry) await learnCategoryHabit(db, { description: entry.description, categoryName: input.categoryName, source: input.source });
  } catch {
    // Best effort.
  }
}

// The person added an entry to Splits: the shop's usual split. Reads the
// entry for its shop and payer; `firstPersonBasisPoints` is what the split
// command was given (the household's first person's share).
export async function learnSplitHabitFromEntry(
  db: D1Database,
  input: { entryId: string; splitGroupId: string | null; firstPersonBasisPoints: number; source: AskHabitSource }
) {
  try {
    const entry = await db
      .prepare(`
        SELECT transactions.description, COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS payer_id
        FROM transactions
        INNER JOIN accounts ON accounts.id = transactions.account_id
        WHERE transactions.household_id = ? AND transactions.id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
      .first<{ description: string; payer_id: string | null }>();
    if (!entry?.payer_id) return;
    const people = await db
      .prepare(`
        SELECT id FROM people WHERE household_id = ?
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id
      `)
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ id: string }>();
    const first = people.results[0]?.id;
    if (!first || !people.results.slice(0, 2).some((person) => person.id === entry.payer_id)) return;
    const payerShareBasisPoints = entry.payer_id === first ? input.firstPersonBasisPoints : 10_000 - input.firstPersonBasisPoints;
    const groupId = input.splitGroupId && input.splitGroupId !== "split-group-none" ? input.splitGroupId : null;
    await confirmHabitValue(db, "split", habitMerchantKey(entry.description), { groupId, payerPersonId: entry.payer_id, payerShareBasisPoints } satisfies AskSplitHabitValue, input.source);
  } catch {
    // Best effort.
  }
}

// A nickname the person confirmed in an Ask clarification.
export async function learnAliasHabit(db: D1Database, input: { alias: string; personId: string }) {
  const key = habitAliasKey(input.alias);
  if (!key) return;
  const person = await db
    .prepare("SELECT display_name FROM people WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.personId)
    .first<{ display_name: string }>()
    .catch(() => null);
  // A person's own name or first word is not a nickname.
  if (!person || person.display_name.toLowerCase().split(/\s+/).includes(key)) return;
  await confirmHabitValue(db, "alias", key, { personId: input.personId } satisfies AskAliasHabitValue, "ask");
}

// The person undid what Ask did, or declined its suggestion: confidence for
// this habit starts again from nothing. Best effort like learning.
export async function recordHabitOverride(db: D1Database, kind: AskHabitKind, key: string) {
  try {
    await db
      .prepare(`
        UPDATE ask_habits
        SET times_confirmed = 0, times_overridden = times_overridden + 1, source = 'undo', updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND kind = ? AND key = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, kind, key)
      .run();
  } catch {
    // Best effort.
  }
}

// ---- Commands the person runs on habits (all-or-nothing, audited) ---------

async function assertHabitExists(db: D1Database, id: string) {
  const separator = id.indexOf(":");
  const kind = id.slice(0, separator) as AskHabitKind;
  const key = id.slice(separator + 1);
  if (separator < 1 || !key || !["category", "split", "alias"].includes(kind)) {
    throw new Error("That habit was not found.");
  }
  const habit = await loadAskHabit(db, kind, key);
  if (!habit) {
    throw new Error("That habit was not found.");
  }
  return habit;
}

// "Stop doing this" and Settings' delete: the habit is gone and Ask will
// not suggest or apply it again until it is learned afresh.
export async function deleteAskHabit(db: D1Database, input: { id: string }) {
  const habit = await assertHabitExists(db, input.id);
  await db.batch([
    db.prepare("DELETE FROM ask_habits WHERE household_id = ? AND kind = ? AND key = ?").bind(DEFAULT_HOUSEHOLD_ID, habit.kind, habit.key),
    buildAuditEventStatement(db, { entityType: "settings", entityId: "ask_habits", action: "ask_habit_deleted", detail: `Ask forgot the ${habit.kind} habit for ${habit.key}.` })
  ]);
  return { deleted: true as const, id: habit.id };
}

export async function forgetAllAskHabits(db: D1Database) {
  const { habits } = await loadAskHabits(db);
  await db.batch([
    db.prepare("DELETE FROM ask_habits WHERE household_id = ?").bind(DEFAULT_HOUSEHOLD_ID),
    buildAuditEventStatement(db, { entityType: "settings", entityId: "ask_habits", action: "ask_habits_forgotten", detail: `Ask forgot everything it remembered (${habits.length} habits).` })
  ]);
  return { forgotten: habits.length };
}

// Settings' edit: the person chooses what this shop should be. The edit is
// their own word, so the habit starts at the confidence bar (3 confirmations):
// Ask uses it at once, until they do something else.
export async function updateAskHabit(
  db: D1Database,
  input: { id: string; categoryName?: string; payerShareBasisPoints?: number; personId?: string }
) {
  const habit = await assertHabitExists(db, input.id);
  let value: AskHabitValue;
  if (habit.kind === "category") {
    const categoryName = (input.categoryName ?? "").trim();
    const category = categoryName
      ? await db.prepare("SELECT name FROM categories WHERE household_id = ? AND name = ?").bind(DEFAULT_HOUSEHOLD_ID, categoryName).first<{ name: string }>()
      : null;
    if (!category) throw new Error("Choose one of your categories.");
    value = { categoryName: category.name };
  } else if (habit.kind === "split") {
    const share = input.payerShareBasisPoints;
    if (share === undefined || !Number.isInteger(share) || share < 0 || share > 10_000) throw new Error("Choose a share between 0% and 100%.");
    value = { ...(habit.value as AskSplitHabitValue), payerShareBasisPoints: share };
  } else {
    const person = input.personId
      ? await db.prepare("SELECT id FROM people WHERE household_id = ? AND id = ?").bind(DEFAULT_HOUSEHOLD_ID, input.personId).first<{ id: string }>()
      : null;
    if (!person) throw new Error("Choose a person in this household.");
    value = { personId: person.id };
  }
  await db.batch([
    db
      .prepare(`
        UPDATE ask_habits
        SET value_json = ?, times_confirmed = MAX(times_confirmed, 3), source = 'settings', last_used = ?, updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND kind = ? AND key = ?
      `)
      .bind(canonicalHabitValue(habit.kind, value), todayInAppTimeZone(), DEFAULT_HOUSEHOLD_ID, habit.kind, habit.key),
    buildAuditEventStatement(db, { entityType: "settings", entityId: "ask_habits", action: "ask_habit_updated", detail: `Ask's ${habit.kind} habit for ${habit.key} was changed in Settings.` })
  ]);
  return { updated: true as const, id: habit.id };
}

// ---- "Let Ask handle safe things" ----------------------------------------

// Default ON (owner decision, 2026-10-14): an absent or unreadable setting
// reads as on. Every auto action is still gated and logged.
export async function loadAskHandlesSafeThings(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .bind(ASK_HANDLES_SAFE_SETTING_KEY)
      .first<{ value_json: string }>();
    return row ? JSON.parse(row.value_json)?.enabled !== false : true;
  } catch {
    return true;
  }
}

export async function saveAskHandlesSafeThings(db: D1Database, input: { enabled: boolean }) {
  await ensureAppSettingsTable(db);
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
      `)
      .bind(ASK_HANDLES_SAFE_SETTING_KEY, JSON.stringify({ enabled: input.enabled })),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: ASK_HANDLES_SAFE_SETTING_KEY,
      action: "ask_handles_safe_things_updated",
      detail: input.enabled ? "Ask may handle safe things by itself." : "Ask no longer handles anything by itself."
    })
  ]);
  return { enabled: input.enabled };
}
