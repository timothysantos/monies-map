import { buildBootstrapDto } from "./domain/bootstrap";
import { enterEmptyState, reseedDemoSettings } from "./domain/demo-settings";
import {
  archiveAccountRecord,
  buildImportPreview,
  commitImportBatch,
  createAccountRecord,
  deleteMonthPlan,
  deleteMonthPlanRow,
  duplicateMonthPlan,
  rollbackImportBatch,
  resetMonthPlan,
  saveAccountCheckpointRecord,
  saveMonthPlanRow,
  linkTransferPair,
  settleTransferPair,
  updateAccountRecord,
  updateCategoryRecord,
  updateMonthlySnapshotNote,
  updateEntryRecord
} from "./domain/app-repository";
import { parseCsv } from "./lib/csv";
import { json } from "./server/json";

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "monies-map" });
    }

    if (url.pathname === "/api/bootstrap") {
      return json(
        await buildBootstrapDto(
          env.DB,
          url.searchParams.get("month") ?? "2025-10",
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared",
          url.searchParams.get("summary_start") ?? undefined,
          url.searchParams.get("summary_end") ?? undefined
        )
      );
    }

    if (url.pathname === "/api/demo/reseed" && request.method === "POST") {
      const demo = await reseedDemoSettings(env.DB);
      return json({ ok: true, demo });
    }

    if (url.pathname === "/api/demo/empty" && request.method === "POST") {
      const demo = await enterEmptyState(env.DB);
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

    if (url.pathname === "/api/accounts/reconcile" && request.method === "POST") {
      const body = await request.json<{
        accountId?: string;
        checkpointMonth?: string;
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
          statementBalanceMinor: body.statementBalanceMinor,
          note: body.note
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
        description?: string;
        accountName?: string;
        categoryName?: string;
        entryType?: "expense" | "income" | "transfer";
        transferDirection?: "in" | "out";
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        note?: string;
        splitBasisPoints?: number;
      }>();

      if (!body.entryId || !body.date || !body.description || !body.accountName || !body.categoryName || !body.ownershipType) {
        return json({ ok: false, error: "Missing entry update fields" }, 400);
      }

      return json({
        ok: true,
        ...(await updateEntryRecord(env.DB, {
          entryId: body.entryId,
          date: body.date,
          description: body.description,
          accountName: body.accountName,
          categoryName: body.categoryName,
          entryType: body.entryType,
          transferDirection: body.transferDirection,
          ownershipType: body.ownershipType,
          ownerName: body.ownerName,
          note: body.note,
          splitBasisPoints: body.splitBasisPoints
        }))
      });
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
        defaultAccountName?: string;
        ownershipType?: "direct" | "shared";
        ownerName?: string;
        splitBasisPoints?: number;
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
            splitBasisPoints: body.splitBasisPoints
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
        note?: string;
        rows?: {
          rowId: string;
          rowIndex: number;
          date: string;
          description: string;
          amountMinor: number;
          entryType: "expense" | "income" | "transfer";
          transferDirection?: "in" | "out";
          accountName?: string;
          categoryName?: string;
          ownershipType: "direct" | "shared";
          ownerName?: string;
          splitBasisPoints: number;
          note?: string;
          rawRow: Record<string, string>;
        }[];
      }>();

      if (!body.sourceLabel || !body.rows?.length) {
        return json({ ok: false, error: "Missing import payload" }, 400);
      }

      return json({
        ok: true,
        ...(await commitImportBatch(env.DB, {
          sourceLabel: body.sourceLabel,
          note: body.note,
          rows: body.rows
        }))
      });
    }

    if (url.pathname === "/api/imports/rollback" && request.method === "POST") {
      const body = await request.json<{ importId?: string }>();
      if (!body.importId) {
        return json({ ok: false, error: "Missing import id" }, 400);
      }

      return json({
        ok: true,
        ...(await rollbackImportBatch(env.DB, { importId: body.importId }))
      });
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
