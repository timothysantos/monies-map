import { ensureAppData, loadAppShellContext } from "./app-shell";
import {
  findSuggestedLoginPersonId,
  loadCategories,
  loadAccountReferences,
  loadHousehold,
  resolveLoginIdentityPersonId
} from "./app-repository";
import { loadShortcutSettings } from "./app-repository-shortcuts";
import type {
  EntriesShellDto,
  AppShellDto,
  ReferenceDataDto,
} from "../types/dto";

// Build the cached app shell payload that the client loads on first paint.
export async function buildAppShellDto(
  db: D1Database,
  viewerEmail?: string,
  appEnvironment?: EntriesShellDto["appEnvironment"]
): Promise<AppShellDto> {
  return loadAppShellContext(db, viewerEmail, appEnvironment);
}

export async function buildReferenceDataDto(db: D1Database): Promise<ReferenceDataDto> {
  const [accounts, categories] = await Promise.all([
    loadAccountReferences(db),
    loadCategories(db)
  ]);

  return {
    accounts,
    categories
  };
}

// Build the dedicated entries shell payload for the entries workflow: the
// shell and the Shortcut defaults an Entries launch (a Shortcut opening the
// quick add) reads before the full app shell arrives. It once also carried
// the month's entries for every view, which no screen reads (Entries reads
// /api/entries-page): ~535 KB, 58 KB gzip, on production's ledger.
export async function buildEntriesShellDto(
  db: D1Database,
  selectedViewId = "household",
  viewerEmail?: string,
  appEnvironment?: EntriesShellDto["appEnvironment"]
): Promise<EntriesShellDto> {
  const demo = await ensureAppData(db);
  const accountsRead = loadAccountReferences(db);
  const [household, accounts, categories, viewerPersonId, shortcutSettings] = await Promise.all([
    loadHousehold(db),
    accountsRead,
    loadCategories(db),
    resolveLoginIdentityPersonId(db, viewerEmail),
    loadShortcutSettings(db, accountsRead)
  ]);
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const suggestedPersonId = viewerEmail && !viewerPersonId
    ? await findSuggestedLoginPersonId(db)
    : undefined;

  return {
    appEnvironment,
    household,
    accounts,
    categories,
    selectedViewId: viewId,
    viewerPersonId,
    viewerIdentity: viewerEmail ? {
      email: viewerEmail,
      personId: viewerPersonId
    } : undefined,
    viewerRegistration: viewerEmail && suggestedPersonId ? {
      email: viewerEmail,
      suggestedPersonId
    } : undefined,
    importsPage: {
      recentImports: [],
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    },
    settingsPage: {
      accounts: [],
      shortcutSettings: {
        ...shortcutSettings,
        apiKey: "",
        apiKeySource: "none"
      },
      paymentWays: [],
      demo,
      categoryMatchRules: [],
      categoryMatchRuleSuggestions: [],
      categoryRuleBackfills: [],
      ignoredCategoryMatchRuleIssueIds: [],
      unresolvedTransfers: [],
      reconciliationExceptions: [],
      recentAuditEvents: [],
      errorDiagnostics: []
    }
  };
}
