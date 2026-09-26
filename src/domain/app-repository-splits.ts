import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  groupSplits,
  slugify
} from "./app-repository-helpers";
import { buildCloseSplitBatchStatement, closeSplitBatch, getOrCreateActiveSplitBatch, planActiveSplitBatch, resolveActiveSplitBatch } from "./app-repository-split-batches";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import { assertSplitSettlementUnchanged, type SplitSettlementFacts } from "./split-settlement-lock";
import {
  findBestCrossCurrencySplitExpenseLedgerCandidate,
  findBestCrossCurrencySplitSettlementLedgerCandidate,
  findBestSplitExpenseLedgerCandidate,
  findBestSplitSettlementLedgerCandidate
} from "./split-matching";
import { rebalanceSplitSharesForTotal, splitAmountMinorWithRoundedRemainder } from "./split-allocation";
import { calculateNetSettlement } from "./split-settlement-policy";
import { calculateFxRateBasisPoints, convertMinorAmount, normalizeSplitCurrency } from "./split-currency";
import { truncateReviewDescription } from "./review-description";
import { getCurrentMonthKey } from "../lib/month";
import type {
  SplitExpenseDto,
  SplitGroupDto,
  SplitMatchCandidateDto,
  SplitSettlementDto,
  SplitSettlementCheckpointDto,
  SplitActivityHistoryDto,
  SplitSettlementCheckpointTransferDto
} from "../types/dto";

const SPLIT_MATCH_DESCRIPTION_MAX_LENGTH = 240;

async function assertSplitGroupCurrency(db: D1Database, groupId: string | null | undefined, currency: unknown) {
  if (!groupId) return normalizeSplitCurrency(currency);
  const group = await db.prepare("SELECT currency FROM split_groups WHERE id = ? AND household_id = ?")
    .bind(groupId, DEFAULT_HOUSEHOLD_ID).first<{ currency: string | null }>();
  if (!group) throw new Error("Split group not found.");
  const groupCurrency = normalizeSplitCurrency(group.currency);
  const recordCurrency = normalizeSplitCurrency(currency);
  if (groupCurrency !== recordCurrency) {
    throw new Error(`This group uses ${groupCurrency}. Split records in the group must use the same currency.`);
  }
  return groupCurrency;
}

function paymentMethodForLinkedAccount(
  accountKind: "bank" | "credit_card" | "loan" | "cash" | "investment" | null | undefined,
  fallback: SplitExpenseDto["paymentMethod"]
): SplitExpenseDto["paymentMethod"] {
  if (accountKind === "credit_card") return "card";
  if (accountKind === "bank") return "bank";
  if (accountKind === "cash") return "cash";
  if (accountKind === "loan" || accountKind === "investment") return "other";
  return fallback;
}

async function assertSplitGroupExpenseSource(
  db: D1Database,
  groupId: string | null | undefined,
  paymentMethod: SplitExpenseDto["paymentMethod"]
) {
  if (!groupId) return;
  const group = await db.prepare("SELECT expense_source FROM split_groups WHERE id = ? AND household_id = ?")
    .bind(groupId, DEFAULT_HOUSEHOLD_ID)
    .first<{ expense_source: SplitGroupDto["expenseSource"] | null }>();
  if (!group) throw new Error("Split group not found.");
  const source = group.expense_source ?? "mixed";
  if (source === "cash" && paymentMethod !== "cash") {
    throw new Error("This group is Cash only. Record bank or card purchases in a Bank/card group.");
  }
  if (source === "ledger" && !["bank", "card"].includes(paymentMethod)) {
    throw new Error("This group is for Bank/card purchases. Record cash purchases in a Cash-only group.");
  }
}

export async function loadSplitGroups(db: D1Database): Promise<SplitGroupDto[]> {
  const groups = await db
    .prepare(`
      SELECT id, group_name, icon_key, sort_order, currency, expense_source
      FROM split_groups
      WHERE household_id = ?
      ORDER BY sort_order, group_name
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      group_name: string;
      icon_key: string | null;
      sort_order: number;
      currency: string | null;
      expense_source: SplitGroupDto["expenseSource"] | null;
    }>();

  return groups.results.map((group) => ({
    id: group.id,
    name: group.group_name,
    iconKey: group.icon_key ?? undefined,
    sortOrder: group.sort_order
    ,currency: normalizeSplitCurrency(group.currency)
    ,expenseSource: group.expense_source ?? "mixed"
  }));
}

export async function loadSplitExpenses(db: D1Database, month = getCurrentMonthKey()): Promise<SplitExpenseDto[]> {
  const expenses = await db
    .prepare(`
      SELECT
        split_expenses.id,
        split_expenses.split_group_id,
        split_expenses.split_batch_id,
        split_expenses.expense_date,
        split_expenses.description,
        split_expenses.total_amount_minor,
        split_expenses.currency,
        split_expenses.home_amount_minor,
        split_expenses.fx_rate_basis_points,
        split_expenses.payment_method,
        split_expenses.payment_status,
        split_expenses.note,
        split_expenses.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        payer.id AS payer_person_id,
        payer.display_name AS payer_person_name,
        categories.name AS category_name,
        transactions.description AS linked_transaction_description,
        transactions.note AS linked_transaction_note,
        linked_categories.name AS linked_transaction_category_name,
        linked_accounts.account_kind AS linked_transaction_account_kind
      FROM split_expenses
      LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
      INNER JOIN people AS payer ON payer.id = split_expenses.payer_person_id
      LEFT JOIN categories ON categories.id = split_expenses.category_id
      LEFT JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      LEFT JOIN accounts AS linked_accounts ON linked_accounts.id = transactions.account_id
      LEFT JOIN categories AS linked_categories ON linked_categories.id = transactions.category_id
      WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL
      ORDER BY split_expenses.expense_date DESC, split_expenses.created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      expense_date: string;
      description: string;
      total_amount_minor: number;
      currency: string | null;
      home_amount_minor: number | null;
      fx_rate_basis_points: number | null;
      payment_method: SplitExpenseDto["paymentMethod"];
      payment_status: SplitExpenseDto["paymentStatus"];
      note: string | null;
      linked_transaction_id: string | null;
      group_name: string | null;
      batch_name: string | null;
      closed_on: string | null;
      payer_person_id: string;
      payer_person_name: string;
      category_name: string | null;
      linked_transaction_description: string | null;
      linked_transaction_note: string | null;
      linked_transaction_category_name: string | null;
      linked_transaction_account_kind: "bank" | "credit_card" | "loan" | "cash" | "investment" | null;
    }>();

  const shares = await db
    .prepare(`
      SELECT
        split_expense_shares.split_expense_id,
        split_expense_shares.person_id,
        split_expense_shares.ratio_basis_points,
        split_expense_shares.amount_minor,
        people.display_name
      FROM split_expense_shares
      INNER JOIN split_expenses ON split_expenses.id = split_expense_shares.split_expense_id
      INNER JOIN people ON people.id = split_expense_shares.person_id
      WHERE split_expenses.household_id = ?
      ORDER BY split_expense_shares.created_at
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      split_expense_id: string;
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
      display_name: string;
    }>();

  const shareMap = groupSplits(
    shares.results.map((row) => ({
      entry_id: row.split_expense_id,
      person_id: row.person_id,
      ratio_basis_points: row.ratio_basis_points,
      amount_minor: row.amount_minor,
      display_name: row.display_name
    })),
    "entry_id"
  );

  return expenses.results.map((row) => ({
    id: row.id,
    groupId: row.split_group_id ?? undefined,
    groupName: row.group_name ?? "Non-group expenses",
    batchId: row.split_batch_id ?? undefined,
    batchLabel: row.batch_name ?? undefined,
    batchClosedAt: row.closed_on ?? undefined,
    date: row.expense_date,
    description: row.description,
    categoryName: row.category_name ?? "Other",
    payerPersonId: row.payer_person_id,
    payerPersonName: row.payer_person_name,
    totalAmountMinor: row.total_amount_minor,
    currency: normalizeSplitCurrency(row.currency),
    homeAmountMinor: row.home_amount_minor ?? undefined,
    fxRateBasisPoints: row.fx_rate_basis_points ?? undefined,
    paymentMethod: paymentMethodForLinkedAccount(row.linked_transaction_account_kind, row.payment_method ?? "cash"),
    paymentStatus: row.payment_status ?? "recorded",
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined,
    linkedTransactionNote: row.linked_transaction_note ?? undefined,
    linkedTransactionCategoryName: row.linked_transaction_category_name ?? undefined,
    shares: shareMap.get(row.id) ?? []
  }));
}

export async function loadSplitSettlements(db: D1Database, month = getCurrentMonthKey()): Promise<SplitSettlementDto[]> {
  const settlements = await db
    .prepare(`
      SELECT
        split_settlements.id,
        split_settlements.split_group_id,
        split_settlements.split_batch_id,
        split_settlements.settlement_date,
        split_settlements.amount_minor,
        split_settlements.currency,
        split_settlements.fx_rate_basis_points,
        split_settlements.payment_method,
        split_settlements.payment_status,
        split_settlements.note,
        split_settlements.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        from_person.id AS from_person_id,
        from_person.display_name AS from_person_name,
        to_person.id AS to_person_id,
        to_person.display_name AS to_person_name,
        transactions.description AS linked_transaction_description,
        transactions.note AS linked_transaction_note,
        linked_categories.name AS linked_transaction_category_name,
        linked_accounts.account_kind AS linked_transaction_account_kind
      FROM split_settlements
      LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
      INNER JOIN people AS from_person ON from_person.id = split_settlements.from_person_id
      INNER JOIN people AS to_person ON to_person.id = split_settlements.to_person_id
      LEFT JOIN transactions ON transactions.id = split_settlements.linked_transaction_id
      LEFT JOIN accounts AS linked_accounts ON linked_accounts.id = transactions.account_id
      LEFT JOIN categories AS linked_categories ON linked_categories.id = transactions.category_id
      WHERE split_settlements.household_id = ? AND split_settlements.deleted_at IS NULL
      ORDER BY split_settlements.settlement_date DESC, split_settlements.created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      settlement_date: string;
      amount_minor: number;
      currency: string | null;
      fx_rate_basis_points: number | null;
      payment_method: SplitSettlementDto["paymentMethod"];
      payment_status: SplitSettlementDto["paymentStatus"];
      note: string | null;
      linked_transaction_id: string | null;
      group_name: string | null;
      batch_name: string | null;
      closed_on: string | null;
      from_person_id: string;
      from_person_name: string;
      to_person_id: string;
      to_person_name: string;
      linked_transaction_description: string | null;
      linked_transaction_note: string | null;
      linked_transaction_category_name: string | null;
      linked_transaction_account_kind: "bank" | "credit_card" | "loan" | "cash" | "investment" | null;
    }>();

  return settlements.results.map((row) => ({
    id: row.id,
    groupId: row.split_group_id ?? undefined,
    groupName: row.group_name ?? "Non-group expenses",
    batchId: row.split_batch_id ?? undefined,
    batchLabel: row.batch_name ?? undefined,
    batchClosedAt: row.closed_on ?? undefined,
    date: row.settlement_date,
    fromPersonId: row.from_person_id,
    fromPersonName: row.from_person_name,
    toPersonId: row.to_person_id,
    toPersonName: row.to_person_name,
    amountMinor: row.amount_minor,
    currency: normalizeSplitCurrency(row.currency),
    fxRateBasisPoints: row.fx_rate_basis_points ?? undefined,
    paymentMethod: paymentMethodForLinkedAccount(row.linked_transaction_account_kind, row.payment_method ?? "cash"),
    paymentStatus: row.payment_status ?? "recorded",
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined,
    linkedTransactionNote: row.linked_transaction_note ?? undefined,
    linkedTransactionCategoryName: row.linked_transaction_category_name ?? undefined
  }));
}

