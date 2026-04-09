import { defaultDemoSettings, type DemoSettings } from "./demo-data";
import { clearDemoData, reseedDemoData, seedEmptyStateReferenceData } from "./app-repository";

const DEMO_SETTINGS_KEY = "current";

export async function ensureDemoSettingsTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS demo_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function loadDemoSettings(db: D1Database): Promise<DemoSettings> {
  try {
    await ensureDemoSettingsTable(db);
    const result = await db
      .prepare("SELECT value_json FROM demo_settings WHERE key = ?")
      .bind(DEMO_SETTINGS_KEY)
      .first<{ value_json: string }>();

    if (!result?.value_json) {
      await saveDemoSettings(db, defaultDemoSettings);
      return defaultDemoSettings;
    }

    const parsed = JSON.parse(result.value_json) as Partial<DemoSettings>;
    return {
      salaryPerPersonMinor: parsed.salaryPerPersonMinor ?? defaultDemoSettings.salaryPerPersonMinor,
      lastSeededAt: parsed.lastSeededAt ?? defaultDemoSettings.lastSeededAt,
      emptyState: parsed.emptyState ?? defaultDemoSettings.emptyState
    };
  } catch {
    return defaultDemoSettings;
  }
}

export async function saveDemoSettings(db: D1Database, settings: DemoSettings) {
  await ensureDemoSettingsTable(db);
  await db
    .prepare(`
      INSERT INTO demo_settings (key, value_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(DEMO_SETTINGS_KEY, JSON.stringify(settings))
    .run();
}

export async function reseedDemoSettings(db: D1Database): Promise<DemoSettings> {
  const nextSettings: DemoSettings = {
    ...defaultDemoSettings,
    lastSeededAt: new Date().toISOString(),
    emptyState: false
  };
  await saveDemoSettings(db, nextSettings);
  await reseedDemoData(db, nextSettings);
  return nextSettings;
}

export async function enterEmptyState(db: D1Database): Promise<DemoSettings> {
  const nextSettings: DemoSettings = {
    ...defaultDemoSettings,
    lastSeededAt: new Date().toISOString(),
    emptyState: true
  };
  await saveDemoSettings(db, nextSettings);
  await clearDemoData(db);
  await seedEmptyStateReferenceData(db);
  return nextSettings;
}
