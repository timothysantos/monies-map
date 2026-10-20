import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { offsetsCategory } from "./category-offset";
import { entryAddedByFromReference } from "./entry-source";
import { getMonthBounds, groupSplits } from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
import { readEntryTime } from "../lib/entry-time";
import { homeCurrencyShareAmounts } from "./split-allocation";
import { isCurrencyMatch } from "./split-currency";
import { selectTransferCandidates, transferCandidateWindow } from "./transfer-candidates";
import type { EntryDto, LinkedTransferDto, TransferPurposeDto } from "../types/dto";

// Only the Entries page reads an entry's time of day (`withTime`); every other
// page's entries stay as they were, so no response grows for a field its
// screen never shows.
export type EntryLoadOptions = { withTime?: boolean };

export async function loadEntries(db: D1Database, month = getCurrentMonthKey(), options: EntryLoadOptions = {}): Promise<EntryDto[]> {
  const [monthStart, nextMonth] = getMonthBounds(month);
  return loadEntriesForDateRange(db, monthStart, nextMonth, options);
}

export async function loadEntriesForMonths(db: D1Database, months: string[], options: EntryLoadOptions = {}): Promise<EntryDto[]> {
  if (!months.length) {
    return [];
  }

  const sortedMonths = [...months].sort();
  const [monthStart] = getMonthBounds(sortedMonths[0]);
  const [, monthEnd] = getMonthBounds(sortedMonths[sortedMonths.length - 1]);
  return loadEntriesForDateRange(db, monthStart, monthEnd, options);
}

// The other-side candidates the Entries transfer dialog shows
// (selectTransferCandidates is the one rule set). `transferDirection`
// ranks as if the entry already had that direction: Ask asks it for an
// entry that is about to become a transfer.
export async function loadTransferMatchCandidates(
  db: D1Database,
  entryId: string,
  options: { transferDirection?: "in" | "out" } = {}
): Promise<{ entry: EntryDto | null; candidates: EntryDto[] }> {
  const entryRow = await db
    .prepare(`
      SELECT transaction_date
      FROM transactions
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{ transaction_date: string }>();

  if (!entryRow) {
    return { entry: null, candidates: [] };
  }

  const window = transferCandidateWindow(entryRow.transaction_date);
  const entries = await loadEntriesForDateRange(db, window.start, window.endExclusive);
  const entry = entries.find((candidate) => candidate.id === entryId) ?? null;
  if (!entry) {
    return { entry: null, candidates: [] };
  }

  const candidates = selectTransferCandidates({
    id: entry.id,
    date: entry.date,
    accountId: entry.accountId,
    accountName: entry.accountName,
    amountMinor: entry.totalAmountMinor ?? entry.amountMinor,
    transferDirection: entry.transferDirection ?? options.transferDirection ?? null
  }, entries);

  return { entry, candidates };
}

// The same search for an entry that is not saved yet (an Ask draft): the
// rows around its date, ranked by the same rules.
export async function loadTransferCandidatesForDraft(
  db: D1Database,
  subject: { date: string; accountId: string; amountMinor: number; transferDirection?: "in" | "out" }
): Promise<EntryDto[]> {
  const window = transferCandidateWindow(subject.date);
  const entries = await loadEntriesForDateRange(db, window.start, window.endExclusive);
  return selectTransferCandidates({ ...subject, transferDirection: subject.transferDirection ?? null }, entries);
}

// Which of these entries already belong to a transfer pair or a split: the
// pair command would refuse to take them from it, so a card never offers
// them as the other side.
export async function loadTakenTransferEntryIds(db: D1Database, candidates: EntryDto[]): Promise<Set<string>> {
  const taken = new Set(candidates.filter((candidate) => candidate.linkedSplitExpenseId).map((candidate) => candidate.id));
  if (!candidates.length) {
    return taken;
  }
  const linked = await db
    .prepare(`SELECT id FROM transactions WHERE household_id = ? AND transfer_group_id IS NOT NULL AND id IN (${candidates.map(() => "?").join(", ")})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...candidates.map((candidate) => candidate.id))
    .all<{ id: string }>();
  for (const row of linked.results) {
    taken.add(row.id);
  }
  return taken;
}

