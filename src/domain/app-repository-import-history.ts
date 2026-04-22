import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { hasSetIntersection } from "./app-repository-helpers";
import type { ImportBatchDto } from "../types/dto";

const DEFAULT_IMPORT_HISTORY_LIMIT = 100;
const MAX_IMPORT_HISTORY_LIMIT = 200;
const IMPORT_HISTORY_ACCOUNT_LOOKUP_CHUNK_SIZE = 80;

type LoadImportBatchesOptions = {
  limit?: number;
  includeOverlapDetails?: boolean;
};

export async function loadImportBatches(
  db: D1Database,
  options: LoadImportBatchesOptions = {}
): Promise<ImportBatchDto[]> {
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_IMPORT_HISTORY_LIMIT),
    MAX_IMPORT_HISTORY_LIMIT
  );
  const includeOverlapDetails = options.includeOverlapDetails ?? true;
  const result = await db
    .prepare(`
      WITH recent_imports AS (
        SELECT
          id,
          source_label,
          source_type,
          parser_key,
          imported_at,
          status,
          note
        FROM imports
        WHERE household_id = ?
        ORDER BY imported_at DESC
        LIMIT ?
      )
      SELECT
        recent_imports.id,
        recent_imports.source_label,
        recent_imports.source_type,
        recent_imports.parser_key,
        recent_imports.imported_at,
        recent_imports.status,
        recent_imports.note,
        COUNT(transactions.id) AS transaction_count,
        MIN(transactions.transaction_date) AS start_date,
        MAX(transactions.transaction_date) AS end_date
      FROM recent_imports
      LEFT JOIN transactions ON transactions.import_id = recent_imports.id
      GROUP BY recent_imports.id, recent_imports.source_label, recent_imports.source_type, recent_imports.parser_key, recent_imports.imported_at, recent_imports.status, recent_imports.note
      ORDER BY recent_imports.imported_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, limit)
    .all<{
      id: string;
      source_label: string;
      source_type: "csv" | "pdf" | "manual";
      parser_key: string | null;
      imported_at: string;
      status: "draft" | "completed" | "rolled_back";
      note: string | null;
      transaction_count: number;
      start_date: string | null;
      end_date: string | null;
    }>();

  if (!result.results.length) {
    return [];
  }

  const accountRows = await loadImportAccountRows(db, result.results.map((row) => row.id));
  const certificateRows = await loadImportStatementCertificateRows(db, result.results.map((row) => row.id));

  const accountIdsByImportId = new Map<string, Set<string>>();
  const accountNamesByImportId = new Map<string, Set<string>>();
  for (const row of accountRows) {
    if (row.account_id) {
      const currentIds = accountIdsByImportId.get(row.import_id) ?? new Set<string>();
      currentIds.add(row.account_id);
      accountIdsByImportId.set(row.import_id, currentIds);
    }

    if (row.account_name) {
      const currentNames = accountNamesByImportId.get(row.import_id) ?? new Set<string>();
      currentNames.add(formatImportAccountLabel(row.account_name, row.owner_name));
      accountNamesByImportId.set(row.import_id, currentNames);
    }
  }
  const certificateSummaryByImportId = new Map(certificateRows.map((row) => [row.import_id, row]));

  return result.results.map((row) => {
    const overlapCandidates = includeOverlapDetails
      ? result.results.filter((candidate) => {
        const rowAccountIds = accountIdsByImportId.get(row.id) ?? new Set<string>();
        return candidate.id !== row.id
          && row.status === "completed"
          && candidate.status === "completed"
          && row.start_date
          && row.end_date
          && candidate.start_date
          && candidate.end_date
          && row.start_date <= candidate.end_date
          && row.end_date >= candidate.start_date
          && hasSetIntersection(rowAccountIds, accountIdsByImportId.get(candidate.id) ?? new Set<string>());
      })
      : [];
    const overlapImports = includeOverlapDetails
      ? overlapCandidates
        .map((candidate) => (
          {
            id: candidate.id,
            sourceLabel: candidate.source_label,
            sourceType: candidate.source_type,
            parserKey: candidate.parser_key ?? undefined,
            importedAt: candidate.imported_at,
            status: candidate.status,
            transactionCount: Number(candidate.transaction_count ?? 0),
            startDate: candidate.start_date ?? undefined,
            endDate: candidate.end_date ?? undefined,
            accountNames: Array.from(accountNamesByImportId.get(candidate.id) ?? []).sort()
          }
        ))
      : [];

    const certificateSummary = certificateSummaryByImportId.get(row.id);
    const transactionCount = Number(row.transaction_count ?? 0);
    const rollbackProtected = row.source_type === "pdf" && (
      Number(certificateSummary?.certified_existing_row_count ?? 0) > 0
      || Number(certificateSummary?.later_statement_count ?? 0) > 0
    );

    return {
      id: row.id,
      sourceLabel: row.source_label,
      sourceType: row.source_type,
      parserKey: row.parser_key ?? undefined,
      importedAt: row.imported_at,
      status: row.status,
      transactionCount,
      startDate: row.start_date ?? undefined,
      endDate: row.end_date ?? undefined,
      accountNames: Array.from(accountNamesByImportId.get(row.id) ?? []).sort(),
      overlapImportCount: includeOverlapDetails ? overlapCandidates.length : 0,
      overlapImports,
      statementCertificateCount: Number(certificateSummary?.certificate_count ?? 0),
      statementCertificateStatus: certificateSummary?.exception_count
        ? "exception"
        : certificateSummaryByImportId.has(row.id) ? "certified" : undefined,
      rollbackProtected,
      note: row.note ?? undefined
    };
  });
}

async function loadImportStatementCertificateRows(db: D1Database, importIds: string[]) {
  if (!importIds.length) {
    return [];
  }

  const rows: {
    import_id: string;
    certificate_count: number;
    exception_count: number;
    imported_row_count: number;
    certified_existing_row_count: number;
    later_statement_count: number;
  }[] = [];
  for (let index = 0; index < importIds.length; index += IMPORT_HISTORY_ACCOUNT_LOOKUP_CHUNK_SIZE) {
    const chunk = importIds.slice(index, index + IMPORT_HISTORY_ACCOUNT_LOOKUP_CHUNK_SIZE);
    const importIdPlaceholders = chunk.map(() => "?").join(", ");
    const result = await db
      .prepare(`
        SELECT
          import_id,
          COUNT(*) AS certificate_count,
          SUM(CASE WHEN status = 'exception' THEN 1 ELSE 0 END) AS exception_count,
          SUM(imported_row_count) AS imported_row_count,
          SUM(certified_existing_row_count) AS certified_existing_row_count,
          SUM(
            CASE WHEN EXISTS (
              SELECT 1
              FROM statement_reconciliation_certificates later_certificate
              WHERE later_certificate.household_id = statement_reconciliation_certificates.household_id
                AND later_certificate.account_id = statement_reconciliation_certificates.account_id
                AND later_certificate.checkpoint_month > statement_reconciliation_certificates.checkpoint_month
            ) THEN 1 ELSE 0 END
          ) AS later_statement_count
        FROM statement_reconciliation_certificates
        WHERE household_id = ?
          AND import_id IN (${importIdPlaceholders})
        GROUP BY import_id
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<{
        import_id: string;
        certificate_count: number;
        exception_count: number;
        imported_row_count: number;
        certified_existing_row_count: number;
        later_statement_count: number;
      }>();

    rows.push(...result.results);
  }

  return rows;
}

