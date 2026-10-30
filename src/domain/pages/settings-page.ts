import { ensureAppData } from "../app-shell";
import {
  loadAuditEvents,
  loadAccounts,
  loadAppErrorDiagnostics,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  loadHousehold,
  loadIgnoredCategoryMatchRuleIssueIds,
  loadReconciliationExceptions,
  loadUnresolvedTransfers,
  TRANSFER_REVIEW_PAGE_LIMIT
} from "../app-repository";
import { loadCategoryRuleBackfills } from "../app-repository-category-rule-backfill";
import { loadPaymentWays } from "../app-repository-payment-ways";
import { loadShortcutSettingsWithConnections } from "../app-repository-shortcuts";
import type { SettingsPageDto } from "../../types/dto";

// Build the route-owned Settings page DTO.
export async function buildSettingsPageDto(
  db: D1Database,
  environmentShortcutToken?: string | null,
  shortcutEndpoint?: string | null
): Promise<{ settingsPage: SettingsPageDto }> {
  const demo = await ensureAppData(db);
  // Every read starts at once. The rule backfills, the Shortcut settings
  // and the payment ways also need what other reads return; they read
  // their own rows meanwhile and finish when those arrive.
  const accountsRead = loadAccounts(db);
  const rulesRead = loadCategoryMatchRules(db);
  const householdRead = loadHousehold(db);
  const shortcutSettingsRead = loadShortcutSettingsWithConnections(
    db,
    accountsRead,
    environmentShortcutToken,
    shortcutEndpoint?.trim() || undefined
  );
  const [
    accounts,
    categoryMatchRules,
    categoryMatchRuleSuggestions,
    ignoredCategoryMatchRuleIssueIds,
    unresolvedTransfers,
    reconciliationExceptions,
    recentAuditEvents,
    errorDiagnostics,
    categoryRuleBackfills,
    shortcutSettings,
    paymentWays
  ] = await Promise.all([
    accountsRead,
    rulesRead,
    loadCategoryMatchRuleSuggestions(db),
    loadIgnoredCategoryMatchRuleIssueIds(db),
    loadUnresolvedTransfers(db, { limit: TRANSFER_REVIEW_PAGE_LIMIT }),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db),
    loadCategoryRuleBackfills(db, rulesRead),
    shortcutSettingsRead,
    // The PayNow default follows Default account priority, so it is
    // resolved with the Shortcut settings.
    loadPaymentWays(db, Promise.all([accountsRead, householdRead, shortcutSettingsRead]).then(([accountList, household, shortcuts]) => ({
      accounts: accountList,
      people: household.people,
      priorityIds: shortcuts.defaultAccountPriorityIds
    })))
  ]);
  return {
    settingsPage: {
      accounts,
      shortcutSettings,
      paymentWays,
      demo,
      categoryMatchRules,
      categoryMatchRuleSuggestions,
      categoryRuleBackfills,
      ignoredCategoryMatchRuleIssueIds,
      unresolvedTransfers,
      reconciliationExceptions,
      recentAuditEvents,
      errorDiagnostics
    }
  };
}
