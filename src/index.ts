import {
  buildAppShellDto,
  buildEntriesShellDto,
  buildReferenceDataDto
} from "./domain/app-shell-dto";
import {
  applyRememberedTransferPurposes,
  applyRememberedTransferPurposesForImport,
  setTransferPurposeRecord,
  TransferPurposeError
} from "./domain/app-repository-transfer-purpose";
import {
  configureAppData,
  invalidateAppDataCache,
  resetAppData
} from "./domain/app-shell";
import type { ImportPreviewRowDto, StatementFixDto, StatementNoticeDto } from "./types/dto";
import { buildEntriesPageDto } from "./domain/pages/entries-page";
import { buildImportsPageDto } from "./domain/pages/imports-page";
import { buildRemindersDto } from "./domain/pages/reminders";
import { buildRepeatingChargesDto } from "./domain/pages/repeating-charges";
import { buildInvestmentsOverTimeDto } from "./domain/pages/investments-over-time";
import { buildTaxReliefsDto } from "./domain/pages/tax-reliefs";
import { buildTripPageDayDto, buildTripPageDto } from "./domain/trip-page-projection";
import { buildSummaryChangedDto } from "./domain/pages/summary-changed";
import { handleRepeatingChoiceRoute, REPEATING_CHOICE_PATH } from "./server/repeating-charges-route";
import { CARD_REWARD_PATHS, handleCardRewardsRoute } from "./server/card-rewards-route";
import { buildLedgerCheckupDto, readLedgerCheckupView } from "./domain/pages/ledger-checkup";
import { buildClearPairsPreviewDto } from "./domain/pages/ledger-checkup-clear-pairs";
import { handleLedgerCheckupWrite, isLedgerCheckupWritePath, LEDGER_CHECKUP_CLEAR_PAIRS_PATH } from "./server/ledger-checkup-route";
import { handleSplitCorrectionRoute, isSplitCorrectionPath } from "./server/split-corrections-route";
import { buildMonthPageDto } from "./domain/pages/month-page";
import { buildSettingsPageDto } from "./domain/pages/settings-page";
import { buildSkewCandidatesDto } from "./domain/pages/skew-candidates";
import { updateEntryAccountRecord } from "./domain/app-repository-entry-account";
import { buildCategoryGuess, readCategoryGuessRequest } from "./domain/pages/category-guess";
import { buildCardSuggestion,CardSuggestionEntryNotFound, readCardSuggestionRequest } from "./domain/pages/card-suggestion";
import { buildSplitSuggestionDto,readSplitSuggestionRequest, SplitSuggestionEntryNotFound } from "./domain/pages/split-suggestion";
import { buildSplitsPageDto } from "./domain/pages/splits-page";
import { buildSettledRowsDto, buildSettledSearchDto } from "./domain/pages/splits-settled";
import { buildTransferDraftCandidatesDto, readTransferDraftQuery } from "./domain/pages/transfer-draft-candidates";
import { buildSummaryAccountPillsDto } from "./domain/pages/summary-account-pills";
import { buildSummaryPageDto } from "./domain/pages/summary-page";
import { enterEmptyState, reseedDemoSettings, showcaseRefreshesItself } from "./domain/demo-settings";
import {
  archiveAccountRecord,
  loadTransferMatchCandidates,
  loadCategoryMatchRules,
  matchCategoryRule,
  recordAppErrorDiagnostic,
  buildAccountCheckpointLedgerCsv,
  buildImportPreview,
  compareAccountCheckpointStatementRows,
  createSplitExpenseRecord,
  createSplitExpenseFromEntryRecord,
  createSplitGroupRecord,
  createSplitSettlementRecord,
  createSplitSettlementCheckpoint,
  createCategoryRecord,
  createAccountRecord,
  createReconciliationExceptionRecord,
  deleteSplitExpenseRecord,
  deleteSplitSettlementRecord,
  deleteCategoryMatchRule,
  deleteAccountCheckpointRecord,
  deleteCategoryRecord,
  ignoreCategoryMatchRuleSuggestion,
  retainLatestAppErrorDiagnostics,
  resolveReconciliationExceptionRecord,
  saveAccountCheckpointRecord,
  saveCategoryMatchRule,
  linkSplitExpenseMatch,
  linkSplitSettlementMatch,
  registerLoginIdentity,
  unregisterLoginIdentity,
  updateSplitExpenseCategoryRecord,
  updateSplitExpenseRecord,
  updateSplitExpenseNoteRecord,
  updateSplitSettlementNoteRecord,
  updateSplitSettlementRecord,
  matchSplitSettlementCheckpoint,
  unmatchSplitSettlementCheckpoint,
  markSplitSettlementCheckpointPaid,
  undoSplitSettlementCheckpointPaid,
  reopenSplitSettlementCheckpoint,
  updateAccountRecord,
  updateCategoryRecord,
  updatePersonRecord,
  loadSplitActivityHistory,
  restoreSplitRecord
} from "./domain/app-repository";
import { commitImportBatch, rollbackImportBatch } from "./domain/app-repository-import-commit";
import { buildStatementCompareDiagnosis, type StatementCompareSection } from "./domain/statement-compare-projection";
import { convertForeignAmount, describeForeignAmount, formatForeignAmount, FxRateUnavailableError } from "./domain/foreign-currency";
import { applyStatementCorrections, StatementCorrectionRefusedError, undoStatementCorrections, type StatementCorrectionDto } from "./domain/app-repository-statement-corrections";
import {
  applyMonthPlanChanges,
  deleteMonthPlan,
  deleteMonthPlanRow,
  MonthPlanChangeError,
  duplicateMonthPlan,
  resetMonthPlan,
  saveMonthPlanEntryLinks,
  saveMonthPlanRow,
  updateMonthlySnapshotNote
} from "./domain/app-repository-month-commands";
import {
  createEntryRecord,
  deleteEntryRecord,
  isAskEntryReference,
  linkTransferPair,
  settleTransferPair,
  updateEntryCategoriesRecord,
  updateEntryCategoryRecord,
  updateEntryClassificationRecord,
  updateEntryNoteRecord,
  updateEntryPostDateRecord,
  updateEntryRecord
} from "./domain/app-repository-entry-commands";
import { ensureDemoSchemaTimed } from "./domain/app-repository-schema";
import { ignoreCategoryMatchRuleIssue } from "./domain/app-repository-category-match-rules";
import { applyCategoryRuleToPastEntries } from "./domain/app-repository-category-rule-backfill";
import {
  dismissAllUnresolvedTransfers,
  dismissUnresolvedTransfer
} from "./domain/app-repository-settings";
import { reopenSplitBatchRecord } from "./domain/app-repository-splits";
import { savePaymentWay } from "./domain/app-repository-payment-ways";
import {
  loadShortcutConnectionRecords,
  resolveShortcutAccountSelection,
  revokeShortcutConnection,
  saveShortcutSettings,
  SHORTCUT_ENDPOINT_PATH,
  type ShortcutConnectionRecord
} from "./domain/app-repository-shortcuts";
import {
  hasOversizedShortcutDescription,
  isShortcutEntryType,
  isShortcutOwnershipType,
  isShortcutTransferDirection,
  isShortcutAmountMissing,
  normalizeShortcutAmount,
  normalizeShortcutCurrency,
  normalizeShortcutDate,
  normalizeShortcutDescription,
  normalizeShortcutNote,
  normalizeShortcutRequestId,
  parseShortcutCreateBody,
  SHORTCUT_NOTE_MAX_LENGTH
} from "./domain/shortcut-entry-contract";
import { entryTimeFieldError, validateEntryCreateFields } from "./domain/entry-create-validation";
import { parseCsv } from "./lib/csv";
import { getCurrentMonthKey } from "./lib/month";
import { json, jsonFromText, serializeJson } from "./server/json";
import { SplitSettlementLockedError } from "./domain/split-settlement-lock";
import { getAuthenticatedEmail } from "./server/access-identity";
import { checkAccess } from "./server/access-jwt";
import { handleAiAssistRoute } from "./server/ai-assistance-routes";
import { handleAskTurn } from "./server/ask-turn-route";
import { handleAskHabitsRoute } from "./server/ask-habits-routes";
import { applyHabitsToNewEntry } from "./server/ask-auto-apply";
import { learnCategoryHabit, learnCategoryHabitForEntry, learnSplitHabitFromEntry } from "./domain/app-repository-ask-habits";
import { aiVisitorKey } from "./domain/ai-assistance";
import { handleViewerPreferencesRoute, isViewerPreferencesPath } from "./server/viewer-preferences-route";
import { handleTripEventsRoute, isTripEventsPath } from "./server/trip-events-route";
import { handleUsuallySharedRoute, isUsuallySharedPath } from "./server/usually-shared-route";
import { followSplitGroupTripEvent } from "./domain/app-repository-trip-events";
import { isCrossSiteWrite } from "./server/cross-site-guard";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./server/limited-body";
import { buildServerTimingHeader, timeInitialization } from "./server/server-timing";
import {
  buildShortcutEntryOpenUrl,
  findShortcutConnectionByKey,
  isShortcutCreateRequestAllowed,
  isShortcutGatewayRequestAllowed
} from "./server/shortcut-gateway";

// A refused write returns its message. One refused by the settlement lock is
// a 409 that names the settlement (a simplification's checkpointId or a group
// settle-up's batchId), so the client can offer the matching undo first.
function splitWriteErrorResponse(error: unknown, fallback: string) {
  if (error instanceof SplitSettlementLockedError) {
    return json({ ok: false, error: error.message, code: error.code, checkpointId: error.checkpointId, batchId: error.batchId }, 409);
  }
  return json({ ok: false, error: error instanceof Error ? error.message : fallback }, 400);
}

export interface Env {
  DB: D1Database;
  AI?: Ai;
  APP_ENVIRONMENT?: "demo" | "local" | "production" | "test";
  DEMO_SEED_MONTH?: string;
  // "showcase" seeds the showcase demo dataset on /api/demo/reseed
  // (docs/demo-tour.md); unset or any other value seeds the default demo.
  DEMO_DATASET?: string;
  SHORTCUT_API_ONLY?: string;
  SHORTCUT_APP_ORIGIN?: string;
  SHORTCUT_INGEST_TOKEN?: string;
  SHORTCUT_PUBLIC_ENDPOINT?: string;
  // "true" keeps foreign-currency conversion to the saved rate (tests).
  FX_RATES_OFFLINE?: string;
  AI_ASSIST_ENABLED?: string;
  AI_ASSIST_DAILY_LIMIT?: string;
  // The demo's per-visitor daily cap and the request's visitor hash
  // (src/domain/ai-assistance.ts, reserveDailyAiBudget).
  AI_ASSIST_VISITOR_DAILY_LIMIT?: string;
  AI_VISITOR_KEY?: string;
  // Optional Claude via Cloudflare AI Gateway (src/domain/ai-provider.ts,
  // docs/developer-guide.md "Optional AI provider"). All absent: Workers AI
  // is used directly.
  AI_ASSIST_VISION_UNITS?: string;
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_BYOK_ALIAS?: string;
  ANTHROPIC_API_KEY?: string;
  AI_CLAUDE_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  // Claude credit status (src/domain/ai-provider-status.ts): who sees it,
  // the estimate's prices and the credit and warn amounts.
  AI_ALERT_EMAILS?: string;
  AI_CLAUDE_PRICE_IN_PER_MTOK?: string;
  AI_CLAUDE_PRICE_OUT_PER_MTOK?: string;
  AI_CLAUDE_CREDIT_USD?: string;
  AI_CLAUDE_WARN_AT_USD?: string;
  // Monthly Claude budget target (US$, default 8) for auto-balance.
  AI_CLAUDE_MONTHLY_TARGET_USD?: string;
  // Cloudflare Access token check (src/server/access-jwt.ts): "off" (unset),
  // "report" or "enforce", the team domain and the Access application's AUD
  // tag. Production enforces; the demo has its own app tag (report).
  ACCESS_JWT_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const API_PAGE_SLOW_MS = 750;
const SHORTCUT_REQUEST_MAX_AGE_MS = 2 * 60 * 1000;
const SHORTCUT_NONCE_RETENTION_HOURS = 24;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestStartedAt = Date.now();

    if (!isShortcutGatewayRequestAllowed(env.SHORTCUT_API_ONLY, url.pathname, SHORTCUT_ENDPOINT_PATH)) {
      return new Response(null, { status: 404 });
    }

    if (!isShortcutCreateRequestAllowed(url.pathname, request.method, SHORTCUT_ENDPOINT_PATH)) {
      return json({ ok: false, error: "Shortcut direct-create endpoint only accepts POST." }, 405, { Allow: "POST" });
    }

