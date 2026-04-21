import {
  buildBootstrapDto,
  buildEntriesPageDto,
  buildImportsPageDto,
  buildMonthPageDto,
  buildSettingsPageDto,
  buildSplitsPageDto,
  buildSummaryPageDto,
  invalidateAppDataCache
} from "./domain/bootstrap";
import { enterEmptyState, reseedDemoSettings } from "./domain/demo-settings";
import {
  archiveAccountRecord,
  buildAccountCheckpointLedgerCsv,
  buildImportPreview,
  compareAccountCheckpointStatementRows,
  commitImportBatch,
  createSplitExpenseRecord,
  createSplitExpenseFromEntryRecord,
  createSplitGroupRecord,
  createSplitSettlementRecord,
  createEntryRecord,
  createCategoryRecord,
  createAccountRecord,
  deleteSplitExpenseRecord,
  deleteSplitSettlementRecord,
  deleteCategoryMatchRule,
  deleteAccountCheckpointRecord,
  deleteCategoryRecord,
  ignoreCategoryMatchRuleSuggestion,
  deleteMonthPlan,
  deleteMonthPlanRow,
  duplicateMonthPlan,
  rollbackImportBatch,
  resetMonthPlan,
  saveAccountCheckpointRecord,
  saveCategoryMatchRule,
  saveMonthPlanEntryLinks,
  saveMonthPlanRow,
  linkSplitExpenseMatch,
  linkSplitSettlementMatch,
  linkTransferPair,
  registerLoginIdentity,
  settleTransferPair,
  unregisterLoginIdentity,
  updateSplitExpenseRecord,
  updateSplitSettlementRecord,
  updateAccountRecord,
  updateCategoryRecord,
  updatePersonRecord,
  updateMonthlySnapshotNote,
  updateEntryClassificationRecord,
  updateEntryRecord
} from "./domain/app-repository";
import {
  dismissAllUnresolvedTransfers,
  dismissUnresolvedTransfer
} from "./domain/app-repository-settings";
import { parseCsv } from "./lib/csv";
import { getCurrentMonthKey } from "./lib/month";
import { json } from "./server/json";

export interface Env {
  DB: D1Database;
  APP_ENVIRONMENT?: "demo" | "local" | "production";
}

