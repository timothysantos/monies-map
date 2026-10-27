// Split Correction commands (DOMAIN.md "Split Correction",
// docs/proposals/settled-correction.md): fix a mistake found inside a settled
// period without undoing the settle-up.
//
// A correction is a `split_settlements` row in the group's open batch that
// carries `correction_source_id` (the expense whose settled effect it corrects)
// and `correction_reason` (its plain-words label). It runs from the person who
// was charged too much to the person who was paid too much, for exactly the
// share the settled period over-charged, so every balance reader that already
// counts payments (the Splits balance, Ask, the next settle-up, Settle group)
// counts it, and every reader that adds up spending (the chip, the donut, the
// fun facts) leaves it out because it is not an expense.
//
// The amount and the parties are never typed: the server works them out from
// the same facts the Ledger check-up's settled-period detector reads, and
// refuses anything that detector does not report.
//
// Commands are all-or-nothing (Persistence Atomicity Contract): everything is
// read and checked first, then the correction, its history event, its audit
// event (and, with `alsoRemoveDuplicate`, the archive of the extra copy and
// its month markers) commit in one `db.batch()` behind a guard that fails the
// whole batch when a correction for the same expense appeared meanwhile.
import { buildAuditEventStatement } from "./app-repository-audit";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { newSplitRecordId } from "./app-repository-helpers";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import { planActiveSplitBatch } from "./app-repository-split-batches";
import { loadSplitPairFacts } from "./ledger-checkup/loader";
import { planSettledCorrections, type SettledCorrectionPlan } from "./ledger-checkup/split-duplicates";
import { assertSplitSettlementUnchanged, findSplitSettlementLock } from "./split-settlement-lock";
import { todayInAppTimeZone } from "../lib/app-calendar";

export type SplitCorrectionRefusal =
  | "correction_not_found"
  | "correction_not_flagged"
  | "correction_not_settled"
  | "correction_exists";

export class SplitCorrectionError extends Error {
  readonly code: SplitCorrectionRefusal;

  constructor(code: SplitCorrectionRefusal, message: string) {
    super(message);
    this.name = "SplitCorrectionError";
    this.code = code;
  }
}

export const SPLIT_CORRECTION_REASON_MAX_LENGTH = 120;
export const SPLIT_CORRECTION_EDIT_REFUSAL = "A correction cannot be edited. Undo it and add it again.";
export const SPLIT_CORRECTION_DELETE_REFUSAL = "A correction is removed with Undo correction.";
export const SPLIT_CORRECTION_RESTORE_REFUSAL = "An undone correction is added again from the check-up, not restored.";

// What the dialog shows before anything is saved.
export interface SplitCorrectionPreview {
  sourceRecordId: string;
  amountMinor: number;
  currency: string;
  groupId: string | null;
  groupName: string | null;
  sourceDescription: string;
  sourceDate: string;
  sourceAmountMinor: number;
  settledOn: string;
  overchargedPersonId: string;
  overchargedPersonName: string;
  overpaidPersonId: string;
  overpaidPersonName: string;
  sourceStillLive: boolean;
  label: string;
}

export type SplitCorrectionPlanResult =
  | { eligible: true; plan: SplitCorrectionPreview }
  | { eligible: false; code: SplitCorrectionRefusal; reason: string };

const REFUSAL_TEXT: Record<SplitCorrectionRefusal, string> = {
  correction_not_found: "That shared cost was not found.",
  correction_not_flagged: "The check-up has not found a settled mistake here, so there is nothing to correct.",
  correction_not_settled: "This shared cost is not in a settle-up yet. Edit or remove it in Splits instead.",
  correction_exists: "A correction for this is already in the activity list."
};

function refusal(code: SplitCorrectionRefusal): SplitCorrectionPlanResult {
  return { eligible: false, code, reason: REFUSAL_TEXT[code] };
}

function preview(plan: SettledCorrectionPlan, people: ReadonlyMap<string, string>): SplitCorrectionPreview {
  return {
    sourceRecordId: plan.sourceRecordId,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    groupId: plan.groupId,
    groupName: plan.groupName,
    sourceDescription: plan.sourceDescription,
    sourceDate: plan.sourceDate,
    sourceAmountMinor: plan.sourceAmountMinor,
    settledOn: plan.settledBy.date,
    overchargedPersonId: plan.overchargedPersonId,
    overchargedPersonName: people.get(plan.overchargedPersonId) ?? "Someone",
    overpaidPersonId: plan.overpaidPersonId,
    overpaidPersonName: people.get(plan.overpaidPersonId) ?? "Someone",
    sourceStillLive: plan.sourceStillLive,
    label: plan.label
  };
}

