import { defaultDemoSettings, type DemoSettings } from "./demo-data";
import { clearDemoData, reseedDemoData, seedEmptyStateReferenceData } from "./app-repository-seed";
import { reseedShowcaseData, resolveShowcaseSeedWindow, showcaseSeedWindowDate } from "./app-repository-showcase-seed";
import { SHOWCASE_DATASET } from "./demo-showcase-data";
import { isoDateInAppTimeZone } from "../lib/app-calendar";

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
    // Read first and create the table only when it is missing: this runs on
    // every cold isolate, and the table nearly always exists.
    const read = () => db
      .prepare("SELECT value_json FROM demo_settings WHERE key = ?")
      .bind(DEMO_SETTINGS_KEY)
      .first<{ value_json: string }>();
    const result = await read().catch(async (error: unknown) => {
      if (!/no such table/i.test(String((error as Error)?.message ?? error))) {
        throw error;
      }
      await ensureDemoSettingsTable(db);
      return read();
    });

    if (!result?.value_json) {
      await saveDemoSettings(db, defaultDemoSettings);
      return defaultDemoSettings;
    }

    const parsed = JSON.parse(result.value_json) as Partial<DemoSettings>;
    return {
      salaryPerPersonMinor: parsed.salaryPerPersonMinor ?? defaultDemoSettings.salaryPerPersonMinor,
      lastSeededAt: parsed.lastSeededAt ?? defaultDemoSettings.lastSeededAt,
      emptyState: parsed.emptyState ?? defaultDemoSettings.emptyState,
      ...(parsed.dataset === SHOWCASE_DATASET ? { dataset: SHOWCASE_DATASET } : {}),
      // Kept as stored: the refresh guard compares the stored value.
      ...(typeof parsed.seedDate === "string" ? { seedDate: parsed.seedDate } : {})
    };
  } catch {
    return defaultDemoSettings;
  }
}

