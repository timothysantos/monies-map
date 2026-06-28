import { ensureAppData } from "../app-shell";
import {
  loadAuditEvents,
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
    categoryMatchRules,
    categoryMatchRuleSuggestions,
    unresolvedTransfers,
    reconciliationExceptions,
    recentAuditEvents,
    errorDiagnostics
  ] = await Promise.all([
    loadCategoryMatchRules(db),
    loadCategoryMatchRuleSuggestions(db),
    loadUnresolvedTransfers(db),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db)
  ]);
  return {
    settingsPage: {
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
