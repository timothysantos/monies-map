import { ensureAppData } from "../app-shell";
import {
  loadAuditEvents,
  loadAccounts,
  loadAppErrorDiagnostics,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  loadIgnoredCategoryMatchRuleIssueIds,
  loadReconciliationExceptions,
  loadUnresolvedTransfers
} from "../app-repository";
import { loadShortcutSettings } from "../app-repository-shortcuts";
import type { SettingsPageDto } from "../../types/dto";

// Build the route-owned Settings page DTO.
export async function buildSettingsPageDto(
  db: D1Database,
  environmentShortcutToken?: string | null
): Promise<{ settingsPage: SettingsPageDto }> {
  const demo = await ensureAppData(db);
  const [
    accounts,
    categoryMatchRules,
    categoryMatchRuleSuggestions,
    ignoredCategoryMatchRuleIssueIds,
    unresolvedTransfers,
    reconciliationExceptions,
    recentAuditEvents,
    errorDiagnostics
  ] = await Promise.all([
    loadAccounts(db),
    loadCategoryMatchRules(db),
    loadCategoryMatchRuleSuggestions(db),
    loadIgnoredCategoryMatchRuleIssueIds(db),
    loadUnresolvedTransfers(db),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db)
  ]);
  const shortcutSettings = await loadShortcutSettings(db, accounts, environmentShortcutToken);
  return {
    settingsPage: {
      accounts,
      shortcutSettings,
      demo,
      categoryMatchRules,
      categoryMatchRuleSuggestions,
      ignoredCategoryMatchRuleIssueIds,
      unresolvedTransfers,
      reconciliationExceptions,
      recentAuditEvents,
      errorDiagnostics
    }
  };
}
