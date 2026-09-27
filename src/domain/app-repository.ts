import { ensureDemoSchema } from "./app-repository-schema";

import { household as defaultHousehold } from "./demo-data";
import { slugify } from "./app-repository-helpers";

export {
  buildAccountCheckpointLedgerCsv,
  compareAccountCheckpointStatementRows,
  deleteAccountCheckpointRecord,
  saveAccountCheckpointRecord
} from "./app-repository-checkpoints";
export {
  deleteCategoryMatchRule,
  ignoreCategoryMatchRuleIssue,
  ignoreCategoryMatchRuleSuggestion,
  loadCategoryMatchRules,
  loadIgnoredCategoryMatchRuleIssueIds,
  loadCategoryMatchRuleSuggestions,
  matchCategoryRule,
  recordVerifiedAiCategoryMatchSuggestion,
  saveCategoryMatchRule
} from "./app-repository-category-match-rules";
export {
  createCategoryRecord,
  deleteCategoryRecord,
  loadCategories,
  updateCategoryRecord
} from "./app-repository-categories";
export { loadEntries, loadEntriesForMonths, loadTransferMatchCandidates } from "./app-repository-entries";
export { buildImportPreview } from "./app-repository-import-preview";
export { loadImportBatches } from "./app-repository-import-history";
export {
  loadAppErrorDiagnostics,
  recordAppErrorDiagnostic,
  retainLatestAppErrorDiagnostics
} from "./app-repository-error-diagnostics";
export {
  createReconciliationExceptionRecord,
  loadReconciliationExceptions,
  resolveReconciliationExceptionRecord
} from "./app-repository-reconciliation-exceptions";
export {
  loadMonthIncomeRows,
  loadMonthIncomeRowsForViews,
  loadMonthPlanRows,
  loadSummaryMonths,
  loadSummaryMonthsForScopes,
  loadTrackedMonths
} from "./app-repository-months";
export {
  createSplitExpenseFromEntryRecord,
  createSplitExpenseRecord,
  createSplitGroupRecord,
  createSplitSettlementRecord,
  createSplitSettlementCheckpoint,
  deleteSplitExpenseRecord,
  deleteSplitSettlementRecord,
  linkSplitExpenseMatch,
  linkSplitSettlementMatch,
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlements,
  loadSplitSettlementCheckpoints,
  loadSplitActivityHistory,
  matchSplitSettlementCheckpoint,
  unmatchSplitSettlementCheckpoint,
  markSplitSettlementCheckpointPaid,
  undoSplitSettlementCheckpointPaid,
  reopenSplitSettlementCheckpoint,
  updateSplitExpenseCategoryRecord,
  updateSplitExpenseRecord,
  updateSplitExpenseNoteRecord,
  updateSplitSettlementNoteRecord,
  updateSplitSettlementRecord,
  restoreSplitRecord
} from "./app-repository-splits";
export {
  archiveAccountRecord,
  loadAccountReferences,
  createAccountRecord,
  loadAccounts,
  loadAuditEvents,
  loadHousehold,
  loadUnresolvedTransfers,
  TRANSFER_REVIEW_PAGE_LIMIT,
  updateAccountRecord,
  updatePersonRecord
} from "./app-repository-settings";

const DEFAULT_HOUSEHOLD_ID = defaultHousehold.id;

export async function resolveLoginIdentityPersonId(db: D1Database, email?: string | null) {
  if (!email?.trim()) {
    return undefined;
  }

  await ensureDemoSchema(db);
  const identity = await db
    .prepare(`
      SELECT person_id
      FROM login_identities
      WHERE household_id = ? AND provider = ? AND email = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email.trim().toLowerCase())
    .first<{ person_id: string }>();

  return identity?.person_id;
}

export async function findSuggestedLoginPersonId(db: D1Database) {
  await ensureDemoSchema(db);
  const person = await db
    .prepare(`
      SELECT people.id
      FROM people
      LEFT JOIN login_identities
        ON login_identities.household_id = people.household_id
       AND login_identities.person_id = people.id
      WHERE people.household_id = ? AND login_identities.id IS NULL
      ORDER BY people.created_at
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();

  if (person?.id) {
    return person.id;
  }

  const fallback = await db
    .prepare(`
      SELECT id
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();

  return fallback?.id;
}

export async function registerLoginIdentity(db: D1Database, input: { email: string; personId: string; name?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Missing login email");
  }

  await ensureDemoSchema(db);

  const person = await db
    .prepare("SELECT id FROM people WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.personId)
    .first<{ id: string }>();
  if (!person) {
    throw new Error("Unknown household profile");
  }

  if (input.name?.trim()) {
    await db
      .prepare("UPDATE people SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(input.name.trim(), DEFAULT_HOUSEHOLD_ID, input.personId)
      .run();
  }

  await db
    .prepare(`
      INSERT INTO login_identities (
        id, household_id, provider, email, person_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(household_id, provider, email) DO UPDATE SET
        person_id = excluded.person_id,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(`login-cloudflare-${slugify(email)}`, DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email, input.personId)
    .run();

  return { personId: input.personId };
}

export async function unregisterLoginIdentity(db: D1Database, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Missing login email");
  }

  await ensureDemoSchema(db);
  await db
    .prepare(`
      DELETE FROM login_identities
      WHERE household_id = ? AND provider = ? AND email = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", normalizedEmail)
    .run();

  return { unregistered: true };
}
