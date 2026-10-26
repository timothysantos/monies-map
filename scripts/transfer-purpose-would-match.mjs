// Read-only report: the untagged transfers out that the "same receiver,
// ignore the bank's wording" learning rule (DOMAIN.md "Transfer Purpose",
// "Learning") would tag today, so the owner can tag them in the editor. It
// opens a local SQLite copy of the database read-only and writes nothing.
//
//   wrangler d1 export monies-map --remote --output export.sql   (read-only)
//   sqlite3 copy.db < export.sql
//   node --experimental-strip-types --experimental-sqlite --no-warnings \
//     scripts/transfer-purpose-would-match.mjs copy.db
//
// Earlier rows are processed oldest first and a row that would match counts as
// tagged for the rows after it (the chain the editor would produce when each
// is tagged in turn). Nothing is applied to existing rows by the app.
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

import { rememberedTransferPurpose } from "../src/domain/app-repository-transfer-purpose.ts";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: node --experimental-sqlite scripts/transfer-purpose-would-match.mjs <database.sqlite>");
}
const db = new DatabaseSync(file, { readOnly: true });

const rows = db.prepare(`
  SELECT
    t.id, t.account_id, t.amount_minor, t.currency, t.transaction_date, t.description, t.owner_person_id,
    t.transfer_purpose_category_id, t.transfer_purpose_person_id,
    o.account_id AS receiver_account_id, o.owner_person_id AS receiver_person_id,
    EXISTS (
      SELECT 1 FROM audit_events a
      WHERE a.entity_type = 'transaction' AND a.entity_id = t.id AND a.action = 'transfer_purpose_cleared'
    ) AS cleared_by_hand
  FROM transactions t
  LEFT JOIN transactions o ON o.transfer_group_id = t.transfer_group_id AND o.id != t.id
  WHERE t.entry_type = 'transfer' AND t.transfer_direction = 'out'
  ORDER BY t.transaction_date, t.id
`).all();

const history = rows.map((row) => ({
  id: row.id,
  accountId: row.account_id,
  amountMinor: row.amount_minor,
  currency: row.currency,
  date: row.transaction_date,
  description: row.description,
  purposeCategoryId: row.transfer_purpose_category_id,
  purposePersonId: row.transfer_purpose_person_id,
  receiverPersonId: row.receiver_person_id,
  receiverAccountId: row.receiver_account_id,
  clearedByHand: Boolean(row.cleared_by_hand)
}));

const matches = [];
for (const [index, row] of rows.entries()) {
  if (row.transfer_purpose_category_id || row.cleared_by_hand || !row.owner_person_id || !row.receiver_person_id || row.receiver_person_id === row.owner_person_id) {
    continue;
  }
  const remembered = rememberedTransferPurpose({
    id: row.id,
    accountId: row.account_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    date: row.transaction_date,
    description: row.description,
    receiverPersonId: row.receiver_person_id,
    receiverAccountId: row.receiver_account_id
  }, history);
  if (!remembered) {
    continue;
  }
  history[index].purposeCategoryId = remembered.categoryId;
  history[index].purposePersonId = remembered.personId;
  const category = db.prepare("SELECT name FROM categories WHERE id = ?").get(remembered.categoryId)?.name ?? remembered.categoryId;
  matches.push({ id: row.id.slice(-8), date: row.transaction_date, amountMinor: row.amount_minor, category, likeEntry: remembered.fromEntryId.slice(-8) });
}

console.log(`${matches.length} untagged transfer(s) out would be set like an earlier one:`);
for (const match of matches) {
  console.log(`${match.date}  ${(match.amountMinor / 100).toFixed(2)}  ${match.category}  id ...${match.id}  like ...${match.likeEntry}`);
}
