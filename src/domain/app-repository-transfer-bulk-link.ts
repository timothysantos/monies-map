// Link many clear transfer pairs at once (DOMAIN.md "Ledger Check-up",
// docs/audits/ledger-checkup.md "Clear pairs"). The route recomputes the clear
// pairs from the ledger as it is now and hands them in with the pairs the
// person was shown; only the shown ones that are still clear are linked.
//
// All-or-nothing: the checks and reads come first, then every pair's writes
// (the same ones the single link makes: `buildTransferLinkStatements`), one
// audit event per pair and ONE set of month refresh markers go into a single
// db.batch(), and the month totals refresh after it. If any statement fails,
// nothing is linked. A pair that is no longer clear is skipped, never guessed
// at, and reported by name.
//
// What the batch holds: 4 statements a pair (group, both sides, audit), a
// purpose statement for the few pairs whose sender already carried one, and
// one marker per affected month. At the cap of 100 pairs that is about 400 to
// 500 statements in one batch, measured in tests/transfer-bulk-link-scale.test.mjs.
// The purposes the pairs earn (set like last month) are learned after the
// batch by the caller, in date order, exactly as one-by-one linking does.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import { CLEAR_PAIR_REQUEST_CAP, type ClearTransferPair } from "./ledger-checkup/clear-transfer-pairs";
import { buildTransferLinkStatements } from "./transfer-link-statements";
import { buildTransferPurposeLinkStatementsFromRows, loadPurposeLinkRows } from "./transfer-purpose-links";

export class BulkTransferLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkTransferLinkError";
  }
}

export interface RequestedPair {
  fromEntryId: string;
  toEntryId: string;
}

// A request body to the pairs it names, or a plain refusal. At most the cap, no
// entry named twice.
export function readRequestedPairs(value: unknown): RequestedPair[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BulkTransferLinkError("Choose at least one pair to link.");
  }
  if (value.length > CLEAR_PAIR_REQUEST_CAP) {
    throw new BulkTransferLinkError(`Link at most ${CLEAR_PAIR_REQUEST_CAP} pairs at a time.`);
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const from = (item as Partial<RequestedPair> | null)?.fromEntryId;
    const to = (item as Partial<RequestedPair> | null)?.toEntryId;
    if (typeof from !== "string" || typeof to !== "string" || !from || !to || from === to || from.length > 100 || to.length > 100) {
      throw new BulkTransferLinkError("Each pair needs two different entries.");
    }
    if (seen.has(from) || seen.has(to)) {
      throw new BulkTransferLinkError("An entry can be in only one pair.");
    }
    seen.add(from);
    seen.add(to);
    return { fromEntryId: from, toEntryId: to };
  });
}

export interface BulkLinkResult {
  linked: Array<RequestedPair & { groupId: string }>;
  // Named, never silent: "changed" means it is no longer a clear pair.
  skipped: Array<RequestedPair & { reason: "changed" }>;
}

export async function linkClearTransferPairs(
  db: D1Database,
  input: { requested: RequestedPair[]; clearPairs: ClearTransferPair[] }
): Promise<BulkLinkResult> {
  const clearByKey = new Map(input.clearPairs.map((pair) => [`${pair.fromEntryId}>${pair.toEntryId}`, pair]));
  const accepted = new Set<ClearTransferPair>();
  const skipped: BulkLinkResult["skipped"] = [];
  for (const pair of input.requested) {
    const clear = clearByKey.get(`${pair.fromEntryId}>${pair.toEntryId}`);
    if (clear) {
      accepted.add(clear);
    } else {
      skipped.push({ ...pair, reason: "changed" });
    }
  }
  if (!accepted.size) {
    return { linked: [], skipped };
  }

  const transferCategory = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, "Transfer")
    .first<{ id: string }>();
  if (!transferCategory) {
    throw new Error("Transfer category not found");
  }

  // Oldest first: the order the audit events are written in and the order the
  // purposes are learned in afterwards.
  const ordered = [...accepted].sort((left, right) => left.date.localeCompare(right.date) || left.fromEntryId.localeCompare(right.fromEntryId));
  const purposeRows = await loadPurposeLinkRows(db, ordered.flatMap((pair) => [pair.fromEntryId, pair.toEntryId]));
  const months = new Set<string>();
  const linked: BulkLinkResult["linked"] = [];
  const statements: D1PreparedStatement[] = [];
  for (const pair of ordered) {
    const groupId = `tg-${crypto.randomUUID()}`;
    months.add(pair.date.slice(0, 7));
    months.add(pair.toDate.slice(0, 7));
    statements.push(...buildTransferLinkStatements(db, {
      groupId,
      fromEntryId: pair.fromEntryId,
      toEntryId: pair.toEntryId,
      transferCategoryId: transferCategory.id,
      note: "Linked from Check my books",
      purposeStatements: buildTransferPurposeLinkStatementsFromRows(db, pair, purposeRows)
    }));
    linked.push({ fromEntryId: pair.fromEntryId, toEntryId: pair.toEntryId, groupId });
  }
  statements.push(...buildMonthlySnapshotRefreshMarkers(db, months));
  await db.batch(statements);
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return { linked, skipped };
}
