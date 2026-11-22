// Trip ledger import, part 3: applying a reviewed plan (and undoing it)
// through the app's existing commands only (docs/audits/trip-ledger-import.md).
//
// Not part of the Worker: scripts/trip-ledger-import.mjs runs it as the
// owner's local, authenticated tool against the D1 binding. Each step is one
// existing all-or-nothing command with its own audit event; this module adds
// one `trip_ledger_import` audit event per step it ran, keyed by the plan's
// import key, so the whole import can be read back and undone.
//
// Safety:
// - nothing runs unless the caller passes the plan's own hash and apply;
// - every step checks the live data first: a step already done is skipped
//   (re-running changes nothing), and a step whose entry changed since the
//   preview (another category or note, a new amount, a new entry that could
//   be the purchase) is refused, never forced;
// - a step that fails leaves its own command's writes out entirely; the
//   steps before it stay, and the next run carries on from there.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { recordAuditEvent } from "./app-repository-audit";
import { createEntryRecord, deleteEntryRecord, updateEntryCategoryRecord, updateEntryNoteRecord } from "./app-repository-entry-commands";
import { createSplitExpenseFromEntryRecord, createSplitExpenseRecord, createSplitGroupRecord, deleteSplitExpenseRecord } from "./app-repository-splits";
import { deleteTripEvent, saveTripEvent, setTripEventEntries, undoTripEventChange } from "./app-repository-trip-events";
import { hashTripLedgerPlan, type TripLedgerPlan, type TripLedgerRef, type TripLedgerStep } from "./trip-ledger-plan";

export const TRIP_LEDGER_AUDIT_ENTITY = "trip_ledger_import";

export type TripLedgerStepStatus = "done" | "already" | "would-run" | "refused" | "undone" | "would-undo" | "kept";

export interface TripLedgerStepReport {
  stepId: string;
  kind: string;
  status: TripLedgerStepStatus;
  detail: string;
  ids?: Record<string, unknown>;
}

interface StepRecord {
  stepId: string;
  kind: string;
  ids: Record<string, unknown>;
  undone?: boolean;
}

export class TripLedgerApplyRefusedError extends Error {}

// Reads the step records this import wrote, in the order they were written.
export async function loadTripLedgerStepRecords(db: D1Database, importKey: string) {
  const rows = await db
    .prepare("SELECT action, detail FROM audit_events WHERE household_id = ? AND entity_type = ? AND entity_id = ? ORDER BY created_at, rowid")
    .bind(DEFAULT_HOUSEHOLD_ID, TRIP_LEDGER_AUDIT_ENTITY, importKey)
    .all<{ action: string; detail: string }>();
  const records = new Map<string, StepRecord>();
  for (const row of rows.results) {
    const detail = JSON.parse(row.detail) as { stepId?: string; kind?: string; ids?: Record<string, unknown> };
    if (!detail.stepId) continue;
    if (row.action === "trip_ledger_step_undone") {
      const record = records.get(detail.stepId);
      if (record) record.undone = true;
      continue;
    }
    if (row.action === "trip_ledger_step") records.set(detail.stepId, { stepId: detail.stepId, kind: String(detail.kind), ids: detail.ids ?? {} });
  }
  return records;
}

