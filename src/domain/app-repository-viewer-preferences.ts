// A signed-in person's display preferences (DOMAIN.md "Lead View"), kept in
// app_settings under one key per login: "viewer_preferences:" and the first
// 32 hex characters of the SHA-256 of the lower-cased Access email, so the
// email itself is never a key. The value is a small JSON object, today
// {"leadView":"plan"|"simple"}. A preference is display state, not household
// data: no audit event, and nothing else reads it.
//
// Without a verified login (local dev, the demo, the browser tests that send
// no identity header) nothing is read or written here; the page keeps the
// choice on the device instead (src/client/lead-view.js).

import { ensureAppSettingsTable } from "./app-settings-table";

export type LeadViewPreference = "plan" | "simple";

export function isLeadViewPreference(value: unknown): value is LeadViewPreference {
  return value === "plan" || value === "simple";
}

export async function viewerPreferencesKey(email: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `viewer_preferences:${hex.slice(0, 32)}`;
}

// The login's lead view, or null when it never chose one (or there is no
// login). An older database without the settings table reads as no choice.
export async function loadLeadViewPreference(db: D1Database, email?: string): Promise<LeadViewPreference | null> {
  if (!email) {
    return null;
  }
  try {
    const row = await db
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .bind(await viewerPreferencesKey(email))
      .first<{ value_json: string }>();
    const stored = row ? JSON.parse(row.value_json)?.leadView : null;
    return isLeadViewPreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

// Saves the login's lead view in one statement (one batch), merged into the
// login's stored preferences so a later preference cannot be lost.
export async function saveLeadViewPreference(db: D1Database, email: string, leadView: LeadViewPreference) {
  if (!isLeadViewPreference(leadView)) {
    throw new Error("Choose Plan or Simple.");
  }
  await ensureAppSettingsTable(db);
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = json_patch(CASE WHEN json_valid(app_settings.value_json) THEN app_settings.value_json ELSE '{}' END, excluded.value_json),
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(await viewerPreferencesKey(email), JSON.stringify({ leadView }))
  ]);
  return { leadView };
}
