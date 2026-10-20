// The 10k-transaction household the page-load scale guards build: 10,000
// imported transactions over 600 days (2025-01-01 on), 60 imports that each
// kept a large stored preview, and 200 saved error diagnostics with
// full-size (20 KB) response bodies. Set-based SQL, a handful of statements.
export const TRANSACTION_COUNT = 10_000;
export const IMPORT_COUNT = 60;
export const PREVIEW_ROWS_PER_IMPORT = 40;
export const PREVIEW_ROW_BYTES = 4_000;
export const DIAGNOSTIC_COUNT = 200;
// Writes cap a stored body at 20,000 characters (app-repository-error-diagnostics.ts).
export const DIAGNOSTIC_BODY_BYTES = 20_000;

export async function buildLargeHousehold(db) {
  const accountCount = (await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).n;
  const categoryId = (await db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").first()).id;
  const heavy = (bytes) => `substr(replace(hex(zeroblob(${Math.ceil(bytes / 2)})), '0', 'x'), 1, ${bytes})`;
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${IMPORT_COUNT})
    INSERT INTO imports (id, household_id, source_type, source_label, parser_key, imported_at, status)
    SELECT 'scale-import-' || i, 'household-1', CASE WHEN i % 2 = 0 THEN 'pdf' ELSE 'csv' END, 'Scale statement ' || i, 'generic_csv',
      strftime('%Y-%m-%dT%H:%M:%SZ', '2026-01-01', '+' || i || ' hours'), 'completed' FROM n
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${TRANSACTION_COUNT})
    INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, post_date, description, amount_minor, currency, entry_type, category_id)
    SELECT 'scale-txn-' || i, 'household-1', 'scale-import-' || (1 + i % ${IMPORT_COUNT}),
      a.id,
      date('2025-01-01', '+' || (i % 600) || ' days'), date('2025-01-01', '+' || ((i % 600) + 1) || ' days'),
      'SCALE MERCHANT ' || (i % 97) || ' SINGAPORE SG', 100 + (i % 9000), 'SGD', 'expense', '${categoryId}'
    FROM n JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn FROM accounts) a ON a.rn = n.i % ${accountCount}
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${IMPORT_COUNT * PREVIEW_ROWS_PER_IMPORT})
    INSERT INTO import_rows (id, import_id, row_index, raw_row_json, status)
    SELECT 'scale-row-' || i, 'scale-import-' || (1 + i % ${IMPORT_COUNT}), i, ${heavy(PREVIEW_ROW_BYTES)}, 'imported' FROM n
  `).run();
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${DIAGNOSTIC_COUNT})
    INSERT INTO app_error_diagnostics (id, household_id, source, action, error_message, response_excerpt, response_body, created_at)
    SELECT 'scale-diag-' || i, 'household-1', 'api', 'GET /api/imports-page', 'Scale failure ' || i, substr(${heavy(2000)}, 1, 2000), ${heavy(DIAGNOSTIC_BODY_BYTES)},
      strftime('%Y-%m-%d %H:%M:%S', '2026-01-01', '+' || i || ' minutes') FROM n
  `).run();
}