export async function loadSplitSettlementCheckpoints(db: D1Database): Promise<SplitSettlementCheckpointDto[]> {
  const rows = await db.prepare(`
    SELECT
      checkpoints.id, checkpoints.from_person_id, checkpoints.to_person_id,
      checkpoints.amount_minor, checkpoints.currency, checkpoints.settlement_date, checkpoints.settled_at, checkpoints.status,
      checkpoints.matched_transaction_id, checkpoints.matched_amount_minor,
      checkpoints.note, from_person.display_name AS from_person_name,
      to_person.display_name AS to_person_name
    FROM split_settlement_checkpoints AS checkpoints
    LEFT JOIN people AS from_person ON from_person.id = checkpoints.from_person_id
    LEFT JOIN people AS to_person ON to_person.id = checkpoints.to_person_id
    WHERE checkpoints.household_id = ?
    ORDER BY checkpoints.settlement_date DESC, checkpoints.created_at DESC
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{
    id: string; from_person_id: string | null; from_person_name: string | null;
    to_person_id: string | null; to_person_name: string | null; amount_minor: number; currency: string | null;
    settlement_date: string; settled_at: string | null; status: SplitSettlementCheckpointDto["status"];
    matched_transaction_id: string | null; matched_amount_minor: number;
    note: string | null;
  }>();
  const [items, matches, legacyMatches] = await Promise.all([db.prepare(`
    SELECT checkpoint_id, record_id
    FROM split_settlement_checkpoint_items
    WHERE checkpoint_id IN (SELECT id FROM split_settlement_checkpoints WHERE household_id = ?)
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{ checkpoint_id: string; record_id: string }>(), db.prepare(`
    SELECT matches.checkpoint_id, matches.transaction_id, matches.amount_minor,
      matches.ledger_amount_minor, matches.fx_rate_basis_points, transactions.currency,
      transactions.transaction_date, transactions.description
    FROM split_settlement_checkpoint_matches AS matches
    INNER JOIN split_settlement_checkpoints AS checkpoints ON checkpoints.id = matches.checkpoint_id
    INNER JOIN transactions ON transactions.id = matches.transaction_id
    WHERE checkpoints.household_id = ?
    ORDER BY matches.created_at, matches.id
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{ checkpoint_id: string; transaction_id: string; amount_minor: number; ledger_amount_minor: number | null; fx_rate_basis_points: number | null; currency: string; transaction_date: string; description: string }>(), db.prepare(`
    SELECT checkpoints.id AS checkpoint_id, checkpoints.matched_transaction_id AS transaction_id,
      checkpoints.matched_amount_minor AS amount_minor, transactions.amount_minor AS ledger_amount_minor,
      NULL AS fx_rate_basis_points, transactions.currency, transactions.transaction_date,
      transactions.description
    FROM split_settlement_checkpoints AS checkpoints
    INNER JOIN transactions ON transactions.id = checkpoints.matched_transaction_id
    WHERE checkpoints.household_id = ? AND checkpoints.matched_transaction_id IS NOT NULL
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{ checkpoint_id: string; transaction_id: string; amount_minor: number; ledger_amount_minor: number | null; fx_rate_basis_points: number | null; currency: string; transaction_date: string; description: string }>()]);
  const itemMap = new Map<string, string[]>();
  for (const item of items.results) itemMap.set(item.checkpoint_id, [...(itemMap.get(item.checkpoint_id) ?? []), item.record_id]);
  const matchMap = new Map<string, SplitSettlementCheckpointTransferDto[]>();
  for (const match of [...legacyMatches.results, ...matches.results]) {
    const transfers = matchMap.get(match.checkpoint_id) ?? [];
    if (!transfers.some((transfer) => transfer.transactionId === match.transaction_id)) {
      transfers.push({ transactionId: match.transaction_id, transactionDate: match.transaction_date, description: match.description, amountMinor: match.amount_minor, currency: normalizeSplitCurrency(match.currency), ledgerAmountMinor: match.ledger_amount_minor ?? undefined, fxRateBasisPoints: match.fx_rate_basis_points ?? undefined });
    }
    matchMap.set(match.checkpoint_id, transfers);
  }
  return rows.results.map((row) => ({
    id: row.id,
    fromPersonId: row.from_person_id ?? undefined,
    fromPersonName: row.from_person_name ?? undefined,
    toPersonId: row.to_person_id ?? undefined,
    toPersonName: row.to_person_name ?? undefined,
    amountMinor: row.amount_minor,
    currency: normalizeSplitCurrency(row.currency),
    settlementDate: row.settlement_date,
    settledAt: row.settled_at ?? undefined,
    status: row.status,
    matchedTransactionId: row.matched_transaction_id ?? undefined,
    matchedAmountMinor: matchMap.get(row.id)?.reduce((total, transfer) => total + transfer.amountMinor, 0) ?? row.matched_amount_minor,
    matchedTransfers: matchMap.get(row.id) ?? [],
    includedRecordCount: itemMap.get(row.id)?.length ?? 0,
    includedRecordIds: itemMap.get(row.id) ?? [],
    note: row.note ?? undefined
  }));
}

