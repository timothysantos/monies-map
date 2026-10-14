// What Ask does by itself, and the "Done for you" log (DOMAIN.md "Done for
// you"; AGENTS.md "AI in Ask"; docs/flows/ask-flow.md "Hands-off").
//
// Ask may apply only the safe set without the person's Save: set a new
// entry's category to the habitual one, add a note from the person's own
// words, add a new entry to Splits with the habitual split. Every one is
// gated by autoApplyRefusal (the setting is on, the entry is new, hand-made
// or from Apple Pay, not imported, not certified, one entry, a
// high-confidence habit), runs through the existing command, and is written
// to the log (an audit event, entity "ask_auto") that Ask lists for 30 days
// with Undo. Undo uses the existing commands too, and counts as an override
// of the habit.
//
// Nothing here throws to its caller: a refused or failed auto action is
// simply not done, and the entry is left as it was.

import { autoApplyRefusal, type AskSafeAction } from "../domain/ask-habits";
import {
  planEntryHabits,
  shareLabel,
  type HabitEntryFacts,
  type HabitPlan
} from "../domain/ask-habit-plan";
import { DEFAULT_HOUSEHOLD_ID } from "../domain/app-repository-constants";
import { recordAuditEvent } from "../domain/app-repository-audit";
import { updateEntryCategoryRecord, updateEntryNoteRecord } from "../domain/app-repository-entry-commands";
import { createSplitExpenseFromEntryRecord, deleteSplitExpenseRecord } from "../domain/app-repository-splits";
import {
  loadAskHabits,
  loadAskHandlesSafeThings,
  recordHabitOverride
} from "../domain/app-repository-ask-habits";
import { loadSharePeople } from "../domain/pages/split-suggestion";
import { todayInAppTimeZone } from "../lib/app-calendar";

export const DONE_FOR_YOU_DAYS = 30;
const APPLIED_ACTION = "ask_auto_applied";
const UNDONE_ACTION = "ask_auto_undone";
const LOG_ENTITY = "ask_auto";

export type DoneKind = "category" | "split" | "note";

export interface DoneForYouItem {
  id: string;
  kind: DoneKind;
  entryId: string;
  entryDescription: string;
  // "Food & Drinks", "Added to splits 50/50 with Joyce", "Note added".
  summary: string;
  // The habit this followed ("" for a note): "Stop doing this" deletes it.
  habitId: string;
  // What changed, for the page to patch its card: a category's before and
  // after, the split an add to splits created.
  from: string | null;
  to: string | null;
  splitExpenseId: string | null;
  at: string;
  undone: boolean;
}

interface LogDetail {
  doneId: string;
  kind: DoneKind;
  entryId: string;
  description: string;
  summary: string;
  from?: string | null;
  to?: string | null;
  splitExpenseId?: string;
  habitId?: string;
}

interface EntryRow {
  id: string;
  description: string;
  entry_type: string;
  currency: string;
  import_id: string | null;
  bank_certification_status: string;
  created_at: string;
  external_reference: string | null;
  note: string | null;
  category_name: string | null;
  payer_id: string | null;
  on_splits: number;
}

