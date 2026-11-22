// Reads the entries that can explain why a saved statement and the ledger
// differ, and attaches the explanation to each statement that is off
// (statement-difference.ts holds the rule). One bounded read, and none at
// all while every statement matches.
import { getMonthEndDate, getSignedLedgerAmountMinor } from "./app-repository-helpers";
import { explainStatementDifference, type StatementDifferenceCandidate } from "./statement-difference";
import type { AccountCheckpointDto, AccountDto } from "../types/dto";

// A statement with no start date still needs a lower bound for the read.
const DEFAULT_PERIOD_DAYS = 62;
const MAX_CANDIDATE_ROWS = 2000;
const MAX_ACCOUNTS = 60;

type CandidateRow = {
  id: string;
  account_id: string;
  cleared_date: string;
  description: string;
  entry_type: "expense" | "income" | "transfer";
  transfer_direction: "in" | "out" | null;
  amount_minor: number;
  bank_certification_status: string | null;
  certified_month: string | null;
};

export async function attachStatementDifferences(
  db: D1Database,
  accounts: AccountDto[],
  options: { latestOnly?: boolean } = {}
): Promise<AccountDto[]> {
  const targets = accounts
    .map((account) => ({ account, statements: statementsToExplain(account, options.latestOnly ?? false) }))
    .filter((target) => target.statements.length)
    .slice(0, MAX_ACCOUNTS);
  if (!targets.length) {
    return accounts;
  }

  const allStatements = targets.flatMap((target) => target.statements);
  const windowStart = allStatements.map(statementWindowStart).sort()[0];
  const windowEnd = allStatements.map(statementEnd).sort().at(-1)!;
  const earliestMonth = allStatements.map((statement) => statement.month).sort()[0];
  const accountIds = targets.map((target) => target.account.id);

  let rows: CandidateRow[];
  try {
    const result = await db.prepare(`
      SELECT * FROM (
        SELECT
          transactions.id,
          transactions.account_id,
          COALESCE(transactions.post_date, transactions.transaction_date) AS cleared_date,
          transactions.description,
          transactions.entry_type,
          transactions.transfer_direction,
          transactions.amount_minor,
          transactions.bank_certification_status,
          (
            SELECT MAX(certificates.checkpoint_month)
            FROM statement_reconciliation_certificates AS certificates
            WHERE certificates.import_id = transactions.statement_certified_import_id
              AND certificates.account_id = transactions.account_id
          ) AS certified_month
        FROM transactions
        LEFT JOIN imports ON imports.id = transactions.import_id
        WHERE transactions.account_id IN (${accountIds.map(() => "?").join(", ")})
          AND COALESCE(transactions.post_date, transactions.transaction_date) BETWEEN ? AND ?
          AND (transactions.import_id IS NULL OR imports.status = 'completed')
      )
      WHERE bank_certification_status IS NOT 'statement_certified' OR certified_month > ?
      ORDER BY cleared_date DESC
      LIMIT ${MAX_CANDIDATE_ROWS}
    `).bind(...accountIds, windowStart, windowEnd, earliestMonth).all<CandidateRow>();
    rows = result.results;
  } catch (error) {
    // The explanation is an extra: a failed read leaves the plain difference.
    console.error("Statement difference read failed", error instanceof Error ? error.name : "unknown");
    return accounts;
  }

  const candidatesByAccountId = new Map<string, StatementDifferenceCandidate[]>();
  for (const row of rows) {
    const list = candidatesByAccountId.get(row.account_id) ?? [];
    list.push({
      entryId: row.id,
      date: row.cleared_date,
      description: row.description,
      signedAmountMinor: getSignedLedgerAmountMinor(row),
      ...(row.bank_certification_status === "statement_certified" && row.certified_month
        ? { certifiedByMonth: row.certified_month }
        : {})
    });
    candidatesByAccountId.set(row.account_id, list);
  }

  const explainedMonthsByAccountId = new Map(targets.map((target) => [
    target.account.id,
    new Set(target.statements.map((statement) => statement.month))
  ]));

  return accounts.map((account) => {
    const months = explainedMonthsByAccountId.get(account.id);
    if (!months || !account.checkpointHistory) {
      return account;
    }
    const entries = candidatesByAccountId.get(account.id) ?? [];
    return {
      ...account,
      checkpointHistory: account.checkpointHistory.map((statement) => {
        if (!months.has(statement.month)) {
          return statement;
        }
        const difference = explainStatementDifference({
          statement: {
            month: statement.month,
            startDate: statementWindowStart(statement),
            endDate: statementEnd(statement)
          },
          deltaMinor: statement.deltaMinor,
          entries
        });
        return difference ? { ...statement, difference } : statement;
      })
    };
  });
}

function statementsToExplain(account: AccountDto, latestOnly: boolean): AccountCheckpointDto[] {
  const history = account.checkpointHistory ?? [];
  if (!latestOnly) {
    return history.filter((statement) => statement.deltaMinor !== 0);
  }
  const latest = history.find((statement) => statement.month === account.latestCheckpointMonth);
  return latest && latest.deltaMinor !== 0 ? [latest] : [];
}

function statementEnd(statement: AccountCheckpointDto) {
  return statement.statementEndDate ?? getMonthEndDate(statement.month);
}

function statementWindowStart(statement: AccountCheckpointDto) {
  if (statement.statementStartDate) {
    return statement.statementStartDate;
  }
  const end = new Date(`${statementEnd(statement)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - DEFAULT_PERIOD_DAYS);
  return end.toISOString().slice(0, 10);
}