function buildSaveDemoSettingsStatement(db: D1Database, settings: DemoSettings) {
  return db
    .prepare(`
      INSERT INTO demo_settings (key, value_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(DEMO_SETTINGS_KEY, JSON.stringify(settings));
}

export async function saveDemoSettings(db: D1Database, settings: DemoSettings) {
  await ensureDemoSettingsTable(db);
  await buildSaveDemoSettingsStatement(db, settings).run();
}

// `dataset` is the demo worker's DEMO_DATASET. Only "showcase" changes
// anything: it seeds the showcase dataset and records it in the settings in
// the same batch as the data. Anything else seeds the default demo exactly
// as before.
export async function reseedDemoSettings(db: D1Database, seedMonth?: string, dataset?: string): Promise<DemoSettings> {
  if (dataset === SHOWCASE_DATASET) {
    const now = new Date();
    const showcaseSettings: DemoSettings = {
      ...defaultDemoSettings,
      lastSeededAt: now.toISOString(),
      emptyState: false,
      dataset: SHOWCASE_DATASET,
      seedDate: showcaseSeedWindowDate(resolveShowcaseSeedWindow(seedMonth, now))
    };
    await ensureDemoSettingsTable(db);
    await reseedShowcaseData(db, {
      seedMonth,
      now,
      extraStatements: [buildSaveDemoSettingsStatement(db, showcaseSettings)]
    });
    return showcaseSettings;
  }

  const nextSettings: DemoSettings = {
    ...defaultDemoSettings,
    lastSeededAt: new Date().toISOString(),
    emptyState: false
  };
  await reseedDemoData(db, nextSettings, seedMonth);
  await saveDemoSettings(db, nextSettings);
  return nextSettings;
}

export async function enterEmptyState(db: D1Database): Promise<DemoSettings> {
  const nextSettings: DemoSettings = {
    ...defaultDemoSettings,
    lastSeededAt: new Date().toISOString(),
    emptyState: true
  };
  await clearDemoData(db);
  await seedEmptyStateReferenceData(db);
  await saveDemoSettings(db, nextSettings);
  return nextSettings;
}

// ---- The showcase keeps itself current --------------------------------------
//
// The demo Worker's showcase ends "today", so it goes stale: at the month
// turn the Summary opens on an empty month, and later in a month the month
// in progress stops at the day it was seeded. A cold isolate of the demo
// Worker rebuilds it, from the demo settings the cold path reads anyway (no
// extra round trip while it is current). Visitors' edits are replaced then,
// which the guides say.

// Rebuilt a week after its last day even within the same month.
export const SHOWCASE_STALE_AFTER_DAYS = 7;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Only the demo Worker running the showcase (wrangler.demo.jsonc), and never
// one pinned to a seed month (tests, guide screenshots). Production, local
// and the default demo dataset never rebuild themselves.
export function showcaseRefreshesItself(env: { APP_ENVIRONMENT?: string; DEMO_DATASET?: string; DEMO_SEED_MONTH?: string }) {
  return env.APP_ENVIRONMENT === "demo" && env.DEMO_DATASET === SHOWCASE_DATASET && !env.DEMO_SEED_MONTH;
}

// The showcase's last day with activity: the recorded seed date, or for a
// showcase seeded before that was recorded, the day it was seeded (its
// cutoff was that day, in the household's time zone).
function showcaseSeedDate(settings: DemoSettings) {
  if (settings.seedDate && ISO_DATE.test(settings.seedDate)) {
    return settings.seedDate;
  }
  return isoDateInAppTimeZone(new Date(settings.lastSeededAt)) || null;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// `today` is the household's calendar day (todayInAppTimeZone), the same
// rule that picks the current month (getCurrentMonthKey).
export function isShowcaseStale(settings: DemoSettings, today: string) {
  if (settings.dataset !== SHOWCASE_DATASET || settings.emptyState) {
    return false;
  }
  const seeded = showcaseSeedDate(settings);
  if (!seeded) {
    return true;
  }
  if (seeded >= today) {
    return false;
  }
  return seeded.slice(0, 7) < today.slice(0, 7) || daysBetween(seeded, today) >= SHOWCASE_STALE_AFTER_DAYS;
}

// Fails (NOT NULL) inside the reseed batch, rolling all of it back, when the
// stored seed date is no longer the one this isolate read: another isolate
// (or a reseed from Settings) has already rebuilt the showcase.
function buildSeedDateGuardStatement(db: D1Database, readSeedDate: string) {
  return db
    .prepare(`
      INSERT INTO demo_settings (key, value_json)
      SELECT 'showcase-refresh-guard', NULL
      WHERE COALESCE((SELECT json_extract(value_json, '$.seedDate') FROM demo_settings WHERE key = ?), '') <> ?
    `)
    .bind(DEMO_SETTINGS_KEY, readSeedDate);
}

// Rebuilds the showcase for today in one all-or-nothing batch (the data and
// the settings that record it), guarded so two isolates never both replace
// it. The isolate that loses the race carries on with the winner's settings.
export async function refreshStaleShowcase(db: D1Database, settings: DemoSettings, now = new Date()): Promise<DemoSettings> {
  const readSeedDate = settings.seedDate ?? "";
  const next: DemoSettings = {
    ...settings,
    lastSeededAt: now.toISOString(),
    emptyState: false,
    dataset: SHOWCASE_DATASET,
    seedDate: showcaseSeedWindowDate(resolveShowcaseSeedWindow(undefined, now))
  };
  try {
    await reseedShowcaseData(db, {
      now,
      guardStatements: [buildSeedDateGuardStatement(db, readSeedDate)],
      extraStatements: [buildSaveDemoSettingsStatement(db, next)]
    });
    return next;
  } catch (error) {
    const current = await loadDemoSettings(db);
    if (current.dataset === SHOWCASE_DATASET && (current.seedDate ?? "") !== readSeedDate) {
      return current;
    }
    throw error;
  }
}