async function loadCheckpointedRecordIds(db: D1Database) {
  const rows = await db.prepare(`
    SELECT items.record_kind, items.record_id
    FROM split_settlement_checkpoint_items AS items
    INNER JOIN split_settlement_checkpoints AS checkpoints ON checkpoints.id = items.checkpoint_id
    WHERE checkpoints.household_id = ? AND checkpoints.status NOT IN ('reopened', 'voided')
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{ record_kind: "expense" | "settlement"; record_id: string }>();
  return new Set(rows.results.map((row) => `${row.record_kind}:${row.record_id}`));
}

export async function createSplitSettlementCheckpoint(
  db: D1Database,
  input: { viewerPersonId: string; date: string; note?: string; currency?: string }
) {
  const people = await db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at, id LIMIT 2")
    .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>();
  const viewer = people.results.find((person) => person.id === input.viewerPersonId);
  const other = people.results.find((person) => person.id !== input.viewerPersonId);
  if (!viewer || !other) throw new Error("Settlement simplification requires two household people.");
  const [expenses, settlements, checkpointed] = await Promise.all([
    loadSplitExpenses(db), loadSplitSettlements(db), loadCheckpointedRecordIds(db)
  ]);
  const requestedCurrency = input.currency ? normalizeSplitCurrency(input.currency) : undefined;
  const allOpenExpenses = expenses.filter((row) => !row.batchClosedAt && !checkpointed.has(`expense:${row.id}`));
  const allOpenSettlements = settlements.filter((row) => !row.batchClosedAt && !checkpointed.has(`settlement:${row.id}`));
  const currencies = new Set([...allOpenExpenses, ...allOpenSettlements].map((row) => row.currency));
  if (requestedCurrency && !currencies.has(requestedCurrency) && currencies.size > 0) {
    throw new Error(`No open split records are available in ${requestedCurrency}.`);
  }
  if (!requestedCurrency && currencies.size > 1) throw new Error("Simplify settlement requires one currency. Select a currency-specific group before simplifying.");
  const currency = requestedCurrency ?? [...currencies][0] ?? "SGD";
  const existingCheckpoint = await db.prepare("SELECT id FROM split_settlement_checkpoints WHERE household_id = ? AND currency = ? AND settled_at IS NULL AND status IN ('open', 'partially_matched') LIMIT 1")
    .bind(DEFAULT_HOUSEHOLD_ID, currency).first<{ id: string }>();
  if (existingCheckpoint) throw new Error(`An active ${currency} settlement checkpoint already exists. Reopen it before creating another.`);
  const openExpenses = allOpenExpenses.filter((row) => row.currency === currency);
  const openSettlements = allOpenSettlements.filter((row) => row.currency === currency);
  const balances = new Map<string, number>();
  for (const row of openExpenses) {
    const primary = row.shares[0];
    const secondary = row.shares[1];
    const raw = row.payerPersonId === primary?.personId ? (secondary?.amountMinor ?? 0) : -(primary?.amountMinor ?? 0);
    const amount = input.viewerPersonId === secondary?.personId ? -raw : raw;
    const groupId = row.groupId ?? "split-group-none";
    balances.set(groupId, (balances.get(groupId) ?? 0) + amount);
  }
  for (const row of openSettlements) {
    const amount = row.toPersonId === input.viewerPersonId ? row.amountMinor : -row.amountMinor;
    const groupId = row.groupId ?? "split-group-none";
    balances.set(groupId, (balances.get(groupId) ?? 0) + amount);
  }
  const net = calculateNetSettlement([...balances].map(([groupId, amountMinor]) => ({ groupId, amountMinor })), viewer.display_name, other.display_name);
  const id = `split-checkpoint-${Date.now()}`;
  const status = net.amountMinor === 0 ? "internally_offset" : "open";
  await db.prepare(`
    INSERT INTO split_settlement_checkpoints
      (id, household_id, from_person_id, to_person_id, amount_minor, currency, settlement_date, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, DEFAULT_HOUSEHOLD_ID, net.fromPersonName ? (net.fromPersonName === viewer.display_name ? viewer.id : other.id) : null,
    net.toPersonName ? (net.toPersonName === viewer.display_name ? viewer.id : other.id) : null,
    net.amountMinor, currency, input.date, status, input.note ?? null).run();
  for (const row of openExpenses) await db.prepare("INSERT INTO split_settlement_checkpoint_items (id, checkpoint_id, record_kind, record_id) VALUES (?, ?, 'expense', ?)").bind(`${id}-expense-${row.id}`, id, row.id).run();
  for (const row of openSettlements) await db.prepare("INSERT INTO split_settlement_checkpoint_items (id, checkpoint_id, record_kind, record_id) VALUES (?, ?, 'settlement', ?)").bind(`${id}-settlement-${row.id}`, id, row.id).run();
  return { checkpointId: id, amountMinor: net.amountMinor, currency, status };
}

export async function reopenSplitSettlementCheckpoint(db: D1Database, checkpointId: string) {
  const existing = await db.prepare("SELECT id FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID).first<{ id: string }>();
  if (!existing) throw new Error("Settlement checkpoint not found.");
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'reopened', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?").bind(checkpointId, DEFAULT_HOUSEHOLD_ID).run();
  return { checkpointId, status: "reopened" as const };
}

// A household can confirm the real-world repayment before the bank transaction
// is available. This deliberately does not change reconciliation status.
export async function markSplitSettlementCheckpointPaid(db: D1Database, checkpointId: string) {
  const checkpoint = await db.prepare("SELECT id, status, settled_at FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; status: SplitSettlementCheckpointDto["status"]; settled_at: string | null }>();
  if (!checkpoint) throw new Error("Settlement checkpoint not found.");
  if (["reopened", "voided", "internally_offset", "matched"].includes(checkpoint.status)) {
    throw new Error("Only an unmatched settlement can be marked paid.");
  }
  if (checkpoint.settled_at) return { checkpointId, settledAt: checkpoint.settled_at };
  await db.prepare("UPDATE split_settlement_checkpoints SET settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID).run();
  const marked = await db.prepare("SELECT settled_at FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID).first<{ settled_at: string | null }>();
  return { checkpointId, settledAt: marked?.settled_at ?? undefined };
}

export async function undoSplitSettlementCheckpointPaid(db: D1Database, checkpointId: string) {
  const checkpoint = await db.prepare("SELECT id, status, settled_at FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; status: SplitSettlementCheckpointDto["status"]; settled_at: string | null }>();
  if (!checkpoint) throw new Error("Settlement checkpoint not found.");
  if (!checkpoint.settled_at) throw new Error("This settlement is not marked paid.");
  if (checkpoint.status === "matched") throw new Error("Remove the bank match before undoing a paid settlement.");
  await db.prepare("UPDATE split_settlement_checkpoints SET settled_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?")
    .bind(checkpointId, DEFAULT_HOUSEHOLD_ID).run();
  return { checkpointId };
}

export async function matchSplitSettlementCheckpoint(db: D1Database, input: { checkpointId: string; transactionId: string; fxRateBasisPoints?: number }) {
  const checkpoint = await db.prepare("SELECT amount_minor, currency, status, matched_transaction_id, matched_amount_minor FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(input.checkpointId, DEFAULT_HOUSEHOLD_ID).first<{ amount_minor: number; currency: string; status: SplitSettlementCheckpointDto["status"]; matched_transaction_id: string | null; matched_amount_minor: number }>();
  if (!checkpoint) throw new Error("Settlement checkpoint not found.");
  if (["reopened", "voided", "internally_offset"].includes(checkpoint.status)) throw new Error("This settlement checkpoint is not open for matching.");
  const alreadyUsed = await db.prepare(`
    SELECT checkpoint_id FROM split_settlement_checkpoint_matches WHERE transaction_id = ?
    UNION ALL
    SELECT id FROM split_settlement_checkpoints WHERE matched_transaction_id = ? AND id != ?
    LIMIT 1
  `).bind(input.transactionId, input.transactionId, input.checkpointId).first<{ checkpoint_id: string }>();
  if (alreadyUsed) throw new Error("This transfer is already matched to another settlement checkpoint.");
  const alreadyMatched = await db.prepare("SELECT transaction_id FROM split_settlement_checkpoint_matches WHERE checkpoint_id = ? AND transaction_id = ?")
    .bind(input.checkpointId, input.transactionId).first<{ transaction_id: string }>();
  if (alreadyMatched || checkpoint.matched_transaction_id === input.transactionId) throw new Error("This transfer is already matched to this settlement checkpoint.");
  const row = await db.prepare("SELECT amount_minor, currency, entry_type FROM transactions WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, DEFAULT_HOUSEHOLD_ID).first<{ amount_minor: number; currency: string; entry_type: string }>();
  if (!row || row.entry_type !== "transfer") throw new Error("Checkpoint matches require a transfer entry.");
  const ledgerAmountMinor = Math.abs(row.amount_minor);
  const ledgerCurrency = normalizeSplitCurrency(row.currency);
  const checkpointCurrency = normalizeSplitCurrency(checkpoint.currency);
  const fxRateBasisPoints = ledgerCurrency === checkpointCurrency ? 10000 : Number(input.fxRateBasisPoints ?? 0);
  if (fxRateBasisPoints <= 0) throw new Error(`This transfer is ${ledgerCurrency}, but the checkpoint is ${checkpointCurrency}. Enter the agreed FX rate before matching.`);
  const amountMinor = ledgerCurrency === checkpointCurrency ? ledgerAmountMinor : convertMinorAmount(ledgerAmountMinor, fxRateBasisPoints);
  const totalMatchedMinor = checkpoint.matched_amount_minor + amountMinor;
  const status = totalMatchedMinor === checkpoint.amount_minor ? "matched" : totalMatchedMinor < checkpoint.amount_minor ? "partially_matched" : "open";
  await db.prepare("INSERT INTO split_settlement_checkpoint_matches (id, checkpoint_id, transaction_id, amount_minor, ledger_amount_minor, fx_rate_basis_points) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(`${input.checkpointId}-match-${input.transactionId}`, input.checkpointId, input.transactionId, amountMinor, ledgerAmountMinor, fxRateBasisPoints).run();
  await db.prepare("UPDATE split_settlement_checkpoints SET matched_transaction_id = COALESCE(matched_transaction_id, ?), matched_amount_minor = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, totalMatchedMinor, status, input.checkpointId, DEFAULT_HOUSEHOLD_ID).run();
  return { checkpointId: input.checkpointId, status, matchedAmountMinor: totalMatchedMinor, remainingMinor: Math.max(0, checkpoint.amount_minor - totalMatchedMinor) };
}

export async function unmatchSplitSettlementCheckpoint(db: D1Database, input: { checkpointId: string; transactionId: string }) {
  const checkpoint = await db.prepare("SELECT amount_minor, status, matched_transaction_id, matched_amount_minor FROM split_settlement_checkpoints WHERE id = ? AND household_id = ?")
    .bind(input.checkpointId, DEFAULT_HOUSEHOLD_ID).first<{ amount_minor: number; status: SplitSettlementCheckpointDto["status"]; matched_transaction_id: string | null; matched_amount_minor: number }>();
  if (!checkpoint) throw new Error("Settlement checkpoint not found.");
  if (["reopened", "voided", "internally_offset"].includes(checkpoint.status)) throw new Error("This settlement checkpoint cannot be changed.");
  const match = await db.prepare("SELECT amount_minor FROM split_settlement_checkpoint_matches WHERE checkpoint_id = ? AND transaction_id = ?")
    .bind(input.checkpointId, input.transactionId).first<{ amount_minor: number }>();
  if (!match) throw new Error("This transfer is not matched to the settlement checkpoint.");
  const totalMatchedMinor = Math.max(0, checkpoint.matched_amount_minor - match.amount_minor);
  const status = totalMatchedMinor === checkpoint.amount_minor ? "matched" : totalMatchedMinor > 0 ? "partially_matched" : "open";
  await db.prepare("DELETE FROM split_settlement_checkpoint_matches WHERE checkpoint_id = ? AND transaction_id = ?").bind(input.checkpointId, input.transactionId).run();
  const nextLegacyTransactionId = await db.prepare("SELECT transaction_id FROM split_settlement_checkpoint_matches WHERE checkpoint_id = ? ORDER BY created_at, id LIMIT 1")
    .bind(input.checkpointId).first<{ transaction_id: string }>();
  await db.prepare("UPDATE split_settlement_checkpoints SET matched_transaction_id = ?, matched_amount_minor = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?")
    .bind(nextLegacyTransactionId?.transaction_id ?? null, totalMatchedMinor, status, input.checkpointId, DEFAULT_HOUSEHOLD_ID).run();
  return { checkpointId: input.checkpointId, status, matchedAmountMinor: totalMatchedMinor, remainingMinor: Math.max(0, checkpoint.amount_minor - totalMatchedMinor) };
}

export async function loadSplitMatchCandidates(db: D1Database, month = getCurrentMonthKey()): Promise<SplitMatchCandidateDto[]> {
  const [expenses, settlements] = await Promise.all([
    loadSplitExpenses(db, month),
    loadSplitSettlements(db, month)
  ]);
  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        SUBSTR(transactions.description, 1, ${SPLIT_MATCH_DESCRIPTION_MAX_LENGTH + 1}) AS description,
        transactions.amount_minor,
        transactions.currency,
        transactions.entry_type,
        transactions.import_id
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.import_id IS NOT NULL
        AND imports.status = 'completed'
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      entry_type: "expense" | "income" | "transfer";
      import_id: string;
    }>();

  const matches: SplitMatchCandidateDto[] = [];

  for (const expense of expenses.filter((item) => !item.linkedTransactionId)) {
    const sameCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) === normalizeSplitCurrency(expense.currency));
    const crossCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) !== normalizeSplitCurrency(expense.currency));
    const candidate = findBestSplitExpenseLedgerCandidate(
      expense,
      sameCurrencyRows
    ) ?? findBestCrossCurrencySplitExpenseLedgerCandidate(expense, crossCurrencyRows);

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `expense-match-${expense.id}-${candidate.row.id}`,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      splitRecordId: expense.id,
      splitDate: expense.date,
      splitDescription: expense.description,
      splitAmountMinor: expense.totalAmountMinor,
      splitCurrency: normalizeSplitCurrency(expense.currency),
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: truncateReviewDescription(candidate.row.description, SPLIT_MATCH_DESCRIPTION_MAX_LENGTH),
      amountMinor: candidate.row.amount_minor,
      transactionCurrency: normalizeSplitCurrency(candidate.row.currency),
      amountDeltaMinor: candidate.amountDelta,
      dateDeltaDays: candidate.dateDelta,
      confidenceLabel: normalizeSplitCurrency(candidate.row.currency) === normalizeSplitCurrency(expense.currency) && candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transaction could match this split expense",
      requiresFxReview: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(expense.currency),
      fxRateBasisPoints: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(expense.currency)
        ? calculateFxRateBasisPoints(Math.abs(expense.totalAmountMinor), Math.abs(candidate.row.amount_minor))
        : undefined
    });
  }

  for (const settlement of settlements.filter((item) => !item.linkedTransactionId)) {
    const sameCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) === normalizeSplitCurrency(settlement.currency));
    const crossCurrencyRows = transactionRows.results.filter((row) => normalizeSplitCurrency(row.currency) !== normalizeSplitCurrency(settlement.currency));
    const candidate = findBestSplitSettlementLedgerCandidate(
      settlement,
      sameCurrencyRows
    ) ?? findBestCrossCurrencySplitSettlementLedgerCandidate(settlement, crossCurrencyRows);

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `settlement-match-${settlement.id}-${candidate.row.id}`,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      splitRecordId: settlement.id,
      splitDate: settlement.date,
      splitDescription: `${settlement.fromPersonName} to ${settlement.toPersonName}`,
      splitAmountMinor: settlement.amountMinor,
      splitCurrency: normalizeSplitCurrency(settlement.currency),
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: truncateReviewDescription(candidate.row.description, SPLIT_MATCH_DESCRIPTION_MAX_LENGTH),
      amountMinor: candidate.row.amount_minor,
      transactionCurrency: normalizeSplitCurrency(candidate.row.currency),
      amountDeltaMinor: candidate.amountDelta,
      dateDeltaDays: candidate.dateDelta,
      confidenceLabel: normalizeSplitCurrency(candidate.row.currency) === normalizeSplitCurrency(settlement.currency) && candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transfer could match this settle-up",
      requiresFxReview: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(settlement.currency),
      fxRateBasisPoints: normalizeSplitCurrency(candidate.row.currency) !== normalizeSplitCurrency(settlement.currency)
        ? calculateFxRateBasisPoints(Math.abs(settlement.amountMinor), Math.abs(candidate.row.amount_minor))
        : undefined
    });
  }

  return matches;
}