// Ids of the entries in [rangeStart, rangeEndExclusive) that belong to a
// transfer group. An entry's `linkedTransfer` is only filled when its
// counterpart is in the same loaded range; this names every linked entry.
export async function loadTransferGroupedEntryIds(db: D1Database, rangeStart: string, rangeEndExclusive: string): Promise<string[]> {
  const result = await db
    .prepare(`
      SELECT id
      FROM transactions
      WHERE household_id = ?
        AND transfer_group_id IS NOT NULL
        AND transaction_date >= ?
        AND transaction_date < ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, rangeStart, rangeEndExclusive)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

// Ids of every account of kind `investment`, archived ones too: money moved
// into or out of them is invested or taken out of investments
// (investment-moves.ts).
export async function loadInvestmentAccountIds(db: D1Database): Promise<Set<string>> {
  const result = await db
    .prepare("SELECT id FROM accounts WHERE household_id = ? AND account_kind = 'investment'")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();
  return new Set(result.results.map((row) => row.id));
}

// The ledger stays event-first. We still project post_date so the UI can show
// when the bank cleared a row without moving it out of its planning month.
export async function loadEntriesForDateRange(db: D1Database, monthStart: string, nextMonth: string, options: EntryLoadOptions = {}): Promise<EntryDto[]> {
  const entries = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.post_date,
        transactions.transaction_time,
        transactions.description,
        transactions.entry_type,
        transactions.transfer_direction,
        transactions.amount_minor,
        transactions.offsets_category,
        transactions.note,
        transactions.transfer_group_id,
        transactions.account_id,
        transactions.bank_certification_status,
        transactions.statement_certified_at,
        transactions.import_id,
        transactions.external_reference,
        imports.source_type AS import_source_type,
        imports.source_label AS import_source_label,
        split_expenses.id AS linked_split_expense_id,
        split_groups.group_name AS linked_split_group_name,
        split_categories.name AS linked_split_category_name,
        split_expenses.note AS linked_split_note,
        transactions.owner_person_id,
        people.display_name AS owner_name,
        accounts.account_name AS account_name,
        CASE
          WHEN accounts.is_joint = 1 THEN 'Shared'
          ELSE account_owners.display_name
        END AS account_owner_label,
        categories.name AS category_name,
        transactions.transfer_purpose_person_id,
        transactions.transfer_purpose_source,
        purpose_categories.name AS transfer_purpose_category_name,
        purpose_people.display_name AS transfer_purpose_person_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN people ON people.id = transactions.owner_person_id
      LEFT JOIN people AS account_owners ON account_owners.id = accounts.owner_person_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      -- A transfer's purpose (transfer-purpose.ts): its category and the
      -- person the money went to, NULL for every other entry.
      LEFT JOIN categories AS purpose_categories ON purpose_categories.id = transactions.transfer_purpose_category_id
      LEFT JOIN people AS purpose_people ON purpose_people.id = transactions.transfer_purpose_person_id
      LEFT JOIN imports ON imports.id = transactions.import_id
      -- An archived (deleted) split keeps its link only for a restore; the
      -- entry is linked to its active split, if any.
      LEFT JOIN split_expenses
        ON split_expenses.household_id = transactions.household_id
       AND split_expenses.linked_transaction_id = transactions.id
       AND split_expenses.deleted_at IS NULL
      LEFT JOIN split_groups
        ON split_groups.household_id = split_expenses.household_id
       AND split_groups.id = split_expenses.split_group_id
      LEFT JOIN categories AS split_categories
        ON split_categories.household_id = split_expenses.household_id
       AND split_categories.id = split_expenses.category_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
        AND (transactions.import_id IS NULL OR imports.status = 'completed')
      ORDER BY transactions.transaction_date, transactions.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      id: string;
      transaction_date: string;
      post_date: string | null;
      transaction_time: string | null;
      description: string;
      entry_type: "expense" | "income" | "transfer";
      transfer_direction: "in" | "out" | null;
      amount_minor: number;
      offsets_category: number;
      note: string | null;
      transfer_group_id: string | null;
      account_id: string;
      bank_certification_status: "provisional" | "statement_certified";
      statement_certified_at: string | null;
      import_id: string | null;
      external_reference: string | null;
      import_source_type: "csv" | "pdf" | "manual" | null;
      import_source_label: string | null;
      linked_split_expense_id: string | null;
      linked_split_group_name: string | null;
      linked_split_category_name: string | null;
      linked_split_note: string | null;
      owner_person_id: string | null;
      owner_name: string | null;
      account_name: string;
      account_owner_label: string | null;
      category_name: string | null;
      transfer_purpose_person_id: string | null;
      transfer_purpose_source: string | null;
      transfer_purpose_category_name: string | null;
      transfer_purpose_person_name: string | null;
    }>();

  const linkedSplitShares = await db
    .prepare(`
      SELECT
        split_expenses.linked_transaction_id AS transaction_id,
        split_expense_shares.person_id,
        split_expense_shares.ratio_basis_points,
        split_expense_shares.amount_minor,
        people.display_name,
        split_expenses.currency AS split_currency,
        transactions.currency AS entry_currency,
        transactions.amount_minor AS entry_amount_minor,
        CASE people.role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END AS person_rank,
        people.created_at AS person_created_at
      FROM split_expense_shares
      INNER JOIN split_expenses ON split_expenses.id = split_expense_shares.split_expense_id
      INNER JOIN people ON people.id = split_expense_shares.person_id
      INNER JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      WHERE split_expenses.household_id = ?
        AND split_expenses.linked_transaction_id IS NOT NULL
        AND split_expenses.deleted_at IS NULL
        AND transactions.transaction_date >= ?
        AND transactions.transaction_date < ?
      ORDER BY split_expense_shares.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, monthStart, nextMonth)
    .all<{
      transaction_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
      split_currency: string | null;
      entry_currency: string | null;
      entry_amount_minor: number;
      person_rank: number;
      person_created_at: string;
    }>();
  const linkedSplitShareMap = buildLinkedSplitShareMap(linkedSplitShares.results);
  const entriesByTransferGroup = new Map<string, typeof entries.results>();

  for (const entry of entries.results) {
    if (!entry.transfer_group_id) {
      continue;
    }

    const current = entriesByTransferGroup.get(entry.transfer_group_id) ?? [];
    current.push(entry);
    entriesByTransferGroup.set(entry.transfer_group_id, current);
  }

  return entries.results.map((row) => {
    let linkedTransfer: LinkedTransferDto | undefined;
    if (row.transfer_group_id) {
      const siblings = entriesByTransferGroup.get(row.transfer_group_id) ?? [];
      const counterpart = siblings.find((candidate) => candidate.id !== row.id);
      if (counterpart) {
        linkedTransfer = {
          transactionId: counterpart.id,
          accountName: counterpart.account_name,
          accountOwnerLabel: counterpart.account_owner_label ?? undefined,
          amountMinor: counterpart.amount_minor,
          transactionDate: counterpart.transaction_date
        };
      }
    }

    return {
      id: row.id,
      // Event date drives sorting, planning, and split attribution.
      date: row.transaction_date,
      // The local clock time, only where one was recorded.
      ...(options.withTime && readEntryTime(row.transaction_time) ? { time: readEntryTime(row.transaction_time) } : {}),
      // postDate is bank clearance evidence for reconciliation UI.
      postDate: row.post_date ?? undefined,
      description: row.description,
      accountId: row.account_id,
      accountName: row.account_name,
      accountOwnerLabel: row.account_owner_label ?? undefined,
      categoryName: row.category_name ?? "Other",
      entryType: row.entry_type,
      transferDirection: row.transfer_direction ?? undefined,
      ownershipType: "direct",
      ownerName: row.owner_name ?? undefined,
      amountMinor: row.amount_minor,
      offsetsCategory: offsetsCategory({ entryType: row.entry_type, categoryName: row.category_name }),
      note: row.note ?? undefined,
      bankCertificationStatus: getEntryBankCertificationStatus(row),
      bankCertificationLabel: getEntryBankCertificationLabel(row),
      importedSourceType: row.import_source_type ?? undefined,
      importedSourceLabel: row.import_source_label ?? undefined,
      statementCertifiedAt: row.statement_certified_at ?? undefined,
      // Only the derived source, never the reference; left out when unknown.
      addedBy: entryAddedByFromReference(row.external_reference) ?? undefined,
      linkedTransfer,
      linkedSplitExpenseId: row.linked_split_expense_id ?? undefined,
      linkedSplitGroupName: row.linked_split_group_name ?? undefined,
      linkedSplitCategoryName: row.linked_split_category_name ?? undefined,
      linkedSplitNote: row.linked_split_note ?? undefined,
      linkedSplitShares: row.linked_split_expense_id
        ? linkedSplitShareMap.get(row.id) ?? []
        : undefined,
      splits: row.owner_person_id
        ? [{
          personId: row.owner_person_id,
          personName: row.owner_name ?? row.account_owner_label ?? "Owner",
          ratioBasisPoints: 10000,
          amountMinor: row.amount_minor
        }]
        : [],
      // Only on a transfer out that has one, so no other entry grows.
      ...readStoredTransferPurpose(row)
    };
  });
}

