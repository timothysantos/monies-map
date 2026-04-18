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
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  last4 TEXT,
  is_joint INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (institution_id) REFERENCES institutions(id),
  FOREIGN KEY (owner_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS account_balance_checkpoints (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  checkpoint_month TEXT NOT NULL,
  statement_start_date TEXT,
  statement_end_date TEXT,
  statement_balance_minor INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, checkpoint_month)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_category_id TEXT,
  reporting_group TEXT NOT NULL,
  icon_key TEXT NOT NULL DEFAULT 'circle',
  color_hex TEXT NOT NULL DEFAULT '#6A7A73',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (parent_category_id) REFERENCES categories(id),
  UNIQUE (household_id, slug)
);

CREATE TABLE IF NOT EXISTS category_match_rules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  UNIQUE (household_id, pattern)
);

CREATE TABLE IF NOT EXISTS category_match_rule_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 1,
  sample_descriptions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'ignored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  UNIQUE (household_id, pattern, category_id)
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

CREATE TABLE IF NOT EXISTS split_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE TABLE IF NOT EXISTS split_batches (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  split_group_id TEXT,
  batch_name TEXT NOT NULL,
  opened_on TEXT NOT NULL,
  closed_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (split_group_id) REFERENCES split_groups(id)
);

CREATE TABLE IF NOT EXISTS split_expenses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  split_group_id TEXT,
  split_batch_id TEXT,
  payer_person_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT,
  total_amount_minor INTEGER NOT NULL,
  note TEXT,
  linked_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
  FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
  FOREIGN KEY (payer_person_id) REFERENCES people(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS split_expense_shares (
  id TEXT PRIMARY KEY,
  split_expense_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  ratio_basis_points INTEGER NOT NULL CHECK (
    ratio_basis_points BETWEEN 0 AND 10000
  ),
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (split_expense_id) REFERENCES split_expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS split_settlements (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  split_group_id TEXT,
  split_batch_id TEXT,
  from_person_id TEXT NOT NULL,
  to_person_id TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  note TEXT,
  linked_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
  FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
  FOREIGN KEY (from_person_id) REFERENCES people(id),
  FOREIGN KEY (to_person_id) REFERENCES people(id),
  FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
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

CREATE TABLE IF NOT EXISTS monthly_plan_rows (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  person_id TEXT,
  ownership_type TEXT NOT NULL DEFAULT 'direct' CHECK (
    ownership_type IN ('direct', 'shared')
  ),
  section_key TEXT NOT NULL CHECK (
    section_key IN ('income', 'planned_items', 'budget_buckets')
  ),
  category_id TEXT,
  label TEXT NOT NULL,
  plan_date TEXT,
  account_id TEXT,
  planned_amount_minor INTEGER NOT NULL DEFAULT 0,
  actual_amount_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (person_id) REFERENCES people(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS monthly_plan_row_splits (
  id TEXT PRIMARY KEY,
  monthly_plan_row_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  ratio_basis_points INTEGER NOT NULL CHECK (
    ratio_basis_points BETWEEN 0 AND 10000
  ),
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_plan_row_id) REFERENCES monthly_plan_rows(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS monthly_plan_entry_links (
  id TEXT PRIMARY KEY,
  monthly_plan_row_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monthly_plan_row_id) REFERENCES monthly_plan_rows(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  UNIQUE (monthly_plan_row_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS monthly_plan_match_hints (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  person_id TEXT,
  category_id TEXT,
  account_id TEXT,
  label_normalized TEXT NOT NULL,
  description_pattern TEXT NOT NULL,
  amount_minor INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(id),
  FOREIGN KEY (person_id) REFERENCES people(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  UNIQUE (household_id, person_id, category_id, account_id, label_normalized, description_pattern)
);

CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  person_scope TEXT NOT NULL,
  total_income_minor INTEGER NOT NULL DEFAULT 0,
  estimated_expense_minor INTEGER NOT NULL DEFAULT 0,
  total_expense_minor INTEGER NOT NULL DEFAULT 0,
  savings_goal_minor INTEGER NOT NULL DEFAULT 0,
  total_net_minor INTEGER NOT NULL DEFAULT 0,
  total_shared_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, year, month, person_scope),
  FOREIGN KEY (household_id) REFERENCES households(id)
);

CREATE TABLE IF NOT EXISTS demo_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE INDEX IF NOT EXISTS idx_import_rows_import
  ON import_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction
  ON transaction_splits (transaction_id);

CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_household_month
  ON monthly_snapshots (household_id, year, month, person_scope);

CREATE INDEX IF NOT EXISTS idx_monthly_plan_rows_household_month
  ON monthly_plan_rows (household_id, year, month, section_key);

CREATE INDEX IF NOT EXISTS idx_monthly_notes_household_month
  ON monthly_notes (household_id, year, month, scope);

CREATE INDEX IF NOT EXISTS idx_split_expenses_household_date
  ON split_expenses (household_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_split_settlements_household_date
  ON split_settlements (household_id, settlement_date);

CREATE INDEX IF NOT EXISTS idx_category_match_rules_household_active
  ON category_match_rules (household_id, is_active, priority);