export async function createSplitGroupRecord(
  db: D1Database,
  input: { name: string; currency?: string; expenseSource?: SplitGroupDto["expenseSource"] }
) {
  const id = `split-group-${slugify(input.name)}-${Date.now()}`;
  await db
    .prepare(`
      INSERT INTO split_groups (
        id, household_id, group_name, currency, expense_source, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(id, DEFAULT_HOUSEHOLD_ID, input.name.trim(), normalizeSplitCurrency(input.currency), input.expenseSource ?? "mixed", Date.now())
    .run();

  return { groupId: id };
}

export async function createSplitExpenseRecord(
  db: D1Database,
  input: {
    groupId?: string | null;
    date: string;
    description: string;
    categoryName: string;
    payerPersonName: string;
    amountMinor: number;
    note?: string;
    currency?: string;
    homeAmountMinor?: number;
    fxRateBasisPoints?: number | null;
    paymentMethod?: SplitExpenseDto["paymentMethod"];
    paymentStatus?: SplitExpenseDto["paymentStatus"];
    splitBasisPoints?: number;
    splitAmountMinor?: number;
  }
) {
  const currency = await assertSplitGroupCurrency(db, input.groupId, input.currency);
  await assertSplitGroupExpenseSource(db, input.groupId, input.paymentMethod ?? "cash");
  const { categoryId, payerPersonId, sharePeople } = await resolveSplitExpenseRefs(
    db,
    input.categoryName,
    input.payerPersonName
  );

  const id = `split-expense-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  const { firstBasisPoints, secondBasisPoints, firstAmount, secondAmount } = buildSplitShareAmounts(input.amountMinor, input.splitBasisPoints, input.splitAmountMinor);
  const shares = [
    { personId: sharePeople[0].id, ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { personId: sharePeople[1].id, ratioBasisPoints: secondBasisPoints, amountMinor: secondAmount }
  ];

  await db
    .prepare(`
      INSERT INTO split_expenses (
        id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
        description, category_id, total_amount_minor, currency, home_amount_minor,
        fx_rate_basis_points, payment_method, payment_status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEFAULT_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      payerPersonId,
      input.date,
      input.description.trim(),
      categoryId,
      input.amountMinor,
      currency,
      input.homeAmountMinor ?? null,
      input.fxRateBasisPoints ?? null,
      input.paymentMethod ?? "cash",
      input.paymentStatus ?? "recorded",
      input.note ?? null
    )
    .run();

  for (const share of shares) {
    await db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${id}-${share.personId}`, id, share.personId, share.ratioBasisPoints, share.amountMinor)
      .run();
  }

  return { splitExpenseId: id };
}

async function resolveSplitExpenseRefs(db: D1Database, categoryName: string, payerPersonName: string) {
  // Resolve form labels against current DB rows, not seed fixtures, so renamed people and real categories stay authoritative.
  const [category, payer, people] = await Promise.all([
    db
      .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, categoryName)
      .first<{ id: string }>(),
    db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, payerPersonName)
      .first<{ id: string }>(),
    loadSplitSharePeople(db)
  ]);

  if (!category?.id) {
    throw new Error("Unknown split expense category.");
  }

  if (!payer?.id) {
    throw new Error("Unknown split expense payer.");
  }

  return { categoryId: category.id, payerPersonId: payer.id, sharePeople: people };
}

async function resolveSplitSettlementRefs(db: D1Database, fromPersonName: string, toPersonName: string) {
  const [fromPerson, toPerson] = await Promise.all([
    db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, fromPersonName)
      .first<{ id: string }>(),
    db
      .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, toPersonName)
      .first<{ id: string }>()
  ]);

  if (!fromPerson?.id || !toPerson?.id || fromPerson.id === toPerson.id) {
    throw new Error("Settlement requires two different people.");
  }

  return { fromPersonId: fromPerson.id, toPersonId: toPerson.id };
}

async function loadSplitSharePeople(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id
      FROM people
      WHERE household_id = ?
      ORDER BY
        CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END,
        created_at,
        id
      LIMIT 2
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();

  if (people.results.length < 2) {
    throw new Error("Split expenses require two people.");
  }

  return people.results;
}

export async function createSplitSettlementRecord(
  db: D1Database,
  input: {
    groupId?: string | null;
    date: string;
    fromPersonName: string;
    toPersonName: string;
    amountMinor: number;
    note?: string;
    currency?: string;
    fxRateBasisPoints?: number | null;
    paymentMethod?: SplitSettlementDto["paymentMethod"];
    paymentStatus?: SplitSettlementDto["paymentStatus"];
  }
) {
  const currency = await assertSplitGroupCurrency(db, input.groupId, input.currency);
  const { fromPersonId, toPersonId } = await resolveSplitSettlementRefs(db, input.fromPersonName, input.toPersonName);

  const id = `split-settlement-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  await db
    .prepare(`
      INSERT INTO split_settlements (
        id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
        settlement_date, amount_minor, currency, fx_rate_basis_points, payment_method, payment_status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEFAULT_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      fromPersonId,
      toPersonId,
      input.date,
      input.amountMinor,
      currency,
      input.fxRateBasisPoints ?? null,
      input.paymentMethod ?? "cash",
      input.paymentStatus ?? "recorded",
      input.note ?? null
    )
    .run();
  await closeSplitBatch(db, { batchId, closedOn: input.date });

  return { settlementId: id };
}