function readStoredTransferPurpose(row: {
  entry_type: string;
  transfer_direction: string | null;
  transfer_purpose_person_id: string | null;
  transfer_purpose_source: string | null;
  transfer_purpose_category_name: string | null;
  transfer_purpose_person_name: string | null;
}): { transferPurpose?: TransferPurposeDto } {
  if (
    row.entry_type !== "transfer"
    || row.transfer_direction !== "out"
    || !row.transfer_purpose_category_name
    || !row.transfer_purpose_person_id
    || !row.transfer_purpose_person_name
  ) {
    return {};
  }
  return {
    transferPurpose: {
      categoryName: row.transfer_purpose_category_name,
      toPersonId: row.transfer_purpose_person_id,
      toPersonName: row.transfer_purpose_person_name,
      ...(row.transfer_purpose_source === "remembered" ? { remembered: true as const } : {})
    }
  };
}

type LinkedSplitShareRow = {
  transaction_id: string;
  person_id: string;
  ratio_basis_points: number;
  amount_minor: number;
  display_name: string;
  split_currency: string | null;
  entry_currency: string | null;
  entry_amount_minor: number;
  person_rank: number;
  person_created_at: string;
};

// The linked split shares of each entry, in the entry's own (home) currency,
// because every projection of an entry (the viewer share on Entries, Month
// actuals, Summary, the stored person month totals) counts them as ledger
// money. A same-currency split's stored shares already are that and pass
// through untouched. A travel split's shares are in its own currency, so each
// person's share is converted to their share of the ledger amount
// (homeCurrencyShareAmounts); the split itself keeps its own shares.
function buildLinkedSplitShareMap(rows: LinkedSplitShareRow[]) {
  const shareMap = groupSplits(rows, "transaction_id");
  const rowsByTransaction = new Map<string, LinkedSplitShareRow[]>();
  for (const row of rows) {
    const current = rowsByTransaction.get(row.transaction_id) ?? [];
    current.push(row);
    rowsByTransaction.set(row.transaction_id, current);
  }

  for (const [transactionId, splitRows] of rowsByTransaction) {
    const [first] = splitRows;
    if (isCurrencyMatch(first.split_currency, first.entry_currency)) {
      continue;
    }

    // Split-share people order, so the balancing cent lands on the same
    // person as when a same-currency split follows a new amount.
    const ordered = [...splitRows].sort((left, right) => left.person_rank - right.person_rank
      || left.person_created_at.localeCompare(right.person_created_at)
      || left.person_id.localeCompare(right.person_id));
    const homeAmounts = homeCurrencyShareAmounts(
      ordered.map((row) => ({ ratioBasisPoints: row.ratio_basis_points, amountMinor: row.amount_minor })),
      first.entry_amount_minor
    );
    const homeAmountByPerson = new Map(ordered.map((row, index) => [row.person_id, homeAmounts[index]]));
    shareMap.set(transactionId, (shareMap.get(transactionId) ?? []).map((share) => ({
      ...share,
      amountMinor: homeAmountByPerson.get(share.personId) ?? share.amountMinor
    })));
  }

  return shareMap;
}

function getEntryBankCertificationStatus(row: {
  bank_certification_status: "provisional" | "statement_certified";
  import_id: string | null;
}): EntryDto["bankCertificationStatus"] {
  if (row.bank_certification_status === "statement_certified") {
    return "statement_certified";
  }

  return row.import_id ? "import_provisional" : "manual_provisional";
}

function getEntryBankCertificationLabel(row: {
  bank_certification_status: "provisional" | "statement_certified";
  import_id: string | null;
}) {
  if (row.bank_certification_status === "statement_certified") {
    return "Statement certified";
  }

  return row.import_id ? "Import provisional" : "Manual provisional";
}
