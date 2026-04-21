import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const databaseName = "monies-map";
const confirmationText = "empty state";

const deleteStatements = [
  "DELETE FROM split_expense_shares",
  "DELETE FROM split_expenses",
  "DELETE FROM split_settlements",
  "DELETE FROM split_batches",
  "DELETE FROM split_groups",
  "DELETE FROM transaction_splits",
  "DELETE FROM monthly_plan_entry_links",
  "DELETE FROM monthly_plan_match_hints",
  "DELETE FROM transactions",
  "DELETE FROM monthly_plan_row_splits",
  "DELETE FROM monthly_plan_rows",
  "DELETE FROM monthly_budgets",
  "DELETE FROM monthly_notes",
  "DELETE FROM monthly_snapshots",
  "DELETE FROM statement_reconciliation_certificates",
  "DELETE FROM import_rows",
  "DELETE FROM imports",
  "DELETE FROM account_balance_checkpoints",
  "DELETE FROM audit_events",
  "DELETE FROM category_match_rule_suggestions",
  "DELETE FROM category_match_rules",
  "DELETE FROM login_identities",
  "DELETE FROM transfer_groups",
  "DELETE FROM categories",
  "DELETE FROM accounts",
  "DELETE FROM institutions",
  "DELETE FROM people",
  "DELETE FROM households"
];

const rl = createInterface({ input, output });
const answer = await rl.question(
  [
    "This will EMPTY the production Cloudflare D1 database 'monies-map'.",
    "It clears accounts, entries, imports, checkpoints, month plans, snapshots, splits, categories, people, and household rows.",
    "The next app bootstrap will recreate only the empty-state reference household, people, categories, and category rules.",
    `Type '${confirmationText}' to continue: `
  ].join("\n")
);
rl.close();

if (answer.trim() !== confirmationText) {
  console.error("Aborted. Confirmation text did not match.");
  process.exit(1);
}

const now = new Date().toISOString();
const sql = `
${deleteStatements.map((statement) => `${statement};`).join("\n")}
CREATE TABLE IF NOT EXISTS demo_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO demo_settings (key, value_json, updated_at)
VALUES ('current', '${JSON.stringify({
  salaryPerPersonMinor: 300000,
  lastSeededAt: now,
  emptyState: true
}).replace(/'/g, "''")}', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = CURRENT_TIMESTAMP;
`;

const tempDir = mkdtempSync(join(tmpdir(), "monies-map-empty-production-"));
const sqlPath = join(tempDir, "empty-production.sql");

try {
  writeFileSync(sqlPath, sql, "utf8");
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", databaseName, "--remote", "--file", sqlPath],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

console.log("Production database was moved to empty-state mode.");
