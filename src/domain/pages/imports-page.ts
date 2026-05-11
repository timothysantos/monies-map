import { ensureAppData } from "../app-shell";
import { loadImportBatches } from "../app-repository";
import type { ImportsPageDto } from "../../types/dto";

// Build the route-owned Imports page DTO.
export async function buildImportsPageDto(db: D1Database): Promise<{ importsPage: ImportsPageDto }> {
  await ensureAppData(db);
  const importBatches = await loadImportBatches(db, { includeOverlapDetails: false });
  return {
    importsPage: {
      recentImports: importBatches,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}
