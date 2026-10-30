// The household's key/value settings table (schema.sql "app_settings"),
// created on first use for databases older than the table. Schema, not
// data: shared by the Shortcut settings and the payment ways, so neither
// command module imports the other.
//
// Once created it stays, so each isolate runs the CREATE once per database
// binding: it was a D1 round trip (twice) on every Settings load.
const ensuredDatabases = new WeakSet<D1Database>();

export async function ensureAppSettingsTable(db: D1Database) {
  if (ensuredDatabases.has(db)) {
    return;
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  ensuredDatabases.add(db);
}
