// Investment statement values inside the import preview, commit and rollback
// (DOMAIN.md, "Investment Statement Value"). What an investment statement
// says an account was worth is saved in `investment_statement_values`, apart
// from `account_balance_checkpoints`: it includes gains, so it is never
// compared with ledger activity, never certified and never part of the
// statement chain. Nothing here writes on its own; the import commit adds
// these statements to its own batch.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { getMonthEndDate, normalizeStatementDate } from "./app-repository-helpers";
import type { ImportPreviewInvestmentValueDto, StatementCheckpointDraftDto } from "../types/dto";

export function isInvestmentValueCheckpoint(checkpoint: StatementCheckpointDraftDto) {
  return Boolean(checkpoint.investmentValue);
}

export interface InvestmentValueSave {
  accountId: string;
  month: string;
  asOfDate: string;
  totalAssetsMinor: number;
  marketValueMinor: number;
  cashMinor: number;
  incomeMinor: number;
  currency: string;
  accountReference: string | null;
}

interface StoredInvestmentValue {
  import_id: string;
  as_of_date: string;
  total_assets_minor: number;
  market_value_minor: number;
  cash_minor: number;
  income_minor: number;
  currency: string;
  account_reference: string | null;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// The save a value checkpoint stands for, checked. Throws a plain message for
// a checkpoint that cannot be saved, before the commit writes anything.
export function readInvestmentValueSave(accountId: string, checkpoint: StatementCheckpointDraftDto): InvestmentValueSave {
  const value = checkpoint.investmentValue;
  if (!value || !MONTH_PATTERN.test(checkpoint.checkpointMonth ?? "")) {
    throw new Error(`Invalid investment statement for ${checkpoint.accountName}`);
  }
  const amounts = [value.totalAssetsMinor, value.marketValueMinor, value.cashMinor, value.incomeMinor];
  if (!amounts.every((amount) => Number.isInteger(amount)) || value.totalAssetsMinor < 0 || value.cashMinor < 0 || value.incomeMinor < 0) {
    throw new Error(`Invalid investment statement amounts for ${checkpoint.accountName}`);
  }
  if (value.currency !== "SGD") {
    throw new Error(`The ${checkpoint.accountName} statement is in ${value.currency}. Only Singapore dollar statements can be imported.`);
  }
  return {
    accountId,
    month: checkpoint.checkpointMonth,
    asOfDate: normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth),
    totalAssetsMinor: value.totalAssetsMinor,
    marketValueMinor: value.marketValueMinor,
    cashMinor: value.cashMinor,
    incomeMinor: value.incomeMinor,
    currency: value.currency,
    accountReference: value.accountReference?.trim() || null
  };
}

async function loadStoredValue(db: D1Database, accountId: string, month: string) {
  return db
    .prepare(`
      SELECT import_id, as_of_date, total_assets_minor, market_value_minor, cash_minor, income_minor, currency, account_reference
      FROM investment_statement_values
      WHERE household_id = ? AND account_id = ? AND value_month = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, accountId, month)
    .first<StoredInvestmentValue>();
}

// What the preview says it will save, and the value it would replace.
export async function buildImportPreviewInvestmentValues(
  db: D1Database,
  checkpoints: StatementCheckpointDraftDto[],
  accountsById: Map<string, { id: string; name: string; kind: string }>
): Promise<ImportPreviewInvestmentValueDto[]> {
  const previews: ImportPreviewInvestmentValueDto[] = [];
  for (const checkpoint of checkpoints) {
    const value = checkpoint.investmentValue;
    if (!value) {
      continue;
    }
    const account = checkpoint.accountId ? accountsById.get(checkpoint.accountId) : undefined;
    const existing = account ? await loadStoredValue(db, account.id, checkpoint.checkpointMonth).catch(() => null) : null;
    previews.push({
      ...(account ? { accountId: account.id } : {}),
      accountName: account?.name ?? checkpoint.accountName,
      detectedAccountName: checkpoint.detectedAccountName ?? checkpoint.accountName,
      ...(account ? { accountKind: account.kind } : {}),
      checkpointMonth: checkpoint.checkpointMonth,
      asOfDate: normalizeStatementDate(checkpoint.statementEndDate) ?? getMonthEndDate(checkpoint.checkpointMonth),
      totalAssetsMinor: value.totalAssetsMinor,
      cashMinor: value.cashMinor,
      currency: value.currency,
      ...(existing ? { replaces: { asOfDate: existing.as_of_date, totalAssetsMinor: existing.total_assets_minor } } : {})
    });
  }
  return previews;
}

// One upsert per saved value, remembering the value it replaces so a rollback
// of this import can put that back. Reads first, then returns the statements
// for the commit's batch.
export async function buildInvestmentValueSaveStatements(db: D1Database, importId: string, saves: InvestmentValueSave[]) {
  const statements: D1PreparedStatement[] = [];
  for (const save of saves) {
    const existing = await loadStoredValue(db, save.accountId, save.month);
    statements.push(db
      .prepare(`
        INSERT INTO investment_statement_values (
          id, household_id, account_id, value_month, as_of_date, total_assets_minor, market_value_minor,
          cash_minor, income_minor, currency, account_reference, import_id, previous_value_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, value_month) DO UPDATE SET
          as_of_date = excluded.as_of_date,
          total_assets_minor = excluded.total_assets_minor,
          market_value_minor = excluded.market_value_minor,
          cash_minor = excluded.cash_minor,
          income_minor = excluded.income_minor,
          currency = excluded.currency,
          account_reference = excluded.account_reference,
          import_id = excluded.import_id,
          previous_value_json = excluded.previous_value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(
        `investment-value-${crypto.randomUUID()}`,
        DEFAULT_HOUSEHOLD_ID,
        save.accountId,
        save.month,
        save.asOfDate,
        save.totalAssetsMinor,
        save.marketValueMinor,
        save.cashMinor,
        save.incomeMinor,
        save.currency,
        save.accountReference,
        importId,
        existing ? JSON.stringify(existing) : null
      ));
  }
  return statements;
}

