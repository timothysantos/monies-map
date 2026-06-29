import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";

export async function repairLegacyOcbcValueDatePostDates(db: D1Database) {
  const transactionColumns = await db
    .prepare("PRAGMA table_info(transactions)")
    .all<{ name: string }>();
  const transactionColumnNames = new Set(transactionColumns.results.map((column) => column.name));
  if (!transactionColumnNames.has("post_date") || !transactionColumnNames.has("note")) {
    return;
  }

  await db.prepare(`
    UPDATE transactions
    SET post_date = substr(note, instr(lower(note), 'value date: ') + 12, 10)
    WHERE household_id = ?
      AND note IS NOT NULL
      AND instr(lower(note), 'value date: ') > 0
      AND substr(note, instr(lower(note), 'value date: ') + 12, 10) GLOB '????-??-??'
      AND (post_date IS NULL OR post_date = transaction_date)
      AND account_id IN (
        SELECT accounts.id
        FROM accounts
        INNER JOIN institutions ON institutions.id = accounts.institution_id
        WHERE accounts.household_id = ?
          AND accounts.account_kind = 'bank'
          AND lower(institutions.name) LIKE '%ocbc%'
      )
  `).bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID).run();
}
