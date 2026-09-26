// Settlement lock. Two things settle split records, and both are computed
// from the records' facts:
// - a simplified settlement (settlement checkpoint) is an immutable manifest
//   of the records it netted. It locks them while it is active (any status
//   except reopened or voided, paid or not). Undo simplification (reopen)
//   releases them.
// - a group settle-up closes its group's current split batch. The batch's
//   records, the settle-up included, are settled group activity while the
//   batch stays closed. Undo settle-up (reopen the batch) releases them.
// A locked record keeps the facts the settled amount was computed from:
// amount, currency, shares, who paid, date and group, and it cannot be
// deleted. A command that would change one is refused before its first
// write, so it changes nothing, and the person is told to undo the
// settlement first. The undo is the one explicit way to release the records,
// so editing one row can never silently reopen a settlement that may be paid
// or matched to a bank transfer. Description, category, note, payment method
// and bank links stay editable.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { normalizeSplitCurrency } from "./split-currency";

export type SplitRecordKind = "expense" | "settlement";

// The facts of a split record that feed a settled balance. For an expense the
// parties are [payer]; for a settle-up they are [from, to].
export interface SplitSettlementFacts {
  date: string;
  groupId: string | null;
  currency: string;
  amountMinor: number;
  partyIds: string[];
  shares: Array<{ personId: string; amountMinor: number }>;
}

export type SplitSettlementFact = "amount" | "currency" | "shares" | "payer" | "date" | "group";

export interface LockingSettlementCheckpoint {
  id: string;
  status: string;
  settledAt: string | null;
  amountMinor: number;
  currency: string;
  settlementDate: string;
  fromPersonName: string | null;
  toPersonName: string | null;
}

// The closed group batch (settled by a group settle-up) a record is in.
export interface LockingGroupSettlement {
  batchId: string;
  closedOn: string;
  groupName: string;
}

export type SplitSettlementLock =
  | { kind: "checkpoint"; checkpoint: LockingSettlementCheckpoint }
  | { kind: "group"; batch: LockingGroupSettlement };

export const SPLIT_SETTLEMENT_LOCKED = "split_settlement_locked";

// Names what holds the record, so the client can offer the matching undo:
// a checkpoint id (Undo simplification) or a batch id (Undo settle-up).
export class SplitSettlementLockedError extends Error {
  readonly code = SPLIT_SETTLEMENT_LOCKED;
  readonly checkpointId?: string;
  readonly batchId?: string;

  constructor(message: string, lock: { checkpointId?: string; batchId?: string }) {
    super(message);
    this.name = "SplitSettlementLockedError";
    this.checkpointId = lock.checkpointId;
    this.batchId = lock.batchId;
  }
}

// Which settlement facts differ, in a stable order for the message.
export function changedSplitSettlementFacts(before: SplitSettlementFacts, after: SplitSettlementFacts): SplitSettlementFact[] {
  const changed: SplitSettlementFact[] = [];
  if (before.amountMinor !== after.amountMinor) changed.push("amount");
  if (normalizeSplitCurrency(before.currency) !== normalizeSplitCurrency(after.currency)) changed.push("currency");
  if (sharesKey(before.shares) !== sharesKey(after.shares)) changed.push("shares");
  if (before.partyIds.join("|") !== after.partyIds.join("|")) changed.push("payer");
  if (before.date !== after.date) changed.push("date");
  if ((before.groupId ?? null) !== (after.groupId ?? null)) changed.push("group");
  return changed;
}

function sharesKey(shares: SplitSettlementFacts["shares"]) {
  return shares
    .map((share) => `${share.personId}:${share.amountMinor}`)
    .sort()
    .join("|");
}

