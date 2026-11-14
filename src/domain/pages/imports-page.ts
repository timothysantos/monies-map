import { ensureAppData } from "../app-shell";
import {
  loadImportBatches,
  loadAccounts,
  loadSplitMatchCandidates
} from "../app-repository";
import { listWaitingFiles } from "../app-repository-waiting-files";
import { buildImportInbox } from "../import-inbox";
import type { ImportsPageDto, WaitingFileDto } from "../../types/dto";

// Files sent to Monies Map that wait for review: names and arrival only,
// never bytes. A missing store or a failed read is no files, never an
// error page.
async function loadWaitingFileList(db: D1Database): Promise<WaitingFileDto[]> {
  try {
    const files = await listWaitingFiles(db);
    return files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      fileKind: file.fileKind,
      sizeBytes: file.sizeBytes,
      arrivedVia: file.arrivedVia,
      receivedAt: file.receivedAt
    }));
  } catch (error) {
    console.error("Waiting files list failed", error instanceof Error ? error.name : "unknown");
    return [];
  }
}

// Build the route-owned Imports page DTO.
export async function buildImportsPageDto(db: D1Database): Promise<{ importsPage: ImportsPageDto }> {
  await ensureAppData(db);
  const [importBatches, splitMatches, accounts, waitingFiles] = await Promise.all([
    loadImportBatches(db, { includeOverlapDetails: false }),
    loadSplitMatchCandidates(db),
    loadAccounts(db),
    loadWaitingFileList(db)
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
      waitingFiles,
      rollbackPolicy:
        "Every transaction is tied to an import batch so the last import can be removed without touching older data."
    }
  };
}