// What a correction for this expense would record, or why none can be.
// Reads only.
export async function planSplitCorrection(db: D1Database, sourceRecordId: string): Promise<SplitCorrectionPlanResult> {
  const { facts, context } = await loadSplitPairFacts(db);
  const plan = planSettledCorrections(facts, context).get(sourceRecordId);
  if (plan) {
    return { eligible: true, plan: preview(plan, context.people) };
  }
  if ((facts.correctedSourceIds ?? []).includes(sourceRecordId)) {
    return refusal("correction_exists");
  }
  const source = await db
    .prepare("SELECT id FROM split_expenses WHERE id = ? AND household_id = ?")
    .bind(sourceRecordId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();
  if (!source) {
    return refusal("correction_not_found");
  }
  return refusal((await findSplitSettlementLock(db, "expense", sourceRecordId)) ? "correction_not_flagged" : "correction_not_settled");
}

// A guard that fails the batch when `staleSql` (a SELECT of an `id` column)
// finds a row: the id is parsed as JSON text that is never valid.
function guard(db: D1Database, staleSql: string, ...params: unknown[]) {
  return db.prepare(`SELECT json('{' || id) AS stale FROM (${staleSql})`).bind(...params);
}

function historyStatement(db: D1Database, input: {
  recordKind: "expense" | "settlement";
  recordId: string;
  action: "created" | "deleted";
  groupId: string | null;
  groupName: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  detail?: string;
}) {
  return db.prepare(`INSERT INTO split_activity_history
    (id, household_id, record_kind, record_id, action, group_id, group_name, description, amount_minor, currency, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newSplitRecordId("split-history"), DEFAULT_HOUSEHOLD_ID, input.recordKind, input.recordId, input.action, input.groupId, input.groupName,
      input.description, input.amountMinor, input.currency, input.detail ?? null);
}

async function linkedEntryMonths(db: D1Database, splitExpenseId: string) {
  const entry = await db
    .prepare(`
      SELECT transactions.transaction_date
      FROM split_expenses
      INNER JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      WHERE split_expenses.id = ? AND split_expenses.household_id = ?
    `)
    .bind(splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ transaction_date: string }>();
  return entry ? [entry.transaction_date.slice(0, 7)] : [];
}

function cleanReason(reason: unknown) {
  const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  return text.slice(0, SPLIT_CORRECTION_REASON_MAX_LENGTH);
}

export async function createSplitCorrection(
  db: D1Database,
  input: { sourceRecordId: string; alsoRemoveDuplicate?: boolean; reason?: string }
) {
  const result = await planSplitCorrection(db, input.sourceRecordId);
  if (!result.eligible) {
    throw new SplitCorrectionError(result.code, result.reason);
  }
  const { plan } = result;
  const typedReason = cleanReason(input.reason);
  const label = typedReason ? `Correction: ${typedReason}` : plan.label;
  const removeDuplicate = Boolean(input.alsoRemoveDuplicate) && plan.sourceStillLive;
  const today = todayInAppTimeZone();
  const months = removeDuplicate ? await linkedEntryMonths(db, plan.sourceRecordId) : [];
  const correctionId = newSplitRecordId("split-correction");
  // The open batch the correction joins: it is open activity until the next
  // settle-up closes the batch (or a simplified settlement includes it).
  const batch = await planActiveSplitBatch(db, { groupId: plan.groupId, date: today });

  try {
    await db.batch([
    // A correction for this expense appeared meanwhile: change nothing.
    guard(db, "SELECT id FROM split_settlements WHERE correction_source_id = ? AND deleted_at IS NULL", plan.sourceRecordId),
    ...(removeDuplicate
      ? [guard(db, "SELECT id FROM split_expenses WHERE id = ? AND deleted_at IS NOT NULL", plan.sourceRecordId)]
      : []),
    ...batch.statements,
    db.prepare(`
      INSERT INTO split_settlements (
        id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
        settlement_date, amount_minor, currency, payment_method, payment_status,
        correction_source_id, correction_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'other', 'recorded', ?, ?)
    `).bind(correctionId, DEFAULT_HOUSEHOLD_ID, plan.groupId, batch.batchId, plan.overchargedPersonId, plan.overpaidPersonId,
      today, plan.amountMinor, plan.currency, plan.sourceRecordId, label),
    ...(removeDuplicate
      ? [
          // The extra copy goes to the activity history. It stays in the
          // settle-up's list of records: that list is a fixed manifest.
          db.prepare("UPDATE split_expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
            .bind(plan.sourceRecordId, DEFAULT_HOUSEHOLD_ID),
          historyStatement(db, {
            recordKind: "expense", recordId: plan.sourceRecordId, action: "deleted", groupId: plan.groupId, groupName: plan.groupName,
            description: plan.sourceDescription, amountMinor: plan.sourceAmountMinor, currency: plan.currency, detail: "removed with a correction"
          })
        ]
      : []),
    historyStatement(db, {
      recordKind: "settlement", recordId: correctionId, action: "created", groupId: plan.groupId, groupName: plan.groupName,
      description: label, amountMinor: plan.amountMinor, currency: plan.currency, detail: "correction"
    }),
    buildAuditEventStatement(db, {
      entityType: "split_correction",
      entityId: correctionId,
      action: "split_correction_created",
      detail: `Corrected the ${plan.settledOn} settle-up for ${plan.sourceRecordId}${removeDuplicate ? " and removed the extra copy" : ""}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
    ]);
  } catch (error) {
    // The guard turned the whole batch away: another request corrected this
    // expense first.
    const raced = await db
      .prepare("SELECT id FROM split_settlements WHERE correction_source_id = ? AND deleted_at IS NULL")
      .bind(plan.sourceRecordId)
      .first();
    if (raced) {
      throw new SplitCorrectionError("correction_exists", REFUSAL_TEXT.correction_exists);
    }
    throw error;
  }
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return {
    correctionId,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    label,
    duplicateRemoved: removeDuplicate
  };
}