export async function applyTripLedgerPlan(
  db: D1Database,
  plan: TripLedgerPlan,
  options: { expectedHash: string; apply: boolean }
): Promise<{ importKey: string; applied: boolean; steps: TripLedgerStepReport[] }> {
  const hash = await hashTripLedgerPlan(plan);
  if (!options.expectedHash || options.expectedHash !== hash) {
    throw new TripLedgerApplyRefusedError("The plan's hash does not match. Pass the hash the preview printed for this exact preview.json.");
  }
  if (plan.kind !== "trip-ledger-import" || plan.version !== 1) throw new TripLedgerApplyRefusedError("Not a trip ledger import plan.");
  if (plan.householdId !== DEFAULT_HOUSEHOLD_ID) throw new TripLedgerApplyRefusedError(`This plan is for ${plan.householdId}, not ${DEFAULT_HOUSEHOLD_ID}.`);

  const records = await loadTripLedgerStepRecords(db, plan.importKey);
  const reports: TripLedgerStepReport[] = [];
  const record = async (step: TripLedgerStep, ids: Record<string, unknown>) => {
    if (!options.apply) return;
    const prior = records.get(step.stepId);
    if (prior && !prior.undone) return;
    await recordAuditEvent(db, {
      entityType: TRIP_LEDGER_AUDIT_ENTITY,
      entityId: plan.importKey,
      action: "trip_ledger_step",
      detail: JSON.stringify({ importKey: plan.importKey, planHash: hash, stepId: step.stepId, kind: step.kind, lineId: "lineId" in step ? step.lineId : null, ids })
    });
    records.set(step.stepId, { stepId: step.stepId, kind: step.kind, ids });
  };
  const report = (step: TripLedgerStep, status: TripLedgerStepStatus, detail: string, ids?: Record<string, unknown>) => {
    reports.push({ stepId: step.stepId, kind: step.kind, status, detail, ...(ids ? { ids } : {}) });
  };

  const findGroupId = async (ref: TripLedgerRef | null) => {
    if (!ref) return null;
    if ("id" in ref) return ref.id;
    const row = await db.prepare("SELECT id FROM split_groups WHERE household_id = ? AND lower(group_name) = lower(?) ORDER BY created_at LIMIT 1").bind(DEFAULT_HOUSEHOLD_ID, ref.newName).first<{ id: string }>();
    return row?.id ?? null;
  };
  const findTripId = async (ref: TripLedgerRef) => {
    if ("id" in ref) return ref.id;
    const row = await db.prepare("SELECT id FROM trip_events WHERE household_id = ? AND lower(name) = lower(?) LIMIT 1").bind(DEFAULT_HOUSEHOLD_ID, ref.newName).first<{ id: string }>();
    return row?.id ?? null;
  };
  const entryByReference = (reference: string) => db
    .prepare("SELECT id FROM transactions WHERE household_id = ? AND external_reference = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, reference)
    .first<{ id: string }>();
  const liveEntry = (entryId: string) => db
    .prepare(`
      SELECT transactions.id, transactions.amount_minor, transactions.note, categories.name AS category_name,
        (SELECT split_expenses.id FROM split_expenses WHERE split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL LIMIT 1) AS split_expense_id
      FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{ id: string; amount_minor: number; note: string | null; category_name: string | null; split_expense_id: string | null }>();

  for (const step of plan.steps) {
    switch (step.kind) {
      case "create_split_group": {
        const existing = await findGroupId({ newName: step.name });
        if (existing) {
          await record(step, { splitGroupId: existing });
          report(step, "already", `Splits group "${step.name}" exists.`, { splitGroupId: existing });
          break;
        }
        if (!options.apply) { report(step, "would-run", `Make the Splits group "${step.name}" (${step.currency}).`); break; }
        const { groupId } = await createSplitGroupRecord(db, { name: step.name, currency: step.currency, expenseSource: "mixed" });
        await record(step, { splitGroupId: groupId });
        report(step, "done", `Made the Splits group "${step.name}".`, { splitGroupId: groupId });
        break;
      }
      case "create_trip": {
        const existing = await findTripId({ newName: step.name });
        if (existing) {
          await record(step, { tripEventId: existing, created: false });
          report(step, "already", `"${step.name}" exists.`, { tripEventId: existing });
          break;
        }
        if (!options.apply) { report(step, "would-run", `Make the trip "${step.name}".`); break; }
        const splitGroupId = await findGroupId(step.splitGroup);
        const { tripEvent } = await saveTripEvent(db, { name: step.name, iconKey: step.iconKey, startDate: step.startDate, endDate: step.endDate, currency: step.currency, splitGroupId });
        await record(step, { tripEventId: tripEvent.id, created: true });
        report(step, "done", `Made the trip "${step.name}".`, { tripEventId: tripEvent.id });
        break;
      }
      case "create_entry": {
        const existing = await entryByReference(step.externalReference);
        if (existing) {
          await record(step, { entryId: existing.id });
          report(step, "already", `Entry for ${step.description} exists.`, { entryId: existing.id });
          break;
        }
        // A purchase that reached Entries since the preview (an Apple Pay
        // tap that arrived late, an imported statement) would be doubled.
        const rival = await db
          .prepare(`
            SELECT transactions.id FROM transactions
            INNER JOIN accounts ON accounts.id = transactions.account_id
            WHERE transactions.household_id = ? AND transactions.account_id = ?
              AND transactions.entry_type = 'expense'
              AND transactions.transaction_date BETWEEN date(?, '-1 day') AND date(?, '+3 day')
              AND (transactions.external_reference IS NULL OR transactions.external_reference NOT LIKE 'trip-ledger:%')
              AND ((transactions.original_currency = ? AND transactions.original_amount_minor = ?)
                OR abs(transactions.amount_minor - ?) <= max(10, ? * 5 / 100))
            LIMIT 1
          `)
          .bind(DEFAULT_HOUSEHOLD_ID, step.accountId, step.date, step.date, step.originalCurrency ?? "", step.originalAmountMinor ?? -1, step.amountMinor, step.amountMinor)
          .first<{ id: string }>();
        if (rival) {
          report(step, "refused", `An entry on that wallet could already be this purchase (${rival.id}). Run the preview again.`);
          break;
        }
        if (!options.apply) { report(step, "would-run", `New entry ${step.description} ${step.date} ${step.amountMinor} on ${step.accountId}${step.shared ? ", shared" : ""}.`); break; }
        const splitGroupId = step.shared ? await findGroupId(step.splitGroup) : null;
        const created = await createEntryRecord(db, {
          date: step.date,
          description: step.description,
          accountId: step.accountId,
          categoryName: step.categoryName,
          amountMinor: step.amountMinor,
          entryType: "expense",
          ownershipType: step.shared ? "shared" : "direct",
          ...(step.shared ? { splitAmountMinor: step.firstPersonShareMinor!, splitGroupId } : {}),
          note: step.note,
          externalReference: step.externalReference,
          ...(step.originalAmountMinor !== null && step.originalCurrency ? { originalAmountMinor: step.originalAmountMinor, originalCurrency: step.originalCurrency } : {}),
          // Dated another day than the day it is saved: no honest time.
          time: null
        });
        const ids = { entryId: created.entryId, splitExpenseId: created.linkedSplitExpenseId ?? null };
        await record(step, ids);
        report(step, "done", `New entry ${step.description}.`, ids);
        break;
      }
      case "set_category": {
        const entry = await liveEntry(step.entryId);
        if (!entry) { report(step, "refused", "The entry is gone."); break; }
        if (entry.category_name === step.categoryName) {
          report(step, "already", `Category is ${step.categoryName}.`);
          break;
        }
        if (entry.category_name !== step.before) { report(step, "refused", `Its category changed to ${entry.category_name} since the preview.`); break; }
        if (!options.apply) { report(step, "would-run", `Category ${step.before} → ${step.categoryName}.`); break; }
        await updateEntryCategoryRecord(db, { entryId: step.entryId, categoryName: step.categoryName });
        await record(step, { entryId: step.entryId, before: step.before });
        report(step, "done", `Category → ${step.categoryName}.`);
        break;
      }
      case "set_note": {
        const entry = await liveEntry(step.entryId);
        if (!entry) { report(step, "refused", "The entry is gone."); break; }
        if ((entry.note ?? "") === step.note) { report(step, "already", "Note is in place."); break; }
        if ((entry.note ?? null) !== (step.before ?? null)) { report(step, "refused", "Its note changed since the preview."); break; }
        if (!options.apply) { report(step, "would-run", "Add the item lines to its note."); break; }
        await updateEntryNoteRecord(db, { entryId: step.entryId, note: step.note });
        await record(step, { entryId: step.entryId, before: step.before });
        report(step, "done", "Note updated.");
        break;
      }
      case "add_entry_to_splits": {
        const entry = await liveEntry(step.entryId);
        if (!entry) { report(step, "refused", "The entry is gone."); break; }
        if (entry.split_expense_id) {
          await record(step, { entryId: step.entryId, splitExpenseId: entry.split_expense_id });
          report(step, "already", "On Splits.", { splitExpenseId: entry.split_expense_id });
          break;
        }
        if (Number(entry.amount_minor) !== step.entryAmountMinor) { report(step, "refused", "Its amount changed since the preview, so the shares would be wrong. Run the preview again."); break; }
        if (!options.apply) { report(step, "would-run", `Add to Splits, first person's share ${step.firstPersonShareMinor}.`); break; }
        const added = await createSplitExpenseFromEntryRecord(db, {
          entryId: step.entryId,
          splitGroupId: await findGroupId(step.splitGroup),
          splitAmountMinor: step.firstPersonShareMinor,
          payerPersonId: step.payerPersonId
        });
        await record(step, { entryId: step.entryId, splitExpenseId: added.splitExpenseId });
        report(step, "done", "Added to Splits.", { splitExpenseId: added.splitExpenseId });
        break;
      }
      case "create_split_expense": {
        const groupId = await findGroupId(step.splitGroup);
        const existing = await db
          .prepare(`
            SELECT split_expenses.id FROM split_expenses
            INNER JOIN people ON people.id = split_expenses.payer_person_id
            WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL
              AND split_expenses.expense_date = ? AND split_expenses.description = ?
              AND split_expenses.total_amount_minor = ? AND people.display_name = ?
              AND split_expenses.split_group_id IS ?
            LIMIT 1
          `)
          .bind(DEFAULT_HOUSEHOLD_ID, step.date, step.description, step.amountMinor, step.payerPersonName, groupId)
          .first<{ id: string }>();
        if (existing) {
          await record(step, { splitExpenseId: existing.id });
          report(step, "already", `On Splits: ${step.description}.`, { splitExpenseId: existing.id });
          break;
        }
        if (!options.apply) { report(step, "would-run", `Splits expense ${step.description} ${step.amountMinor}, paid by ${step.payerPersonName}.`); break; }
        const { splitExpenseId } = await createSplitExpenseRecord(db, {
          groupId,
          date: step.date,
          description: step.description,
          categoryName: step.categoryName,
          payerPersonName: step.payerPersonName,
          amountMinor: step.amountMinor,
          note: step.note,
          currency: "SGD",
          paymentMethod: "card",
          paymentStatus: "awaiting_statement",
          splitAmountMinor: step.firstPersonShareMinor
        });
        await record(step, { splitExpenseId });
        report(step, "done", `Splits expense ${step.description}.`, { splitExpenseId });
        break;
      }
      case "put_on_trip": {
        const tripId = await findTripId(step.trip);
        if (!tripId) {
          report(step, options.apply ? "refused" : "would-run", options.apply ? "The trip is not there." : `Put ${step.entries.length} entries on the trip once it is made.`);
          break;
        }
        const entryIds: string[] = [];
        for (const item of step.entries) {
          const id = "id" in item.entry ? item.entry.id : (await entryByReference(item.entry.externalReference))?.id;
          if (id) entryIds.push(id);
        }
        const onTrips = entryIds.length
          ? await db
            .prepare("SELECT transaction_id, trip_event_id FROM trip_event_entries WHERE household_id = ? AND transaction_id IN (SELECT value FROM json_each(?))")
            .bind(DEFAULT_HOUSEHOLD_ID, JSON.stringify(entryIds))
            .all<{ transaction_id: string; trip_event_id: string }>()
          : { results: [] };
        const onTrip = new Map(onTrips.results.map((row) => [row.transaction_id, row.trip_event_id]));
        // An entry already on another trip is never moved.
        const toPut = entryIds.filter((id) => !onTrip.has(id));
        const missing = step.entries.length - entryIds.length;
        if (!toPut.length) {
          report(step, missing && !options.apply ? "would-run" : "already", missing ? `${missing} entries are made by earlier steps first.` : "Every entry is on a trip.");
          break;
        }
        if (!options.apply) { report(step, "would-run", `Put ${toPut.length + missing} entries on the trip.`); break; }
        const result = await setTripEventEntries(db, { changes: toPut.map((entryId) => ({ entryId, tripEventId: tripId })), addedBy: "person" });
        // A later run that puts more entries on adds its own Undo to the
        // step's record, so the undo takes them all off.
        const prior = records.get(step.stepId);
        const live = prior && !prior.undone ? prior : null;
        const undoIds = [...(Array.isArray(live?.ids.undoIds) ? (live.ids.undoIds as string[]) : []), ...(result.undoId ? [result.undoId] : [])];
        const entryIdsSoFar = [...(Array.isArray(live?.ids.entryIds) ? (live.ids.entryIds as string[]) : []), ...toPut];
        if (live) records.delete(step.stepId);
        await record(step, { tripEventId: tripId, undoIds, entryIds: entryIdsSoFar });
        report(step, "done", `Put ${result.changed} entries on the trip.`, { undoId: result.undoId });
        break;
      }
    }
  }

  if (options.apply && reports.some((item) => item.status === "done")) {
    await recordAuditEvent(db, {
      entityType: TRIP_LEDGER_AUDIT_ENTITY,
      entityId: plan.importKey,
      action: "trip_ledger_import_applied",
      detail: JSON.stringify({ importKey: plan.importKey, planHash: hash, done: reports.filter((item) => item.status === "done").length, refused: reports.filter((item) => item.status === "refused").map((item) => item.stepId) })
    });
  }
  return { importKey: plan.importKey, applied: options.apply, steps: reports };
}

