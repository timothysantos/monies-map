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
import { loadShortcutSettings } from "../app-repository-shortcuts";
import { loadLegacyLedgerOwnershipRepairStatus } from "../app-repository-repairs";
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
    unresolvedTransfers,
    reconciliationExceptions,
    recentAuditEvents,
    errorDiagnostics,
    legacyLedgerOwnershipRepair
  ] = await Promise.all([
    loadAccounts(db),
    loadCategoryMatchRules(db),
    loadCategoryMatchRuleSuggestions(db),
    loadUnresolvedTransfers(db),
    loadReconciliationExceptions(db),
    loadAuditEvents(db),
    loadAppErrorDiagnostics(db),
    loadLegacyLedgerOwnershipRepairStatus(db)
  ]);
  const shortcutSettings = await loadShortcutSettings(db, accounts, environmentShortcutToken);
  return {
    settingsPage: {
      accounts,
      shortcutSettings,
      legacyLedgerOwnershipRepair,
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