export async function updateSplitExpenseRecord(
  db: D1Database,
  input: {
    splitExpenseId: string;
    groupId?: string | null;
    date: string;
    description: string;
    categoryName: string;
    payerPersonName: string;
    amountMinor: number;
    note?: string;
    splitBasisPoints?: number;
    splitAmountMinor?: number;
    currency?: string;
    homeAmountMinor?: number;
    fxRateBasisPoints?: number | null;
    paymentMethod?: SplitExpenseDto["paymentMethod"];
    paymentStatus?: SplitExpenseDto["paymentStatus"];
  }
) {
  const currency = await assertSplitGroupCurrency(db, input.groupId, input.currency);
  await assertSplitGroupExpenseSource(db, input.groupId, input.paymentMethod ?? "cash");
  const { categoryId, payerPersonId, sharePeople } = await resolveSplitExpenseRefs(
    db,
    input.categoryName,
    input.payerPersonName
  );

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id, linked_transaction_id
      FROM split_expenses
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null; linked_transaction_id: string | null }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }

  const nextGroupId = input.groupId || null;
  const { firstBasisPoints, secondBasisPoints, firstAmount, secondAmount } = buildSplitShareAmounts(input.amountMinor, input.splitBasisPoints, input.splitAmountMinor);
  await assertSplitSettlementUnchanged(db, {
    recordKind: "expense",
    recordId: input.splitExpenseId,
    next: () => ({
      date: input.date,
      groupId: nextGroupId,
      currency,
      amountMinor: input.amountMinor,
      partyIds: [payerPersonId],
      shares: [
        { personId: sharePeople[0].id, amountMinor: firstAmount },
        { personId: sharePeople[1].id, amountMinor: secondAmount }
      ]
    })
  });

  const batch = existing.split_group_id === nextGroupId
    ? { batchId: existing.split_batch_id, statements: [] }
    : await planActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });
  // A linked entry counts by its split shares in person views, so a share
  // (or payer) change moves the stored month totals of the entry's month.
  const months = existing.linked_transaction_id ? await linkedEntryMonths(db, input.splitExpenseId) : [];

  await db.batch([
    ...batch.statements,
    db
      .prepare(`
        UPDATE split_expenses
        SET split_group_id = ?, split_batch_id = ?, payer_person_id = ?, expense_date = ?, description = ?,
            category_id = ?, total_amount_minor = ?, currency = ?, home_amount_minor = ?,
            fx_rate_basis_points = ?, payment_method = ?, payment_status = ?, note = ?
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        nextGroupId,
        batch.batchId ?? null,
        payerPersonId,
        input.date,
        input.description.trim(),
        categoryId,
        input.amountMinor,
        currency,
        input.homeAmountMinor ?? null,
        input.fxRateBasisPoints ?? null,
        input.paymentMethod ?? "cash",
        input.paymentStatus ?? "recorded",
        input.note ?? null,
        input.splitExpenseId,
        DEFAULT_HOUSEHOLD_ID
      ),
    db.prepare("DELETE FROM split_expense_shares WHERE split_expense_id = ?").bind(input.splitExpenseId),
    db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.splitExpenseId}-${sharePeople[0].id}`,
        input.splitExpenseId,
        sharePeople[0].id,
        firstBasisPoints,
        firstAmount,
        `${input.splitExpenseId}-${sharePeople[1].id}`,
        input.splitExpenseId,
        sharePeople[1].id,
        secondBasisPoints,
        secondAmount
      ),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  if (existing.linked_transaction_id) {
    await syncLinkedTransactionToSplitExpense(db, {
      transactionId: existing.linked_transaction_id,
      splitBasisPoints: firstBasisPoints
    });
  }

  return { splitExpenseId: input.splitExpenseId };
}

export async function updateSplitExpenseNoteRecord(
  db: D1Database,
  input: {
    splitExpenseId: string;
    note?: string;
  }
) {
  const existing = await db
    .prepare("SELECT id FROM split_expenses WHERE id = ? AND household_id = ?")
    .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }

  await db
    .prepare("UPDATE split_expenses SET note = ? WHERE id = ? AND household_id = ?")
    .bind(input.note ?? null, input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .run();

  return { splitExpenseId: input.splitExpenseId, updated: true };
}

export async function updateSplitExpenseCategoryRecord(
  db: D1Database,
  input: {
    splitExpenseId: string;
    categoryName: string;
  }
) {
  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${input.categoryName}`);
  }

  const existing = await db
    .prepare("SELECT id FROM split_expenses WHERE id = ? AND household_id = ?")
    .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }

  await db
    .prepare("UPDATE split_expenses SET category_id = ? WHERE id = ? AND household_id = ?")
    .bind(category.id, input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .run();

  return { splitExpenseId: input.splitExpenseId, updated: true };
}

function buildSplitShareAmounts(amountMinor: number, splitBasisPoints = 5000, splitAmountMinor?: number) {
  const safeAmountMinor = Math.max(0, Number(amountMinor ?? 0));
  const safeBasisPoints = Math.max(0, Math.min(10000, splitBasisPoints));
  const hasExactAmount = typeof splitAmountMinor === "number" && Number.isFinite(splitAmountMinor);
  const firstAmount = hasExactAmount
    ? Math.min(safeAmountMinor, Math.max(0, Math.round(splitAmountMinor)))
    : splitAmountMinorWithRoundedRemainder(safeAmountMinor, safeBasisPoints).firstAmount;
  const secondAmount = safeAmountMinor - firstAmount;
  const firstBasisPoints = safeAmountMinor > 0
    ? Math.max(0, Math.min(10000, Math.round((firstAmount / safeAmountMinor) * 10000)))
    : 0;

  return {
    firstBasisPoints,
    secondBasisPoints: 10000 - firstBasisPoints,
    firstAmount,
    secondAmount
  };
}

async function syncLinkedTransactionToSplitExpense(
  _db: D1Database,
  input: { transactionId: string; splitBasisPoints: number }
) {
  // Split allocation is owned by split_expense_shares. Linking a split expense
  // must not rewrite the ledger entry owner.
  void input.transactionId;
  void input.splitBasisPoints;
}

export async function updateSplitSettlementRecord(
  db: D1Database,
  input: {
    settlementId: string;
    groupId?: string | null;
    date: string;
    fromPersonName: string;
    toPersonName: string;
    amountMinor: number;
    note?: string;
    currency?: string;
    fxRateBasisPoints?: number | null;
    paymentMethod?: SplitSettlementDto["paymentMethod"];
    paymentStatus?: SplitSettlementDto["paymentStatus"];
  }
) {
  const currency = await assertSplitGroupCurrency(db, input.groupId, input.currency);
  const { fromPersonId, toPersonId } = await resolveSplitSettlementRefs(db, input.fromPersonName, input.toPersonName);

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id
      FROM split_settlements
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.settlementId, DEFAULT_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null }>();
  if (!existing) {
    throw new Error("Split settlement not found.");
  }

  const nextGroupId = input.groupId || null;
  await assertSplitSettlementUnchanged(db, {
    recordKind: "settlement",
    recordId: input.settlementId,
    next: () => ({
      date: input.date,
      groupId: nextGroupId,
      currency,
      amountMinor: input.amountMinor,
      partyIds: [fromPersonId, toPersonId],
      shares: []
    })
  });

  const batch = existing.split_group_id === nextGroupId
    ? { batchId: existing.split_batch_id, statements: [] }
    : await planActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });
  // A settle-up closes the batch it belongs to.
  const closeBatchStatement = batch.batchId
    ? await buildCloseSplitBatchStatement(db, { batchId: batch.batchId, groupId: nextGroupId, closedOn: input.date })
    : null;

  await db.batch([
    ...batch.statements,
    db
      .prepare(`
        UPDATE split_settlements
        SET split_group_id = ?, split_batch_id = ?, from_person_id = ?, to_person_id = ?,
            settlement_date = ?, amount_minor = ?, currency = ?, fx_rate_basis_points = ?,
            payment_method = ?, payment_status = ?, note = ?
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        nextGroupId,
        batch.batchId ?? null,
        fromPersonId,
        toPersonId,
        input.date,
        input.amountMinor,
        currency,
        input.fxRateBasisPoints ?? null,
        input.paymentMethod ?? "cash",
        input.paymentStatus ?? "recorded",
        input.note ?? null,
        input.settlementId,
        DEFAULT_HOUSEHOLD_ID
      ),
    ...(closeBatchStatement ? [closeBatchStatement] : [])
  ]);

  return { settlementId: input.settlementId };
}

export async function updateSplitSettlementNoteRecord(
  db: D1Database,
  input: {
    settlementId: string;
    note?: string;
  }
) {
  const existing = await db
    .prepare("SELECT id FROM split_settlements WHERE id = ? AND household_id = ?")
    .bind(input.settlementId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string }>();
  if (!existing) {
    throw new Error("Split settlement not found.");
  }

  await db
    .prepare("UPDATE split_settlements SET note = ? WHERE id = ? AND household_id = ?")
    .bind(input.note ?? null, input.settlementId, DEFAULT_HOUSEHOLD_ID)
    .run();

  return { settlementId: input.settlementId, updated: true };
}