async function loadImportAccountRows(db: D1Database, importIds: string[]) {
  const rows: { import_id: string; account_id: string | null; account_name: string | null; owner_name: string | null }[] = [];

  for (let index = 0; index < importIds.length; index += IMPORT_HISTORY_ACCOUNT_LOOKUP_CHUNK_SIZE) {
    const chunk = importIds.slice(index, index + IMPORT_HISTORY_ACCOUNT_LOOKUP_CHUNK_SIZE);
    const importIdPlaceholders = chunk.map(() => "?").join(", ");
    const accountRows = await db
      .prepare(`
        SELECT DISTINCT
          imports.id AS import_id,
          accounts.id AS account_id,
          accounts.account_name,
          CASE
            WHEN accounts.is_joint = 1 THEN 'Shared'
            ELSE people.display_name
          END AS owner_name
        FROM imports
        LEFT JOIN transactions ON transactions.import_id = imports.id
        LEFT JOIN accounts ON accounts.id = transactions.account_id
        LEFT JOIN people ON people.id = accounts.owner_person_id
        WHERE imports.household_id = ?
          AND imports.id IN (${importIdPlaceholders})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chunk)
      .all<{ import_id: string; account_id: string | null; account_name: string | null; owner_name: string | null }>();

    rows.push(...accountRows.results);
  }

  return rows;
}

function formatImportAccountLabel(accountName: string, ownerName: string | null) {
  return ownerName ? `${accountName} - ${ownerName}` : accountName;
}
