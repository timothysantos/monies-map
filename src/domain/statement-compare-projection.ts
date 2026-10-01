// The statement mismatch diagnosis after commit: a statement uploaded in
// Settings ("Compare statement") is set against the ledger for every card
// section it holds, and the same deterministic diagnosis as the import
// preview (DOMAIN.md, "Statement Mismatch Diagnosis") finds entries on the
// wrong card and second copies of purchases. Corrections it suggests are
// applied by app-repository-statement-corrections.ts. Read only.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { extractTransactionDateHint, getMonthEndDate, getSignedLedgerAmountMinor } from "./app-repository-helpers";
import { matchStatementCompareRows, normalizeStatementCompareRows } from "./app-repository-checkpoints";
import { loadAccounts } from "./app-repository-settings";
import {
  diagnoseStatementMismatches,
  findCheckpointsBrokenByCorrections,
  getCorrectionBalanceChanges,
  toDiagnosisAccount,
  type DiagnosisCard,
  type DiagnosisLedgerEntry,
  type DiagnosisStatementRow,
  type SavedCheckpointBalance
} from "./statement-mismatch-diagnosis";
import type { AccountDto, StatementCompareRowDto, StatementDiagnosisDto } from "../types/dto";

export interface StatementCompareSection {
  accountName: string;
  accountLast4?: string;
  statementStartDate?: string;
  statementEndDate?: string;
  rows: Record<string, string>[];
}

const RELATED_ENTRY_WINDOW_DAYS = 7;

// The account a statement section belongs to: its name, else the card's
// remembered last four digits.
export function resolveStatementSectionAccount(section: StatementCompareSection, accounts: AccountDto[], last4ByAccountId: Map<string, string>) {
  const byName = accounts.filter((account) => account.name === section.accountName);
  if (byName.length === 1) {
    return byName[0];
  }
  const byLast4 = section.accountLast4 ? accounts.filter((account) => last4ByAccountId.get(account.id) === section.accountLast4) : [];
  return byLast4.length === 1 ? byLast4[0] : undefined;
}

export async function loadAccountLast4(db: D1Database) {
  const result = await db
    .prepare("SELECT id, last4 FROM accounts WHERE household_id = ? AND last4 IS NOT NULL")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; last4: string }>();
  return new Map(result.results.map((row) => [row.id, row.last4]));
}

export async function buildStatementCompareDiagnosis(db: D1Database, input: {
  accountId: string;
  checkpointMonth: string;
  statementStartDate: string;
  statementEndDate: string;
  rows: Record<string, string>[];
  otherSections: StatementCompareSection[];
  sourceType: "csv" | "pdf";
}): Promise<StatementDiagnosisDto | undefined> {
  const accounts = await loadAccounts(db);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const target = accountsById.get(input.accountId);
  if (!target) {
    return undefined;
  }
  const last4ByAccountId = input.otherSections.length ? await loadAccountLast4(db) : new Map<string, string>();

  // Each card on the statement with its period: the saved checkpoint's
  // dates when there is one, else the section's own.
  const sections = [
    { account: target, rows: input.rows, startDate: input.statementStartDate, endDate: input.statementEndDate },
    ...input.otherSections.flatMap((section) => {
      const account = resolveStatementSectionAccount(section, accounts, last4ByAccountId);
      if (!account || account.id === target.id) {
        return [];
      }
      const saved = account.checkpointHistory?.find((checkpoint) => checkpoint.month === input.checkpointMonth);
      return [{
        account,
        rows: section.rows,
        startDate: saved?.statementStartDate ?? section.statementStartDate ?? input.statementStartDate,
        endDate: saved?.statementEndDate ?? section.statementEndDate ?? input.statementEndDate
      }];
    })
  ];

  const relatedAccountIds = new Set(sections.map((section) => section.account.id));
  for (const account of accounts) {
    if (
      !target.isJoint
      && target.ownerPersonId
      && account.ownerPersonId === target.ownerPersonId
      && account.institutionId === target.institutionId
    ) {
      relatedAccountIds.add(account.id);
    }
  }
  const windowStart = shiftDate(sections.map((section) => section.startDate).sort()[0], -RELATED_ENTRY_WINDOW_DAYS);
  const windowEnd = shiftDate(sections.map((section) => section.endDate).sort().at(-1)!, RELATED_ENTRY_WINDOW_DAYS);
  const ledgerEntries = await loadDiagnosisLedgerEntries(db, Array.from(relatedAccountIds), windowStart, windowEnd);

  const cards: DiagnosisCard[] = [];
  const statementRows: DiagnosisStatementRow[] = [];
  let rowIndexOffset = 0;
  for (const section of sections) {
    const saved = section.account.checkpointHistory?.find((checkpoint) => checkpoint.month === input.checkpointMonth);
    const normalizedRows = normalizeStatementCompareRows(section.rows, section.startDate, section.endDate);
    const cardLedger = ledgerEntries
      .filter((entry) => entry.accountId === section.account.id)
      .filter((entry) => {
        const clearedDate = entry.postDate ?? entry.transactionDate;
        return clearedDate >= section.startDate && clearedDate <= section.endDate;
      })
      .map(toCompareRow);
    const { ledgerIdByStatementId } = matchStatementCompareRows(normalizedRows, cardLedger);
    // A section with no saved statement has no difference to explain; its
    // rows still tell which purchases belong on that card.
    if (saved) {
      cards.push({
        accountId: section.account.id,
        accountName: section.account.name,
        checkpointMonth: input.checkpointMonth,
        startDate: section.startDate,
        endDate: section.endDate,
        deltaMinor: saved.deltaMinor,
        supersededEntryIds: []
      });
    }
    for (const [index, row] of normalizedRows.entries()) {
      const eventDate = extractTransactionDateHint(row.note);
      statementRows.push({
        rowIndex: rowIndexOffset + index + 1,
        accountId: section.account.id,
        postedDate: row.date,
        ...(eventDate && eventDate !== row.date ? { eventDate } : {}),
        description: row.description,
        amountMinor: row.amountMinor,
        entryType: row.entryType,
        ...(row.transferDirection ? { transferDirection: row.transferDirection } : {}),
        commitStatus: "included",
        commitStatusExplicit: false,
        ...(ledgerIdByStatementId.get(row.id) ? { targetEntryId: ledgerIdByStatementId.get(row.id) } : {}),
        reviewCandidateEntryIds: []
      });
    }
    rowIndexOffset += normalizedRows.length;
  }
  if (!cards.some((card) => card.accountId === target.id)) {
    return undefined;
  }

  const diagnosis = diagnoseStatementMismatches({
    sourceType: input.sourceType,
    mode: "committed",
    accounts: accounts.map((account) => toDiagnosisAccount(account)!),
    cards,
    statementRows,
    ledgerEntries,
    appliedFixes: [],
    rejectedFixes: []
  });

  // A correction that would unbalance a saved statement that matches now is
  // not offered: it stays in the list, with that statement named.
  const savedCheckpoints = buildSavedCheckpointBalances(accounts);
  for (const finding of diagnosis.findings) {
    if (!finding.fix || !finding.entry) {
      continue;
    }
    const entry = ledgerEntries.find((candidate) => candidate.id === finding.entry!.id);
    if (!entry) {
      continue;
    }
    const broken = findCheckpointsBrokenByCorrections({
      checkpoints: savedCheckpoints,
      changes: getCorrectionBalanceChanges(finding.fix, {
        accountId: entry.accountId,
        signedAmountMinor: getEntrySigned(entry),
        clearedDate: entry.postDate ?? entry.transactionDate
      })
    });
    if (broken.length) {
      finding.facts.push({ code: "unbalances_saved_statement", accountName: broken[0].accountName, month: broken[0].month });
      finding.confidence = "low";
      delete finding.fix;
    }
  }
  return diagnosis;
}