// The active settlement that includes this record, if any.
export async function findLockingSettlementCheckpoint(
  db: D1Database,
  recordKind: SplitRecordKind,
  recordId: string
): Promise<LockingSettlementCheckpoint | null> {
  const row = await db
    .prepare(`
      SELECT checkpoints.id, checkpoints.status, checkpoints.settled_at, checkpoints.amount_minor,
        checkpoints.currency, checkpoints.settlement_date,
        from_person.display_name AS from_person_name, to_person.display_name AS to_person_name
      FROM split_settlement_checkpoint_items AS items
      INNER JOIN split_settlement_checkpoints AS checkpoints ON checkpoints.id = items.checkpoint_id
      LEFT JOIN people AS from_person ON from_person.id = checkpoints.from_person_id
      LEFT JOIN people AS to_person ON to_person.id = checkpoints.to_person_id
      WHERE checkpoints.household_id = ?
        AND items.record_kind = ?
        AND items.record_id = ?
        AND checkpoints.status NOT IN ('reopened', 'voided')
      ORDER BY checkpoints.created_at DESC, checkpoints.id DESC
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, recordKind, recordId)
    .first<{
      id: string;
      status: string;
      settled_at: string | null;
      amount_minor: number;
      currency: string | null;
      settlement_date: string;
      from_person_name: string | null;
      to_person_name: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    settledAt: row.settled_at,
    amountMinor: row.amount_minor,
    currency: normalizeSplitCurrency(row.currency),
    settlementDate: row.settlement_date,
    fromPersonName: row.from_person_name,
    toPersonName: row.to_person_name
  };
}

// The closed group batch that holds this record, if any. Archived records
// are left out: they no longer count in any balance.
export async function findLockingGroupSettlement(
  db: D1Database,
  recordKind: SplitRecordKind,
  recordId: string
): Promise<LockingGroupSettlement | null> {
  const table = recordKind === "expense" ? "split_expenses" : "split_settlements";
  const row = await db
    .prepare(`
      SELECT batches.id, batches.closed_on, split_groups.group_name
      FROM ${table} AS records
      INNER JOIN split_batches AS batches ON batches.id = records.split_batch_id
      LEFT JOIN split_groups ON split_groups.id = batches.split_group_id
      WHERE records.id = ?
        AND records.household_id = ?
        AND records.deleted_at IS NULL
        AND batches.closed_on IS NOT NULL
    `)
    .bind(recordId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; closed_on: string; group_name: string | null }>();
  if (!row) return null;
  return { batchId: row.id, closedOn: row.closed_on, groupName: row.group_name ?? "Non-group expenses" };
}

// What settles this record: an active simplified settlement first (the
// person-level step), else a closed group batch.
export async function findSplitSettlementLock(
  db: D1Database,
  recordKind: SplitRecordKind,
  recordId: string
): Promise<SplitSettlementLock | null> {
  const checkpoint = await findLockingSettlementCheckpoint(db, recordKind, recordId);
  if (checkpoint) return { kind: "checkpoint", checkpoint };
  const batch = await findLockingGroupSettlement(db, recordKind, recordId);
  return batch ? { kind: "group", batch } : null;
}

// The stored settlement facts of an expense or settle-up.
export async function loadSplitSettlementFacts(
  db: D1Database,
  recordKind: SplitRecordKind,
  recordId: string
): Promise<SplitSettlementFacts | null> {
  if (recordKind === "settlement") {
    const settlement = await db
      .prepare("SELECT settlement_date, split_group_id, currency, amount_minor, from_person_id, to_person_id FROM split_settlements WHERE id = ? AND household_id = ?")
      .bind(recordId, DEFAULT_HOUSEHOLD_ID)
      .first<{ settlement_date: string; split_group_id: string | null; currency: string | null; amount_minor: number; from_person_id: string; to_person_id: string }>();
    if (!settlement) return null;
    return {
      date: settlement.settlement_date,
      groupId: settlement.split_group_id,
      currency: normalizeSplitCurrency(settlement.currency),
      amountMinor: settlement.amount_minor,
      partyIds: [settlement.from_person_id, settlement.to_person_id],
      shares: []
    };
  }

  const [expense, shares] = await Promise.all([
    db
      .prepare("SELECT expense_date, split_group_id, currency, total_amount_minor, payer_person_id FROM split_expenses WHERE id = ? AND household_id = ?")
      .bind(recordId, DEFAULT_HOUSEHOLD_ID)
      .first<{ expense_date: string; split_group_id: string | null; currency: string | null; total_amount_minor: number; payer_person_id: string }>(),
    db
      .prepare("SELECT person_id, amount_minor FROM split_expense_shares WHERE split_expense_id = ?")
      .bind(recordId)
      .all<{ person_id: string; amount_minor: number }>()
  ]);
  if (!expense) return null;
  return {
    date: expense.expense_date,
    groupId: expense.split_group_id,
    currency: normalizeSplitCurrency(expense.currency),
    amountMinor: expense.total_amount_minor,
    partyIds: [expense.payer_person_id],
    shares: shares.results.map((share) => ({ personId: share.person_id, amountMinor: share.amount_minor }))
  };
}

// Refuses a change to a settled record (active simplified settlement or
// closed group batch) when it would change a settlement fact or delete the
// record. `next` receives the stored facts and
// returns the facts the command would write, or "deleted"; it runs only for
// a locked record, so it may read what it needs. Reads only.
export async function assertSplitSettlementUnchanged(
  db: D1Database,
  input: {
    recordKind: SplitRecordKind;
    recordId: string;
    next: (current: SplitSettlementFacts) => SplitSettlementFacts | "deleted" | Promise<SplitSettlementFacts | "deleted">;
    subject?: "record" | "linked entry";
  }
) {
  const lock = await findSplitSettlementLock(db, input.recordKind, input.recordId);
  if (!lock) return;
  const current = await loadSplitSettlementFacts(db, input.recordKind, input.recordId);
  if (!current) return;
  const next = await input.next(current);
  const change = next === "deleted" ? "deleted" : changedSplitSettlementFacts(current, next);
  if (change !== "deleted" && change.length === 0) return;
  throw new SplitSettlementLockedError(
    buildSplitSettlementLockedMessage({ recordKind: input.recordKind, subject: input.subject ?? "record", lock, change }),
    lock.kind === "checkpoint" ? { checkpointId: lock.checkpoint.id } : { batchId: lock.batch.batchId }
  );
}

export function buildSplitSettlementLockedMessage(input: {
  recordKind: SplitRecordKind;
  subject: "record" | "linked entry";
  lock: SplitSettlementLock;
  change: SplitSettlementFact[] | "deleted";
}) {
  const record = input.recordKind === "expense" ? "expense" : "settle-up";
  const settlement = input.lock.kind === "checkpoint"
    ? describeCheckpoint(input.lock.checkpoint)
    : `${input.lock.batch.groupName} settle-up of ${input.lock.batch.closedOn}`;
  const undo = input.lock.kind === "checkpoint" ? "the simplification" : "the settle-up";
  const reason = "so the settled amount still matches its activity";
  if (input.subject === "linked entry" && input.change !== "deleted") {
    return `This entry's split ${record} is part of the ${settlement}, and saving would change the split's ${joinFacts(input.change)}. Undo ${undo} first, ${reason}.`;
  }
  const action = input.change === "deleted" ? "deleting it" : `changing its ${joinFacts(input.change)}`;
  return `This split ${record} is part of the ${settlement}. Undo ${undo} before ${action}, ${reason}.`;
}

function joinFacts(facts: SplitSettlementFact[]) {
  if (facts.length <= 1) return facts[0] ?? "details";
  return `${facts.slice(0, -1).join(", ")} and ${facts[facts.length - 1]}`;
}

// Names the settlement without its amount: the message is plain text, and
// the Splits and Entries pages may be hiding money.
function describeCheckpoint(checkpoint: LockingSettlementCheckpoint) {
  const state = checkpoint.status === "matched"
    ? ", bank matched"
    : checkpoint.settledAt
      ? ", marked paid"
      : "";
  const detail = checkpoint.amountMinor === 0 || checkpoint.status === "internally_offset" || !checkpoint.fromPersonName || !checkpoint.toPersonName
    ? "groups offset to zero"
    : `${checkpoint.fromPersonName} pays ${checkpoint.toPersonName}`;
  return `simplified settlement of ${checkpoint.settlementDate} (${detail}${state})`;
}