// True for a settled-period correction record. Every command that edits,
// matches, deletes or restores a payment refuses one.
export async function isSplitCorrection(db: D1Database, settlementId: string) {
  const row = await db
    .prepare("SELECT correction_source_id FROM split_settlements WHERE id = ? AND household_id = ?")
    .bind(settlementId, DEFAULT_HOUSEHOLD_ID)
    .first<{ correction_source_id: string | null }>();
  return Boolean(row?.correction_source_id);
}

export async function assertNotSplitCorrection(db: D1Database, settlementId: string, message: string) {
  if (await isSplitCorrection(db, settlementId)) {
    throw new Error(message);
  }
}

// Undo correction: archives the correction while it is still in the open
// period. Once a settle-up covers it, the settlement lock refuses (the same
// "undo the settle-up first" as any settled record). The removed duplicate, if
// it was removed with the correction, stays in the activity history.
export async function undoSplitCorrection(db: D1Database, input: { correctionId: string }) {
  const existing = await db
    .prepare(`
      SELECT split_settlements.id, split_settlements.split_group_id, split_groups.group_name,
        split_settlements.amount_minor, split_settlements.currency, split_settlements.deleted_at,
        split_settlements.correction_source_id, split_settlements.correction_reason
      FROM split_settlements LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
      WHERE split_settlements.id = ? AND split_settlements.household_id = ?
    `)
    .bind(input.correctionId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; split_group_id: string | null; group_name: string | null; amount_minor: number; currency: string; deleted_at: string | null; correction_source_id: string | null; correction_reason: string | null }>();
  if (!existing || !existing.correction_source_id) {
    throw new SplitCorrectionError("correction_not_found", "That correction was not found.");
  }
  if (existing.deleted_at) {
    throw new Error("This correction is already undone.");
  }
  await assertSplitSettlementUnchanged(db, { recordKind: "settlement", recordId: existing.id, next: () => "deleted" });

  await db.batch([
    // Already undone meanwhile: change nothing.
    guard(db, "SELECT id FROM split_settlements WHERE id = ? AND household_id = ? AND deleted_at IS NOT NULL", existing.id, DEFAULT_HOUSEHOLD_ID),
    db.prepare("UPDATE split_settlements SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
      .bind(existing.id, DEFAULT_HOUSEHOLD_ID),
    historyStatement(db, {
      recordKind: "settlement", recordId: existing.id, action: "deleted", groupId: existing.split_group_id, groupName: existing.group_name,
      description: existing.correction_reason ?? "Correction", amountMinor: existing.amount_minor, currency: existing.currency, detail: "correction undone"
    }),
    buildAuditEventStatement(db, {
      entityType: "split_correction",
      entityId: existing.id,
      action: "split_correction_undone",
      detail: `Undid the correction for ${existing.correction_source_id}.`
    })
  ]);
  return { correctionId: existing.id, undone: true };
}
