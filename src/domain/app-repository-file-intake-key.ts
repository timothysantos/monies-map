// The key the "Send to Monies Map" Shortcut sends with each file (DOMAIN.md
// "Waiting File"). Its own key, never the Apple Pay Shortcut's: either can
// be replaced without breaking the other. Kept like the Apple Pay key: in
// app_settings once made in Settings, else the Worker secret
// FILE_INTAKE_KEY. Making a new key stops the old one at once.

import { buildAuditEventStatement } from "./app-repository-audit";
import { ensureAppSettingsTable } from "./app-settings-table";

export const FILE_INTAKE_SETTINGS_KEY = "file_intake";

export type FileIntakeKey = { key: string; source: "app" | "environment" | "none" };

function parseStoredKey(valueJson: string | undefined) {
  try {
    const value: unknown = valueJson ? JSON.parse(valueJson) : null;
    const key = value && typeof value === "object" ? (value as { key?: unknown }).key : undefined;
    return typeof key === "string" ? key.trim() : "";
  } catch {
    return "";
  }
}

export async function loadFileIntakeKey(db: D1Database, environmentKey?: string | null): Promise<FileIntakeKey> {
  await ensureAppSettingsTable(db);
  const row = await db
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .bind(FILE_INTAKE_SETTINGS_KEY)
    .first<{ value_json: string }>();
  const stored = parseStoredKey(row?.value_json);
  if (stored) {
    return { key: stored, source: "app" };
  }
  const fallback = environmentKey?.trim() ?? "";
  return fallback ? { key: fallback, source: "environment" } : { key: "", source: "none" };
}

// 32 random bytes as URL-safe text (43 characters).
export function generateFileIntakeKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Settings > Send files to Monies Map > "Make a new key". The key and its
// audit event are saved together; the audit line never holds the key.
export async function makeNewFileIntakeKey(db: D1Database) {
  await ensureAppSettingsTable(db);
  const key = generateFileIntakeKey();
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
      `)
      .bind(FILE_INTAKE_SETTINGS_KEY, JSON.stringify({ key })),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: FILE_INTAKE_SETTINGS_KEY,
      action: "file_intake_key_replaced",
      detail: "A new key was made for sending files to Monies Map; the old key stopped working."
    })
  ]);
  return { key, source: "app" as const };
}
