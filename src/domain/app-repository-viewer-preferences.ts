// A signed-in person's display preferences (DOMAIN.md "Lead View", "Plan
// view"), kept in app_settings under one key per login: "viewer_preferences:"
// and the first 32 hex characters of the SHA-256 of the lower-cased Access
// email, so the email itself is never a key. The value is a small JSON object,
// today {"leadView":"plan"|"simple","planMode":"studio"|"tables"}. A
// preference is display state, not household data: no audit event, and nothing
// else reads it.
//
// Without a verified login (local dev, the demo, the browser tests that send
// no identity header) nothing is read or written here; the page keeps the
// choice on the device instead (src/client/lead-view.js, plan-mode.js).

import { ensureAppSettingsTable } from "./app-settings-table";

export type LeadViewPreference = "plan" | "simple";
export type PlanModePreference = "studio" | "tables";
export interface ViewerPreferences {
  leadView: LeadViewPreference | null;
  planMode: PlanModePreference | null;
  // Summary's card order and hidden cards (design.md "Arrange Summary"):
  // "insights,mix,subs,plan,-accounts"; null is the usual order.
  summaryCards: string | null;
}

export function isLeadViewPreference(value: unknown): value is LeadViewPreference {
  return value === "plan" || value === "simple";
}

export function isPlanModePreference(value: unknown): value is PlanModePreference {
  return value === "studio" || value === "tables";
}

// The card ids and "-" for hidden, comma separated; the page drops ids it
// does not know (summary-card-order.js), so only the shape is checked here.
export function isSummaryCardsPreference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && /^-?[a-z]{1,20}(?:,-?[a-z]{1,20}){0,11}$/.test(value);
}

export async function viewerPreferencesKey(email: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `viewer_preferences:${hex.slice(0, 32)}`;
}

// The login's choices in one read, each null when it never chose (or there is
// no login). An older database without the settings table reads as no choice.
export async function loadViewerPreferences(db: D1Database, email?: string): Promise<ViewerPreferences> {
  const none = { leadView: null, planMode: null, summaryCards: null };
  if (!email) {
    return none;
  }
  try {
    const row = await db
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .bind(await viewerPreferencesKey(email))
      .first<{ value_json: string }>();
    const stored = row ? JSON.parse(row.value_json) : null;
    return {
      leadView: isLeadViewPreference(stored?.leadView) ? stored.leadView : null,
      planMode: isPlanModePreference(stored?.planMode) ? stored.planMode : null,
      summaryCards: isSummaryCardsPreference(stored?.summaryCards) ? stored.summaryCards : null
    };
  } catch {
    return none;
  }
}

// The login's lead view, or null when it never chose one.
export async function loadLeadViewPreference(db: D1Database, email?: string): Promise<LeadViewPreference | null> {
  return (await loadViewerPreferences(db, email)).leadView;
}

// Merges one preference into the login's stored preferences in one statement
// (one batch), so saving one never loses another.
async function saveViewerPreference(db: D1Database, email: string, patch: Partial<Record<keyof ViewerPreferences, string | null>>) {
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
      .bind(await viewerPreferencesKey(email), JSON.stringify(patch))
  ]);
}

export async function saveLeadViewPreference(db: D1Database, email: string, leadView: LeadViewPreference) {
  if (!isLeadViewPreference(leadView)) {
    throw new Error("Choose Plan or Simple.");
  }
  await saveViewerPreference(db, email, { leadView });
  return { leadView };
}

export async function savePlanModePreference(db: D1Database, email: string, planMode: PlanModePreference) {
  if (!isPlanModePreference(planMode)) {
    throw new Error("Choose Sliders or List.");
  }
  await saveViewerPreference(db, email, { planMode });
  return { planMode };
}

// Null is the usual order: json_patch removes the key.
export async function saveSummaryCardsPreference(db: D1Database, email: string, summaryCards: string | null) {
  if (summaryCards !== null && !isSummaryCardsPreference(summaryCards)) {
    throw new Error("That card order is not one Summary knows.");
  }
  await saveViewerPreference(db, email, { summaryCards });
  return { summaryCards };
}