// Takes the import back out, latest step first, with the existing commands:
// entries it made are deleted (with the split saved with them), Splits
// expenses it made go to activity history (restorable there), categories
// and notes go back to what they were, the trip change is undone and a trip
// it made is deleted. A statement-certified entry cannot be deleted (a
// statement counts it); it is reported and kept. A Splits group it made is
// kept (there is no delete for groups); it is empty afterwards.
export async function undoTripLedgerImport(
  db: D1Database,
  importKey: string,
  options: { apply: boolean }
): Promise<{ importKey: string; steps: TripLedgerStepReport[] }> {
  const records = [...(await loadTripLedgerStepRecords(db, importKey)).values()].filter((item) => !item.undone).reverse();
  const reports: TripLedgerStepReport[] = [];
  const done = async (item: StepRecord, detail: string) => {
    reports.push({ stepId: item.stepId, kind: item.kind, status: options.apply ? "undone" : "would-undo", detail });
    if (!options.apply) return;
    await recordAuditEvent(db, {
      entityType: TRIP_LEDGER_AUDIT_ENTITY,
      entityId: importKey,
      action: "trip_ledger_step_undone",
      detail: JSON.stringify({ importKey, stepId: item.stepId, kind: item.kind })
    });
  };
  const kept = (item: StepRecord, detail: string) => reports.push({ stepId: item.stepId, kind: item.kind, status: "kept", detail });
  const activeSplit = async (splitExpenseId: unknown) => typeof splitExpenseId === "string"
    ? db.prepare("SELECT id FROM split_expenses WHERE household_id = ? AND id = ? AND deleted_at IS NULL").bind(DEFAULT_HOUSEHOLD_ID, splitExpenseId).first<{ id: string }>()
    : null;

  for (const item of records) {
    const ids = item.ids;
    switch (item.kind) {
      case "put_on_trip": {
        const undoIds = Array.isArray(ids.undoIds) ? (ids.undoIds as string[]) : [];
        if (options.apply) for (const undoId of [...undoIds].reverse()) await undoTripEventChange(db, { undoId });
        await done(item, `Took ${Array.isArray(ids.entryIds) ? ids.entryIds.length : 0} entries off the trip.`);
        break;
      }
      case "create_split_expense":
      case "add_entry_to_splits": {
        if (!(await activeSplit(ids.splitExpenseId))) { await done(item, "The split is already gone."); break; }
        if (options.apply) await deleteSplitExpenseRecord(db, { splitExpenseId: String(ids.splitExpenseId) });
        await done(item, "Split moved to Splits activity history.");
        break;
      }
      case "set_note": {
        if (options.apply) await updateEntryNoteRecord(db, { entryId: String(ids.entryId), note: (ids.before as string | null) ?? undefined });
        await done(item, "Note put back.");
        break;
      }
      case "set_category": {
        if (typeof ids.before !== "string") { kept(item, "It had no category before; left as it is."); break; }
        if (options.apply) await updateEntryCategoryRecord(db, { entryId: String(ids.entryId), categoryName: ids.before });
        await done(item, `Category back to ${ids.before}.`);
        break;
      }
      case "create_entry": {
        const entry = await db
          .prepare("SELECT id, bank_certification_status FROM transactions WHERE household_id = ? AND id = ?")
          .bind(DEFAULT_HOUSEHOLD_ID, String(ids.entryId))
          .first<{ id: string; bank_certification_status: string }>();
        if (!entry) { await done(item, "The entry is already gone."); break; }
        if (entry.bank_certification_status === "statement_certified") { kept(item, "A statement certified it since; it stays (roll back the statement import to remove it)."); break; }
        if (options.apply) await deleteEntryRecord(db, { entryId: entry.id, withLinkedSplit: true });
        await done(item, "Entry deleted, with the split saved with it.");
        break;
      }
      case "create_trip": {
        if (!ids.created) { kept(item, "The trip was there before the import; kept."); break; }
        const trip = await db.prepare("SELECT id FROM trip_events WHERE household_id = ? AND id = ?").bind(DEFAULT_HOUSEHOLD_ID, String(ids.tripEventId)).first<{ id: string }>();
        if (!trip) { await done(item, "The trip is already gone."); break; }
        if (options.apply) await deleteTripEvent(db, { tripEventId: trip.id });
        await done(item, "Trip deleted (its own Undo can bring it back).");
        break;
      }
      case "create_split_group":
        kept(item, "Splits groups have no delete; it is left empty.");
        break;
      default:
        kept(item, "Unknown step; left as it is.");
    }
  }
  return { importKey, steps: reports };
}
