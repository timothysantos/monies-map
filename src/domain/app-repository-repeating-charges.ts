import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import type { RepeatingChoice, RepeatingChoiceKind } from "./repeating-charges";

// The household's choices about Subscriptions and bills (DOMAIN.md
// "Repeating Charge", owner decision D3: one choice both people see): keep a
// charge on the list, take it off ("Not a subscription or bill"), show it
// again, or rename it. Each command reads first, then writes its row and its
// `repeating_charge_chosen` audit event in one db.batch(). Nothing here
// writes to entries, and no month total changes, so there are no month
// refresh markers. The table is additive: a reader tolerates it missing
// (no choices).

export const REPEATING_NAME_MAX = 40;
// A series key: the payee key (capitals, digits and spaces, as payeeKey
// writes it) and its period.
const SERIES_KEY = /^[A-Z0-9][A-Z0-9 ]{0,119}\|(monthly|yearly)$/;

export type RepeatingChoiceAction = "keep" | "take_off" | "show_again" | "rename" | "restore";
export const REPEATING_CHOICE_ACTIONS: readonly RepeatingChoiceAction[] = ["keep", "take_off", "show_again", "rename", "restore"];

export class RepeatingChoiceRefused extends Error {}

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message ?? error));

export async function loadRepeatingChoices(db: D1Database): Promise<Record<string, RepeatingChoice>> {
  try {
    const result = await db.prepare("SELECT series_key, choice, display_name FROM repeating_charge_choices WHERE household_id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ series_key: string; choice: RepeatingChoiceKind | null; display_name: string | null }>();
    return Object.fromEntries(result.results.map((row) => [row.series_key, { choice: row.choice, displayName: row.display_name }]));
  } catch (error) {
    if (isMissingTable(error)) {
      return {};
    }
    throw error;
  }
}

// The payee keys the household said are not a subscription or bill: the
// price change reminder stays quiet about them.
export function notRepeatingPayeeKeys(choices: Record<string, RepeatingChoice>): Set<string> {
  return new Set(Object.entries(choices)
    .filter(([, value]) => value.choice === "not_repeating")
    .map(([key]) => key.slice(0, key.lastIndexOf("|"))));
}

function readName(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new RepeatingChoiceRefused("Give the name as words.");
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length > REPEATING_NAME_MAX) {
    throw new RepeatingChoiceRefused(`Keep the name to ${REPEATING_NAME_MAX} characters.`);
  }
  return name || null;
}

function nextState(current: RepeatingChoice, input: { action: RepeatingChoiceAction; displayName?: unknown; choice?: unknown }): RepeatingChoice {
  switch (input.action) {
    case "keep":
      return { ...current, choice: "kept" };
    case "take_off":
      return { ...current, choice: "not_repeating" };
    case "show_again":
      return { ...current, choice: null };
    case "rename":
      return { ...current, displayName: readName(input.displayName) };
    case "restore": {
      // Undo: back to the state a command reported as `previous`.
      const choice = input.choice === null || input.choice === undefined ? null : input.choice;
      if (choice !== null && choice !== "kept" && choice !== "not_repeating") {
        throw new RepeatingChoiceRefused("That choice is not one the list knows.");
      }
      return { choice: choice as RepeatingChoiceKind | null, displayName: readName(input.displayName) };
    }
    default:
      throw new RepeatingChoiceRefused("That is not a choice the list knows.");
  }
}

function describe(seriesKey: string, state: RepeatingChoice) {
  const payee = seriesKey.slice(0, seriesKey.lastIndexOf("|"));
  const what = state.choice === "kept" ? "kept on the list" : state.choice === "not_repeating" ? "taken off the list" : "shown as found";
  return `Subscriptions and bills: ${payee} ${what}${state.displayName ? `, named "${state.displayName}"` : ""}.`;
}

/**
 * Keep, take off, show again, rename or restore one series. Returns the
 * choice before (for Undo) and after.
 */
export async function chooseRepeatingCharge(
  db: D1Database,
  input: { seriesKey: unknown; action: unknown; displayName?: unknown; choice?: unknown; personId?: string | null }
): Promise<{ seriesKey: string; previous: RepeatingChoice; current: RepeatingChoice }> {
  const seriesKey = typeof input.seriesKey === "string" ? input.seriesKey : "";
  if (!SERIES_KEY.test(seriesKey)) {
    throw new RepeatingChoiceRefused("That charge was not found.");
  }
  if (!REPEATING_CHOICE_ACTIONS.includes(input.action as RepeatingChoiceAction)) {
    throw new RepeatingChoiceRefused("That is not a choice the list knows.");
  }
  const row = await db.prepare("SELECT choice, display_name FROM repeating_charge_choices WHERE household_id = ? AND series_key = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, seriesKey)
    .first<{ choice: RepeatingChoiceKind | null; display_name: string | null }>();
  const previous: RepeatingChoice = { choice: row?.choice ?? null, displayName: row?.display_name ?? null };
  const current = nextState(previous, { action: input.action as RepeatingChoiceAction, displayName: input.displayName, choice: input.choice });

  const write = current.choice === null && current.displayName === null
    ? db.prepare("DELETE FROM repeating_charge_choices WHERE household_id = ? AND series_key = ?").bind(DEFAULT_HOUSEHOLD_ID, seriesKey)
    : db.prepare(`
        INSERT INTO repeating_charge_choices (household_id, series_key, choice, display_name, updated_by_person_id, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (household_id, series_key) DO UPDATE SET
          choice = excluded.choice,
          display_name = excluded.display_name,
          updated_by_person_id = excluded.updated_by_person_id,
          updated_at = CURRENT_TIMESTAMP
      `).bind(DEFAULT_HOUSEHOLD_ID, seriesKey, current.choice, current.displayName, input.personId ?? null);
  await db.batch([
    write,
    buildAuditEventStatement(db, {
      entityType: "repeating_charge",
      entityId: seriesKey,
      action: "repeating_charge_chosen",
      detail: describe(seriesKey, current)
    })
  ]);
  return { seriesKey, previous, current };
}
