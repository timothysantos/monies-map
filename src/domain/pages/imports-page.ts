import { ensureAppData } from "../app-shell";
import {
  loadImportBatches,
  loadSplitMatchCandidates
} from "../app-repository";
import type { ImportsPageDto } from "../../types/dto";

// Build the route-owned Imports page DTO.
export async function buildImportsPageDto(db: D1Database): Promise<{ importsPage: ImportsPageDto }> {
  await ensureAppData(db);
  const [importBatches, splitMatches] = await Promise.all([
    loadImportBatches(db, { includeOverlapDetails: false }),
    loadSplitMatchCandidates(db)
  ]);
  return {
    importsPage: {
      recentImports: importBatches,
      pendingSplitMatchCount: splitMatches.length,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}
