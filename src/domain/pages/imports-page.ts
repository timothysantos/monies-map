import { ensureAppData } from "../app-shell";
import {
  loadImportBatches,
  loadAccounts,
  loadSplitMatchCandidates
} from "../app-repository";
import { buildImportInbox } from "../import-inbox";
import type { ImportsPageDto } from "../../types/dto";

// Build the route-owned Imports page DTO.
export async function buildImportsPageDto(db: D1Database): Promise<{ importsPage: ImportsPageDto }> {
  await ensureAppData(db);
  const [importBatches, splitMatches, accounts] = await Promise.all([
    loadImportBatches(db, { includeOverlapDetails: false }),
    loadSplitMatchCandidates(db),
    loadAccounts(db)
  ]);
  const pendingSplitMatchCount = splitMatches.length;
  return {
    importsPage: {
      recentImports: importBatches,
      importInbox: buildImportInbox({
        accounts,
        recentImports: importBatches,
        pendingSplitMatchCount
      }),
      pendingSplitMatchCount,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}
