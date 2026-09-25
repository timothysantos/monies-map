// Runtime schema initialization (H15a). Brings existing databases up to the
// current schema with additive, idempotent repairs, once per D1 binding per
// isolate. Seeding lives in app-repository-seed.ts; optimizing this path is a
// separate decision.

import { backfillSplitBatches } from "./app-repository-split-batches";
import { repairLegacyOcbcValueDatePostDates } from "./app-repository-post-date-repairs";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

// A Worker isolate can serve concurrent first requests. Keep additive schema
// checks single-filed so two requests cannot attempt the same D1 migration.
const schemaInitializationByDatabase = new WeakMap<D1Database, Promise<void>>();

export async function ensureDemoSchema(db: D1Database) {
  const pending = schemaInitializationByDatabase.get(db);
  if (pending) {
    return pending;
  }

  const initialization = ensureDemoSchemaOnce(db);
  schemaInitializationByDatabase.set(db, initialization);

  try {
    await initialization;
  } catch (error) {
    // A transient D1 error must be retryable on the next request.
    schemaInitializationByDatabase.delete(db);
    throw error;
  }
}

// Same as ensureDemoSchema, and reports whether this call started the
// initialization (cold) or found it already done or in flight (warm).
export async function ensureDemoSchemaTimed(db: D1Database) {
  const cold = !schemaInitializationByDatabase.has(db);
  await ensureDemoSchema(db);
  return { cold };
}

