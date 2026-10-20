// A production-shaped split history for payload and projection tests: one
// matched settlement checkpoint (27 Aug 2025) covering 352 records, 287 of
// them in a large SGD group like production's "Okaeri", 65 in a second
// group, with about half of the expenses linked to an imported bank row (the
// linked description and note are what make a production row ~1.1 kB), a
// few settle-up records inside the checkpoint, and six newer open expenses.
// Written with set-based SQL so it costs a handful of statements.

export const SETTLED_HISTORY = {
  checkpointId: "cp-prod-shape",
  bigGroupId: "split-group-prod-okaeri",
  smallGroupId: "split-group-prod-home",
  // Covered: expenses 1..348 (1..283 in the big group) and 4 settle-ups in
  // the big group, so the big group has 287 covered records and 352 in all.
  bigGroupCoveredExpenses: 283,
  coveredExpenses: 348,
  coveredTotal: 352,
  settlementCount: 4,
  // Open: expenses 349..352 in the small group, 353..358 in the big group.
  openCount: 10,
  settlementDate: "2025-08-27"
};

const MERCHANTS = [
  "GRAB*A-8XYZ123 SINGAPORE SG", "NTUC FAIRPRICE CO-OP SINGAPORE", "Sushi Tei dinner", "Okaeri rent share",
  "COLD STORAGE GREAT WORLD", "Taxi to airport", "SHOPEE SINGAPORE MP", "Kopitiam lunch", "Movie night",
  "IKEA TAMPINES", "Utilities SP GROUP", "Bus card top up", "Dim sum brunch", "Pharmacy WATSONS",
  "Groceries", "Hawker dinner", "Netflix", "Cleaning supplies", "Birthday cake", "Petrol SHELL",
  "Bakery BREADTALK", "Coffee", "Takeaway pizza", "Hardware store", "Flowers"
];

export async function seedSettledSplitHistory(db) {
  const h = SETTLED_HISTORY;
  const categories = (await db.prepare("SELECT id FROM categories WHERE household_id = 'household-1' ORDER BY id LIMIT 8").all()).results.map((row) => row.id);
  const account = (await db.prepare("SELECT id FROM accounts WHERE household_id = 'household-1' ORDER BY id LIMIT 1").first()).id;
  const merchantCase = `CASE (i % ${MERCHANTS.length}) ${MERCHANTS.map((name, index) => `WHEN ${index} THEN '${name.replace(/'/g, "''")}'`).join(" ")} END`;
  const categoryCase = `CASE (i % ${categories.length}) ${categories.map((id, index) => `WHEN ${index} THEN '${id}'`).join(" ")} END`;
  const total = h.coveredExpenses + h.openCount;
  const statements = [
    db.prepare(`INSERT INTO split_groups (id, household_id, group_name, currency, expense_source, icon_key, sort_order)
      VALUES ('${h.bigGroupId}', 'household-1', 'Okaeri', 'SGD', 'mixed', 'home', 50),
             ('${h.smallGroupId}', 'household-1', 'Flat costs', 'SGD', 'mixed', 'receipt', 51)`),
    db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${total})
      INSERT INTO transactions (id, household_id, account_id, transaction_date, post_date, description, amount_minor, currency, entry_type, category_id, note)
      SELECT 'prod-shape-txn-' || i, 'household-1', '${account}',
        CASE WHEN i <= ${h.coveredExpenses} THEN date('2025-01-02', '+' || (i * 236 / ${h.coveredExpenses}) || ' days') ELSE date('2025-09-01', '+' || (i - ${h.coveredExpenses}) || ' days') END,
        NULL, ${merchantCase} || ' REF ' || (100000 + i), -(500 + (i * 37) % 9000), 'SGD', 'expense', ${categoryCase},
        'Shared with Joyce, paid on the card ' || i
      FROM n WHERE i % 2 = 0`),
    db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${total})
      INSERT INTO split_expenses (id, household_id, split_group_id, payer_person_id, expense_date, description, category_id, total_amount_minor, currency, payment_method, payment_status, note, linked_transaction_id, created_at)
      SELECT 'prod-shape-exp-' || printf('%04d', i), 'household-1',
        CASE WHEN i <= ${h.bigGroupCoveredExpenses} OR i > ${h.coveredTotal} THEN '${h.bigGroupId}' ELSE '${h.smallGroupId}' END,
        CASE WHEN i % 3 = 0 THEN 'person-joyce' ELSE 'person-tim' END,
        CASE WHEN i <= ${h.coveredExpenses} THEN date('2025-01-02', '+' || (i * 236 / ${h.coveredExpenses}) || ' days') ELSE date('2025-09-01', '+' || (i - ${h.coveredExpenses}) || ' days') END,
        ${merchantCase}, ${categoryCase}, 500 + (i * 37) % 9000, 'SGD',
        CASE WHEN i % 2 = 0 THEN 'card' WHEN i % 5 = 0 THEN 'bank' ELSE 'cash' END,
        CASE WHEN i % 2 = 0 THEN 'certified' ELSE 'recorded' END,
        CASE WHEN i % 4 = 0 THEN 'Split evenly, receipt in the shared album ' || i ELSE NULL END,
        CASE WHEN i % 2 = 0 THEN 'prod-shape-txn-' || i ELSE NULL END,
        '2025-09-01T00:00:' || printf('%02d', i % 60) || 'Z'
      FROM n`),
    db.prepare(`INSERT INTO split_expense_shares (id, split_expense_id, person_id, ratio_basis_points, amount_minor)
      SELECT id || '-tim', id, 'person-tim', 5000, total_amount_minor / 2 FROM split_expenses WHERE id LIKE 'prod-shape-exp-%'
      UNION ALL
      SELECT id || '-joyce', id, 'person-joyce', 5000, total_amount_minor - total_amount_minor / 2 FROM split_expenses WHERE id LIKE 'prod-shape-exp-%'`),
    db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${h.settlementCount})
      INSERT INTO split_settlements (id, household_id, split_group_id, from_person_id, to_person_id, settlement_date, amount_minor, currency, payment_method, note)
      SELECT 'prod-shape-set-' || i, 'household-1', '${h.bigGroupId}', 'person-joyce', 'person-tim', date('2025-02-01', '+' || (i * 40) || ' days'), 10000 * i, 'SGD', 'bank', 'Paid back ' || i FROM n`),
    db.prepare(`INSERT INTO split_settlement_checkpoints (id, household_id, from_person_id, to_person_id, amount_minor, currency, settlement_date, status, matched_amount_minor)
      VALUES ('${h.checkpointId}', 'household-1', 'person-joyce', 'person-tim', 708217, 'SGD', '${h.settlementDate}', 'matched', 708217)`),
    db.prepare(`INSERT INTO split_settlement_checkpoint_items (id, checkpoint_id, record_kind, record_id)
      SELECT 'cpi-' || id, '${h.checkpointId}', 'expense', id FROM split_expenses
        WHERE id LIKE 'prod-shape-exp-%' AND CAST(substr(id, 16) AS INTEGER) <= ${h.coveredExpenses}
      UNION ALL
      SELECT 'cpi-' || id, '${h.checkpointId}', 'settlement', id FROM split_settlements WHERE id LIKE 'prod-shape-set-%'`)
  ];
  await db.batch(statements);
  return h;
}
