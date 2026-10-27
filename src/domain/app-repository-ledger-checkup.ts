// "This is fine" for the Ledger check-up (DOMAIN.md "Ledger Check-up",
// docs/proposals/ledger-checkup.md "Dismissal"): the one write the feature has.
//
// A dismissal is one `app_settings` row per finding, key
// `ledger_checkup:dismissed:<finding id>`, value `{ evidenceKey, kind, dismissedAt }`.
// No new table, so no schema migration. A finding that is dismissed for one
// evidence key comes back when its evidence (and so its key) changes.
//
// Commands are all-or-nothing: the check (the id and key are well formed, the
// dismissal list is not full) happens first, then the setting and its audit
// event commit in one `db.batch()`. Reading tolerates a missing table (nothing
// is dismissed).
import { buildAuditEventStatement } from "./app-repository-audit";
import { ensureAppSettingsTable } from "./app-settings-table";
import { FINDING_KINDS } from "./ledger-checkup/types";

export const CHECKUP_DISMISSAL_PREFIX = "ledger_checkup:dismissed:";
// The next string after every key that starts with the prefix (":" + 1 = ";").
const PREFIX_END = "ledger_checkup:dismissed;";
export const MAX_CHECKUP_DISMISSALS = 500;

const FINDING_ID_PATTERN = new RegExp(`^(?:${FINDING_KINDS.join("|")}):[A-Za-z0-9:+,._-]{1,180}$`);
const EVIDENCE_KEY_PATTERN = /^[0-9a-f]{1,32}$/;

export class CheckupDismissalError extends Error {}

export function isFindingId(value: unknown): value is string {
  return typeof value === "string" && FINDING_ID_PATTERN.test(value);
}

export function isEvidenceKey(value: unknown): value is string {
  return typeof value === "string" && EVIDENCE_KEY_PATTERN.test(value);
}

// finding id -> the evidence key it was dismissed for.
export async function loadCheckupDismissals(db: D1Database): Promise<Map<string, string>> {
  const dismissals = new Map<string, string>();
  try {
    const result = await db
      .prepare("SELECT key, value_json FROM app_settings WHERE key >= ? AND key < ? LIMIT ?")
      .bind(CHECKUP_DISMISSAL_PREFIX, PREFIX_END, MAX_CHECKUP_DISMISSALS + 1)
      .all<{ key: string; value_json: string }>();
    for (const row of result.results) {
      try {
        const value = JSON.parse(row.value_json) as { evidenceKey?: unknown };
        if (typeof value.evidenceKey === "string") {
          dismissals.set(row.key.slice(CHECKUP_DISMISSAL_PREFIX.length), value.evidenceKey);
        }
      } catch {
        // An unreadable row dismisses nothing.
      }
    }
  } catch {
    // No table yet: nothing is dismissed.
  }
  return dismissals;
}

export async function dismissCheckupFinding(db: D1Database, input: { id: string; evidenceKey: string }) {
  if (!isFindingId(input.id)) {
    throw new CheckupDismissalError("That finding could not be recognised.");
  }
  if (!isEvidenceKey(input.evidenceKey)) {
    throw new CheckupDismissalError("That finding could not be recognised.");
  }
  await ensureAppSettingsTable(db);
  const existing = await loadCheckupDismissals(db);
  if (!existing.has(input.id) && existing.size >= MAX_CHECKUP_DISMISSALS) {
    throw new CheckupDismissalError("Too many findings are marked as fine. Bring some back before marking more.");
  }
  const kind = input.id.slice(0, input.id.indexOf(":"));
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
      `)
      .bind(`${CHECKUP_DISMISSAL_PREFIX}${input.id}`, JSON.stringify({ evidenceKey: input.evidenceKey, kind, dismissedAt: new Date().toISOString() })),
    buildAuditEventStatement(db, {
      entityType: "ledger_checkup",
      entityId: input.id,
      action: "ledger_checkup_dismissed",
      detail: `Marked a ${kind.replace(/_/g, " ")} finding in the Ledger check-up as fine.`
    })
  ]);
  return { id: input.id };
}

export async function undoCheckupDismissal(db: D1Database, input: { id: string }) {
  if (!isFindingId(input.id)) {
    throw new CheckupDismissalError("That finding could not be recognised.");
  }
  await ensureAppSettingsTable(db);
  const existing = await loadCheckupDismissals(db);
  if (!existing.has(input.id)) {
    throw new CheckupDismissalError("That finding is not marked as fine.");
  }
  await db.batch([
    db.prepare("DELETE FROM app_settings WHERE key = ?").bind(`${CHECKUP_DISMISSAL_PREFIX}${input.id}`),
    buildAuditEventStatement(db, {
      entityType: "ledger_checkup",
      entityId: input.id,
      action: "ledger_checkup_dismissal_undone",
      detail: "Brought a finding in the Ledger check-up back."
    })
  ]);
  return { id: input.id };
}