async function ensureDemoSchemaOnce(db: D1Database) {
  let shouldBackfillImportedPostDates = false;
  let shouldResetRolledBackStatementCertifications = false;

  // Legacy repairs below record audit events, so the table must exist before
  // any of them run. schema.sql does not create it.
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      )
    `)
    .run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_snapshot_refreshes (
      household_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, month_key),
      FOREIGN KEY (household_id) REFERENCES households(id)
    )
  `).run();

  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_plan_entry_links (
      id TEXT PRIMARY KEY,
      monthly_plan_row_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (monthly_plan_row_id) REFERENCES monthly_plan_rows(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      UNIQUE (monthly_plan_row_id, transaction_id)
    )
  `).run();

  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
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
    )
  `).run();

  // These counters enforce the optional Workers AI allowance without retaining
  // prompts, statement text, model output, or financial records.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_assist_daily_usage (
      household_id TEXT NOT NULL,
      usage_day TEXT NOT NULL,
      used_units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, usage_day)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS category_match_rule_issue_ignores (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      rule_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      UNIQUE (household_id, issue_key)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS login_identities (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      person_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (person_id) REFERENCES people(id),
      UNIQUE (household_id, provider, email)
    )
  `).run();

  const categoryColumns = await db
    .prepare("PRAGMA table_info(categories)")
    .all<{ name: string }>();

  const hasSlug = categoryColumns.results.some((column) => column.name === "slug");
  if (!hasSlug && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN slug TEXT").run();
  }

  const hasSortOrder = categoryColumns.results.some((column) => column.name === "sort_order");
  if (!hasSortOrder && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasIsSystem = categoryColumns.results.some((column) => column.name === "is_system");
  if (!hasIsSystem && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasReportingGroup = categoryColumns.results.some((column) => column.name === "reporting_group");
  if (!hasReportingGroup && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN reporting_group TEXT NOT NULL DEFAULT 'general'").run();
  }

  const hasIconKey = categoryColumns.results.some((column) => column.name === "icon_key");
  if (!hasIconKey && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN icon_key TEXT NOT NULL DEFAULT 'circle'").run();
  }

  const hasColorHex = categoryColumns.results.some((column) => column.name === "color_hex");
  if (!hasColorHex && categoryColumns.results.length > 0) {
    await db.prepare("ALTER TABLE categories ADD COLUMN color_hex TEXT NOT NULL DEFAULT '#6A7A73'").run();
  }

  const accountColumns = await db
    .prepare("PRAGMA table_info(accounts)")
    .all<{ name: string }>();

  const hasOpeningBalanceMinor = accountColumns.results.some((column) => column.name === "opening_balance_minor");
  if (!hasOpeningBalanceMinor && accountColumns.results.length > 0) {
    await db.prepare("ALTER TABLE accounts ADD COLUMN opening_balance_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const transactionColumns = await db
    .prepare("PRAGMA table_info(transactions)")
    .all<{ name: string }>();

  if (transactionColumns.results.some((column) => column.name === "external_reference")) {
    await db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_household_external_reference
      ON transactions(household_id, external_reference)
      WHERE external_reference IS NOT NULL
    `).run();
  }

  await dropLegacyLedgerOwnershipStorage(db, transactionColumns.results);

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "bank_certification_status")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN bank_certification_status TEXT NOT NULL DEFAULT 'provisional'").run();
  }

  const hasLegacyOriginalTransactionDate = transactionColumns.results.some((column) => column.name === "original_transaction_date");
  const hasPostDate = transactionColumns.results.some((column) => column.name === "post_date");
  // Migration safety:
  // - legacy-only databases rename the old column in place, which preserves the
  //   stored values without a copy step
  // - mixed schemas copy any stranded legacy values into post_date
  // - brand new schemas just add post_date
  if (transactionColumns.results.length > 0 && !hasPostDate && hasLegacyOriginalTransactionDate) {
    await db.prepare("ALTER TABLE transactions RENAME COLUMN original_transaction_date TO post_date").run();
    shouldBackfillImportedPostDates = true;
  } else if (transactionColumns.results.length > 0 && !hasPostDate) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN post_date TEXT").run();
    shouldBackfillImportedPostDates = true;
  }

  if (shouldBackfillImportedPostDates && hasLegacyOriginalTransactionDate && hasPostDate) {
    await db.prepare(`
      UPDATE transactions
      SET post_date = COALESCE(post_date, original_transaction_date)
      WHERE original_transaction_date IS NOT NULL
    `).run();
  }

  if (shouldBackfillImportedPostDates) {
    await db.prepare(`
      UPDATE transactions
      SET post_date = transaction_date
      WHERE import_id IS NOT NULL
        AND post_date IS NULL
    `).run();
  }

  // Older OCBC 360 activity imports saved the bank value date only in notes.
  // Repair those rows so statement checkpoints use the cleared date lane.
  await repairLegacyOcbcValueDatePostDates(db);

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_import_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_import_id TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_import_row_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_import_row_id TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_at")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_at TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_import_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_import_id TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_import_row_id")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_import_row_id TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_transaction_date")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_transaction_date TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_post_date")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_post_date TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_description")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_description TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_amount_minor")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_amount_minor INTEGER").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_entry_type")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_entry_type TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "statement_certified_previous_transfer_direction")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN statement_certified_previous_transfer_direction TEXT").run();
    shouldResetRolledBackStatementCertifications = true;
  }

  if (shouldResetRolledBackStatementCertifications) {
    await resetRolledBackStatementCertifications(db);
  }

  if (transactionColumns.results.length > 0 && !transactionColumns.results.some((column) => column.name === "transfer_review_dismissed_at")) {
    await db.prepare("ALTER TABLE transactions ADD COLUMN transfer_review_dismissed_at TEXT").run();
  }

  const peopleColumns = await db
    .prepare("PRAGMA table_info(people)")
    .all<{ name: string }>();

  const hasPeopleUpdatedAt = peopleColumns.results.some((column) => column.name === "updated_at");
  if (!hasPeopleUpdatedAt && peopleColumns.results.length > 0) {
    await db.prepare("ALTER TABLE people ADD COLUMN updated_at TEXT").run();
  }

  const loginIdentityColumns = await db
    .prepare("PRAGMA table_info(login_identities)")
    .all<{ name: string }>();

  const hasLoginIdentityUpdatedAt = loginIdentityColumns.results.some((column) => column.name === "updated_at");
  if (!hasLoginIdentityUpdatedAt && loginIdentityColumns.results.length > 0) {
    await db.prepare("ALTER TABLE login_identities ADD COLUMN updated_at TEXT").run();
  }

  await db
    .prepare(`
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
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS statement_reconciliation_certificates (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        import_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        checkpoint_month TEXT NOT NULL,
        statement_start_date TEXT,
        statement_end_date TEXT,
        statement_row_count INTEGER NOT NULL DEFAULT 0,
        imported_row_count INTEGER NOT NULL DEFAULT 0,
        certified_existing_row_count INTEGER NOT NULL DEFAULT 0,
        already_covered_row_count INTEGER NOT NULL DEFAULT 0,
        needs_review_row_count INTEGER NOT NULL DEFAULT 0,
        debit_total_minor INTEGER NOT NULL DEFAULT 0,
        credit_total_minor INTEGER NOT NULL DEFAULT 0,
        net_total_minor INTEGER NOT NULL DEFAULT 0,
        statement_balance_minor INTEGER NOT NULL,
        projected_ledger_balance_minor INTEGER NOT NULL,
        delta_minor INTEGER NOT NULL,
        exception_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('certified', 'exception')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS statement_chain_breaks (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        missing_checkpoint_month TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        UNIQUE (household_id, account_id, missing_checkpoint_month)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        account_id TEXT,
        transaction_id TEXT,
        checkpoint_month TEXT,
        kind TEXT NOT NULL CHECK (
          kind IN ('missing_bank_row', 'extra_ledger_row', 'duplicate', 'direction_mismatch', 'wrong_account', 'timing_difference', 'manual_review', 'adjustment_needed')
        ),
        severity TEXT NOT NULL DEFAULT 'review' CHECK (severity IN ('info', 'review', 'blocking')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        title TEXT NOT NULL,
        note TEXT,
        resolution_note TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS shortcut_request_nonces (
        nonce TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .run();

  const checkpointColumns = await db
    .prepare("PRAGMA table_info(account_balance_checkpoints)")
    .all<{ name: string }>();

  const hasStatementStartDate = checkpointColumns.results.some((column) => column.name === "statement_start_date");
  if (!hasStatementStartDate && checkpointColumns.results.length > 0) {
    await db.prepare("ALTER TABLE account_balance_checkpoints ADD COLUMN statement_start_date TEXT").run();
  }

  const hasStatementEndDate = checkpointColumns.results.some((column) => column.name === "statement_end_date");
  if (!hasStatementEndDate && checkpointColumns.results.length > 0) {
    await db.prepare("ALTER TABLE account_balance_checkpoints ADD COLUMN statement_end_date TEXT").run();
  }

  const statementCertificateColumns = await db
    .prepare("PRAGMA table_info(statement_reconciliation_certificates)")
    .all<{ name: string }>();
  if (
    statementCertificateColumns.results.length > 0
    && !statementCertificateColumns.results.some((column) => column.name === "superseded_ledger_rows_json")
  ) {
    await db.prepare("ALTER TABLE statement_reconciliation_certificates ADD COLUMN superseded_ledger_rows_json TEXT").run();
  }

  if (
    statementCertificateColumns.results.length > 0
    && !statementCertificateColumns.results.some((column) => column.name === "certified_ledger_rows_json")
  ) {
    await db.prepare("ALTER TABLE statement_reconciliation_certificates ADD COLUMN certified_ledger_rows_json TEXT").run();
  }

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS app_error_diagnostics (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        previous_action TEXT,
        method TEXT,
        route TEXT,
        status INTEGER,
        status_text TEXT,
        content_type TEXT,
        error_message TEXT NOT NULL,
        possible_reason TEXT,
        request_context_json TEXT,
        response_excerpt TEXT,
        response_body TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_app_error_diagnostics_household_created
      ON app_error_diagnostics (household_id, created_at DESC)
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_groups (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SGD',
        expense_source TEXT NOT NULL DEFAULT 'mixed' CHECK (expense_source IN ('cash', 'ledger', 'mixed')),
        icon_key TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      )
    `)
    .run();

  const splitGroupColumns = await db.prepare("PRAGMA table_info(split_groups)").all<{ name: string }>();
  if (splitGroupColumns.results.length > 0 && !splitGroupColumns.results.some((column) => column.name === "currency")) {
    await db.prepare("ALTER TABLE split_groups ADD COLUMN currency TEXT NOT NULL DEFAULT 'SGD'").run();
  }
  if (splitGroupColumns.results.length > 0 && !splitGroupColumns.results.some((column) => column.name === "expense_source")) {
    await db.prepare("ALTER TABLE split_groups ADD COLUMN expense_source TEXT NOT NULL DEFAULT 'mixed'").run();
  }

  await db
    .prepare(`
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
      )
    `)
    .run();

  await db
    .prepare(`
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
        currency TEXT NOT NULL DEFAULT 'SGD',
        home_amount_minor INTEGER,
        fx_rate_basis_points INTEGER,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        payment_status TEXT NOT NULL DEFAULT 'recorded',
        note TEXT,
        linked_transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
        FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
        FOREIGN KEY (payer_person_id) REFERENCES people(id),
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
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
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_settlements (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        split_group_id TEXT,
        split_batch_id TEXT,
        from_person_id TEXT NOT NULL,
        to_person_id TEXT NOT NULL,
        settlement_date TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SGD',
        fx_rate_basis_points INTEGER,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        payment_status TEXT NOT NULL DEFAULT 'recorded',
        note TEXT,
        linked_transaction_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (split_group_id) REFERENCES split_groups(id),
        FOREIGN KEY (split_batch_id) REFERENCES split_batches(id),
        FOREIGN KEY (from_person_id) REFERENCES people(id),
        FOREIGN KEY (to_person_id) REFERENCES people(id),
        FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_settlement_checkpoints (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        from_person_id TEXT,
        to_person_id TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SGD',
        settlement_date TEXT NOT NULL,
        settled_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'matched', 'partially_matched', 'internally_offset', 'reopened', 'voided')),
        matched_transaction_id TEXT,
        matched_amount_minor INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (from_person_id) REFERENCES people(id),
        FOREIGN KEY (to_person_id) REFERENCES people(id),
        FOREIGN KEY (matched_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_settlement_checkpoint_items (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        record_kind TEXT NOT NULL CHECK (record_kind IN ('expense', 'settlement')),
        record_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (checkpoint_id) REFERENCES split_settlement_checkpoints(id) ON DELETE CASCADE,
        UNIQUE (checkpoint_id, record_kind, record_id)
      )
    `)
    .run();

  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS split_settlement_checkpoint_matches (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        ledger_amount_minor INTEGER,
        fx_rate_basis_points INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (checkpoint_id) REFERENCES split_settlement_checkpoints(id) ON DELETE CASCADE,
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        UNIQUE (checkpoint_id, transaction_id)
      )
    `)
    .run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS split_activity_history (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      record_kind TEXT NOT NULL CHECK (record_kind IN ('expense', 'settlement')),
      record_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
      group_id TEXT,
      group_name TEXT,
      description TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SGD',
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      detail TEXT,
      FOREIGN KEY (household_id) REFERENCES households(id)
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_split_activity_history_household_time ON split_activity_history (household_id, occurred_at DESC, id DESC)").run();

  const snapshotColumns = await db
    .prepare("PRAGMA table_info(monthly_snapshots)")
    .all<{ name: string }>();

  const hasEstimatedExpense = snapshotColumns.results.some((column) => column.name === "estimated_expense_minor");
  if (!hasEstimatedExpense && snapshotColumns.results.length > 0) {
    await db.prepare("ALTER TABLE monthly_snapshots ADD COLUMN estimated_expense_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const hasSavingsGoal = snapshotColumns.results.some((column) => column.name === "savings_goal_minor");
  if (!hasSavingsGoal && snapshotColumns.results.length > 0) {
    await db.prepare("ALTER TABLE monthly_snapshots ADD COLUMN savings_goal_minor INTEGER NOT NULL DEFAULT 0").run();
  }

  const splitExpenseColumns = await db.prepare("PRAGMA table_info(split_expenses)").all<{ name: string }>();
  if (splitExpenseColumns.results.length > 0 && !splitExpenseColumns.results.some((column) => column.name === "split_batch_id")) {
    await db.prepare("ALTER TABLE split_expenses ADD COLUMN split_batch_id TEXT").run();
  }
  for (const column of [
    ["currency", "TEXT NOT NULL DEFAULT 'SGD'"],
    ["home_amount_minor", "INTEGER"],
    ["fx_rate_basis_points", "INTEGER"],
    ["payment_method", "TEXT NOT NULL DEFAULT 'cash'"],
    ["payment_status", "TEXT NOT NULL DEFAULT 'recorded'"]
  ]) {
    if (splitExpenseColumns.results.length > 0 && !splitExpenseColumns.results.some((item) => item.name === column[0])) {
      await db.prepare(`ALTER TABLE split_expenses ADD COLUMN ${column[0]} ${column[1]}`).run();
    }
  }
  if (splitExpenseColumns.results.length > 0 && !splitExpenseColumns.results.some((item) => item.name === "deleted_at")) {
    await db.prepare("ALTER TABLE split_expenses ADD COLUMN deleted_at TEXT").run();
  }

  const splitSettlementColumns = await db.prepare("PRAGMA table_info(split_settlements)").all<{ name: string }>();
  if (splitSettlementColumns.results.length > 0 && !splitSettlementColumns.results.some((column) => column.name === "split_batch_id")) {
    await db.prepare("ALTER TABLE split_settlements ADD COLUMN split_batch_id TEXT").run();
  }
  for (const column of [
    ["currency", "TEXT NOT NULL DEFAULT 'SGD'"],
    ["fx_rate_basis_points", "INTEGER"],
    ["payment_method", "TEXT NOT NULL DEFAULT 'cash'"],
    ["payment_status", "TEXT NOT NULL DEFAULT 'recorded'"]
  ]) {
    if (splitSettlementColumns.results.length > 0 && !splitSettlementColumns.results.some((item) => item.name === column[0])) {
      await db.prepare(`ALTER TABLE split_settlements ADD COLUMN ${column[0]} ${column[1]}`).run();
    }
  }
  if (splitSettlementColumns.results.length > 0 && !splitSettlementColumns.results.some((item) => item.name === "deleted_at")) {
    await db.prepare("ALTER TABLE split_settlements ADD COLUMN deleted_at TEXT").run();
  }

  const splitSettlementCheckpointColumns = await db.prepare("PRAGMA table_info(split_settlement_checkpoints)").all<{ name: string }>();
  for (const column of [
    ["currency", "TEXT NOT NULL DEFAULT 'SGD'"],
    ["settled_at", "TEXT"]
  ]) {
    if (splitSettlementCheckpointColumns.results.length > 0 && !splitSettlementCheckpointColumns.results.some((item) => item.name === column[0])) {
      await db.prepare(`ALTER TABLE split_settlement_checkpoints ADD COLUMN ${column[0]} ${column[1]}`).run();
    }
  }

  const checkpointMatchColumns = await db.prepare("PRAGMA table_info(split_settlement_checkpoint_matches)").all<{ name: string }>();
  for (const column of [
    ["ledger_amount_minor", "INTEGER"],
    ["fx_rate_basis_points", "INTEGER"]
  ]) {
    if (checkpointMatchColumns.results.length > 0 && !checkpointMatchColumns.results.some((item) => item.name === column[0])) {
      await db.prepare(`ALTER TABLE split_settlement_checkpoint_matches ADD COLUMN ${column[0]} ${column[1]}`).run();
    }
  }

  await ensureHotReadIndexes(db);
  await backfillSplitBatches(db);
}

async function dropLegacyLedgerOwnershipStorage(
  db: D1Database,
  transactionColumns: Array<{ name: string }>
) {
  const hasTransactionsTable = transactionColumns.length > 0;
  const hasLegacyOwnershipColumn = transactionColumns.some((column) => column.name === "ownership_type");

  if (hasTransactionsTable && hasLegacyOwnershipColumn) {
    await db.prepare(`
      UPDATE transactions
      SET owner_person_id = (
        SELECT owner_person_id
        FROM accounts
        WHERE accounts.id = transactions.account_id
      )
      WHERE household_id = ?
        AND owner_person_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM accounts
          WHERE accounts.id = transactions.account_id
            AND accounts.owner_person_id IS NOT NULL
        )
    `).bind(DEFAULT_HOUSEHOLD_ID).run();

    await db.prepare(`
      UPDATE transactions
      SET ownership_type = 'direct',
        owner_person_id = (
          SELECT owner_person_id
          FROM accounts
          WHERE accounts.id = transactions.account_id
        )
      WHERE household_id = ?
        AND ownership_type = 'shared'
        AND EXISTS (
          SELECT 1
          FROM accounts
          WHERE accounts.id = transactions.account_id
            AND accounts.owner_person_id IS NOT NULL
        )
    `).bind(DEFAULT_HOUSEHOLD_ID).run();

    const unresolvedShared = await db
      .prepare("SELECT COUNT(*) AS count FROM transactions WHERE household_id = ? AND ownership_type = 'shared'")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .first<{ count: number }>();

    if (Number(unresolvedShared?.count ?? 0) > 0) {
      throw new Error("Legacy shared ledger rows still exist without an account owner. Repair or delete those rows before deploying the storage removal migration.");
    }
  }

  await db.prepare("DROP INDEX IF EXISTS idx_transaction_splits_transaction").run();
  await db.prepare("DROP TABLE IF EXISTS transaction_splits").run();

  if (hasTransactionsTable && hasLegacyOwnershipColumn) {
    await db.prepare("ALTER TABLE transactions DROP COLUMN ownership_type").run();
  }
}

async function ensureHotReadIndexes(db: D1Database) {
  const indexStatements = [
    "CREATE INDEX IF NOT EXISTS idx_imports_household_imported_at ON imports (household_id, imported_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_import_rows_import ON import_rows (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_household_date ON transactions (household_id, transaction_date)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, transaction_date)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_import ON transactions (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_statement_certified_import ON transactions (statement_certified_import_id)",
    "CREATE INDEX IF NOT EXISTS idx_statement_reconciliation_certificates_import ON statement_reconciliation_certificates (import_id)",
    "CREATE INDEX IF NOT EXISTS idx_statement_reconciliation_certificates_account_period ON statement_reconciliation_certificates (account_id, statement_start_date, statement_end_date)",
    "CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_household_status ON reconciliation_exceptions (household_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions (transfer_group_id)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_household_month ON monthly_snapshots (household_id, year, month, person_scope)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_household_scope_month ON monthly_snapshots (household_id, person_scope, year, month)",
    "CREATE INDEX IF NOT EXISTS idx_monthly_plan_rows_household_month ON monthly_plan_rows (household_id, year, month, section_key)",
    "CREATE INDEX IF NOT EXISTS idx_split_expenses_household_date ON split_expenses (household_id, expense_date)",
    "CREATE INDEX IF NOT EXISTS idx_split_settlements_household_date ON split_settlements (household_id, settlement_date)",
    "CREATE INDEX IF NOT EXISTS idx_category_match_rules_household_active ON category_match_rules (household_id, is_active, priority)",
    "CREATE INDEX IF NOT EXISTS idx_category_match_rule_issue_ignores_household ON category_match_rule_issue_ignores (household_id, issue_key)"
  ];

  await db.batch(indexStatements.map((statement) => db.prepare(statement)));
}

async function resetRolledBackStatementCertifications(db: D1Database) {
  await db
    .prepare(`
      UPDATE transactions
      SET bank_certification_status = 'provisional',
        statement_certified_import_id = NULL,
        statement_certified_import_row_id = NULL,
        statement_certified_at = NULL,
        statement_certified_previous_import_id = NULL,
        statement_certified_previous_import_row_id = NULL,
        statement_certified_previous_transaction_date = NULL,
        statement_certified_previous_post_date = NULL,
        statement_certified_previous_description = NULL,
        statement_certified_previous_amount_minor = NULL,
        statement_certified_previous_entry_type = NULL,
        statement_certified_previous_transfer_direction = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ?
        AND statement_certified_import_id IN (
          SELECT id
          FROM imports
          WHERE household_id = ?
            AND status = 'rolled_back'
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID)
    .run();
}
