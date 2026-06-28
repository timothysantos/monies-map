import { ensureAppData } from "../app-shell";
import {
  loadAuditEvents,
  loadAccounts,
  loadAppErrorDiagnostics,
  loadCategoryMatchRules,
  loadCategoryMatchRuleSuggestions,
  loadReconciliationExceptions,
  loadUnresolvedTransfers
} from "../app-repository";
import type { SettingsPageDto } from "../../types/dto";

// Build the route-owned Settings page DTO.
export async function buildSettingsPageDto(db: D1Database): Promise<{ settingsPage: SettingsPageDto }> {
  const demo = await ensureAppData(db);
  const [
    accounts,
    categoryMatchRules,
    categoryMatchRuleSuggestions,
    unresolvedTransfers,
    reconciliationExceptions,
    recentAuditEvents,
    errorDiagnostics
  ] = await Promise.all([
    loadAccounts(db),
    loadCategoryMatchRules(db),
    loadCategoryMatchRuleSuggestions(db),
    loadUnresolvedTransfers(db),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db)
  ]);
  return {
    settingsPage: {
      accounts,
      demo,
      categoryMatchRules,
      categoryMatchRuleSuggestions,
      unresolvedTransfers,
      reconciliationExceptions,
      recentAuditEvents,
      errorDiagnostics
    }
  };
}
