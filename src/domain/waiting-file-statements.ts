// The statements that take a waiting file (DOMAIN.md "Waiting File") out of
// the store, bytes first. Shared by the waiting-files commands and the
// import commit (which deletes the file in its own batch), so neither
// command module imports the other. Every delete is scoped to the household.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import type { WaitingFileKind } from "./waiting-files";

export const WAITING_FILE_KIND_WORDS: Record<WaitingFileKind, string> = { pdf: "PDF", csv: "CSV", tsv: "TSV", xls: "XLS" };

export function deleteWaitingFileStatements(db: D1Database, id: string) {
  return [
    db
      .prepare("DELETE FROM waiting_file_chunks WHERE file_id IN (SELECT id FROM waiting_files WHERE household_id = ? AND id = ?)")
      .bind(DEFAULT_HOUSEHOLD_ID, id),
    db
      .prepare("DELETE FROM waiting_files WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, id)
  ];
}

// The file whose rows an import saved: deleted with an audit line in the
// same batch as the import.
export function buildWaitingFileImportedStatements(
  db: D1Database,
  file: { id: string; fileKind: WaitingFileKind },
  importId: string
) {
  return [
    ...deleteWaitingFileStatements(db, file.id),
    buildAuditEventStatement(db, {
      entityType: "waiting_file",
      entityId: file.id,
      action: "waiting_file_imported",
      detail: `A ${WAITING_FILE_KIND_WORDS[file.fileKind]} file sent to Monies Map was imported (${importId}) and deleted.`
    })
  ];
}