export async function deleteSplitExpenseRecord(
  db: D1Database,
  input: { splitExpenseId: string }
) {
  const existing = await db
    .prepare(`SELECT split_expenses.id, split_expenses.split_group_id, split_groups.group_name,
        split_expenses.description, split_expenses.total_amount_minor, split_expenses.currency,
        split_expenses.deleted_at
      FROM split_expenses LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
      WHERE split_expenses.id = ? AND split_expenses.household_id = ?`)
    .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; split_group_id: string | null; group_name: string | null; description: string; total_amount_minor: number; currency: string | null; deleted_at: string | null }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }
  if (existing.deleted_at) throw new Error("This split is already in activity history.");
  await assertSplitSettlementUnchanged(db, { recordKind: "expense", recordId: existing.id, next: () => "deleted" });

  // The archived split keeps its ledger link so a restore can bring it back,
  // but it stops counting as the entry's split, so the entry's month totals
  // go back to the full ledger amount.
  const months = await linkedEntryMonths(db, input.splitExpenseId);
  await db.batch([
    db
      .prepare("UPDATE split_expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
      .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID),
    buildSplitHistoryStatement(db, { recordKind: "expense", recordId: existing.id, action: "deleted", groupId: existing.split_group_id, groupName: existing.group_name, description: existing.description, amountMinor: existing.total_amount_minor, currency: existing.currency }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return { splitExpenseId: input.splitExpenseId, deleted: true };
}

// The event month of the ledger entry a split expense is linked to: the only
// month whose totals read that split's shares.
async function linkedEntryMonths(db: D1Database, splitExpenseId: string) {
  const entry = await db
    .prepare(`
      SELECT transactions.transaction_date
      FROM split_expenses
      INNER JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      WHERE split_expenses.id = ? AND split_expenses.household_id = ?
    `)
    .bind(splitExpenseId, DEFAULT_HOUSEHOLD_ID)
    .first<{ transaction_date: string }>();
  return entry ? [entry.transaction_date.slice(0, 7)] : [];
}

export async function deleteSplitSettlementRecord(
  db: D1Database,
  input: { settlementId: string }
) {
  const existing = await db
    .prepare(`SELECT split_settlements.id, split_settlements.split_group_id, split_groups.group_name,
        split_settlements.amount_minor, split_settlements.currency, split_settlements.deleted_at,
        'Settlement' AS description
      FROM split_settlements LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
      WHERE split_settlements.id = ? AND split_settlements.household_id = ?`)
    .bind(input.settlementId, DEFAULT_HOUSEHOLD_ID)
    .first<{ id: string; split_group_id: string | null; group_name: string | null; amount_minor: number; currency: string | null; deleted_at: string | null; description: string }>();
  if (!existing) {
    throw new Error("Split settlement not found.");
  }
  if (existing.deleted_at) throw new Error("This settlement is already in activity history.");
  await assertSplitSettlementUnchanged(db, { recordKind: "settlement", recordId: existing.id, next: () => "deleted" });

  await db.batch([
    db
      .prepare("UPDATE split_settlements SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ? AND deleted_at IS NULL")
      .bind(input.settlementId, DEFAULT_HOUSEHOLD_ID),
    buildSplitHistoryStatement(db, { recordKind: "settlement", recordId: existing.id, action: "deleted", groupId: existing.split_group_id, groupName: existing.group_name, description: existing.description, amountMinor: existing.amount_minor, currency: existing.currency })
  ]);

  return { settlementId: input.settlementId, deleted: true };
}

type SplitHistoryInput = { recordKind: "expense" | "settlement"; recordId: string; action: "created" | "updated" | "deleted" | "restored"; groupId?: string | null; groupName?: string | null; description: string; amountMinor: number; currency?: string | null; detail?: string };

function buildSplitHistoryStatement(db: D1Database, input: SplitHistoryInput) {
  return db.prepare(`INSERT INTO split_activity_history
    (id, household_id, record_kind, record_id, action, group_id, group_name, description, amount_minor, currency, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`split-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, DEFAULT_HOUSEHOLD_ID, input.recordKind, input.recordId, input.action, input.groupId ?? null, input.groupName ?? null, input.description, input.amountMinor, normalizeSplitCurrency(input.currency), input.detail ?? null);
}

async function recordSplitHistory(db: D1Database, input: SplitHistoryInput) {
  await buildSplitHistoryStatement(db, input).run();
}

export async function loadSplitActivityHistory(db: D1Database): Promise<SplitActivityHistoryDto[]> {
  const rows = await db.prepare(`SELECT id, record_kind, record_id, action, group_id, group_name,
      description, amount_minor, currency, occurred_at, detail
    FROM split_activity_history WHERE household_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200`)
    .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; record_kind: "expense" | "settlement"; record_id: string; action: SplitActivityHistoryDto["action"]; group_id: string | null; group_name: string | null; description: string; amount_minor: number; currency: string | null; occurred_at: string; detail: string | null }>();
  const live = await db.prepare(`SELECT id FROM split_expenses WHERE household_id = ? AND deleted_at IS NULL UNION ALL SELECT id FROM split_settlements WHERE household_id = ? AND deleted_at IS NULL`).bind(DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID).all<{ id: string }>();
  const liveIds = new Set(live.results.map((row) => row.id));
  return rows.results.map((row) => ({ id: row.id, recordKind: row.record_kind, recordId: row.record_id, action: row.action, groupId: row.group_id ?? undefined, groupName: row.group_name ?? undefined, description: row.description, amountMinor: row.amount_minor, currency: normalizeSplitCurrency(row.currency), occurredAt: row.occurred_at, detail: row.detail ?? undefined, canRestore: row.action === "deleted" && !liveIds.has(row.record_id) }));
}

export async function restoreSplitRecord(db: D1Database, input: { recordKind: "expense" | "settlement"; recordId: string }) {
  const table = input.recordKind === "expense" ? "split_expenses" : "split_settlements";
  const existing = await db.prepare(`SELECT id, split_group_id, description, ${input.recordKind === "expense" ? "total_amount_minor" : "amount_minor"} AS amount_minor, currency, deleted_at, linked_transaction_id FROM ${table} WHERE id = ? AND household_id = ?`).bind(input.recordId, DEFAULT_HOUSEHOLD_ID).first<{ id: string; split_group_id: string | null; description: string; amount_minor: number; currency: string | null; deleted_at: string | null; linked_transaction_id: string | null }>();
  if (!existing) throw new Error("Split record not found.");
  if (!existing.deleted_at) throw new Error("This split is already active.");
  if (existing.linked_transaction_id) {
    await assertLedgerRowFreeForRestore(db, { recordId: input.recordId, transactionId: existing.linked_transaction_id });
  }
  const group = existing.split_group_id ? await db.prepare("SELECT group_name FROM split_groups WHERE id = ?").bind(existing.split_group_id).first<{ group_name: string }>() : null;
  // A restored expense counts as its entry's split again.
  const months = input.recordKind === "expense" ? await linkedEntryMonths(db, input.recordId) : [];
  const linkedTransactionId = existing.linked_transaction_id;
  const holder = linkedTransactionId
    ? () => findActiveLedgerRowHolder(db, linkedTransactionId, input.recordId)
    : async () => null;
  await runLinkingBatch(db, RESTORE_LEDGER_ROW_TAKEN, holder, [
    db.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND household_id = ? AND deleted_at IS NOT NULL`).bind(input.recordId, DEFAULT_HOUSEHOLD_ID),
    buildSplitHistoryStatement(db, { recordKind: input.recordKind, recordId: existing.id, action: "restored", groupId: existing.split_group_id, groupName: group?.group_name, description: existing.description, amountMinor: existing.amount_minor, currency: existing.currency }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);
  return { recordId: input.recordId, restored: true };
}

// An archived split record keeps its ledger link but no longer holds that
// ledger row, which another split record may since have taken. Restoring
// would give the row two active split records, so it is refused.
async function assertLedgerRowFreeForRestore(db: D1Database, input: { recordId: string; transactionId: string }) {
  if (await findActiveLedgerRowHolder(db, input.transactionId, input.recordId)) {
    throw new Error(RESTORE_LEDGER_ROW_TAKEN);
  }
}

const ENTRY_ALREADY_LINKED = "This entry is already linked to a split expense.";
const LEDGER_ROW_ALREADY_LINKED = "This ledger row is already linked to another split record.";
const RESTORE_LEDGER_ROW_TAKEN = "Its entry is now linked to another split. Delete that split first to restore this one.";

async function findActiveLinkedSplitExpenseId(db: D1Database, transactionId: string) {
  const split = await db
    .prepare("SELECT id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ? AND deleted_at IS NULL")
    .bind(DEFAULT_HOUSEHOLD_ID, transactionId)
    .first<{ id: string }>();
  return split?.id ?? null;
}

// The active split record (or settlement checkpoint match) that holds a
// ledger row, other than `exceptRecordId`.
async function findActiveLedgerRowHolder(db: D1Database, transactionId: string, exceptRecordId = "") {
  const holder = await db
    .prepare(`
      SELECT id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ? AND deleted_at IS NULL AND id <> ?
      UNION ALL SELECT id FROM split_settlements WHERE household_id = ? AND linked_transaction_id = ? AND deleted_at IS NULL AND id <> ?
      UNION ALL SELECT checkpoint_id AS id FROM split_settlement_checkpoint_matches WHERE transaction_id = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, transactionId, exceptRecordId, DEFAULT_HOUSEHOLD_ID, transactionId, exceptRecordId, transactionId)
    .first<{ id: string }>();
  return holder?.id ?? null;
}

// Whether a failed write lost the race for a ledger row to another split
// record: the one-active-split index (schema.sql) rejected its batch.
export function isActiveSplitLinkConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: split_(expenses|settlements)\.linked_transaction_id/.test(message);
}

// Runs a batch that links a split record to a ledger row. The checks before
// it cannot see a write that commits in between, so when the batch fails
// and another split record now holds the row (the index turned the second
// write away as a whole), the person gets the same "already linked" message
// as the check gives.
async function runLinkingBatch(
  db: D1Database,
  alreadyLinkedMessage: string,
  findHolder: () => Promise<string | null>,
  statements: D1PreparedStatement[]
) {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (isActiveSplitLinkConflict(error) || await findHolder()) {
      throw new Error(alreadyLinkedMessage);
    }
    throw error;
  }
}

