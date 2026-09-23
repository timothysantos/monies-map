-- Fresh test D1 schema can run a legacy repair that audits before the runtime
-- creates this table. Prepare the same table shape before starting that Worker.
INSERT OR IGNORE INTO households (id, name, base_currency)
VALUES ('household-1', 'Performance fixture household', 'SGD');

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id)
);