export function buildSavedCheckpointBalances(accounts: AccountDto[]): SavedCheckpointBalance[] {
  return accounts.flatMap((account) => (account.checkpointHistory ?? []).map((checkpoint) => ({
    accountId: account.id,
    accountName: account.name,
    month: checkpoint.month,
    endDate: checkpoint.statementEndDate ?? getMonthEndDate(checkpoint.month),
    deltaMinor: checkpoint.deltaMinor
  })));
}

async function loadDiagnosisLedgerEntries(db: D1Database, accountIds: string[], startDate: string, endDate: string): Promise<DiagnosisLedgerEntry[]> {
  if (!accountIds.length) {
    return [];
  }
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.account_id, transactions.transaction_date, transactions.post_date,
        transactions.note, transactions.description, transactions.amount_minor, transactions.entry_type,
        transactions.transfer_direction, transactions.bank_certification_status, transactions.transfer_group_id,
        COALESCE(imports.source_type, 'manual') AS source_type
      FROM transactions
      LEFT JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.account_id IN (${accountIds.map(() => "?").join(", ")})
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
        AND COALESCE(transactions.post_date, transactions.transaction_date) BETWEEN ? AND ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...accountIds, startDate, endDate)
    .all<{
      id: string;
      account_id: string;
      transaction_date: string;
      post_date: string | null;
      note: string | null;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      bank_certification_status: "provisional" | "statement_certified";
      transfer_group_id: string | null;
      source_type: "csv" | "pdf" | "manual";
    }>();
  return result.results.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    transactionDate: row.transaction_date,
    postDate: row.post_date,
    note: row.note,
    description: row.description,
    amountMinor: Number(row.amount_minor),
    entryType: row.entry_type,
    transferDirection: row.transfer_direction,
    bankCertificationStatus: row.bank_certification_status,
    sourceType: row.source_type,
    transferGroupId: row.transfer_group_id
  }));
}

function toCompareRow(entry: DiagnosisLedgerEntry): StatementCompareRowDto {
  return {
    id: entry.id,
    date: entry.postDate ?? entry.transactionDate,
    ...(entry.postDate && entry.postDate !== entry.transactionDate ? { transactionDate: entry.transactionDate } : {}),
    description: entry.description,
    amountMinor: entry.amountMinor,
    signedAmountMinor: getEntrySigned(entry),
    entryType: entry.entryType,
    ...(entry.transferDirection ? { transferDirection: entry.transferDirection } : {})
  };
}

function getEntrySigned(entry: DiagnosisLedgerEntry) {
  return getSignedLedgerAmountMinor({ entry_type: entry.entryType, transfer_direction: entry.transferDirection, amount_minor: entry.amountMinor });
}

// Calendar-day arithmetic in UTC.
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