// Puts back the value an import replaced (while the import that saved it is
// still completed), or removes the value when it replaced nothing.
export async function buildInvestmentValueRollbackStatements(db: D1Database, importId: string) {
  const saved = await db
    .prepare(`
      SELECT id, account_id, value_month, previous_value_json
      FROM investment_statement_values
      WHERE household_id = ? AND import_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, importId)
    .all<{ id: string; account_id: string; value_month: string; previous_value_json: string | null }>();
  const statements: D1PreparedStatement[] = [];
  for (const row of saved.results) {
    const previous = parsePreviousValue(row.previous_value_json);
    const previousImport = previous
      ? await db
        .prepare("SELECT status FROM imports WHERE household_id = ? AND id = ?")
        .bind(DEFAULT_HOUSEHOLD_ID, previous.import_id)
        .first<{ status: string }>()
      : null;
    if (previous && previousImport?.status === "completed") {
      statements.push(db
        .prepare(`
          UPDATE investment_statement_values
          SET as_of_date = ?, total_assets_minor = ?, market_value_minor = ?, cash_minor = ?, income_minor = ?,
            currency = ?, account_reference = ?, import_id = ?, previous_value_json = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE household_id = ? AND id = ? AND import_id = ?
        `)
        .bind(
          previous.as_of_date,
          previous.total_assets_minor,
          previous.market_value_minor,
          previous.cash_minor,
          previous.income_minor,
          previous.currency,
          previous.account_reference,
          previous.import_id,
          DEFAULT_HOUSEHOLD_ID,
          row.id,
          importId
        ));
    }
  }
  return statements;
}

export function buildInvestmentValueCleanupStatement(db: D1Database, importId: string) {
  return db
    .prepare("DELETE FROM investment_statement_values WHERE household_id = ? AND import_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, importId);
}

function parsePreviousValue(json: string | null): StoredInvestmentValue | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as StoredInvestmentValue;
    return typeof parsed?.import_id === "string" && Number.isInteger(parsed.total_assets_minor) ? parsed : null;
  } catch {
    return null;
  }
}

// The latest statement value of each account, for the Summary's investment
// rows. An older database without the table has none.
export async function loadLatestInvestmentValues(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT account_id, as_of_date, total_assets_minor
      FROM investment_statement_values AS value
      WHERE household_id = ?
        AND as_of_date = (
          SELECT MAX(inner_value.as_of_date) FROM investment_statement_values AS inner_value
          WHERE inner_value.household_id = value.household_id AND inner_value.account_id = value.account_id
        )
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ account_id: string; as_of_date: string; total_assets_minor: number }>()
    .catch(() => ({ results: [] as { account_id: string; as_of_date: string; total_assets_minor: number }[] }));
  return new Map(result.results.map((row) => [row.account_id, { valueMinor: row.total_assets_minor, asOfDate: row.as_of_date }]));
}
