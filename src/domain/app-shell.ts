import { buildEmptySummaryMonth } from "./summary-projection";
import { buildPersonScopes } from "./person-view-scope";

import { defaultDemoSettings, type DemoSettings } from "./demo-data";
import { loadDemoSettings } from "./demo-settings";

import {
  loadCategories,
  loadHousehold,
  findSuggestedLoginPersonId,
  resolveLoginIdentityPersonId,
  loadTrackedMonths
} from "./app-repository";
import { ensureSeedData, seedEmptyStateReferenceData } from "./app-repository-seed";
import { ensureDemoSchema } from "./app-repository-schema";

import type {
  AppShellDto,
  EntriesShellDto,
  ContextViewDto,
  EntryDto,
  SplitGroupDto,
  SplitGroupPillDto
} from "../types/dto";

let appDataReadyPromise: Promise<DemoSettings> | null = null;

// This module owns shell orchestration and shell-shared DTO builders.
// Route-specific fragments belong in `src/domain/route-context.ts`,
// `src/domain/page-labels.ts`, or the relevant page module, not here.
export function invalidateAppDataCache() {
  appDataReadyPromise = null;
}

export function primeAppDataCache(demo: DemoSettings) {
  appDataReadyPromise = Promise.resolve(demo);
}

export async function loadAppShellContext(
  db: D1Database,
  viewerEmail?: string,
  appEnvironment?: EntriesShellDto["appEnvironment"]
): Promise<AppShellDto> {
  await ensureAppData(db);
  // Load the global shell metadata without pulling any route-specific page
  // payloads into the shell response.
  const [household, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadTrackedMonths(db)
  ]);
  const viewerPersonId = await resolveLoginIdentityPersonId(db, viewerEmail);
  const suggestedPersonId = viewerEmail && !viewerPersonId
    ? await findSuggestedLoginPersonId(db)
    : undefined;

  return {
    appEnvironment,
    household,
    availableViewIds: ["household", ...household.people.map((person) => person.id)],
    selectedViewId: "household",
    trackedMonths,
    viewerPersonId,
    viewerIdentity: viewerEmail ? {
      email: viewerEmail,
      personId: viewerPersonId
    } : undefined,
    viewerRegistration: viewerEmail && suggestedPersonId ? {
      email: viewerEmail,
      suggestedPersonId
    } : undefined
  };
}

export async function ensureAppData(db: D1Database) {
  appDataReadyPromise ??= initializeAppData(db);
  try {
    return await appDataReadyPromise;
  } catch (error) {
    appDataReadyPromise = null;
    throw error;
  }
}

async function initializeAppData(db: D1Database) {
  const demo = await loadDemoSettings(db).catch(() => defaultDemoSettings);
  await ensureDemoSchema(db);
  if (demo.emptyState) {
    await seedEmptyStateReferenceData(db);
  } else {
    await ensureSeedData(db, demo);
  }
  return demo;
}

export async function loadPageShell(db: D1Database, selectedViewId: string) {
  const [household, categories, trackedMonths] = await Promise.all([
    loadHousehold(db),
    loadCategories(db),
    loadTrackedMonths(db)
  ]);
  const personNameById = Object.fromEntries(household.people.map((person) => [person.id, person.name]));
  const viewId = selectedViewId === "household" || household.people.some((person) => person.id === selectedViewId)
    ? selectedViewId
    : "household";
  const label = viewId === "household" ? "Household" : personNameById[viewId] ?? "Household";

  return {
    household,
    categories,
    trackedMonths,
    viewId,
    label,
    personNameById
  };
}

export function buildEntriesContextView(
  id: string,
  label: string,
  entries: EntryDto[],
  splitGroups: SplitGroupDto[],
  selectedMonth: string,
  availableMonths: string[]
): ContextViewDto {
  return {
    id,
    label,
    summaryPage: {
      metricCards: [],
      availableMonths,
      rangeStartMonth: selectedMonth,
      rangeEndMonth: selectedMonth,
      rangeMonths: [selectedMonth],
      months: [buildEmptySummaryMonth(selectedMonth)],
      categoryShareChart: [],
      categoryShareByMonth: [],
      notes: []
    },
    monthPage: {
      month: selectedMonth,
      selectedPersonId: id,
      selectedScope: "direct_plus_shared",
      scopes: buildPersonScopes(id),
      metricCards: [],
      monthNote: "",
      incomeRows: [],
      planSections: [],
      categoryShareChart: [],
      entries
    },
    splitsPage: {
      month: selectedMonth,
      groups: buildEntriesSplitShellGroups(splitGroups),
      activity: [],
      matches: [],
      donutChart: [],
      settlementCheckpoints: [],
      activityHistory: []
    }
  };
}

function buildEntriesSplitShellGroups(splitGroups: SplitGroupDto[]): SplitGroupPillDto[] {
  return [
    {
      id: "split-group-none",
      name: "Non-group expenses",
      iconKey: "receipt",
      balanceMinor: 0,
      summaryText: "",
      entryCount: 0,
      pendingMatchCount: 0,
      currency: "SGD",
      expenseSource: "mixed",
      isDefault: false
    },
    ...splitGroups.map((group) => ({
      id: group.id,
      name: group.name,
      iconKey: group.iconKey,
      balanceMinor: 0,
      summaryText: "",
      entryCount: 0,
      pendingMatchCount: 0,
      currency: group.currency,
      expenseSource: group.expenseSource,
      isDefault: false
    }))
  ];
}

