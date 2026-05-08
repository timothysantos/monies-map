import { getCurrentMonthKey } from "../lib/month";
import {
  adjustEntriesForView,
  buildEntriesContextView,
  ensureAppData,
  loadAppShellContext
} from "./bootstrap";
import {
  findSuggestedLoginPersonId,
  loadAccounts,
  loadCategories,
  loadEntries,
  loadHousehold,
  loadSplitGroups,
  loadTrackedMonths,
  resolveLoginIdentityPersonId
} from "./app-repository";
import type {
  AppBootstrapDto,
  AppShellDto,
} from "../types/dto";

export async function buildAppShellDto(
  db: D1Database,
  viewerEmail?: string,
  appEnvironment?: AppBootstrapDto["appEnvironment"]
): Promise<AppShellDto> {
  return loadAppShellContext(db, viewerEmail, appEnvironment);
}

export async function buildEntriesBootstrapDto(
  db: D1Database,
  selectedViewId = "household",
  selectedMonth = getCurrentMonthKey(),
  viewerEmail?: string,
  appEnvironment?: AppBootstrapDto["appEnvironment"]
): Promise<AppBootstrapDto> {
  const demo = await ensureAppData(db);
  const [household, accounts, categories, trackedMonths, splitGroups] = await Promise.all([
    loadHousehold(db),
    loadAccounts(db),
    loadCategories(db),
    loadTrackedMonths(db),
    loadSplitGroups(db)
  ]);
  const effectiveSelectedMonth = trackedMonths.includes(selectedMonth)
    ? selectedMonth
    : trackedMonths[trackedMonths.length - 1] ?? selectedMonth;
  const availableMonths = trackedMonths.length ? trackedMonths : [effectiveSelectedMonth];
  const monthEntries = await loadEntries(db, effectiveSelectedMonth);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewIds = ["household", ...household.people.map((person) => person.id)];
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const viewerPersonId = await resolveLoginIdentityPersonId(db, viewerEmail);
  const suggestedPersonId = viewerEmail && !viewerPersonId
    ? await findSuggestedLoginPersonId(db)
    : undefined;
  const views = viewIds.map((id) =>
    buildEntriesContextView(
      id,
      personNameById[id] ?? "Household",
      adjustEntriesForView(monthEntries, id),
      splitGroups,
      effectiveSelectedMonth,
      availableMonths
    )
  );

  return {
    appEnvironment,
    household,
    accounts,
    categories,
    views,
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
      demo,
      categoryMatchRules: [],
      categoryMatchRuleSuggestions: [],
      unresolvedTransfers: [],
      reconciliationExceptions: [],
      recentAuditEvents: []
    }
  };
}
