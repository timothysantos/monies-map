-- Ask audit 2: read-only check for rows the old Ask save paths may have
-- left wrong in production (docs/flows/ask-flow.md "What a save writes").
-- Nothing here writes. Run each query on its own and review the rows by
-- hand; repairs are the owner's call, made on Splits or Entries.
--
--   npx wrangler d1 execute monies-map --remote --file docs/audits/ask-audit2-data-check.sql
--
-- "First" and "second" are the household's two Splits people, in the
-- order Splits uses (owner, partner, then by when they were added).

-- 1. B2: a split left on Splits after Ask's Undo removed its entry. The
--    split is still counted, but its entry is gone: an active split with no
--    entry, saved the way a Shared entry saves (payment status certified),
--    whose description and day match an "entry_deleted" audit row.
SELECT
  split_expenses.id AS split_expense_id,
  split_expenses.expense_date,
  split_expenses.description,
  split_expenses.total_amount_minor,
  split_expenses.currency,
  COALESCE(split_groups.group_name, 'No group') AS group_name,
  audit_events.created_at AS entry_deleted_at
FROM split_expenses
LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
INNER JOIN audit_events
  ON audit_events.household_id = split_expenses.household_id
  AND audit_events.entity_type = 'transaction'
  AND audit_events.action = 'entry_deleted'
  AND audit_events.detail = 'Deleted entry ' || split_expenses.description || ' on ' || split_expenses.expense_date || '.'
WHERE split_expenses.deleted_at IS NULL
  AND split_expenses.linked_transaction_id IS NULL
  AND split_expenses.payment_status = 'certified'
ORDER BY split_expenses.expense_date DESC;

-- 2. B1: entries Ask saved on Splits whose split has no group. Some are
--    right (the person chose no group); the ones saved with a group chosen
--    landed here by mistake. Compare with what the person meant.
SELECT
  transactions.id AS entry_id,
  transactions.transaction_date,
  transactions.description,
  transactions.amount_minor,
  split_expenses.id AS split_expense_id,
  split_expenses.created_at AS split_created_at
FROM transactions
INNER JOIN split_expenses
  ON split_expenses.linked_transaction_id = transactions.id
  AND split_expenses.deleted_at IS NULL
WHERE transactions.external_reference LIKE 'ask:%'
  AND split_expenses.split_group_id IS NULL
ORDER BY transactions.transaction_date DESC;

-- 3. B9: a group closed as settled while something was still owed (a
--    payment more or less than the balance). What the second person owes
--    the first in each closed batch, from its own records; any row here
--    was not at zero when it closed.
WITH people_order AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id
  ) AS position
  FROM people
),
first_person AS (SELECT id FROM people_order WHERE position = 1),
second_person AS (SELECT id FROM people_order WHERE position = 2),
records AS (
  SELECT split_expenses.split_batch_id AS batch_id,
    CASE
      WHEN split_expenses.payer_person_id = (SELECT id FROM first_person)
        THEN COALESCE((SELECT amount_minor FROM split_expense_shares WHERE split_expense_id = split_expenses.id AND person_id = (SELECT id FROM second_person)), 0)
      WHEN split_expenses.payer_person_id = (SELECT id FROM second_person)
        THEN -COALESCE((SELECT amount_minor FROM split_expense_shares WHERE split_expense_id = split_expenses.id AND person_id = (SELECT id FROM first_person)), 0)
      ELSE 0
    END AS owed_minor
  FROM split_expenses
  WHERE split_expenses.deleted_at IS NULL
  UNION ALL
  SELECT split_settlements.split_batch_id,
    CASE
      WHEN split_settlements.from_person_id = (SELECT id FROM second_person) THEN -split_settlements.amount_minor
      WHEN split_settlements.from_person_id = (SELECT id FROM first_person) THEN split_settlements.amount_minor
      ELSE 0
    END
  FROM split_settlements
  WHERE split_settlements.deleted_at IS NULL
)
SELECT
  split_batches.id AS batch_id,
  COALESCE(split_groups.group_name, 'No group') AS group_name,
  split_batches.closed_on,
  SUM(records.owed_minor) AS second_owes_first_minor
FROM split_batches
INNER JOIN records ON records.batch_id = split_batches.id
LEFT JOIN split_groups ON split_groups.id = split_batches.split_group_id
WHERE split_batches.closed_on IS NOT NULL
GROUP BY split_batches.id
HAVING SUM(records.owed_minor) <> 0
ORDER BY split_batches.closed_on DESC;