    // The Cloudflare Access token, when ACCESS_JWT_MODE asks for it
    // (src/server/access-jwt.ts): enforce refuses here, before any data work.
    const accessRefusal = await checkAccess(request, env);
    if (accessRefusal) {
      return accessRefusal;
    }

    // Only the demo Worker's showcase rebuilds itself when it is out of date.
    configureAppData({ refreshStaleShowcase: showcaseRefreshesItself(env) });

    // A write that another site's page triggered in a signed-in browser is
    // refused before any schema or data work (src/server/cross-site-guard.ts).
    if (isCrossSiteWrite(request)) {
      return json({ ok: false, error: "Cross-site requests are not allowed." }, 403);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "monies-map" });
    }

    // The demo's per-visitor AI cap (AI_ASSIST_VISITOR_DAILY_LIMIT) counts
    // by a hash of the visitor, never the address itself.
    if (env.AI_ASSIST_VISITOR_DAILY_LIMIT && request.method === "POST" && url.pathname.startsWith("/api/")) {
      env = { ...env, AI_VISITOR_KEY: await aiVisitorKey(request) };
    }

    // Existing production databases may need additive columns before any page
    // DTO reads the newer split schema.
    const initialization = await timeInitialization(() => ensureDemoSchemaTimed(env.DB), Date.now);
    if (!initialization.ok) {
      const requestId = crypto.randomUUID();
      console.error("API init failed", {
        requestId,
        method: request.method,
        path: url.pathname,
        initMs: initialization.initMs,
        error: describeError(initialization.error)
      });
      return json({ ok: false, error: "Initialization failed", requestId }, 500, {
        "server-timing": buildServerTimingHeader({
          initMs: initialization.initMs,
          initCold: initialization.cold,
          totalMs: Date.now() - requestStartedAt
        })
      });
    }
    const timing: RequestTiming = { requestStartedAt, initMs: initialization.initMs, initCold: initialization.cold };

    if (url.pathname === "/api/splits/activity-history" && request.method === "GET") {
      return json({ ok: true, activityHistory: await loadSplitActivityHistory(env.DB) });
    }

    if (url.pathname === "/api/splits/activity-history/restore" && request.method === "POST") {
      const body = await request.json<{ recordKind?: "expense" | "settlement"; recordId?: string }>();
      if (!body.recordKind || !["expense", "settlement"].includes(body.recordKind) || !body.recordId || body.recordId.length > 200) {
        return json({ ok: false, error: "Invalid split history record fields" }, 400);
      }
      try {
        return json({ ok: true, ...(await restoreSplitRecord(env.DB, { recordKind: body.recordKind, recordId: body.recordId })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to restore split" }, 400);
      }
    }

    if (url.pathname === "/api/app-shell") {
      return apiPageResponse("App shell", request, url, () =>
        buildAppShellDto(
          env.DB,
          getAuthenticatedEmail(request),
          getAppEnvironment(env, url)
        ),
        timing
      );
    }

    if (url.pathname === "/api/reference-data") {
      return apiPageResponse("Reference data", request, url, () =>
        buildReferenceDataDto(env.DB),
        timing
      );
    }

    if (url.pathname === "/api/entries-shell") {
      return apiPageResponse("Entries shell", request, url, () =>
        buildEntriesShellDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          getAuthenticatedEmail(request),
          getAppEnvironment(env, url)
        ),
        timing
      );
    }

    if (url.pathname === "/api/entries-page") {
      return apiPageResponse("Entries page", request, url, () =>
        buildEntriesPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          url.searchParams.get("from"),
          url.searchParams.get("trip")
        ),
        timing
      );
    }

    if (url.pathname === "/api/transfers/candidates" && request.method === "GET") {
      const entryId = url.searchParams.get("entryId");
      if (!entryId) {
        return json({ ok: false, error: "Missing transfer candidate entry id" }, 400);
      }

      return json({
        ok: true,
        ...(await loadTransferMatchCandidates(env.DB, entryId))
      });
    }

    // The other-side candidates for a transfer that is not saved yet (an Ask
    // draft): the Entries transfer dialog's own search, read only.
    if (url.pathname === "/api/transfers/draft-candidates" && request.method === "GET") {
      const query = readTransferDraftQuery(url.searchParams);
      if (!query) {
        return json({ ok: false, error: "Missing or invalid transfer draft fields" }, 400);
      }
      return json({ ok: true, candidates: await buildTransferDraftCandidatesDto(env.DB, query) });
    }

    // Read-only skew candidates for a view and month (DOMAIN.md "Skew
    // Candidate"); not part of any page or first-screen payload.
    // `?include=medium` adds the one-sided settlements that name nobody.
    if (url.pathname === "/api/skew-candidates") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Skew candidates only answer GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Skew candidates", request, url, () =>
        buildSkewCandidatesDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          url.searchParams.get("scope"),
          {
            includeMedium: url.searchParams.getAll("include")
              .flatMap((value) => value.split(","))
              .some((value) => value.trim() === "medium")
          }
        ),
        timing
      );
    }

    // Read-only split suggestion for one entry (DOMAIN.md "Split
    // Suggestion"): a saved entry by id, or a new Ask card's fields. POST so
    // a typed shop name stays out of URLs and request logs; it writes
    // nothing.
    if (url.pathname === "/api/splits/suggestion") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Split suggestions only answer POST." }, 405, { Allow: "POST" });
      }
      const suggestionRequest = readSplitSuggestionRequest(await request.json().catch(() => null));
      if (!suggestionRequest) {
        return json({ ok: false, error: "Invalid split suggestion fields" }, 400);
      }
      const startedAt = Date.now();
      try {
        const suggestion = await buildSplitSuggestionDto(env.DB, suggestionRequest);
        return json({ ok: true, suggestion }, 200, {
          "server-timing": buildServerTimingHeader({
            appMs: Date.now() - startedAt,
            initMs: timing.initMs,
            initCold: timing.initCold,
            totalMs: Date.now() - timing.requestStartedAt
          })
        });
      } catch (error) {
        if (error instanceof SplitSuggestionEntryNotFound) {
          return json({ ok: false, error: error.message }, 404);
        }
        console.error("Split suggestion failed", { path: url.pathname, error: describeError(error) });
        return json({ ok: false, error: "Split suggestion failed" }, 500);
      }
    }

    // Read-only card suggestion for one entry (DOMAIN.md "Card Suggestion"):
    // the card the household usually pays this shop with, when it is not
    // the chosen one. No AI, nothing written, never changes the card.
    if (url.pathname === "/api/entries/card-suggestion") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Card suggestions only answer POST." }, 405, { Allow: "POST" });
      }
      const suggestionRequest = readCardSuggestionRequest(await request.json().catch(() => null));
      if (!suggestionRequest) {
        return json({ ok: false, error: "Invalid card suggestion fields" }, 400);
      }
      try {
        return json({ ok: true, suggestion: await buildCardSuggestion(env.DB, suggestionRequest) });
      } catch (error) {
        if (error instanceof CardSuggestionEntryNotFound) {
          return json({ ok: false, error: error.message }, 404);
        }
        console.error("Card suggestion failed", { path: url.pathname, error: describeError(error) });
        return json({ ok: false, error: "Card suggestion failed" }, 500);
      }
    }

    // Read-only best-guess category for one description (DOMAIN.md
    // "Category Guess"): rules, then Ask habits, then the household's own
    // history, then everyday words. No AI, nothing written.
    if (url.pathname === "/api/entries/category-guess") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Category guesses only answer POST." }, 405, { Allow: "POST" });
      }
      const guessRequest = readCategoryGuessRequest(await request.json().catch(() => null));
      if (!guessRequest) {
        return json({ ok: false, error: "Invalid category guess fields" }, 400);
      }
      try {
        return json({ ok: true, guess: await buildCategoryGuess(env.DB, guessRequest) });
      } catch (error) {
        console.error("Category guess failed", { path: url.pathname, error: describeError(error) });
        return json({ ok: false, error: "Category guess failed" }, 500);
      }
    }

    if (url.pathname === "/api/summary-page") {
      return apiPageResponse("Summary page", request, url, () =>
        buildSummaryPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared",
          url.searchParams.get("summary_start") ?? undefined,
          url.searchParams.get("summary_end") ?? undefined
        ),
        timing
      );
    }

    if (url.pathname === "/api/summary-account-pills") {
      return apiPageResponse("Summary account pills", request, url, () =>
        buildSummaryAccountPillsDto(
          env.DB,
          url.searchParams.get("view") ?? "household"
        ),
        timing
      );
    }

    if (url.pathname === "/api/month-page") {
      return apiPageResponse("Month page", request, url, () =>
        buildMonthPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared"
        ),
        timing
      );
    }

    if (url.pathname === "/api/splits-page") {
      return apiPageResponse("Splits page", request, url, () =>
        buildSplitsPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey()
        ),
        timing
      );
    }

    // A settled section's rows, loaded when it is opened, and the Splits
    // search inside settled sections (pages/splits-settled.ts).
    if (url.pathname === "/api/splits/settled-rows" && request.method === "GET") {
      const params = readSplitsSettledParams(url, ["checkpoint", "group", "record"]);
      if (!params || !(params.record || (params.checkpoint && params.group))) {
        return json({ ok: false, error: "Invalid settled rows request" }, 400);
      }
      return apiPageResponse("Settled split rows", request, url, async () => {
        const rows = await buildSettledRowsDto(env.DB, {
          viewId: params.view,
          checkpointId: params.checkpoint,
          groupId: params.group,
          recordId: params.record
        });
        return rows ?? { viewId: params.view, checkpointId: params.checkpoint ?? "", groupId: params.group ?? "", items: [], truncated: false };
      }, timing);
    }

    if (url.pathname === "/api/splits/settled-search" && request.method === "GET") {
      const params = readSplitsSettledParams(url, ["group", "q"]);
      if (!params || !params.group) {
        return json({ ok: false, error: "Invalid settled search request" }, 400);
      }
      return apiPageResponse("Settled split search", request, url, () =>
        buildSettledSearchDto(env.DB, { viewId: params.view, groupId: params.group ?? "", query: params.q ?? "" }), timing);
    }

    if (url.pathname === "/api/imports-page") {
      return apiPageResponse("Imports page", request, url, () => buildImportsPageDto(env.DB), timing);
    }

    // Reminders in Ask (DOMAIN.md "Reminder"): what the fixed rules say is
    // coming up for a view. Read-only, no AI, not part of any page payload.
    if (url.pathname === "/api/reminders") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Reminders only answer GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Reminders", request, url, () => buildRemindersDto(env.DB, url.searchParams.get("view") ?? "household"), timing);
    }

    // Subscriptions and bills on Summary (DOMAIN.md "Repeating Charge"): the
    // charges that come back every month or year, for a view and scope.
    // Read-only, no AI; the card asks for it once the top summary is usable.
    if (url.pathname === REPEATING_CHOICE_PATH) {
      return handleRepeatingChoiceRoute(request, env);
    }
    if (url.pathname === "/api/repeating-charges") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Subscriptions and bills only answer GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Repeating charges", request, url, () => buildRepeatingChargesDto(
        env.DB,
        url.searchParams.get("view") ?? "household",
        (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared"
      ), timing);
    }

    // Investments over time on Summary (DOMAIN.md "Investments Over Time"):
    // what the statements say each investment account is worth and the money
    // put in this year. Read-only, no AI; asked once the top summary is usable.
    if (url.pathname === "/api/investments-over-time") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Investments over time only answers GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Investments over time", request, url, () => buildInvestmentsOverTimeDto(
        env.DB,
        url.searchParams.get("view") ?? "household"
      ), timing);
    }

    // Tax reliefs on Summary (DOMAIN.md "Tax Relief"): each person's SRS and
    // CPF top-ups and charity gifts this year against the yearly limits.
    // Read-only, no AI; asked once the top summary is usable.
    if (url.pathname === "/api/tax-reliefs") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Tax reliefs only answer GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Tax reliefs", request, url, () => buildTaxReliefsDto(
        env.DB,
        url.searchParams.get("view") ?? "household"
      ), timing);
    }

    // What changed this month on Summary (DOMAIN.md "What Changed Card"):
    // the month so far against the same point last month. Read-only, no AI;
    // the card asks for it once the top summary is usable.
    if (url.pathname === "/api/summary-changed") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "What changed only answers GET." }, 405, { Allow: "GET" });
      }
      return apiPageResponse("Summary changed", request, url, () => buildSummaryChangedDto(
        env.DB,
        url.searchParams.get("view") ?? "household",
        (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared"
      ), timing);
    }

    // Miles and cashback on Summary and Settings > Cards and rewards
    // (DOMAIN.md "Card reward rule"). No AI; the card asks once the top
    // summary is usable.
    if (CARD_REWARD_PATHS.has(url.pathname)) {
      return handleCardRewardsRoute(request, env, url, (label, build) => apiPageResponse(label, request, url, build, timing));
    }

    // The Ledger check-up (DOMAIN.md "Ledger Check-up"): one explicit,
    // read-only report; only "This is fine" and its undo write (a setting
    // and an audit event). No AI, no schedule.
    if (url.pathname === "/api/ledger-checkup") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "The Ledger check-up only answers GET." }, 405, { Allow: "GET" });
      }
      const view = readLedgerCheckupView(url.searchParams.get("view"));
      if (view === null) {
        return json({ ok: false, error: "Unknown view." }, 400);
      }
      return apiPageResponse("Ledger check-up", request, url, () =>
        buildLedgerCheckupDto(env.DB, { view, includeDismissed: url.searchParams.get("dismissed") === "1" }), timing);
    }

    // The clear transfer pairs "Link these N clear pairs" would link
    // (read-only; the POST on the same path is the link).
    if (url.pathname === LEDGER_CHECKUP_CLEAR_PAIRS_PATH && request.method === "GET") {
      const view = readLedgerCheckupView(url.searchParams.get("view"));
      if (view === null) {
        return json({ ok: false, error: "Unknown view." }, 400);
      }
      return apiPageResponse("Clear transfer pairs", request, url, () => buildClearPairsPreviewDto(env.DB, { view }), timing);
    }

    if (isLedgerCheckupWritePath(url.pathname)) {
      return handleLedgerCheckupWrite(request, url, env);
    }

    // Split Correction (DOMAIN.md): fix a mistake inside a settled period
    // with a record in the open period (src/server/split-corrections-route.ts).
    if (isSplitCorrectionPath(url.pathname)) {
      return handleSplitCorrectionRoute(request, url, env);
    }

    // Ask's habits, suggestions and Done for you: no AI, deterministic
    // (src/server/ask-habits-routes.ts).
    if (url.pathname.startsWith("/api/ask/") && url.pathname !== "/api/ask/turn") {
      const habitsResponse = await handleAskHabitsRoute(request, url, env);
      if (habitsResponse) {
        return habitsResponse;
      }
    }

    // Ask's turn: AI reads the message into one action, the app checks it
    // (src/server/ask-turn-route.ts); AI off falls back to Ask's rules.
    if (url.pathname === "/api/ask/turn") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "The Ask turn route only answers POST." }, 405, { Allow: "POST" });
      }
      return handleAskTurn(request, env);
    }

    // Usually shared (src/server/usually-shared-route.ts).
    if (isUsuallySharedPath(url.pathname)) {
      return (await handleUsuallySharedRoute(request, url, env))
        ?? json({ ok: false, error: "Not found." }, 404);
    }

    // The trip page (DOMAIN.md "Trip or Event", "Trip page"): one trip's
    // figures grouped in SQL, or one day's entries when the page opens that
    // day. Read-only, no AI. An unknown trip (or another household's) reads
    // as gone: tripPage null.
    if (url.pathname === "/api/trip-page") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "The trip page only answers GET." }, 405, { Allow: "GET" });
      }
      const tripId = url.searchParams.get("trip");
      const day = url.searchParams.get("day");
      if (day !== null) {
        return apiPageResponse("Trip page day", request, url, async () => ({ ok: true, tripDay: await buildTripPageDayDto(env.DB, tripId, day) }), timing);
      }
      return apiPageResponse("Trip page", request, url, async () => ({ ok: true, tripPage: await buildTripPageDto(env.DB, tripId) }), timing);
    }

    // Trips and events (src/server/trip-events-route.ts).
    if (isTripEventsPath(url.pathname)) {
      return (await handleTripEventsRoute(request, url, env))
        ?? json({ ok: false, error: "Not found." }, 404);
    }

    if (isViewerPreferencesPath(url.pathname)) {
      return (await handleViewerPreferencesRoute(request, url, env))
        ?? json({ ok: false, error: "This route only answers POST." }, 405, { Allow: "POST" });
    }

    if (url.pathname.startsWith("/api/ai-assist/")) {
      const aiResponse = await handleAiAssistRoute(request, url, env);
      if (aiResponse) {
        return aiResponse;
      }
    }

    if (url.pathname === "/api/settings-page") {
      return apiPageResponse("Settings page", request, url, () =>
        buildSettingsPageDto(
          env.DB,
          env.SHORTCUT_INGEST_TOKEN,
          env.SHORTCUT_PUBLIC_ENDPOINT
        ),
        timing
      );
    }

    if (url.pathname === "/api/error-diagnostics/record" && request.method === "POST") {
      const body = await request.json<{
        source?: string;
        action?: string;
        previousAction?: string;
        method?: string;
        route?: string;
        status?: number;
        statusText?: string;
        contentType?: string;
        errorMessage?: string;
        possibleReason?: string;
        requestContextJson?: string;
        responseExcerpt?: string;
        responseBody?: string;
      }>();

      if (!body.source || !body.action || !body.errorMessage) {
        return json({ ok: false, error: "Missing diagnostic fields" }, 400);
      }

      return json({
        ok: true,
        ...(await recordAppErrorDiagnostic(env.DB, {
          source: body.source,
          action: body.action,
          previousAction: body.previousAction,
          method: body.method,
          route: body.route,
          status: body.status,
          statusText: body.statusText,
          contentType: body.contentType,
          errorMessage: body.errorMessage,
          possibleReason: body.possibleReason,
          requestContextJson: body.requestContextJson,
          responseExcerpt: body.responseExcerpt,
          responseBody: body.responseBody
        }))
      });
    }

    if (url.pathname === "/api/error-diagnostics/retain-latest" && request.method === "POST") {
      const body = await request.json<{ keep?: number }>().catch(() => ({ keep: undefined }));
      return json({
        ok: true,
        ...(await retainLatestAppErrorDiagnostics(env.DB, body.keep ?? 50))
      });
    }

    if (url.pathname === "/api/settings/shortcuts/save" && request.method === "POST") {
      const body = await request.json<{
        personId?: string;
        apiKey?: string;
        defaultAccountPriorityIds?: string[];
        defaultParams?: string;
        foreignCurrencyAccountId?: string;
      }>().catch(() => ({
        personId: undefined,
        apiKey: undefined,
        defaultAccountPriorityIds: undefined,
        defaultParams: undefined,
        foreignCurrencyAccountId: undefined
      }));

      try {
        return json({
          ok: true,
          ...(await saveShortcutSettings(env.DB, {
            personId: typeof body.personId === "string" ? body.personId : undefined,
            apiKey: body.apiKey ?? "",
            defaultAccountPriorityIds: body.defaultAccountPriorityIds ?? [],
            defaultParams: body.defaultParams ?? "",
            foreignCurrencyAccountId: typeof body.foreignCurrencyAccountId === "string" ? body.foreignCurrencyAccountId : ""
          }, env.SHORTCUT_INGEST_TOKEN))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to save shortcut settings" }, 400);
      }
    }

    // Stops one person's phone: its key no longer saves entries.
    if (url.pathname === "/api/settings/shortcuts/revoke" && request.method === "POST") {
      const body = await request.json<{ personId?: string }>().catch(() => ({ personId: undefined }));
      try {
        return json({
          ok: true,
          ...(await revokeShortcutConnection(env.DB, {
            personId: typeof body.personId === "string" ? body.personId : undefined
          }, env.SHORTCUT_INGEST_TOKEN))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to revoke the shortcut key" }, 400);
      }
    }

    if (url.pathname === "/api/settings/payment-ways/save" && request.method === "POST") {
      const body = await request.json<{
        personId?: unknown;
        bankTransferAccountId?: unknown;
        cashAccountId?: unknown;
      }>().catch(() => null);
      const text = (value: unknown) => (typeof value === "string" ? value : "");
      try {
        return json({
          ok: true,
          ...(await savePaymentWay(env.DB, {
            personId: text(body?.personId),
            bankTransferAccountId: text(body?.bankTransferAccountId),
            cashAccountId: text(body?.cashAccountId)
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to save payment ways" }, 400);
      }
    }

    if (url.pathname === "/api/demo/reseed" && request.method === "POST") {
      if (!canUseDemoControls(env, url)) {
        return json({ ok: false, error: "Demo controls are disabled in production." }, 403);
      }
      const demo = await resetAppData(() => reseedDemoSettings(env.DB, env.DEMO_SEED_MONTH, env.DEMO_DATASET));
      return json({ ok: true, demo });
    }

    if (url.pathname === "/api/demo/empty" && request.method === "POST") {
      if (!canUseDemoControls(env, url)) {
        return json({ ok: false, error: "Demo controls are disabled in production." }, 403);
      }
      const demo = await resetAppData(() => enterEmptyState(env.DB));
      return json({ ok: true, demo });
    }

    if (url.pathname === "/api/accounts/create" && request.method === "POST") {
      const body = await request.json<{
        name?: string;
        institution?: string;
        kind?: string;
        currency?: string;
        openingBalanceMinor?: number;
        ownerPersonId?: string | null;
        isJoint?: boolean;
      }>();

      if (!body.name || !body.institution || !body.kind) {
        return json({ ok: false, error: "Missing account fields" }, 400);
      }

      return json({
        ok: true,
        ...(await createAccountRecord(env.DB, {
          name: body.name,
          institution: body.institution,
          kind: body.kind,
          currency: body.currency ?? "SGD",
          openingBalanceMinor: body.openingBalanceMinor ?? 0,
          ownerPersonId: body.ownerPersonId,
          isJoint: body.isJoint
        }))
      });
    }

    if (url.pathname === "/api/accounts/update" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        name?: string;
        institution?: string;
        kind?: string;
        currency?: string;
        openingBalanceMinor?: number;
        ownerPersonId?: string | null;
        isJoint?: boolean;
      }>();

      if (!body.accountId || !body.name || !body.institution || !body.kind) {
        return json({ ok: false, error: "Missing account fields" }, 400);
      }

      return json({
        ok: true,
        ...(await updateAccountRecord(env.DB, {
          accountId: body.accountId,
          name: body.name,
          institution: body.institution,
          kind: body.kind,
          currency: body.currency ?? "SGD",
          openingBalanceMinor: body.openingBalanceMinor ?? 0,
          ownerPersonId: body.ownerPersonId,
          isJoint: body.isJoint
        }))
      });
    }

    if (url.pathname === "/api/accounts/archive" && request.method === "POST") {
      const body = await request.json<{ accountId?: string }>();
      if (!body.accountId) {
        return json({ ok: false, error: "Missing account id" }, 400);
      }

      return json({
        ok: true,
        ...(await archiveAccountRecord(env.DB, { accountId: body.accountId }))
      });
    }

    if (url.pathname === "/api/people/update" && request.method === "POST") {
      const body = await request.json<{ personId?: string; name?: string }>();
      if (!body.personId || !body.name?.trim()) {
        return json({ ok: false, error: "Missing person fields" }, 400);
      }

      return json({
        ok: true,
        ...(await updatePersonRecord(env.DB, {
          personId: body.personId,
          name: body.name
        }))
      });
    }

    if (url.pathname === "/api/login-identities/register" && request.method === "POST") {
      const authenticatedEmail = getAuthenticatedEmail(request);
      if (!authenticatedEmail) {
        return json({ ok: false, error: "No authenticated login email available" }, 401);
      }

      const body = await request.json<{ personId?: string; name?: string }>();
      if (!body.personId) {
        return json({ ok: false, error: "Missing household profile" }, 400);
      }

      return json({
        ok: true,
        ...(await registerLoginIdentity(env.DB, {
          email: authenticatedEmail,
          personId: body.personId,
          name: body.name
        }))
      });
    }

    if (url.pathname === "/api/login-identities/unregister" && request.method === "POST") {
      const authenticatedEmail = getAuthenticatedEmail(request);
      if (!authenticatedEmail) {
        return json({ ok: false, error: "No authenticated login email available" }, 401);
      }

      return json({
        ok: true,
        ...(await unregisterLoginIdentity(env.DB, authenticatedEmail))
      });
    }

    if (url.pathname === "/api/accounts/reconcile" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        checkpointMonth?: string;
        statementStartDate?: string | null;
        statementEndDate?: string | null;
        statementBalanceMinor?: number;
        note?: string;
      }>();

      if (!body.accountId || !body.checkpointMonth || body.statementBalanceMinor == null) {
        return json({ ok: false, error: "Missing reconciliation fields" }, 400);
      }

      return json({
        ok: true,
        ...(await saveAccountCheckpointRecord(env.DB, {
          accountId: body.accountId,
          checkpointMonth: body.checkpointMonth,
          statementStartDate: body.statementStartDate,
          statementEndDate: body.statementEndDate,
          statementBalanceMinor: body.statementBalanceMinor,
          note: body.note
        }))
      });
    }

    if (url.pathname === "/api/accounts/checkpoints/delete" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        checkpointMonth?: string;
      }>();

      if (!body.accountId || !body.checkpointMonth) {
        return json({ ok: false, error: "Missing checkpoint fields" }, 400);
      }

      return json({
        ok: true,
        ...(await deleteAccountCheckpointRecord(env.DB, {
          accountId: body.accountId,
          checkpointMonth: body.checkpointMonth
        }))
      });
    }

    if (url.pathname === "/api/accounts/checkpoints/export" && request.method === "GET") {
      const accountId = url.searchParams.get("accountId");
      const checkpointMonth = url.searchParams.get("checkpointMonth");
      if (!accountId || !checkpointMonth) {
        return json({ ok: false, error: "Missing checkpoint fields" }, 400);
      }

      const exportResult = await buildAccountCheckpointLedgerCsv(env.DB, {
        accountId,
        checkpointMonth
      });

      return new Response(exportResult.csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportResult.filename}"`
        }
      });
    }

    if (url.pathname === "/api/accounts/checkpoints/compare-statement" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        checkpointMonth?: string;
        rows?: Record<string, string>[];
        uploadedStatementStartDate?: string;
        uploadedStatementEndDate?: string;
        sourceType?: "csv" | "pdf";
        otherSections?: StatementCompareSection[];
      }>();

      if (!body.accountId || !body.checkpointMonth || !body.rows?.length) {
        return json({ ok: false, error: "Missing statement compare fields" }, 400);
      }

      try {
        const comparison = await compareAccountCheckpointStatementRows(env.DB, {
          accountId: body.accountId,
          checkpointMonth: body.checkpointMonth,
          rows: body.rows,
          uploadedStatementStartDate: body.uploadedStatementStartDate,
          uploadedStatementEndDate: body.uploadedStatementEndDate
        });
        const statementDiagnosis = await buildStatementCompareDiagnosis(env.DB, {
          accountId: body.accountId,
          checkpointMonth: body.checkpointMonth,
          statementStartDate: comparison.statementStartDate ?? comparison.statementEndDate,
          statementEndDate: comparison.statementEndDate,
          rows: body.rows,
          otherSections: (body.otherSections ?? []).filter((section) => section?.accountName && Array.isArray(section.rows)),
          sourceType: body.sourceType === "pdf" ? "pdf" : "csv"
        });
        return json({
          ok: true,
          comparison: statementDiagnosis ? { ...comparison, statementDiagnosis } : comparison
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Statement compare failed" }, 400);
      }
    }

    if (url.pathname === "/api/accounts/checkpoints/statement-corrections/apply" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        checkpointMonth?: string;
        corrections?: StatementCorrectionDto[];
      }>();
      const corrections = (body.corrections ?? []).filter((correction) => correction?.kind === "move_to_statement_account" || correction?.kind === "remove_duplicate_entry");
      if (!body.accountId || !body.checkpointMonth || !corrections.length || corrections.length !== body.corrections?.length) {
        return json({ ok: false, error: "Missing statement correction fields" }, 400);
      }
      try {
        return json({
          ok: true,
          ...(await applyStatementCorrections(env.DB, { accountId: body.accountId, checkpointMonth: body.checkpointMonth, corrections }))
        });
      } catch (error) {
        if (error instanceof StatementCorrectionRefusedError) {
          return json({ ok: false, error: error.message }, 409);
        }
        throw error;
      }
    }

    if (url.pathname === "/api/accounts/checkpoints/statement-corrections/undo" && request.method === "POST") {
      const body = await request.json<{ correctionIds?: string[] }>();
      const correctionIds = (body.correctionIds ?? []).filter((id) => typeof id === "string" && id);
      if (!correctionIds.length) {
        return json({ ok: false, error: "Missing statement correction ids" }, 400);
      }
      try {
        return json({ ok: true, ...(await undoStatementCorrections(env.DB, { correctionIds })) });
      } catch (error) {
        if (error instanceof StatementCorrectionRefusedError) {
          return json({ ok: false, error: error.message }, 409);
        }
        throw error;
      }
    }

    if (url.pathname === "/api/reconciliation-exceptions/create" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        transactionId?: string;
        checkpointMonth?: string;
        kind?: "missing_bank_row" | "extra_ledger_row" | "duplicate" | "direction_mismatch" | "wrong_account" | "timing_difference" | "manual_review" | "adjustment_needed";
        severity?: "info" | "review" | "blocking";
        title?: string;
        note?: string;
      }>();

      if (!body.kind || !body.title?.trim()) {
        return json({ ok: false, error: "Missing reconciliation exception fields" }, 400);
      }

      return json({
        ok: true,
        ...(await createReconciliationExceptionRecord(env.DB, {
          accountId: body.accountId,
          transactionId: body.transactionId,
          checkpointMonth: body.checkpointMonth,
          kind: body.kind,
          severity: body.severity,
          title: body.title,
          note: body.note
        }))
      });
    }

    if (url.pathname === "/api/reconciliation-exceptions/resolve" && request.method === "POST") {
      const body = await request.json<{
        exceptionId?: string;
        resolutionNote?: string;
      }>();

      if (!body.exceptionId) {
        return json({ ok: false, error: "Missing reconciliation exception id" }, 400);
      }

      return json({
        ok: true,
        ...(await resolveReconciliationExceptionRecord(env.DB, {
          exceptionId: body.exceptionId,
          resolutionNote: body.resolutionNote
        }))
      });
    }

    if (url.pathname === "/api/months/duplicate" && request.method === "POST") {
      const sourceMonth = url.searchParams.get("source");
      if (!sourceMonth) {
        return json({ ok: false, error: "Missing source month" }, 400);
      }

      return json({ ok: true, ...(await duplicateMonthPlan(env.DB, sourceMonth)) });
    }

    if (url.pathname === "/api/months/reset" && request.method === "POST") {
      const month = url.searchParams.get("month");
      if (!month) {
        return json({ ok: false, error: "Missing month" }, 400);
      }

      return json({ ok: true, ...(await resetMonthPlan(env.DB, month)) });
    }

    if (url.pathname === "/api/months/delete" && request.method === "POST") {
      const month = url.searchParams.get("month");
      if (!month) {
        return json({ ok: false, error: "Missing month" }, 400);
      }

      return json({ ok: true, ...(await deleteMonthPlan(env.DB, month)) });
    }

    if (url.pathname === "/api/entries/update" && request.method === "POST") {
      const body = await request.json<{
        entryId?: string;
        date?: string;
        postDate?: string | null;
        description?: string;
        accountId?: string;
        accountName?: string;
        categoryName?: string;
        amountMinor?: number;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        offsetsCategory?: boolean;
        note?: string;
        splitBasisPoints?: number;
        time?: unknown;
      }>();

      if (!body.entryId || !body.date || !body.description || (!body.accountId && !body.accountName) || !body.categoryName || !body.ownershipType) {
        return json({ ok: false, error: "Missing entry update fields" }, 400);
      }
      const updateTimeError = entryTimeFieldError(body.time);
      if (updateTimeError) {
        return json({ ok: false, error: updateTimeError }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateEntryRecord(env.DB, {
            entryId: body.entryId,
            date: body.date,
            postDate: body.postDate,
            description: body.description,
            accountId: body.accountId,
            accountName: body.accountName,
            categoryName: body.categoryName,
            amountMinor: body.amountMinor,
            entryType: body.entryType,
            transferDirection: body.transferDirection,
            ownershipType: body.ownershipType,
            ownerName: body.ownerName,
            offsetsCategory: body.offsetsCategory,
            note: body.note,
            splitBasisPoints: body.splitBasisPoints,
            time: body.time as string | null | undefined
          }))
        });
      } catch (error) {
        return splitWriteErrorResponse(error, "Failed to update entry");
      }
    }

    if (url.pathname === "/api/entries/update-note" && request.method === "POST") {
      const body = await request.json<{ entryId?: string; note?: string }>();

      if (!body.entryId) {
        return json({ ok: false, error: "Missing entry note fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateEntryNoteRecord(env.DB, {
            entryId: body.entryId,
            note: body.note
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update entry note" }, 400);
      }
    }

    // Only the card changes (Ask's card suggestion, after the person's Yes).
    if (url.pathname === "/api/entries/update-account" && request.method === "POST") {
      const body = await request.json<{ entryId?: unknown; accountId?: unknown }>().catch(() => ({ entryId: undefined, accountId: undefined }));
      if (typeof body.entryId !== "string" || !body.entryId || typeof body.accountId !== "string" || !body.accountId) {
        return json({ ok: false, error: "Missing entry card fields" }, 400);
      }
      try {
        return json({ ok: true, ...(await updateEntryAccountRecord(env.DB, { entryId: body.entryId, accountId: body.accountId })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to change the card" }, 400);
      }
    }

    if (url.pathname === "/api/entries/update-category" && request.method === "POST") {
      const body = await request.json<{
        entryId?: string;
        categoryName?: string;
        changes?: Array<{ entryId?: unknown; fromCategoryName?: unknown; categoryName?: unknown }>;
        confirmedCount?: unknown;
      }>();

      // Many entries at once (Ask's bulk recategorise and its Undo).
      if (Array.isArray(body.changes)) {
        const text = (value: unknown) => (typeof value === "string" ? value : "");
        try {
          return json({
            ok: true,
            ...(await updateEntryCategoriesRecord(env.DB, {
              changes: body.changes.map((change) => ({
                entryId: text(change?.entryId),
                fromCategoryName: text(change?.fromCategoryName),
                categoryName: text(change?.categoryName)
              })),
              confirmedCount: typeof body.confirmedCount === "number" ? body.confirmedCount : undefined
            }))
          });
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update entry categories" }, 400);
        }
      }

      if (!body.entryId || !body.categoryName) {
        return json({ ok: false, error: "Missing entry category fields" }, 400);
      }

      try {
        const updated = await updateEntryCategoryRecord(env.DB, {
          entryId: body.entryId,
          categoryName: body.categoryName
        });
        // The person's own category choice is a habit confirmation (best
        // effort; ask-habits.ts).
        await learnCategoryHabitForEntry(env.DB, { entryId: body.entryId, categoryName: body.categoryName, source: "entries" });
        return json({ ok: true, ...updated });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update entry category" }, 400);
      }
    }

    if (url.pathname === "/api/entries/delete" && request.method === "POST") {
      const body = await request.json<{ entryId?: string }>();

      if (!body.entryId) {
        return json({ ok: false, error: "Missing entry id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await deleteEntryRecord(env.DB, {
            entryId: body.entryId
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete entry" }, 400);
      }
    }

    if (url.pathname === "/api/entries/update-post-date" && request.method === "POST") {
      const body = await request.json<{ entryId?: string; postDate?: string }>();

      if (!body.entryId || !body.postDate) {
        return json({ ok: false, error: "Missing entry posted date fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateEntryPostDateRecord(env.DB, {
            entryId: body.entryId,
            postDate: body.postDate
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update posted date" }, 400);
      }
    }

    if (url.pathname === "/api/entries/update-classification" && request.method === "POST") {
      const body = await request.json<{
        entryId?: string;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        categoryName?: string;
      }>();

      if (!body.entryId || !body.entryType || !body.categoryName) {
        return json({ ok: false, error: "Missing entry classification fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateEntryClassificationRecord(env.DB, {
            entryId: body.entryId,
            entryType: body.entryType,
            transferDirection: body.transferDirection,
            categoryName: body.categoryName
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update entry classification" }, 400);
      }
    }

    if (url.pathname === "/api/entries/create" && request.method === "POST") {
      const body = await request.json<{
        date?: string;
        postDate?: string | null;
        description?: string;
        accountId?: string;
        accountName?: string;
        categoryName?: string;
        amountMinor?: number;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        offsetsCategory?: boolean;
        note?: string;
        splitBasisPoints?: number;
        externalReference?: unknown;
        time?: unknown;
      }>();

      if (
        !body.date
        || !body.description
        || (!body.accountId && !body.accountName)
        || !body.categoryName
        || typeof body.amountMinor !== "number"
        || !body.entryType
        || !body.ownershipType
      ) {
        return json({ ok: false, error: "Missing entry create fields" }, 400);
      }
      const invalidField = validateEntryCreateFields(body);
      if (invalidField) {
        return json({ ok: false, error: invalidField }, 400);
      }
      // An Ask card's stable client id: a repeat create with it returns the
      // entry it already made (a reload during a save). The Shortcut's
      // references stay with its own route.
      if (body.externalReference !== undefined && !isAskEntryReference(body.externalReference)) {
        return json({ ok: false, error: "Invalid entry reference" }, 400);
      }

      try {
        const createdEntry = await createEntryRecord(env.DB, {
          date: body.date,
          postDate: body.postDate,
          description: body.description,
          accountId: body.accountId,
          accountName: body.accountName,
          categoryName: body.categoryName,
          amountMinor: body.amountMinor,
          entryType: body.entryType,
          transferDirection: body.transferDirection,
          ownershipType: body.ownershipType,
          ownerName: body.ownerName,
          offsetsCategory: body.offsetsCategory,
          note: body.note,
          splitBasisPoints: body.splitBasisPoints,
          externalReference: body.externalReference,
          time: body.time as string | null | undefined
        });
        // A new hand-made expense: its category is the person's own choice
        // (a habit confirmation), then Ask handles what the habits allow
        // (src/server/ask-auto-apply.ts). Both are best effort.
        if (createdEntry.created && body.entryType === "expense") {
          await learnCategoryHabit(env.DB, { description: body.description, categoryName: body.categoryName, source: "entries" });
          await applyHabitsToNewEntry(env.DB, createdEntry.entryId);
        }
        // A transfer out like last month's gets its purpose. Best effort.
        if (createdEntry.created && body.entryType === "transfer") {
          await applyRememberedTransferPurposes(env.DB, [createdEntry.entryId]).catch((error) => {
            console.error("Remembered transfer purposes failed", error);
          });
        }
        return json({ ok: true, ...createdEntry });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create entry" }, 400);
      }
    }

    if (url.pathname === "/api/shortcuts/entries/create" && request.method === "POST") {
      const shortcutAuth = await authenticateShortcutRequest(request, env, "entries:create");
      if (!shortcutAuth.ok) {
        return json({ ok: false, error: shortcutAuth.error }, shortcutAuth.status);
      }

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return json({ ok: false, error: "Shortcut request body must be valid JSON." }, 400);
      }
      const parsedBody = parseShortcutCreateBody(rawBody);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.error }, 400);
      }
      const body = parsedBody.body;

      // The key said whose phone this is: their default params, card order
      // and card for other currencies apply, and the entry is theirs.
      const connection = shortcutAuth.connection;
      const bodyWithDefaults = applyShortcutCreateDefaults(body, connection.stored.defaultParams);
      const amount = normalizeShortcutAmount(bodyWithDefaults.amountMinor, bodyWithDefaults.amount);
      const shortcutDate = normalizeShortcutDate(bodyWithDefaults.date);
      const explicitCurrency = normalizeShortcutCurrency(bodyWithDefaults.currency);
      const requestId = normalizeShortcutRequestId(bodyWithDefaults.requestId);
      const entryType = bodyWithDefaults.entryType ?? "expense";
      const ownershipType = bodyWithDefaults.ownershipType ?? "direct";
      let account;
      try {
        account = await resolveShortcutAccountSelection(env.DB, connection, {
          accountId: bodyWithDefaults.accountId,
          accountName: bodyWithDefaults.accountName,
          walletName: bodyWithDefaults.name,
          amountCurrency: explicitCurrency ?? amount?.currency
        });
      } catch (error) {
        return json({ ok: false, error: describeError(error) }, 400);
      }
      const descriptionValues = [
        bodyWithDefaults.description,
        bodyWithDefaults.merchant,
        account?.resolution === "wallet_name" ? undefined : bodyWithDefaults.name
      ];
      const shortcutDescription = normalizeShortcutDescription(...descriptionValues);
      const note = normalizeShortcutNote(bodyWithDefaults.note);
      const amountCurrency = explicitCurrency ?? amount?.currency;
      const invalidFields = [
        !shortcutDate ? "date" : undefined,
        !shortcutDescription ? "description" : undefined,
        !account ? "account" : undefined,
        !amount ? "amount" : undefined,
        bodyWithDefaults.currency && !explicitCurrency ? "currency" : undefined,
        explicitCurrency && amount?.currency && explicitCurrency !== amount.currency ? "currency" : undefined,
        !isShortcutEntryType(entryType) ? "entryType" : undefined,
        bodyWithDefaults.transferDirection != null && !isShortcutTransferDirection(bodyWithDefaults.transferDirection) ? "transferDirection" : undefined,
        !isShortcutOwnershipType(ownershipType) ? "ownershipType" : undefined,
        bodyWithDefaults.requestId != null && !requestId ? "requestId" : undefined,
        bodyWithDefaults.note != null && bodyWithDefaults.note.trim().length > SHORTCUT_NOTE_MAX_LENGTH ? "note" : undefined,
        bodyWithDefaults.splitBasisPoints != null && (
          !Number.isInteger(bodyWithDefaults.splitBasisPoints)
          || bodyWithDefaults.splitBasisPoints < 0
          || bodyWithDefaults.splitBasisPoints > 10_000
        ) ? "splitBasisPoints" : undefined
      ].filter((field): field is string => Boolean(field));
      if (
        invalidFields.length
        || !shortcutDate
        || !shortcutDescription
        || !account
        || !amount
        || !isShortcutEntryType(entryType)
        || !isShortcutOwnershipType(ownershipType)
      ) {
        // Only the amount is missing (a terminal asking which currency to pay
        // in): say so, with what the Shortcut's prompt names, so it can ask
        // the person and post the same request again. Nothing is saved.
        if (
          invalidFields.length === 1
          && invalidFields[0] === "amount"
          && account
          && isShortcutAmountMissing(bodyWithDefaults.amountMinor, bodyWithDefaults.amount)
        ) {
          return json({
            ok: false,
            needsAmount: true,
            merchant: shortcutDescription,
            accountName: account.name,
            error: "Missing or invalid shortcut fields: amount."
          }, 400);
        }
        return json({
          ok: false,
          error: hasOversizedShortcutDescription(...descriptionValues)
            ? "Shortcut description must be 500 characters or fewer. Nothing was saved."
            : `Missing or invalid shortcut fields: ${invalidFields.join(", ")}.`
        }, 400);
      }
      if (requestId && ownershipType !== "direct") {
        return json({
          ok: false,
          error: "Shortcut requestId is only supported for direct ownership entries. Nothing was saved."
        }, 400);
      }

      // A Wallet amount in another currency (an Amaze card abroad) is saved
      // in the account's currency at the day's rate, the original kept.
      let foreign: { amountMinor: number; originalAmountMinor: number; originalCurrency: string; note: string } | undefined;
      if (amountCurrency && amountCurrency !== account.currency) {
        try {
          const conversion = await convertForeignAmount(env.DB, {
            amountMinor: amount.amountMinor,
            fromCurrency: amountCurrency,
            toCurrency: account.currency,
            offline: env.FX_RATES_OFFLINE === "true"
          });
          foreign = {
            amountMinor: conversion.amountMinor,
            originalAmountMinor: amount.amountMinor,
            originalCurrency: amountCurrency,
            note: describeForeignAmount({ originalAmountMinor: amount.amountMinor, originalCurrency: amountCurrency, accountCurrency: account.currency, conversion })
          };
        } catch (error) {
          if (error instanceof FxRateUnavailableError) {
            return json({ ok: false, error: error.message }, 503);
          }
          throw error;
        }
      }
      const savedAmountMinor = foreign?.amountMinor ?? amount.amountMinor;

      try {
        const categoryName = bodyWithDefaults.categoryName
          ?? matchCategoryRule(shortcutDescription, await loadCategoryMatchRules(env.DB))
          ?? "Other";
        const created = await createEntryRecord(env.DB, {
          date: shortcutDate,
          description: shortcutDescription,
          accountId: account.id,
          categoryName,
          amountMinor: savedAmountMinor,
          originalAmountMinor: foreign?.originalAmountMinor,
          originalCurrency: foreign?.originalCurrency,
          entryType,
          transferDirection: bodyWithDefaults.transferDirection,
          ownershipType,
          // Always the key's person, whatever the request or the default
          // params name: one person's key cannot save an entry as another's.
          ownerName: connection.personName,
          offsetsCategory: bodyWithDefaults.offsetsCategory,
          note: [foreign?.note, note].filter(Boolean).join("\n") || undefined,
          splitBasisPoints: bodyWithDefaults.splitBasisPoints,
          externalReference: requestId ? `shortcut:${requestId}` : undefined
        });
        // A new Apple Pay entry: Ask handles what its habits allow (its
        // category is the rules' default, not the person's choice). Best
        // effort, never part of the save.
        if (created.created && entryType === "expense") {
          await applyHabitsToNewEntry(env.DB, created.entryId, { applePay: true });
        }
        if (created.created && entryType === "transfer") {
          await applyRememberedTransferPurposes(env.DB, [created.entryId]).catch((error) => {
            console.error("Remembered transfer purposes failed", error);
          });
        }
        const openUrl = buildShortcutEntryOpenUrl(request, {
          entryId: created.entryId,
          date: shortcutDate,
          viewId: bodyWithDefaults.view,
          accountId: account.id
        }, env.SHORTCUT_APP_ORIGIN);

        return json({
          ok: true,
          entryId: created.entryId,
          created: created.created,
          date: shortcutDate,
          // The Singapore clock time saved with a new entry dated today.
          ...("time" in created && created.time ? { time: created.time } : {}),
          description: shortcutDescription,
          amountMinor: savedAmountMinor,
          currency: account.currency,
          ...(foreign ? { originalAmount: formatForeignAmount(foreign.originalAmountMinor, foreign.originalCurrency) } : {}),
          accountId: account.id,
          accountName: account.name,
          accountResolution: account.resolution,
          openUrl
        });
      } catch (error) {
        const message = describeError(error);
        if (message.includes("request ID was already used")) {
          return json({ ok: false, error: message }, 409);
        }
        if (/^(Amount|Unknown|Missing)/.test(message)) {
          return json({ ok: false, error: message }, 400);
        }
        console.error("Shortcut entry create failed", error);
        return json({ ok: false, error: "Monies Map could not save this shortcut entry." }, 500);
      }
    }

    if (url.pathname === "/api/transfers/link" && request.method === "POST") {
      const body = await request.json<{
        fromEntryId?: string;
        toEntryId?: string;
      }>();

      if (!body.fromEntryId || !body.toEntryId) {
        return json({ ok: false, error: "Missing transfer link fields" }, 400);
      }

      const linked = await linkTransferPair(env.DB, {
        fromEntryId: body.fromEntryId,
        toEntryId: body.toEntryId
      });
      // The receiver is known now: a monthly transfer out like an earlier
      // one to the same person gets its purpose. Best effort.
      await applyRememberedTransferPurposes(env.DB, [body.fromEntryId, body.toEntryId]).catch((error) => {
        console.error("Remembered transfer purposes failed", error);
      });
      return json({ ok: true, ...linked });
    }

    // "What is this for?" on a transfer out to someone in the household
    // (DOMAIN.md "Transfer Purpose"); categoryName null clears it.
    if (url.pathname === "/api/transfers/purpose" && request.method === "POST") {
      const body = await request.json<{ entryId?: unknown; categoryName?: unknown }>().catch(() => ({ entryId: undefined, categoryName: undefined }));
      if (typeof body.entryId !== "string" || !body.entryId || !(body.categoryName === null || (typeof body.categoryName === "string" && body.categoryName))) {
        return json({ ok: false, error: "Missing transfer purpose fields" }, 400);
      }
      try {
        return json({ ok: true, ...(await setTransferPurposeRecord(env.DB, { entryId: body.entryId, categoryName: body.categoryName })) });
      } catch (error) {
        if (error instanceof TransferPurposeError) {
          return json({ ok: false, error: error.message }, 400);
        }
        throw error;
      }
    }

    if (url.pathname === "/api/transfers/settle" && request.method === "POST") {
      const body = await request.json<{
        entryId?: string;
        counterpartEntryId?: string;
        currentCategoryName?: string;
        counterpartCategoryName?: string;
      }>();

      if (!body.entryId || !body.currentCategoryName) {
        return json({ ok: false, error: "Missing transfer settlement fields" }, 400);
      }

      return json({
        ok: true,
        ...(await settleTransferPair(env.DB, {
          entryId: body.entryId,
          counterpartEntryId: body.counterpartEntryId,
          currentCategoryName: body.currentCategoryName,
          counterpartCategoryName: body.counterpartCategoryName
        }))
      });
    }

    if (url.pathname === "/api/transfers/dismiss-unresolved" && request.method === "POST") {
      const body = await request.json<{ entryId?: string }>();
      if (!body.entryId) {
        return json({ ok: false, error: "Missing unresolved transfer id" }, 400);
      }

      return json({
        ok: true,
        ...(await dismissUnresolvedTransfer(env.DB, body.entryId))
      });
    }

    if (url.pathname === "/api/transfers/dismiss-all-unresolved" && request.method === "POST") {
      return json({
        ok: true,
        ...(await dismissAllUnresolvedTransfers(env.DB))
      });
    }

    if (url.pathname === "/api/splits/groups/create" && request.method === "POST") {
      const body = await request.json<{ name?: string; currency?: string; expenseSource?: "cash" | "ledger" | "mixed" }>();
      if (!body.name?.trim()) {
        return json({ ok: false, error: "Missing split group name" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createSplitGroupRecord(env.DB, { name: body.name, currency: body.currency, expenseSource: body.expenseSource }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create split group" }, 400);
      }
    }

    if (url.pathname === "/api/splits/expenses/create" && request.method === "POST") {
      const body = await request.json<{
        groupId?: string | null;
        date?: string;
        description?: string;
        categoryName?: string;
        payerPersonName?: string;
        amountMinor?: number;
        note?: string;
        splitBasisPoints?: number;
        splitAmountMinor?: number;
        currency?: string;
        homeAmountMinor?: number;
        fxRateBasisPoints?: number;
        paymentMethod?: "cash" | "card" | "bank" | "other";
        paymentStatus?: "recorded" | "awaiting_statement" | "certified";
      }>();

      if (!body.date || !body.description || !body.categoryName || !body.payerPersonName || typeof body.amountMinor !== "number") {
        return json({ ok: false, error: "Missing split expense fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createSplitExpenseRecord(env.DB, {
            groupId: body.groupId,
            date: body.date,
            description: body.description,
            categoryName: body.categoryName,
            payerPersonName: body.payerPersonName,
            amountMinor: body.amountMinor,
            note: body.note,
            splitBasisPoints: body.splitBasisPoints,
            splitAmountMinor: body.splitAmountMinor,
            currency: body.currency,
            homeAmountMinor: body.homeAmountMinor,
            fxRateBasisPoints: body.fxRateBasisPoints,
            paymentMethod: body.paymentMethod,
            paymentStatus: body.paymentStatus
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create split expense" }, 400);
      }
    }

    if (url.pathname === "/api/splits/expenses/from-entry" && request.method === "POST") {
      const body = await request.json<{
        entryId?: string;
        splitGroupId?: string | null;
        splitBasisPoints?: number;
        splitAmountMinor?: number;
      }>();

      if (!body.entryId) {
        return json({ ok: false, error: "Missing entry id" }, 400);
      }

      try {
        const added = await createSplitExpenseFromEntryRecord(env.DB, {
          entryId: body.entryId,
          splitGroupId: body.splitGroupId,
          ...(body.splitBasisPoints !== undefined ? { splitBasisPoints: body.splitBasisPoints } : {}),
          ...(body.splitAmountMinor !== undefined ? { splitAmountMinor: body.splitAmountMinor } : {})
        });
        // An even or percentage split is the shop's usual split (a fixed
        // amount is not a habit). Best effort.
        if (body.splitAmountMinor === undefined) {
          await learnSplitHabitFromEntry(env.DB, {
            entryId: body.entryId,
            splitGroupId: body.splitGroupId ?? null,
            firstPersonBasisPoints: body.splitBasisPoints ?? 5000,
            source: "splits"
          });
        }
        // A trip or event linked to this split group follows it (owner
        // decision 3 = A; DOMAIN.md "Trip or Event"): the entry goes on the
        // trip too, unless it is on one already. A second all-or-nothing
        // command after the split saved; if it fails, the split stays saved.
        const tripEventFollow = await followSplitGroupTripEvent(env.DB, { entryId: body.entryId, splitGroupId: body.splitGroupId ?? null })
          .catch(() => null);
        return json({ ok: true, ...added, ...(tripEventFollow ? { tripEventFollow } : {}) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to add entry to splits" }, 400);
      }
    }

    if (url.pathname === "/api/splits/settlements/create" && request.method === "POST") {
      const body = await request.json<{
        groupId?: string | null;
        date?: string;
        fromPersonName?: string;
        toPersonName?: string;
        amountMinor?: number;
        currency?: string;
        fxRateBasisPoints?: number | null;
        paymentMethod?: "cash" | "card" | "bank" | "other";
        paymentStatus?: "recorded" | "awaiting_statement" | "certified";
        note?: string;
      }>();

      if (!body.date || !body.fromPersonName || !body.toPersonName || typeof body.amountMinor !== "number") {
        return json({ ok: false, error: "Missing split settlement fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createSplitSettlementRecord(env.DB, {
            groupId: body.groupId,
            date: body.date,
            fromPersonName: body.fromPersonName,
            toPersonName: body.toPersonName,
            amountMinor: body.amountMinor,
            note: body.note,
            currency: body.currency,
            fxRateBasisPoints: body.fxRateBasisPoints,
            paymentMethod: body.paymentMethod,
            paymentStatus: body.paymentStatus
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create settlement" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/create" && request.method === "POST") {
      const body = await request.json<{ viewerPersonId?: string; date?: string; note?: string; currency?: string }>();
      if (!body.viewerPersonId || !body.date) return json({ ok: false, error: "Missing settlement checkpoint fields" }, 400);
      try {
        return json({ ok: true, ...(await createSplitSettlementCheckpoint(env.DB, { viewerPersonId: body.viewerPersonId, date: body.date, note: body.note, currency: body.currency })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to simplify settlement" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/reopen" && request.method === "POST") {
      const body = await request.json<{ checkpointId?: string }>();
      if (!body.checkpointId) return json({ ok: false, error: "Missing settlement checkpoint id" }, 400);
      try {
        return json({ ok: true, ...(await reopenSplitSettlementCheckpoint(env.DB, body.checkpointId)) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to reopen settlement" }, 400);
      }
    }

    // Undo settle-up: reopens the group batch a settle-up closed.
    if (url.pathname === "/api/splits/batches/reopen" && request.method === "POST") {
      const body = await request.json<{ batchId?: string }>();
      if (!body.batchId) return json({ ok: false, error: "Missing split batch id" }, 400);
      try {
        return json({ ok: true, ...(await reopenSplitBatchRecord(env.DB, { batchId: body.batchId })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to undo the settle-up" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/mark-paid" && request.method === "POST") {
      const body = await request.json<{ checkpointId?: string }>();
      if (!body.checkpointId) return json({ ok: false, error: "Missing settlement checkpoint id" }, 400);
      try {
        return json({ ok: true, ...(await markSplitSettlementCheckpointPaid(env.DB, body.checkpointId)) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to mark settlement paid" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/undo-paid" && request.method === "POST") {
      const body = await request.json<{ checkpointId?: string }>();
      if (!body.checkpointId) return json({ ok: false, error: "Missing settlement checkpoint id" }, 400);
      try {
        return json({ ok: true, ...(await undoSplitSettlementCheckpointPaid(env.DB, body.checkpointId)) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to undo paid settlement" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/match" && request.method === "POST") {
      const body = await request.json<{ checkpointId?: string; transactionId?: string; fxRateBasisPoints?: number }>();
      if (!body.checkpointId || !body.transactionId) return json({ ok: false, error: "Missing checkpoint match fields" }, 400);
      try {
        return json({ ok: true, ...(await matchSplitSettlementCheckpoint(env.DB, { checkpointId: body.checkpointId, transactionId: body.transactionId, fxRateBasisPoints: body.fxRateBasisPoints })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to match settlement" }, 400);
      }
    }

    if (url.pathname === "/api/splits/checkpoints/unmatch" && request.method === "POST") {
      const body = await request.json<{ checkpointId?: string; transactionId?: string }>();
      if (!body.checkpointId || !body.transactionId) return json({ ok: false, error: "Missing checkpoint unmatch fields" }, 400);
      try {
        return json({ ok: true, ...(await unmatchSplitSettlementCheckpoint(env.DB, { checkpointId: body.checkpointId, transactionId: body.transactionId })) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to unmatch settlement." }, 400);
      }
    }

    if (url.pathname === "/api/splits/expenses/update" && request.method === "POST") {
      const body = await request.json<{
        splitExpenseId?: string;
        groupId?: string | null;
        date?: string;
        description?: string;
        categoryName?: string;
        payerPersonName?: string;
        amountMinor?: number;
        note?: string;
        splitBasisPoints?: number;
        splitAmountMinor?: number;
        currency?: string;
        homeAmountMinor?: number;
        fxRateBasisPoints?: number;
        paymentMethod?: "cash" | "card" | "bank" | "other";
        paymentStatus?: "recorded" | "awaiting_statement" | "certified";
      }>();

      if (!body.splitExpenseId || !body.date || !body.description || !body.categoryName || !body.payerPersonName || typeof body.amountMinor !== "number") {
        return json({ ok: false, error: "Missing split expense fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateSplitExpenseRecord(env.DB, {
            splitExpenseId: body.splitExpenseId,
            groupId: body.groupId,
            date: body.date,
            description: body.description,
            categoryName: body.categoryName,
            payerPersonName: body.payerPersonName,
            amountMinor: body.amountMinor,
            note: body.note,
            splitBasisPoints: body.splitBasisPoints,
            splitAmountMinor: body.splitAmountMinor,
            currency: body.currency,
            homeAmountMinor: body.homeAmountMinor,
            fxRateBasisPoints: body.fxRateBasisPoints,
            paymentMethod: body.paymentMethod,
            paymentStatus: body.paymentStatus
          }))
        });
      } catch (error) {
        return splitWriteErrorResponse(error, "Failed to update split expense");
      }
    }

    if (url.pathname === "/api/splits/expenses/update-note" && request.method === "POST") {
      const body = await request.json<{ splitExpenseId?: string; note?: string }>();

      if (!body.splitExpenseId) {
        return json({ ok: false, error: "Missing split expense note fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateSplitExpenseNoteRecord(env.DB, {
            splitExpenseId: body.splitExpenseId,
            note: body.note
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update split expense note" }, 400);
      }
    }

    if (url.pathname === "/api/splits/expenses/update-category" && request.method === "POST") {
      const body = await request.json<{ splitExpenseId?: string; categoryName?: string }>();

      if (!body.splitExpenseId || !body.categoryName) {
        return json({ ok: false, error: "Missing split expense category fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateSplitExpenseCategoryRecord(env.DB, {
            splitExpenseId: body.splitExpenseId,
            categoryName: body.categoryName
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update split expense category" }, 400);
      }
    }

    if (url.pathname === "/api/splits/settlements/update" && request.method === "POST") {
      const body = await request.json<{
        settlementId?: string;
        groupId?: string | null;
        date?: string;
        fromPersonName?: string;
        toPersonName?: string;
        amountMinor?: number;
        currency?: string;
        fxRateBasisPoints?: number | null;
        paymentMethod?: "cash" | "card" | "bank" | "other";
        paymentStatus?: "recorded" | "awaiting_statement" | "certified";
        note?: string;
      }>();

      if (!body.settlementId || !body.date || !body.fromPersonName || !body.toPersonName || typeof body.amountMinor !== "number") {
        return json({ ok: false, error: "Missing split settlement fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateSplitSettlementRecord(env.DB, {
            settlementId: body.settlementId,
            groupId: body.groupId,
            date: body.date,
            fromPersonName: body.fromPersonName,
            toPersonName: body.toPersonName,
            amountMinor: body.amountMinor,
            currency: body.currency,
            fxRateBasisPoints: body.fxRateBasisPoints,
            paymentMethod: body.paymentMethod,
            paymentStatus: body.paymentStatus,
            note: body.note
          }))
        });
      } catch (error) {
        return splitWriteErrorResponse(error, "Failed to update split settlement");
      }
    }

    if (url.pathname === "/api/splits/settlements/update-note" && request.method === "POST") {
      const body = await request.json<{ settlementId?: string; note?: string }>();

      if (!body.settlementId) {
        return json({ ok: false, error: "Missing split settlement note fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateSplitSettlementNoteRecord(env.DB, {
            settlementId: body.settlementId,
            note: body.note
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update split settlement note" }, 400);
      }
    }

    if (url.pathname === "/api/splits/expenses/delete" && request.method === "POST") {
      const body = await request.json<{ splitExpenseId?: string }>();
      if (!body.splitExpenseId) {
        return json({ ok: false, error: "Missing split expense id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await deleteSplitExpenseRecord(env.DB, { splitExpenseId: body.splitExpenseId }))
        });
      } catch (error) {
        return splitWriteErrorResponse(error, "Failed to delete split expense");
      }
    }

    if (url.pathname === "/api/splits/settlements/delete" && request.method === "POST") {
      const body = await request.json<{ settlementId?: string }>();
      if (!body.settlementId) {
        return json({ ok: false, error: "Missing split settlement id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await deleteSplitSettlementRecord(env.DB, { settlementId: body.settlementId }))
        });
      } catch (error) {
        return splitWriteErrorResponse(error, "Failed to delete split settlement");
      }
    }

    if (url.pathname === "/api/splits/matches/link-expense" && request.method === "POST") {
      const body = await request.json<{ splitExpenseId?: string; transactionId?: string }>();
      if (!body.splitExpenseId || !body.transactionId) {
        return json({ ok: false, error: "Missing split expense match fields" }, 400);
      }

      try {
        return json({
          ...(await linkSplitExpenseMatch(env.DB, {
            splitExpenseId: body.splitExpenseId,
            transactionId: body.transactionId
          })),
          ok: true
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to link split expense" }, 400);
      }
    }

    if (url.pathname === "/api/splits/matches/link-settlement" && request.method === "POST") {
      const body = await request.json<{ settlementId?: string; transactionId?: string }>();
      if (!body.settlementId || !body.transactionId) {
        return json({ ok: false, error: "Missing split settlement match fields" }, 400);
      }

      try {
        return json({
          ...(await linkSplitSettlementMatch(env.DB, {
            settlementId: body.settlementId,
            transactionId: body.transactionId
          })),
          ok: true
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to link split settlement" }, 400);
      }
    }

    if (url.pathname === "/api/categories/update" && request.method === "POST") {
      const body = await request.json<{
        categoryId?: string;
        name?: string;
        slug?: string;
        iconKey?: string;
        colorHex?: string;
      }>();

      if (!body.categoryId) {
        return json({ ok: false, error: "Missing category id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await updateCategoryRecord(env.DB, {
            categoryId: body.categoryId,
            name: body.name,
            slug: body.slug,
            iconKey: body.iconKey,
            colorHex: body.colorHex
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update category" }, 400);
      }
    }

    if (url.pathname === "/api/categories/create" && request.method === "POST") {
      const body = await request.json<{
        name?: string;
        slug?: string;
        iconKey?: string;
        colorHex?: string;
      }>();

      if (!body.name?.trim()) {
        return json({ ok: false, error: "Missing category name" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createCategoryRecord(env.DB, {
            name: body.name,
            slug: body.slug,
            iconKey: body.iconKey,
            colorHex: body.colorHex
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create category" }, 400);
      }
    }

    if (url.pathname === "/api/categories/delete" && request.method === "POST") {
      const body = await request.json<{ categoryId?: string }>();

      if (!body.categoryId) {
        return json({ ok: false, error: "Missing category id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await deleteCategoryRecord(env.DB, {
            categoryId: body.categoryId
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete category" }, 400);
      }
    }

    if (url.pathname === "/api/category-match-rules/save" && request.method === "POST") {
      const body = await request.json<{
        ruleId?: string;
        pattern?: string;
        categoryId?: string;
        priority?: number;
        isActive?: boolean;
        note?: string | null;
        sourceSuggestionId?: string;
      }>();

      if (!body.pattern?.trim() || !body.categoryId) {
        return json({ ok: false, error: "Missing category match rule fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await saveCategoryMatchRule(env.DB, {
            ruleId: body.ruleId,
            pattern: body.pattern,
            categoryId: body.categoryId,
            priority: body.priority,
            isActive: body.isActive,
            note: body.note,
            sourceSuggestionId: body.sourceSuggestionId
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to save category match rule" }, 400);
      }
    }

    if (url.pathname === "/api/category-match-rules/delete" && request.method === "POST") {
      const body = await request.json<{ ruleId?: string }>();

      if (!body.ruleId) {
        return json({ ok: false, error: "Missing category match rule id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await deleteCategoryMatchRule(env.DB, body.ruleId))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete category match rule" }, 400);
      }
    }

    if (url.pathname === "/api/category-match-rules/apply-to-past" && request.method === "POST") {
      const body = await request.json<{ ruleId?: string }>();

      if (!body.ruleId) {
        return json({ ok: false, error: "Missing category match rule id" }, 400);
      }

      try {
        return json({ ok: true, ...(await applyCategoryRuleToPastEntries(env.DB, body.ruleId)) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to apply the rule to past entries" }, 400);
      }
    }

    if (url.pathname === "/api/category-match-rules/ignore-issue" && request.method === "POST") {
      const body = await request.json<{ issueId?: string }>();

      if (!body.issueId) {
        return json({ ok: false, error: "Missing duplicate rule issue id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await ignoreCategoryMatchRuleIssue(env.DB, body.issueId))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to ignore duplicate rule issue" }, 400);
      }
    }

    if (url.pathname === "/api/category-match-suggestions/ignore" && request.method === "POST") {
      const body = await request.json<{ suggestionId?: string }>();

      if (!body.suggestionId) {
        return json({ ok: false, error: "Missing category match suggestion id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await ignoreCategoryMatchRuleSuggestion(env.DB, body.suggestionId))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to ignore category match suggestion" }, 400);
      }
    }

    if (url.pathname === "/api/month-plan/save" && request.method === "POST") {
      const body = await request.json<{
        rowId?: string;
        month?: string;
        sectionKey?: "income" | "planned_items" | "budget_buckets";
        categoryName?: string;
        label?: string;
        planDate?: string | null;
        accountName?: string | null;
        plannedMinor?: number;
        note?: string | null;
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        splitBasisPoints?: number;
      }>();

      if (!body.rowId || !body.month || !body.sectionKey || !body.categoryName || !body.label || typeof body.plannedMinor !== "number" || !body.ownershipType) {
        return json({ ok: false, error: "Missing month plan fields" }, 400);
      }

      return json({
        ok: true,
        ...(await saveMonthPlanRow(env.DB, {
          rowId: body.rowId,
          month: body.month,
          sectionKey: body.sectionKey,
          categoryName: body.categoryName,
          label: body.label,
          planDate: body.planDate,
          accountName: body.accountName,
          plannedMinor: body.plannedMinor,
          note: body.note,
          ownershipType: body.ownershipType,
          ownerName: body.ownerName,
          splitBasisPoints: body.splitBasisPoints
        }))
      });
    }

    // Ask's plan draft, saved: several plan-row changes for one month in one
    // batch (DOMAIN.md "Plan Draft"). 409 when the plan changed since the
    // draft; nothing is written then.
    if (url.pathname === "/api/month-plan/apply-changes" && request.method === "POST") {
      let body: { month?: unknown; changes?: unknown };
      try {
        body = await readJsonObject<{ month?: unknown; changes?: unknown }>(request, SMALL_JSON_MAX_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return json({ ok: false, error: error.message }, 413);
        }
        throw error;
      }
      try {
        return json({
          ok: true,
          ...(await applyMonthPlanChanges(env.DB, {
            month: typeof body.month === "string" ? body.month : "",
            changes: Array.isArray(body.changes) ? body.changes : []
          }))
        });
      } catch (error) {
        if (error instanceof MonthPlanChangeError) {
          return json({ ok: false, error: error.message }, error.status);
        }
        return json({ ok: false, error: error instanceof Error ? error.message : "The plan could not be saved." }, 400);
      }
    }

    if (url.pathname === "/api/month-plan/delete" && request.method === "POST") {
      const body = await request.json<{ rowId?: string; month?: string }>();

      if (!body.rowId || !body.month) {
        return json({ ok: false, error: "Missing month plan delete fields" }, 400);
      }

      return json({
        ok: true,
        ...(await deleteMonthPlanRow(env.DB, {
          rowId: body.rowId,
          month: body.month
        }))
      });
    }

    if (url.pathname === "/api/month-plan/links" && request.method === "POST") {
      const body = await request.json<{
        rowId?: string;
        month?: string;
        transactionIds?: string[];
      }>();

      if (!body.rowId || !body.month || !Array.isArray(body.transactionIds)) {
        return json({ ok: false, error: "Missing month plan link fields" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await saveMonthPlanEntryLinks(env.DB, {
            rowId: body.rowId,
            month: body.month,
            transactionIds: body.transactionIds
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update planned item links" }, 400);
      }
    }

    if (url.pathname === "/api/month-note/update" && request.method === "POST") {
      const body = await request.json<{ month?: string; personScope?: string; note?: string }>();

      if (!body.month || !body.personScope || typeof body.note !== "string") {
        return json({ ok: false, error: "Missing month note fields" }, 400);
      }

      return json({
        ok: true,
        ...(await updateMonthlySnapshotNote(env.DB, {
          month: body.month,
          personScope: body.personScope,
          note: body.note
        }))
      });
    }

    if (url.pathname === "/api/imports/preview" && request.method === "POST") {
      const body = await request.json<{
        sourceLabel?: string;
        csv?: string;
        rows?: Record<string, string>[];
        sourceType?: "csv" | "pdf" | "manual";
        defaultAccountName?: string;
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        splitBasisPoints?: number;
        statementCheckpoints?: {
          accountId?: string;
          accountName: string;
          checkpointMonth: string;
          statementStartDate?: string;
          statementEndDate?: string;
          statementBalanceMinor: number;
          previousBalanceMinor?: number;
          accountLast4?: string;
          paymentDueDate?: string;
          minimumPaymentMinor?: number;
          notices?: StatementNoticeDto[];
          note?: string;
        }[];
        statementFixes?: StatementFixDto[];
      }>();

      const rows = body.rows ?? parseCsv(body.csv ?? "");
      try {
        return json({
          ok: true,
          preview: await buildImportPreview(env.DB, {
            sourceLabel: body.sourceLabel?.trim() || "Imported CSV",
            rows,
            defaultAccountName: body.defaultAccountName,
            ownershipType: body.ownershipType ?? "direct",
            ownerName: body.ownerName,
            splitBasisPoints: body.splitBasisPoints,
            sourceType: body.sourceType ?? "csv",
            statementCheckpoints: body.statementCheckpoints ?? [],
            statementFixes: Array.isArray(body.statementFixes) ? body.statementFixes : []
          })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import preview failed";
        return json({ ok: false, error: message }, 400);
      }
    }

    if (url.pathname === "/api/imports/commit" && request.method === "POST") {
      const body = await request.json<{
        sourceLabel?: string;
        sourceType?: "csv" | "pdf" | "manual";
        parserKey?: string;
        note?: string;
        statementCheckpoints?: {
          accountId?: string;
          accountName: string;
          detectedAccountName?: string;
          checkpointMonth: string;
          statementStartDate?: string;
          statementEndDate?: string;
          statementBalanceMinor: number;
          previousBalanceMinor?: number;
          accountLast4?: string;
          paymentDueDate?: string;
          minimumPaymentMinor?: number;
          notices?: StatementNoticeDto[];
          note?: string;
        }[];
        statementControlRows?: {
          rowId: string;
          rowIndex: number;
          date: string;
          description: string;
          amountMinor: number;
          entryType: "expense" | "income" | "transfer";
          transferDirection?: "in" | "out";
          accountName?: string;
          accountId?: string;
          categoryName?: string;
          ownershipType: "direct" | "shared";
          ownerName?: string;
          splitBasisPoints: number;
          commitStatus?: "included" | "skipped" | "needs_review";
          note?: string;
          rawRow: Record<string, string>;
          reconciliationMatch?: {
            existingImportId?: string;
            existingTransactionId?: string;
            existingAccountId?: string;
            existingSourceType?: "csv" | "pdf" | "manual";
            existingBankCertificationStatus?: "provisional" | "statement_certified";
            date: string;
            description: string;
            amountMinor: number;
            accountName?: string;
            matchKind: "exact" | "probable" | "near";
          };
          reconciliationMatchCount?: number;
          reconciliationTargetTransactionId?: string;
          isStatementMatchResolved?: boolean;
          isCertifiedConflict?: boolean;
        }[];
        statementReconciliations?: {
          accountName: string;
          accountId?: string;
          accountKind?: string;
          checkpointMonth: string;
          statementStartDate?: string;
          statementEndDate?: string;
          statementBalanceMinor: number;
          projectedLedgerBalanceMinor?: number;
          deltaMinor?: number;
          status: "matched" | "mismatch" | "unknown_account" | "identity_unconfirmed" | "missing_prior_statement";
        }[];
        rows?: {
          rowId: string;
          rowIndex: number;
          date: string;
          description: string;
          amountMinor: number;
          entryType: "expense" | "income" | "transfer";
          transferDirection?: "in" | "out";
          accountName?: string;
          accountId?: string;
          categoryName?: string;
          ownershipType: "direct" | "shared";
          ownerName?: string;
          splitBasisPoints: number;
          commitStatus?: "included" | "skipped" | "needs_review";
          note?: string;
          rawRow: Record<string, string>;
          reconciliationMatch?: {
            existingImportId?: string;
            existingTransactionId?: string;
            existingAccountId?: string;
            existingSourceType?: "csv" | "pdf" | "manual";
            existingBankCertificationStatus?: "provisional" | "statement_certified";
            date: string;
            description: string;
            amountMinor: number;
            accountName?: string;
            matchKind: "exact" | "probable" | "near";
          };
          reconciliationMatchCount?: number;
          reconciliationTargetTransactionId?: string;
          isStatementMatchResolved?: boolean;
          isCertifiedConflict?: boolean;
        }[];
        statementFixes?: StatementFixDto[];
        noLongerListedEntries?: { transactionId: string; importId: string }[];
        reopenedEstimates?: { transactionId: string; importId: string }[];
        wrongCardDuplicates?: { transactionId: string; twinKind: string; twinId: string }[];
        reviewedRows?: ImportPreviewRowDto[];
      }>();

      if (!body.sourceLabel || (!body.rows?.length && !body.statementCheckpoints?.length && !body.wrongCardDuplicates?.length)) {
        return json({ ok: false, error: "Missing import payload" }, 400);
      }

      try {
        const committed = await commitImportBatch(env.DB, {
            sourceLabel: body.sourceLabel,
            sourceType: body.sourceType ?? "csv",
            parserKey: body.parserKey ?? "generic_csv",
            note: body.note,
            statementCheckpoints: body.statementCheckpoints ?? [],
            statementControlRows: body.statementControlRows,
            statementReconciliations: body.statementReconciliations,
            statementFixes: Array.isArray(body.statementFixes) ? body.statementFixes : [],
            noLongerListedEntries: Array.isArray(body.noLongerListedEntries)
              ? body.noLongerListedEntries.filter((entry) => typeof entry?.transactionId === "string" && typeof entry?.importId === "string")
              : [],
            reopenedEstimates: Array.isArray(body.reopenedEstimates)
              ? body.reopenedEstimates.filter((entry) => typeof entry?.transactionId === "string" && typeof entry?.importId === "string")
              : [],
            wrongCardDuplicates: Array.isArray(body.wrongCardDuplicates)
              ? body.wrongCardDuplicates.flatMap((request) => (
                typeof request?.transactionId === "string" && typeof request?.twinId === "string" && (request.twinKind === "ledger" || request.twinKind === "this_file")
                  ? [{ transactionId: request.transactionId, twinKind: request.twinKind, twinId: request.twinId }]
                  : []
              ))
              : [],
            reviewedRows: Array.isArray(body.reviewedRows) ? body.reviewedRows : undefined,
            rows: body.rows ?? []
          });
        // A monthly transfer out gets what last month's said it was for
        // (transfer purpose learning). Best effort, never part of the import.
        if (committed.created) {
          await applyRememberedTransferPurposesForImport(env.DB, committed.importId).catch((error) => {
            console.error("Remembered transfer purposes failed", error);
          });
        }
        return json({ ok: true, ...committed });
      } catch (error) {
        const message = describeError(error);
        console.error("Import commit failed", error);
        return json({ ok: false, error: message || "Import commit failed." }, 400);
      }
    }

    if (url.pathname === "/api/imports/rollback" && request.method === "POST") {
      const body = await request.json<{ importId?: string }>();
      if (!body.importId) {
        return json({ ok: false, error: "Missing import id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await rollbackImportBatch(env.DB, { importId: body.importId }))
        });
      } catch (error) {
        if (error instanceof SplitSettlementLockedError) {
          return splitWriteErrorResponse(error, "Import rollback failed");
        }
        const message = describeError(error);
        if (message.includes("cannot be rolled back")) {
          return json({ ok: false, error: message }, 409);
        }
        console.error("Import rollback failed", error);
        return json({ ok: false, error: "Import rollback failed", message }, 500);
      }
    }

    if (url.pathname === "/api/db-check") {
      try {
        const result = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).all();

        return json({
          ok: true,
          tables: result.results
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown database error"
          },
          500
        );
      }
    }

    return new Response(null, { status: 404 });
  }
};

function describeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Unknown server error";
}

async function authenticateShortcutRequest(
  request: Request,
  env: Env,
  scope: string
): Promise<
  | { ok: true; connection: ShortcutConnectionRecord }
  | { ok: false; status: number; error: string }
> {
  const connections = await loadShortcutConnectionRecords(env.DB, env.SHORTCUT_INGEST_TOKEN);
  if (!connections.some((connection) => connection.apiKey)) {
    return { ok: false, status: 503, error: "Shortcut ingest is not configured." };
  }

  const providedToken = request.headers.get("X-Monies-Shortcut-Token")?.trim()
    || request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    || new URL(request.url).searchParams.get("shortcut_token")?.trim()
    || "";
  if (!providedToken) {
    return { ok: false, status: 401, error: "Missing shortcut token." };
  }

  const connection = await findShortcutConnectionByKey(connections, providedToken);
  if (!connection) {
    return { ok: false, status: 401, error: "Invalid shortcut token." };
  }

  const nonce = request.headers.get("X-Monies-Shortcut-Nonce")?.trim();
  const timestampHeader = request.headers.get("X-Monies-Shortcut-Timestamp")?.trim();
  if (!nonce && !timestampHeader) {
    return { ok: true, connection };
  }

  if (!nonce) {
    return { ok: false, status: 400, error: "Missing shortcut nonce." };
  }

  const timestamp = parseShortcutTimestamp(timestampHeader);
  if (timestamp == null) {
    return { ok: false, status: 400, error: "Missing or invalid shortcut timestamp." };
  }

  if (Math.abs(Date.now() - timestamp) > SHORTCUT_REQUEST_MAX_AGE_MS) {
    return { ok: false, status: 401, error: "Shortcut request expired." };
  }

  await cleanupExpiredShortcutNonces(env.DB);
  const nonceAccepted = await consumeShortcutNonce(env.DB, nonce, scope);
  if (!nonceAccepted) {
    return { ok: false, status: 409, error: "Shortcut request was already used." };
  }

  return { ok: true, connection };
}

function parseShortcutTimestamp(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{10,13}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return trimmed.length === 13 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

async function consumeShortcutNonce(db: D1Database, nonce: string, scope: string) {
  try {
    await db
      .prepare(`
        INSERT INTO shortcut_request_nonces (nonce, scope)
        VALUES (?, ?)
      `)
      .bind(nonce, scope)
      .run();
    return true;
  } catch {
    return false;
  }
}

async function cleanupExpiredShortcutNonces(db: D1Database) {
  await db
    .prepare(`
      DELETE FROM shortcut_request_nonces
      WHERE created_at < datetime('now', ?)
    `)
    .bind(`-${SHORTCUT_NONCE_RETENTION_HOURS} hours`)
    .run();
}

function applyShortcutCreateDefaults<
  T extends {
    date?: string;
    description?: string;
    accountId?: string;
    accountName?: string;
    categoryName?: string;
    amountMinor?: number;
    amount?: number | string;
    entryType?: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType?: "direct" | "shared";
    ownerName?: string;
    offsetsCategory?: boolean;
    note?: string;
    splitBasisPoints?: number;
    view?: string;
  }
>(body: T, defaultParams = ""): T {
  const params = parseShortcutDefaultParams(defaultParams);
  const shared = parseShortcutBoolean(params.get("shared"));
  return {
    ...body,
    date: body.date ?? params.get("date") ?? undefined,
    description: body.description ?? params.get("description") ?? params.get("merchant") ?? undefined,
    accountId: body.accountId ?? params.get("account_id") ?? params.get("accountId") ?? undefined,
    accountName: body.accountName ?? params.get("account") ?? params.get("accountName") ?? undefined,
    categoryName: body.categoryName ?? params.get("categoryName") ?? params.get("category") ?? undefined,
    amount: body.amount ?? params.get("amount") ?? undefined,
    entryType: body.entryType ?? parseShortcutEntryType(params.get("entryType")) ?? "expense",
    transferDirection: body.transferDirection ?? parseShortcutTransferDirection(params.get("transferDirection")),
    ownershipType: body.ownershipType ?? parseShortcutOwnershipType(params.get("ownershipType")) ?? (shared === true ? "shared" : undefined),
    ownerName: body.ownerName ?? params.get("ownerName") ?? params.get("owner") ?? undefined,
    offsetsCategory: body.offsetsCategory ?? parseShortcutBoolean(params.get("offsetsCategory")),
    note: body.note ?? params.get("note") ?? undefined,
    splitBasisPoints: body.splitBasisPoints ?? parseShortcutNumber(params.get("splitBasisPoints")),
    view: body.view ?? params.get("view") ?? undefined
  };
}

function parseShortcutDefaultParams(defaultParams = "") {
  const trimmed = defaultParams.trim().replace(/^\?/, "");
  return new URLSearchParams(trimmed);
}

function parseShortcutBoolean(value?: string | null) {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "shared"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "direct"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseShortcutNumber(value?: string | null) {
  if (value == null || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseShortcutEntryType(value?: string | null): "expense" | "income" | "transfer" | undefined {
  return value === "expense" || value === "income" || value === "transfer" ? value : undefined;
}

function parseShortcutTransferDirection(value?: string | null): "in" | "out" | undefined {
  return value === "in" || value === "out" ? value : undefined;
}

function parseShortcutOwnershipType(value?: string | null): "direct" | "shared" | undefined {
  return value === "direct" || value === "shared" ? value : undefined;
}

type RequestTiming = { requestStartedAt: number; initMs: number; initCold: boolean };

// The view and the named string parameters of a settled-rows or settled
// search request, each at most 200 characters; null when one is longer.
function readSplitsSettledParams(url: URL, names: string[]) {
  const params: Record<string, string | undefined> & { view: string } = { view: url.searchParams.get("view") ?? "household" };
  for (const name of ["view", ...names]) {
    const value = url.searchParams.get(name);
    if (value !== null && value.length > 200) {
      return null;
    }
    if (value !== null && name !== "view") {
      params[name] = value;
    }
  }
  return params;
}

async function apiPageResponse<T>(
  label: string,
  request: Request,
  url: URL,
  handler: () => Promise<T>,
  timing?: RequestTiming
) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const payload = await handler();
    const durationMs = Date.now() - startedAt;
    if (durationMs >= API_PAGE_SLOW_MS) {
      console.warn("API page slow", buildApiDiagnostic(label, request, url, requestId, durationMs));
    }
    const body = serializeJson(payload);
    return jsonFromText(body, 200, {
      "server-timing": timing
        ? buildServerTimingHeader({
          appMs: durationMs,
          initMs: timing.initMs,
          initCold: timing.initCold,
          totalMs: Date.now() - timing.requestStartedAt
        })
        : `app;dur=${durationMs}`
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error("API page failed", {
      ...buildApiDiagnostic(label, request, url, requestId, durationMs),
      error: describeError(error)
    });
    return json({
      ok: false,
      error: `${label} failed`,
      message: describeError(error),
      requestId,
      durationMs
    }, 500);
  }
}

function buildApiDiagnostic(label: string, request: Request, url: URL, requestId: string, durationMs: number) {
  return {
    requestId,
    label,
    method: request.method,
    path: url.pathname,
    params: pickDiagnosticSearchParams(url.searchParams),
    durationMs
  };
}

function getAppEnvironment(env: Env, url: URL): Env["APP_ENVIRONMENT"] {
  if (env.APP_ENVIRONMENT) {
    return env.APP_ENVIRONMENT;
  }

  return isLocalHostname(url.hostname) ? "local" : "production";
}

function canUseDemoControls(env: Env, url: URL) {
  const environment = getAppEnvironment(env, url);
  return environment === "demo" || environment === "local" || environment === "test";
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function pickDiagnosticSearchParams(searchParams: URLSearchParams) {
  const keys = ["view", "month", "scope", "summary_start", "summary_end"];
  const params: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}
