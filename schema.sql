PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'SGD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'partner')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  country_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  owner_person_id TEXT,
  account_name TEXT NOT NULL,
  account_kind TEXT NOT NULL CHECK (
    account_kind IN ('bank', 'credit_card', 'loan', 'cash', 'investment')
  ),
  currency TEXT NOT NULL DEFAULT 'SGD',
  last4 TEXT,
  is_joint INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (institution_id) REFERENCES institutions(id),
  FOREIGN KEY (owner_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_category_id TEXT,
  reporting_group TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (parent_category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf', 'manual')),
  source_label TEXT NOT NULL,
  parser_key TEXT,
  imported_by_person_id TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (
    status IN ('draft', 'completed', 'rolled_back')
  ),
  note TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (imported_by_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  assigned_account_id TEXT,
  raw_row_json TEXT NOT NULL,
  normalized_hash TEXT,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (
    status IN ('preview', 'imported', 'skipped', 'error')
  ),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS transfer_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  note TEXT,
  matched_confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  import_id TEXT,
  import_row_id TEXT,
  account_id TEXT NOT NULL,
  transfer_group_id TEXT,
  transaction_date TEXT NOT NULL,
  posted_date TEXT,
  description TEXT NOT NULL,
  original_description TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SGD',
  entry_type TEXT NOT NULL CHECK (entry_type IN ('expense', 'income', 'transfer')),
  transfer_direction TEXT CHECK (transfer_direction IN ('in', 'out')),
  merchant TEXT,
  category_id TEXT,
  ownership_type TEXT NOT NULL DEFAULT 'direct' CHECK (
    ownership_type IN ('direct', 'shared')
  ),
  owner_person_id TEXT,
  offsets_category INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  external_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (import_id) REFERENCES imports(id),
  FOREIGN KEY (import_row_id) REFERENCES import_rows(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (transfer_group_id) REFERENCES transfer_groups(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (owner_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  ratio_basis_points INTEGER NOT NULL CHECK (
    ratio_basis_points BETWEEN 0 AND 10000
  ),
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS monthly_notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  scope TEXT NOT NULL DEFAULT 'month' CHECK (scope IN ('summary', 'month')),
  note TEXT NOT NULL,
  created_by_person_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS monthly_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  person_id TEXT,
  category_id TEXT,
  planned_amount_minor INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (person_id) REFERENCES people(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  person_scope TEXT NOT NULL,
  total_income_minor INTEGER NOT NULL DEFAULT 0,
  total_expense_minor INTEGER NOT NULL DEFAULT 0,
  total_net_minor INTEGER NOT NULL DEFAULT 0,
  total_shared_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, year, month, person_scope),
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE INDEX IF NOT EXISTS idx_imports_household_imported_at
  ON imports (household_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_household_date
  ON transactions (household_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (account_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_import
  ON transactions (import_id);

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group
  ON transactions (transfer_group_id);

CREATE INDEX IF NOT EXISTS idx_monthly_notes_household_month
  ON monthly_notes (household_id, year, month, scope);
