import { buildBootstrapDto } from "./domain/bootstrap";
import { enterEmptyState, reseedDemoSettings } from "./domain/demo-settings";
import { deleteMonthPlan, duplicateMonthPlan, resetMonthPlan } from "./domain/app-repository";
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
          (url.searchParams.get("scope") as "direct" | "shared" | "direct_plus_shared" | null) ?? "direct_plus_shared"
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

    if (url.pathname === "/api/import/csv" && request.method === "POST") {
      const body = await request.text();
      const rows = parseCsv(body);

      // This remains a preview endpoint until persistence and mapping profiles
      // are wired to D1. The response shape already mirrors the import-batch
      // workflow the app will use later.
      return json({
        importedRows: rows.length,
        preview: rows.slice(0, 5),
        message: "CSV preview only. Persist imports and row-level account mapping next.",
        suggestions: [
          "Attach this preview to an import batch record.",
          "Allow per-row account overrides before committing transactions.",
          "Keep rollback scoped to the import batch."
        ]
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
