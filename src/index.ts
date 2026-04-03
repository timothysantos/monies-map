import { buildBootstrapDto } from "./domain/bootstrap";
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
      return json(buildBootstrapDto());
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