async function loadEntry(db: D1Database, entryId: string) {
  return db
    .prepare(`
      SELECT
        transactions.id, transactions.description, transactions.entry_type, transactions.currency,
        transactions.import_id, transactions.bank_certification_status, transactions.created_at,
        transactions.external_reference, transactions.note,
        categories.name AS category_name,
        COALESCE(transactions.owner_person_id, accounts.owner_person_id) AS payer_id,
        EXISTS (
          SELECT 1 FROM split_expenses
          WHERE split_expenses.household_id = transactions.household_id
            AND split_expenses.linked_transaction_id = transactions.id
            AND split_expenses.deleted_at IS NULL
        ) AS on_splits
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<EntryRow>();
}

function toFacts(row: EntryRow): HabitEntryFacts {
  return {
    id: row.id,
    description: row.description,
    entryType: row.entry_type,
    currency: (row.currency || "SGD").toUpperCase(),
    categoryName: row.category_name,
    payerPersonId: row.payer_id,
    onSplits: Boolean(row.on_splits)
  };
}

// The habits' plan for one entry, or null when habits are unavailable or
// the entry is not found. Read only.
export async function loadEntryHabitPlan(db: D1Database, entryId: string): Promise<{ plan: HabitPlan; row: EntryRow } | null> {
  const row = await loadEntry(db, entryId);
  if (!row) return null;
  const { available, habits } = await loadAskHabits(db);
  if (!available || !habits.length) return { plan: { category: null, split: null }, row };
  const [categories, groups, sharePeople] = await Promise.all([
    db.prepare("SELECT name FROM categories WHERE household_id = ?").bind(DEFAULT_HOUSEHOLD_ID).all<{ name: string }>(),
    db.prepare("SELECT id, group_name, currency FROM split_groups WHERE household_id = ?").bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; group_name: string; currency: string | null }>(),
    loadSharePeople(db)
  ]);
  return {
    row,
    plan: planEntryHabits({
      entry: toFacts(row),
      habits,
      categoryNames: categories.results.map((category) => category.name),
      sharePeople,
      groups: groups.results.map((group) => ({ id: group.id, name: group.group_name, currency: (group.currency || "SGD").toUpperCase() })),
      today: todayInAppTimeZone()
    })
  };
}

// Whether the log already holds an auto action of this kind for this entry,
// done or undone: Ask never does the same thing to an entry twice, so an
// Undo is final.
async function alreadyHandled(db: D1Database, entryId: string, kind: DoneKind) {
  const row = await db
    .prepare(`
      SELECT 1 AS found FROM audit_events
      WHERE household_id = ? AND entity_type = ? AND action = ? AND entity_id = ?
        AND json_valid(detail) AND json_extract(detail, '$.kind') = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, LOG_ENTITY, APPLIED_ACTION, entryId, kind)
    .first();
  return Boolean(row);
}

function toItem(row: { entity_id: string; detail: string; created_at: string }, undoneIds: Set<string>): DoneForYouItem | null {
  try {
    const detail = JSON.parse(row.detail) as LogDetail;
    if (!detail.doneId || !["category", "split", "note"].includes(detail.kind)) return null;
    return {
      id: detail.doneId,
      kind: detail.kind,
      entryId: detail.entryId,
      entryDescription: detail.description,
      summary: detail.summary,
      habitId: detail.habitId ?? "",
      from: detail.kind === "note" ? null : detail.from ?? null,
      to: detail.kind === "note" ? null : detail.to ?? null,
      splitExpenseId: detail.splitExpenseId ?? null,
      at: `${row.created_at.replace(" ", "T")}Z`,
      undone: undoneIds.has(detail.doneId)
    };
  } catch {
    return null;
  }
}

