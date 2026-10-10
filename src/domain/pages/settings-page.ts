import { ensureAppData } from "../app-shell";
import {
  loadAuditEvents,
  loadAccounts,
  loadAppErrorDiagnostics,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  loadIgnoredCategoryMatchRuleIssueIds,
  loadReconciliationExceptions,
  loadUnresolvedTransfers,
  TRANSFER_REVIEW_PAGE_LIMIT
} from "../app-repository";
import { loadCategoryRuleBackfills } from "../app-repository-category-rule-backfill";
import { loadShortcutSettings } from "../app-repository-shortcuts";
import type { SettingsPageDto } from "../../types/dto";

// Build the route-owned Settings page DTO.
export async function buildSettingsPageDto(
  db: D1Database,
  environmentShortcutToken?: string | null,
  shortcutEndpoint?: string | null
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
    loadUnresolvedTransfers(db, { limit: TRANSFER_REVIEW_PAGE_LIMIT }),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db)
  ]);
  const categoryRuleBackfills = await loadCategoryRuleBackfills(db, categoryMatchRules);
  const shortcutSettings = await loadShortcutSettings(
    db,
    accounts,
    environmentShortcutToken,
    shortcutEndpoint?.trim() || undefined
  );
  return {
    settingsPage: {
      accounts,
      shortcutSettings,
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