export async function linkSplitExpenseMatch(
  db: D1Database,
  input: { splitExpenseId: string; transactionId: string }
) {
  const [expense, transaction, alreadyUsed] = await Promise.all([
    db.prepare("SELECT total_amount_minor, currency, payment_method, payment_status FROM split_expenses WHERE id = ? AND household_id = ? AND linked_transaction_id IS NULL")
      .bind(input.splitExpenseId, DEFAULT_HOUSEHOLD_ID)
      .first<{ total_amount_minor: number; currency: string; payment_method: SplitExpenseDto["paymentMethod"]; payment_status: SplitExpenseDto["paymentStatus"] }>(),
    db.prepare(`SELECT transactions.amount_minor, transactions.currency, transactions.entry_type, transactions.transaction_date
      FROM transactions INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.id = ? AND transactions.household_id = ? AND imports.status = 'completed'`)
      .bind(input.transactionId, DEFAULT_HOUSEHOLD_ID)
      .first<{ amount_minor: number; currency: string; entry_type: string; transaction_date: string }>(),
    db.prepare(`SELECT id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL
      UNION ALL SELECT id FROM split_settlements WHERE linked_transaction_id = ? AND deleted_at IS NULL
      UNION ALL SELECT checkpoint_id AS id FROM split_settlement_checkpoint_matches WHERE transaction_id = ?
      LIMIT 1`).bind(input.transactionId, input.transactionId, input.transactionId).first<{ id: string }>()
  ]);
  if (!expense) throw new Error("This split expense is unavailable or already linked.");
  if (!transaction || transaction.entry_type !== "expense") throw new Error("Split expense matches require an imported expense.");
  if (alreadyUsed) throw new Error(LEDGER_ROW_ALREADY_LINKED);
  const splitCurrency = normalizeSplitCurrency(expense.currency);
  const transactionCurrency = normalizeSplitCurrency(transaction.currency);
  if (splitCurrency !== transactionCurrency && (!["card", "bank"].includes(expense.payment_method) || expense.payment_status !== "awaiting_statement")) {
    throw new Error("Cross-currency matching requires a card or bank expense awaiting its statement.");
  }
  const homeAmountMinor = Math.abs(transaction.amount_minor);
  const fxRateBasisPoints = splitCurrency === transactionCurrency
    ? 10000
    : calculateFxRateBasisPoints(Math.abs(expense.total_amount_minor), homeAmountMinor);
  // The entry now counts by its split shares, so its month totals change.
  const months = [transaction.transaction_date.slice(0, 7)];
  await runLinkingBatch(db, LEDGER_ROW_ALREADY_LINKED, () => findActiveLedgerRowHolder(db, input.transactionId), [
    db
      .prepare("UPDATE split_expenses SET linked_transaction_id = ?, home_amount_minor = ?, fx_rate_basis_points = ?, payment_status = 'certified' WHERE id = ? AND household_id = ? AND linked_transaction_id IS NULL")
      .bind(input.transactionId, homeAmountMinor, fxRateBasisPoints, input.splitExpenseId, DEFAULT_HOUSEHOLD_ID),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  const primaryShare = await db
    .prepare(`
      SELECT ratio_basis_points
      FROM split_expense_shares
      WHERE split_expense_id = ?
      ORDER BY created_at
      LIMIT 1
    `)
    .bind(input.splitExpenseId)
    .first<{ ratio_basis_points: number }>();

  await syncLinkedTransactionToSplitExpense(db, {
    transactionId: input.transactionId,
    splitBasisPoints: primaryShare?.ratio_basis_points ?? 5000
  });

  return { ok: true };
}

export async function linkSplitSettlementMatch(
  db: D1Database,
  input: { settlementId: string; transactionId: string }
) {
  const [settlement, transaction, alreadyUsed] = await Promise.all([
    db.prepare("SELECT amount_minor, currency, payment_method, payment_status FROM split_settlements WHERE id = ? AND household_id = ? AND linked_transaction_id IS NULL")
      .bind(input.settlementId, DEFAULT_HOUSEHOLD_ID)
      .first<{ amount_minor: number; currency: string; payment_method: SplitSettlementDto["paymentMethod"]; payment_status: SplitSettlementDto["paymentStatus"] }>(),
    db.prepare(`SELECT transactions.amount_minor, transactions.currency, transactions.entry_type
      FROM transactions INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.id = ? AND transactions.household_id = ? AND imports.status = 'completed'`)
      .bind(input.transactionId, DEFAULT_HOUSEHOLD_ID)
      .first<{ amount_minor: number; currency: string; entry_type: string }>(),
    db.prepare(`SELECT id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL
      UNION ALL SELECT id FROM split_settlements WHERE linked_transaction_id = ? AND deleted_at IS NULL
      UNION ALL SELECT checkpoint_id AS id FROM split_settlement_checkpoint_matches WHERE transaction_id = ?
      LIMIT 1`).bind(input.transactionId, input.transactionId, input.transactionId).first<{ id: string }>()
  ]);
  if (!settlement) throw new Error("This settle-up is unavailable or already linked.");
  if (!transaction || transaction.entry_type !== "transfer") throw new Error("Settle-up matches require an imported transfer.");
  if (alreadyUsed) throw new Error(LEDGER_ROW_ALREADY_LINKED);
  const splitCurrency = normalizeSplitCurrency(settlement.currency);
  const transactionCurrency = normalizeSplitCurrency(transaction.currency);
  if (splitCurrency !== transactionCurrency && (settlement.payment_method !== "bank" || settlement.payment_status !== "awaiting_statement")) {
    throw new Error("Cross-currency matching requires a bank settle-up awaiting its statement.");
  }
  const fxRateBasisPoints = splitCurrency === transactionCurrency
    ? 10000
    : calculateFxRateBasisPoints(Math.abs(settlement.amount_minor), Math.abs(transaction.amount_minor));
  await runLinkingBatch(db, LEDGER_ROW_ALREADY_LINKED, () => findActiveLedgerRowHolder(db, input.transactionId), [
    db
      .prepare("UPDATE split_settlements SET linked_transaction_id = ?, fx_rate_basis_points = ?, payment_status = 'certified' WHERE id = ? AND household_id = ? AND linked_transaction_id IS NULL")
      .bind(input.transactionId, fxRateBasisPoints, input.settlementId, DEFAULT_HOUSEHOLD_ID)
  ]);

  return { ok: true };
}

export async function createSplitExpenseFromEntryRecord(
  db: D1Database,
  input: { entryId: string; splitGroupId?: string | null }
) {
  const entry = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.currency,
        transactions.owner_person_id,
        transactions.note,
        transactions.category_id,
        transactions.entry_type,
        accounts.owner_person_id AS account_owner_person_id,
        accounts.account_kind
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      owner_person_id: string | null;
      note: string | null;
      category_id: string | null;
      entry_type: "expense" | "income" | "transfer";
      account_owner_person_id: string | null;
      account_kind: "bank" | "credit_card" | "loan" | "cash" | "investment";
    }>();

  if (!entry) {
    throw new Error("Entry not found.");
  }

  if (entry.entry_type !== "expense") {
    throw new Error("Only expense entries can be added to splits.");
  }

  // An archived split keeps its link for a restore but no longer holds the
  // entry, so the entry can be added to a new split.
  if (await findActiveLinkedSplitExpenseId(db, input.entryId)) {
    throw new Error(ENTRY_ALREADY_LINKED);
  }

  const payerPersonId = entry.owner_person_id ?? entry.account_owner_person_id;
  if (!payerPersonId) {
    throw new Error("This entry does not have a clear payer. Assign an owner first.");
  }

  const id = `split-expense-${Date.now()}`;
  const currency = await assertSplitGroupCurrency(db, input.splitGroupId, entry.currency);
  const batch = await resolveActiveSplitBatch(db, {
    groupId: input.splitGroupId || null,
    date: entry.transaction_date
  });
  const sharePeople = await loadSplitSharePeople(db);
  const { firstBasisPoints, secondBasisPoints, firstAmount, secondAmount } = buildSplitShareAmounts(entry.amount_minor, 5000);
  const shares = [
    { personId: sharePeople[0].id, ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { personId: sharePeople[1].id, ratioBasisPoints: secondBasisPoints, amountMinor: secondAmount }
  ];
  // The entry now counts by its split shares, so its month totals change.
  const months = [entry.transaction_date.slice(0, 7)];

  await runLinkingBatch(db, ENTRY_ALREADY_LINKED, () => findActiveLinkedSplitExpenseId(db, input.entryId), [
    ...batch.statements,
    db
      .prepare(`
        INSERT INTO split_expenses (
          id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
          description, category_id, total_amount_minor, currency, home_amount_minor,
          payment_method, payment_status, note, linked_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        DEFAULT_HOUSEHOLD_ID,
        input.splitGroupId || null,
        batch.id,
        payerPersonId,
        entry.transaction_date,
        entry.description,
        entry.category_id,
        entry.amount_minor,
        currency,
        Math.abs(entry.amount_minor),
        paymentMethodForLinkedAccount(entry.account_kind, "other"),
        "certified",
        entry.note,
        entry.id
      ),
    ...shares.map((split) => db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${id}-${split.personId}`, id, split.personId, split.ratioBasisPoints, split.amountMinor)),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ]);
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return {
    splitExpenseId: id,
    splitExpenseDate: entry.transaction_date,
    splitExpenseMonth: entry.transaction_date.slice(0, 7),
    splitGroupId: input.splitGroupId || "split-group-none"
  };
}

// Statements that move the split expense linked to a ledger entry onto the
// entry's new amount, for the entry update's own batch. Reads happen here,
// before that batch. A same-currency split takes the new amount as its total
// and rebalances its shares by the stored basis; a cross-currency split keeps
// its own total and shares and only updates the home amount and FX rate.
export async function buildLinkedSplitAmountStatements(
  db: D1Database,
  input: { entryId: string; entryCurrency: string; amountMinor: number }
) {
  const linkedSplits = await db
    .prepare(`
      SELECT id, total_amount_minor, currency
      FROM split_expenses
      WHERE household_id = ? AND linked_transaction_id = ?
      ORDER BY id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .all<{ id: string; total_amount_minor: number; currency: string }>();
  const statements: D1PreparedStatement[] = [];
  const homeAmountMinor = Math.abs(input.amountMinor);

  for (const split of linkedSplits.results) {
    if (normalizeSplitCurrency(split.currency) !== normalizeSplitCurrency(input.entryCurrency)) {
      statements.push(
        db
          .prepare("UPDATE split_expenses SET home_amount_minor = ?, fx_rate_basis_points = ? WHERE id = ? AND household_id = ?")
          .bind(homeAmountMinor, calculateFxRateBasisPoints(Math.abs(split.total_amount_minor), homeAmountMinor), split.id, DEFAULT_HOUSEHOLD_ID)
      );
      continue;
    }

    // Shares in split-share people order, so the remainder lands on the same
    // person as when the split was created.
    const shares = await db
      .prepare(`
        SELECT split_expense_shares.id, split_expense_shares.ratio_basis_points, split_expense_shares.amount_minor
        FROM split_expense_shares
        INNER JOIN people ON people.id = split_expense_shares.person_id
        WHERE split_expense_shares.split_expense_id = ?
        ORDER BY
          CASE people.role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END,
          people.created_at,
          people.id
      `)
      .bind(split.id)
      .all<{ id: string; ratio_basis_points: number; amount_minor: number }>();
    const nextShares = rebalanceSplitSharesForTotal(
      shares.results.map((share) => ({ ratioBasisPoints: share.ratio_basis_points, amountMinor: share.amount_minor })),
      input.amountMinor
    );

    statements.push(
      db
        .prepare("UPDATE split_expenses SET total_amount_minor = ?, home_amount_minor = ? WHERE id = ? AND household_id = ?")
        .bind(input.amountMinor, homeAmountMinor, split.id, DEFAULT_HOUSEHOLD_ID),
      ...shares.results.map((share, index) => db
        .prepare("UPDATE split_expense_shares SET ratio_basis_points = ?, amount_minor = ? WHERE id = ?")
        .bind(nextShares[index].ratioBasisPoints, nextShares[index].amountMinor, share.id))
    );
  }

  return statements;
}

type MirroredEntryFields = { date: string; description: string; payerPersonId: string | null };

// Statements that copy an entry edit's event date, description and payer to
// the split expenses linked to it, for the entry update's own batch. A split
// field follows only while it still holds the entry's previous value: a
// split whose description or date was set in Splits (or recorded there
// before a bank match) keeps its own. Note, category, group, shares and
// travel-currency amounts are split-owned and never touched here. Archived
// links follow too, so a restore matches the ledger.
export async function buildLinkedSplitMirrorStatements(
  db: D1Database,
  input: { entryId: string; previous: MirroredEntryFields; next: MirroredEntryFields }
) {
  const { previous, next } = input;
  if (previous.date === next.date && previous.description === next.description && previous.payerPersonId === next.payerPersonId) {
    return [];
  }

  const linkedSplits = await db
    .prepare(`
      SELECT id, expense_date, description, payer_person_id
      FROM split_expenses
      WHERE household_id = ? AND linked_transaction_id = ?
      ORDER BY id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .all<{ id: string; expense_date: string; description: string; payer_person_id: string }>();

  const follows = (splitValue: string, previousValue: string | null, nextValue: string | null) => (
    nextValue !== null && splitValue === previousValue ? nextValue : splitValue
  );
  const statements: D1PreparedStatement[] = [];
  for (const split of linkedSplits.results) {
    const expenseDate = follows(split.expense_date, previous.date, next.date);
    const description = follows(split.description, previous.description, next.description);
    const payerPersonId = follows(split.payer_person_id, previous.payerPersonId, next.payerPersonId);
    if (expenseDate === split.expense_date && description === split.description && payerPersonId === split.payer_person_id) {
      continue;
    }
    statements.push(db
      .prepare("UPDATE split_expenses SET expense_date = ?, description = ?, payer_person_id = ? WHERE id = ? AND household_id = ?")
      .bind(expenseDate, description, payerPersonId, split.id, DEFAULT_HOUSEHOLD_ID));
  }
  return statements;
}

// Refuses an entry save when its linked split expense is in an active
// simplified settlement and the save would change that split's settlement
// facts: the amount follow-up above (same currency only) and, for a shared
// save, the upsert below, which rewrites date, payer, amount, currency and
// shares, and the date and payer mirror (buildLinkedSplitMirrorStatements),
// which moves them while the split still holds the entry's previous values.
// Runs before the entry's batch, so a refused save writes nothing.
export async function assertLinkedSplitSettlementUnchanged(
  db: D1Database,
  input: {
    entryId: string;
    entryCurrency: string;
    followAmountMinor?: number;
    sharedSync?: { date: string; payerPersonId: string | null; amountMinor: number; splitBasisPoints?: number };
    mirror?: {
      previous: { date: string; payerPersonId: string | null };
      next: { date: string; payerPersonId: string | null };
    };
    subject?: "linked entry" | "import rollback";
  }
) {
  const mirror = input.mirror
    && (input.mirror.previous.date !== input.mirror.next.date || input.mirror.previous.payerPersonId !== input.mirror.next.payerPersonId)
    ? input.mirror
    : undefined;
  if (input.followAmountMinor === undefined && !input.sharedSync && !mirror) return;
  const linkedSplits = await db
    .prepare("SELECT id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .all<{ id: string }>();
  const entryCurrency = normalizeSplitCurrency(input.entryCurrency);

  for (const [index, split] of linkedSplits.results.entries()) {
    // The upsert rewrites the first linked split only.
    const sharedSync = index === 0 ? input.sharedSync : undefined;
    const followAmountMinor = input.followAmountMinor;
    await assertSplitSettlementUnchanged(db, {
      recordKind: "expense",
      recordId: split.id,
      subject: input.subject ?? "linked entry",
      next: async (current): Promise<SplitSettlementFacts> => {
        const withMirror = (facts: SplitSettlementFacts): SplitSettlementFacts => {
          if (!mirror) return facts;
          // Same rule as buildLinkedSplitMirrorStatements: a field follows only
          // while the split still holds the entry's previous value.
          const date = current.date === mirror.previous.date ? mirror.next.date : facts.date;
          const payer = current.partyIds[0] === mirror.previous.payerPersonId && mirror.next.payerPersonId !== null
            ? mirror.next.payerPersonId
            : facts.partyIds[0];
          return { ...facts, date, partyIds: [payer, ...facts.partyIds.slice(1)] };
        };
        if (sharedSync) {
          const sharePeople = await loadSplitSharePeople(db);
          const { firstAmount, secondAmount } = buildSplitShareAmounts(sharedSync.amountMinor, sharedSync.splitBasisPoints);
          return {
            date: sharedSync.date,
            groupId: current.groupId,
            currency: entryCurrency,
            amountMinor: sharedSync.amountMinor,
            partyIds: [sharedSync.payerPersonId ?? current.partyIds[0]],
            shares: [
              { personId: sharePeople[0].id, amountMinor: firstAmount },
              { personId: sharePeople[1].id, amountMinor: secondAmount }
            ]
          };
        }
        if (followAmountMinor === undefined || current.currency !== entryCurrency) {
          return withMirror(current);
        }
        const shares = await loadOrderedSplitShares(db, split.id);
        if (shares.length !== 2) return withMirror({ ...current, amountMinor: followAmountMinor });
        const nextShares = rebalanceSplitSharesForTotal(shares, followAmountMinor);
        return withMirror({
          ...current,
          amountMinor: followAmountMinor,
          shares: shares.map((share, shareIndex) => ({ personId: share.personId, amountMinor: nextShares[shareIndex].amountMinor }))
        });
      }
    });
  }
}

// A split expense's shares in split-share people order, as the amount
// follow-up rebalances them.
async function loadOrderedSplitShares(db: D1Database, splitExpenseId: string) {
  const shares = await db
    .prepare(`
      SELECT split_expense_shares.person_id, split_expense_shares.ratio_basis_points, split_expense_shares.amount_minor
      FROM split_expense_shares
      INNER JOIN people ON people.id = split_expense_shares.person_id
      WHERE split_expense_shares.split_expense_id = ?
      ORDER BY
        CASE people.role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END,
        people.created_at,
        people.id
    `)
    .bind(splitExpenseId)
    .all<{ person_id: string; ratio_basis_points: number; amount_minor: number }>();
  return shares.results.map((share) => ({ personId: share.person_id, ratioBasisPoints: share.ratio_basis_points, amountMinor: share.amount_minor }));
}

// The statements a Shared owner save (entry create or update with
// ownershipType "shared") uses to rewrite the entry's active split expense,
// or to link a new one, for the entry command's own batch: the split takes
// the entry's date, description, payer, category, amount and note, and its
// shares are replaced by the given basis. Reads and checks run here, before
// that batch, so a refused save (no clear payer, wrong group currency)
// writes nothing, and the entry, its split and the month refresh markers
// commit together. An archived split is left alone (a restore brings it
// back); a later batch that loses a race for the entry fails on the
// one-active-split index.
export async function buildLinkedSplitUpsertStatements(
  db: D1Database,
  input: {
    entryId: string;
    entry: {
      date: string;
      description: string;
      amountMinor: number;
      currency: string;
      payerPersonId: string | null;
      categoryId: string | null;
      note: string | null;
      accountKind: "bank" | "credit_card" | "loan" | "cash" | "investment";
    };
    splitBasisPoints?: number;
    splitGroupId?: string | null;
  }
) {
  const { entry } = input;
  if (!entry.payerPersonId) {
    throw new Error("This entry does not have a clear payer. Assign an owner first.");
  }

  const existingSplit = await db
    .prepare("SELECT id, split_group_id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ? AND deleted_at IS NULL")
    .bind(DEFAULT_HOUSEHOLD_ID, input.entryId)
    .first<{ id: string; split_group_id: string | null }>();
  const splitExpenseId = existingSplit?.id ?? `split-expense-${Date.now()}`;
  const splitGroupId = input.splitGroupId === undefined ? existingSplit?.split_group_id ?? null : input.splitGroupId || null;
  await assertSplitGroupCurrency(db, splitGroupId, entry.currency);
  const batch = await planActiveSplitBatch(db, { groupId: splitGroupId, date: entry.date });
  const sharePeople = await loadSplitSharePeople(db);
  const { firstBasisPoints, secondBasisPoints, firstAmount, secondAmount } = buildSplitShareAmounts(entry.amountMinor, input.splitBasisPoints);
  const shares = [
    { personId: sharePeople[0].id, ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { personId: sharePeople[1].id, ratioBasisPoints: secondBasisPoints, amountMinor: secondAmount }
  ];
  const paymentMethod = paymentMethodForLinkedAccount(entry.accountKind, "other");

  const splitStatement = existingSplit
    ? db
      .prepare(`
        UPDATE split_expenses
        SET split_group_id = ?, split_batch_id = ?, payer_person_id = ?, expense_date = ?, description = ?,
            category_id = ?, total_amount_minor = ?, currency = ?, home_amount_minor = ?,
            payment_method = ?, payment_status = ?, note = ?
        WHERE id = ? AND household_id = ?
      `)
      .bind(
        splitGroupId,
        batch.batchId,
        entry.payerPersonId,
        entry.date,
        entry.description,
        entry.categoryId,
        entry.amountMinor,
        entry.currency,
        entry.amountMinor,
        paymentMethod,
        "certified",
        entry.note,
        splitExpenseId,
        DEFAULT_HOUSEHOLD_ID
      )
    : db
      .prepare(`
        INSERT INTO split_expenses (
          id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
          description, category_id, total_amount_minor, currency, home_amount_minor,
          payment_method, payment_status, note, linked_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        splitExpenseId,
        DEFAULT_HOUSEHOLD_ID,
        splitGroupId,
        batch.batchId,
        entry.payerPersonId,
        entry.date,
        entry.description,
        entry.categoryId,
        entry.amountMinor,
        entry.currency,
        entry.amountMinor,
        paymentMethod,
        "certified",
        entry.note,
        input.entryId
      );

  const statements = [
    ...batch.statements,
    splitStatement,
    db.prepare("DELETE FROM split_expense_shares WHERE split_expense_id = ?").bind(splitExpenseId),
    ...shares.map((share) => db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${splitExpenseId}-${share.personId}`, splitExpenseId, share.personId, share.ratioBasisPoints, share.amountMinor))
  ];
  return { splitExpenseId, statements };
}