// The log for the last 30 days, newest first.
export async function loadDoneForYou(db: D1Database): Promise<DoneForYouItem[]> {
  try {
    const events = await db
      .prepare(`
        SELECT action, entity_id, detail, created_at FROM audit_events
        WHERE household_id = ? AND entity_type = ? AND action IN (?, ?)
          AND created_at >= datetime('now', ?)
          AND json_valid(detail)
        ORDER BY created_at DESC, rowid DESC
        LIMIT 100
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, LOG_ENTITY, APPLIED_ACTION, UNDONE_ACTION, `-${DONE_FOR_YOU_DAYS} days`)
      .all<{ action: string; entity_id: string; detail: string; created_at: string }>();
    const undoneIds = new Set<string>();
    for (const event of events.results) {
      if (event.action === UNDONE_ACTION) {
        try { undoneIds.add((JSON.parse(event.detail) as { doneId: string }).doneId); } catch { /* skip */ }
      }
    }
    return events.results
      .filter((event) => event.action === APPLIED_ACTION)
      .map((event) => toItem(event, undoneIds))
      .filter((item): item is DoneForYouItem => item !== null);
  } catch {
    return [];
  }
}

function newDoneId() {
  return `done-${crypto.randomUUID()}`;
}

async function writeLog(db: D1Database, detail: LogDetail) {
  await recordAuditEvent(db, { entityType: LOG_ENTITY, entityId: detail.entryId, action: APPLIED_ACTION, detail: JSON.stringify(detail) });
}

// Applies what the habits say about a new entry, within the safe set and
// only when every gate holds. Returns what was done (empty when nothing).
export async function applyHabitsToNewEntry(
  db: D1Database,
  entryId: string,
  options: { applePay?: boolean; now?: Date } = {}
): Promise<DoneForYouItem[]> {
  const now = options.now ?? new Date();
  const done: DoneForYouItem[] = [];
  try {
    if (!(await loadAskHandlesSafeThings(db))) return done;
    const loaded = await loadEntryHabitPlan(db, entryId);
    if (!loaded || (!loaded.plan.category && !loaded.plan.split)) return done;
    const { plan, row } = loaded;
    const entry = {
      importId: row.import_id,
      bankCertificationStatus: row.bank_certification_status,
      createdAt: row.created_at,
      entryType: row.entry_type
    };
    const gate = (action: AskSafeAction, confidence: "high" | "suggest") => autoApplyRefusal({ settingOn: true, action, entryCount: 1, entry, confidence, now }) === null;

    // The category is the Apple Pay entry's default (from the rules): a
    // hand-made entry's category is the person's own choice, never replaced.
    const fromApplePay = options.applePay === true || (row.external_reference ?? "").startsWith("shortcut:");
    if (plan.category && fromApplePay && gate("set_category", plan.category.confidence) && !(await alreadyHandled(db, entryId, "category"))) {
      const part = plan.category;
      await updateEntryCategoryRecord(db, { entryId, categoryName: part.to });
      const detail: LogDetail = { doneId: newDoneId(), kind: "category", entryId, description: row.description, summary: `Category set to ${part.to}`, from: part.from, to: part.to, habitId: part.habitId };
      done.push(await logOrRevert(db, detail, async () => {
        if (part.from) await updateEntryCategoryRecord(db, { entryId, categoryName: part.from });
      }));
    }

    if (plan.split && gate("add_to_splits", plan.split.confidence) && !(await alreadyHandled(db, entryId, "split"))) {
      const part = plan.split;
      const result = await createSplitExpenseFromEntryRecord(db, {
        entryId,
        splitGroupId: part.groupId,
        splitBasisPoints: part.firstPersonBasisPoints
      });
      const where = part.groupName ? ` in ${part.groupName}` : "";
      const detail: LogDetail = {
        doneId: newDoneId(), kind: "split", entryId, description: row.description,
        summary: `Added to splits ${shareLabel(part.payerShareBasisPoints)} with ${part.otherPersonName}${where}`,
        splitExpenseId: result.splitExpenseId, habitId: part.habitId
      };
      done.push(await logOrRevert(db, detail, async () => { await deleteSplitExpenseRecord(db, { splitExpenseId: result.splitExpenseId }); }));
    }
  } catch {
    // A refused or failed auto action is simply not done.
  }
  return done.filter(Boolean);
}

// The log row commits after the change. If it cannot be written the change
// is reversed at once: Ask never changes data it cannot list and undo.
async function logOrRevert(db: D1Database, detail: LogDetail, revert: () => Promise<void>): Promise<DoneForYouItem> {
  try {
    await writeLog(db, detail);
  } catch (error) {
    await revert().catch(() => undefined);
    throw error;
  }
  return { id: detail.doneId, kind: detail.kind, entryId: detail.entryId, entryDescription: detail.description, summary: detail.summary, habitId: detail.habitId ?? "", from: detail.kind === "note" ? null : detail.from ?? null, to: detail.kind === "note" ? null : detail.to ?? null, splitExpenseId: detail.splitExpenseId ?? null, at: new Date().toISOString(), undone: false };
}

// A note from the person's own words, on a new entry (the one auto action
// that is not a habit). The caller has already checked the note is theirs.
export async function applyNoteToNewEntry(
  db: D1Database,
  input: { entryId: string; note: string; now?: Date }
): Promise<DoneForYouItem | null> {
  try {
    if (!(await loadAskHandlesSafeThings(db))) return null;
    const row = await loadEntry(db, input.entryId);
    const note = input.note.trim();
    if (!row || !note) return null;
    const refusal = autoApplyRefusal({
      settingOn: true,
      action: "add_note",
      entryCount: 1,
      entry: { importId: row.import_id, bankCertificationStatus: row.bank_certification_status, createdAt: row.created_at, entryType: row.entry_type },
      confidence: "none",
      now: input.now ?? new Date()
    });
    if (refusal) return null;
    const previous = row.note ?? "";
    await updateEntryNoteRecord(db, { entryId: input.entryId, note });
    const detail: LogDetail = { doneId: newDoneId(), kind: "note", entryId: input.entryId, description: row.description, summary: "Note added", from: previous, to: note };
    return await logOrRevert(db, detail, async () => { await updateEntryNoteRecord(db, { entryId: input.entryId, note: previous }); });
  } catch {
    return null;
  }
}

export class UndoRefused extends Error {}

// Undo for one "Done for you" line, through the existing commands. It
// counts as an override: the habit it followed starts again from nothing.
export async function undoDoneForYou(db: D1Database, doneId: string): Promise<{ undone: true; id: string }> {
  const applied = await db
    .prepare(`
      SELECT entity_id, detail FROM audit_events
      WHERE household_id = ? AND entity_type = ? AND action = ? AND json_valid(detail) AND json_extract(detail, '$.doneId') = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, LOG_ENTITY, APPLIED_ACTION, doneId)
    .first<{ entity_id: string; detail: string }>();
  if (!applied) throw new UndoRefused("That action was not found.");
  const alreadyUndone = await db
    .prepare(`
      SELECT 1 AS found FROM audit_events
      WHERE household_id = ? AND entity_type = ? AND action = ? AND json_valid(detail) AND json_extract(detail, '$.doneId') = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, LOG_ENTITY, UNDONE_ACTION, doneId)
    .first();
  if (alreadyUndone) throw new UndoRefused("That was already undone.");

  const detail = JSON.parse(applied.detail) as LogDetail;
  const entry = await loadEntry(db, detail.entryId);
  if (detail.kind === "category") {
    if (!entry) throw new UndoRefused("That entry no longer exists.");
    if (entry.category_name !== detail.to) throw new UndoRefused("This entry's category was changed since, so there is nothing to undo.");
    if (!detail.from) throw new UndoRefused("The earlier category is not known, so change it on the entry instead.");
    await updateEntryCategoryRecord(db, { entryId: detail.entryId, categoryName: detail.from });
  } else if (detail.kind === "split") {
    const split = detail.splitExpenseId
      ? await db.prepare("SELECT deleted_at FROM split_expenses WHERE household_id = ? AND id = ?").bind(DEFAULT_HOUSEHOLD_ID, detail.splitExpenseId).first<{ deleted_at: string | null }>()
      : null;
    if (split && !split.deleted_at) {
      await deleteSplitExpenseRecord(db, { splitExpenseId: detail.splitExpenseId as string });
    }
  } else {
    if (!entry) throw new UndoRefused("That entry no longer exists.");
    if ((entry.note ?? "") !== (detail.to ?? "")) throw new UndoRefused("This entry's note was changed since, so there is nothing to undo.");
    await updateEntryNoteRecord(db, { entryId: detail.entryId, note: detail.from ?? "" });
  }
  await recordAuditEvent(db, { entityType: LOG_ENTITY, entityId: detail.entryId, action: UNDONE_ACTION, detail: JSON.stringify({ doneId, kind: detail.kind, entryId: detail.entryId }) });
  if (detail.habitId) {
    const separator = detail.habitId.indexOf(":");
    await recordHabitOverride(db, detail.habitId.slice(0, separator) as "category" | "split" | "alias", detail.habitId.slice(separator + 1));
  }
  return { undone: true, id: doneId };
}
