import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { hasSetIntersection } from "./app-repository-helpers";
import type { ImportBatchDto } from "../types/dto";

const DEFAULT_IMPORT_HISTORY_LIMIT = 100;
const MAX_IMPORT_HISTORY_LIMIT = 200;

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
      SELECT
        imports.id,
        imports.source_label,
        imports.source_type,
        imports.parser_key,
        imports.imported_at,
        imports.status,
        imports.note,
        COUNT(DISTINCT transactions.id) AS transaction_count,
        MIN(transactions.transaction_date) AS start_date,
        MAX(transactions.transaction_date) AS end_date
      FROM imports
      LEFT JOIN transactions ON transactions.import_id = imports.id
      WHERE imports.household_id = ?
      GROUP BY imports.id, imports.source_label, imports.source_type, imports.parser_key, imports.imported_at, imports.status, imports.note
      ORDER BY imports.imported_at DESC
      LIMIT ?
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

  const importIds = result.results.map((row) => row.id);
  const importIdPlaceholders = importIds.map(() => "?").join(", ");
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
    .bind(DEFAULT_HOUSEHOLD_ID, ...importIds)
    .all<{ import_id: string; account_id: string | null; account_name: string | null; owner_name: string | null }>();

  const accountIdsByImportId = new Map<string, Set<string>>();
  const accountNamesByImportId = new Map<string, Set<string>>();
  for (const row of accountRows.results) {
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

  return result.results.map((row) => {
    const rowAccountIds = accountIdsByImportId.get(row.id) ?? new Set<string>();
    const overlapCandidates = result.results.filter((candidate) => (
      candidate.id !== row.id
      && row.status === "completed"
      && candidate.status === "completed"
      && row.start_date
      && row.end_date
      && candidate.start_date
      && candidate.end_date
      && row.start_date <= candidate.end_date
      && row.end_date >= candidate.start_date
      && hasSetIntersection(rowAccountIds, accountIdsByImportId.get(candidate.id) ?? new Set<string>())
    ));
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

    return {
      id: row.id,
      sourceLabel: row.source_label,
      sourceType: row.source_type,
      parserKey: row.parser_key ?? undefined,
      importedAt: row.imported_at,
      status: row.status,
      transactionCount: Number(row.transaction_count ?? 0),
      startDate: row.start_date ?? undefined,
      endDate: row.end_date ?? undefined,
      accountNames: Array.from(accountNamesByImportId.get(row.id) ?? []).sort(),
      overlapImportCount: includeOverlapDetails ? overlapCandidates.length : 0,
      overlapImports,
      note: row.note ?? undefined
    };
  });
}

function formatImportAccountLabel(accountName: string, ownerName: string | null) {
  return ownerName ? `${accountName} - ${ownerName}` : accountName;
}