const API_PAGE_SLOW_MS = 750;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "monies-map" });
    }

    if (url.pathname === "/api/bootstrap") {
      return apiPageResponse("Bootstrap", request, url, () =>
        buildBootstrapDto(
          env.DB,
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared",
          url.searchParams.get("summary_start") ?? undefined,
          url.searchParams.get("summary_end") ?? undefined,
          getAuthenticatedEmail(request),
          getAppEnvironment(env, url)
        )
      );
    }

    if (url.pathname === "/api/entries-page") {
      return apiPageResponse("Entries page", request, url, () =>
        buildEntriesPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey()
        )
      );
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
        )
      );
    }

    if (url.pathname === "/api/month-page") {
      return apiPageResponse("Month page", request, url, () =>
        buildMonthPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey(),
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared"
        )
      );
    }

    if (url.pathname === "/api/splits-page") {
      return apiPageResponse("Splits page", request, url, () =>
        buildSplitsPageDto(
          env.DB,
          url.searchParams.get("view") ?? "household",
          url.searchParams.get("month") ?? getCurrentMonthKey()
        )
      );
    }

    if (url.pathname === "/api/imports-page") {
      return apiPageResponse("Imports page", request, url, () => buildImportsPageDto(env.DB));
    }

    if (url.pathname === "/api/settings-page") {
      return apiPageResponse("Settings page", request, url, () => buildSettingsPageDto(env.DB));
    }

    if (url.pathname === "/api/demo/reseed" && request.method === "POST") {
      if (!canUseDemoControls(env, url)) {
        return json({ ok: false, error: "Demo controls are disabled in production." }, 403);
      }
      const demo = await reseedDemoSettings(env.DB);
      invalidateAppDataCache();
      return json({ ok: true, demo });
    }

    if (url.pathname === "/api/demo/empty" && request.method === "POST") {
      if (!canUseDemoControls(env, url)) {
        return json({ ok: false, error: "Demo controls are disabled in production." }, 403);
      }
      const demo = await enterEmptyState(env.DB);
      invalidateAppDataCache();
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
      }>();

      if (!body.accountId || !body.checkpointMonth || !body.rows?.length) {
        return json({ ok: false, error: "Missing statement compare fields" }, 400);
      }

      try {
        return json({
          ok: true,
          comparison: await compareAccountCheckpointStatementRows(env.DB, {
            accountId: body.accountId,
            checkpointMonth: body.checkpointMonth,
            rows: body.rows,
            uploadedStatementStartDate: body.uploadedStatementStartDate,
            uploadedStatementEndDate: body.uploadedStatementEndDate
          })
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Statement compare failed" }, 400);
      }
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
        description?: string;
        accountId?: string;
        accountName?: string;
        categoryName?: string;
        amountMinor?: number;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        note?: string;
        splitBasisPoints?: number;
      }>();

      if (!body.entryId || !body.date || !body.description || (!body.accountId && !body.accountName) || !body.categoryName || !body.ownershipType) {
        return json({ ok: false, error: "Missing entry update fields" }, 400);
      }

      return json({
        ok: true,
        ...(await updateEntryRecord(env.DB, {
          entryId: body.entryId,
          date: body.date,
          description: body.description,
          accountId: body.accountId,
          accountName: body.accountName,
          categoryName: body.categoryName,
          amountMinor: body.amountMinor,
          entryType: body.entryType,
          transferDirection: body.transferDirection,
          ownershipType: body.ownershipType,
          ownerName: body.ownerName,
          note: body.note,
          splitBasisPoints: body.splitBasisPoints
        }))
      });
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

      return json({
        ok: true,
        ...(await updateEntryClassificationRecord(env.DB, {
          entryId: body.entryId,
          entryType: body.entryType,
          transferDirection: body.transferDirection,
          categoryName: body.categoryName
        }))
      });
    }

    if (url.pathname === "/api/entries/create" && request.method === "POST") {
      const body = await request.json<{
        date?: string;
        description?: string;
        accountId?: string;
        accountName?: string;
        categoryName?: string;
        amountMinor?: number;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        note?: string;
        splitBasisPoints?: number;
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

      try {
        return json({
          ok: true,
          ...(await createEntryRecord(env.DB, {
            date: body.date,
            description: body.description,
            accountId: body.accountId,
            accountName: body.accountName,
            categoryName: body.categoryName,
            amountMinor: body.amountMinor,
            entryType: body.entryType,
            transferDirection: body.transferDirection,
            ownershipType: body.ownershipType,
            ownerName: body.ownerName,
            note: body.note,
            splitBasisPoints: body.splitBasisPoints
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create entry" }, 400);
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

      return json({
        ok: true,
        ...(await linkTransferPair(env.DB, {
          fromEntryId: body.fromEntryId,
          toEntryId: body.toEntryId
        }))
      });
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
      const body = await request.json<{ name?: string }>();
      if (!body.name?.trim()) {
        return json({ ok: false, error: "Missing split group name" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createSplitGroupRecord(env.DB, { name: body.name }))
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
            splitBasisPoints: body.splitBasisPoints
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
      }>();

      if (!body.entryId) {
        return json({ ok: false, error: "Missing entry id" }, 400);
      }

      try {
        return json({
          ok: true,
          ...(await createSplitExpenseFromEntryRecord(env.DB, {
            entryId: body.entryId,
            splitGroupId: body.splitGroupId
          }))
        });
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
            note: body.note
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to create settlement" }, 400);
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
            splitBasisPoints: body.splitBasisPoints
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update split expense" }, 400);
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
            note: body.note
          }))
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to update split settlement" }, 400);
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
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete split expense" }, 400);
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
        return json({ ok: false, error: error instanceof Error ? error.message : "Failed to delete split settlement" }, 400);
      }
    }

    if (url.pathname === "/api/splits/matches/link-expense" && request.method === "POST") {
      const body = await request.json<{ splitExpenseId?: string; transactionId?: string }>();
      if (!body.splitExpenseId || !body.transactionId) {
        return json({ ok: false, error: "Missing split expense match fields" }, 400);
      }

      return json({
        ok: true,
        ...(await linkSplitExpenseMatch(env.DB, {
          splitExpenseId: body.splitExpenseId,
          transactionId: body.transactionId
        }))
      });
    }

    if (url.pathname === "/api/splits/matches/link-settlement" && request.method === "POST") {
      const body = await request.json<{ settlementId?: string; transactionId?: string }>();
      if (!body.settlementId || !body.transactionId) {
        return json({ ok: false, error: "Missing split settlement match fields" }, 400);
      }

      return json({
        ok: true,
        ...(await linkSplitSettlementMatch(env.DB, {
          settlementId: body.settlementId,
          transactionId: body.transactionId
        }))
      });
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
          note?: string;
        }[];
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
            statementCheckpoints: body.statementCheckpoints ?? []
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
          statementCertificationTargetTransactionId?: string;
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
          status: "matched" | "mismatch" | "unknown_account" | "identity_unconfirmed";
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
          statementCertificationTargetTransactionId?: string;
        }[];
      }>();

      if (!body.sourceLabel || (!body.rows?.length && !body.statementCheckpoints?.length)) {
        return json({ ok: false, error: "Missing import payload" }, 400);
      }

      return json({
        ok: true,
        ...(await commitImportBatch(env.DB, {
          sourceLabel: body.sourceLabel,
          sourceType: body.sourceType ?? "csv",
          parserKey: body.parserKey ?? "generic_csv",
          note: body.note,
          statementCheckpoints: body.statementCheckpoints ?? [],
          statementControlRows: body.statementControlRows,
          statementReconciliations: body.statementReconciliations,
          rows: body.rows ?? []
        }))
      });
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
        console.error("Import rollback failed", error);
        return json({ ok: false, error: "Import rollback failed", message: describeError(error) }, 500);
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

function getAuthenticatedEmail(request: Request) {
  return request.headers.get("CF-Access-Authenticated-User-Email")?.trim().toLowerCase()
    || request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLowerCase()
    || undefined;
}

async function apiPageResponse<T>(
  label: string,
  request: Request,
  url: URL,
  handler: () => Promise<T>
) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const payload = await handler();
    const durationMs = Date.now() - startedAt;
    if (durationMs >= API_PAGE_SLOW_MS) {
      console.warn("API page slow", buildApiDiagnostic(label, request, url, requestId, durationMs));
    }
    return json(payload);
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
  return environment === "demo" || environment === "local";
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
