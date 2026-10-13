// The household's rows a Phase 2 Ask change needs before its card can be
// built (ask-turn-actions.ts): read only, and only for the one action the
// turn chose. The pure builders then decide the card, the question back or
// the note, so what the card lists is exactly what the person's Save tap
// changes. Nothing here writes.

import {
  buildBulkRecategorise,
  buildGroupMove,
  buildGroupSettle,
  buildMatches,
  buildMonthNote,
  buildPlanLink,
  buildSimplify,
  buildTransferLink,
  type AskEntryCandidate,
  type AskMatch,
  type AskPlanRowFacts,
  type AskResolveRequest,
  type AskSimplifyPlan,
  type AskSplitExpenseFacts
} from "./ask-turn-actions";
import type { AskTurnContext, AskTurnReply } from "./ask-turn";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { loadTransferMatchCandidates } from "./app-repository-entries";
import { loadMonthPlanRowsForDraft } from "./app-repository-months";
import {
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitMatchCandidates,
  loadSplitSettlementCheckpoints,
  loadSplitSettlements,
  planSplitSettlementCheckpoint
} from "./app-repository-splits";
import { getMonthBounds } from "./app-repository-helpers";
import { loadRoutePageContext } from "./route-context";
import { buildSplitsPage } from "./splits-projection";
import { normalizeSplitCurrency } from "./split-currency";

// Enough rows for the bulk limit and its "too many" answer.
const WORD_CANDIDATE_LIMIT = 1000;

export async function resolveAskTurnRequest(db: D1Database, request: AskResolveRequest, context: AskTurnContext): Promise<AskTurnReply> {
  switch (request.type) {
    case "recategorise_bulk":
      return buildBulkRecategorise(request, await loadWordCandidates(db, request.words, request.month), context);
    case "month_note":
      return buildMonthNote(request, await loadMonthNote(db, request.month, request.personScope));
    case "link_transfer":
      return buildTransferLink(request, await loadTransferCandidates(db, request.entry.entryId, request.entry.currency));
    case "group_move":
      return buildGroupMove(request, await loadEntrySplit(db, request.entry.entryId, context));
    case "group_settle":
      return buildGroupSettle(request, await loadGroupBalance(db, request.group.id, context), context);
    case "simplify":
      return buildSimplify(await loadSimplifyPlan(db, request.currency, context), context);
    case "matches":
      return buildMatches(request, await loadMatches(db, request.month));
    case "plan_link":
      return buildPlanLink(request, await loadPlanRows(db, request.month), await loadWordCandidates(db, request.words, request.month));
    default:
      return { kind: "note", text: "Ask can't do that one yet. Try the page it lives on." };
  }
}

// Entries whose bank text may hold the words: a LIKE on the longest word
// narrows the read; the builder then applies the category rule matcher
// itself, so the card lists exactly what a rule with those words matches.
async function loadWordCandidates(db: D1Database, words: string, month: string | null): Promise<AskEntryCandidate[]> {
  const token = words.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).sort((left, right) => right.length - left.length)[0] ?? "";
  if (!token) {
    return [];
  }
  const like = `%${token}%`;
  const [start, next] = month ? getMonthBounds(month) : ["0000-01-01", "9999-12-31"];
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.transaction_date, transactions.description, transactions.original_description,
        transactions.amount_minor, transactions.currency, transactions.entry_type,
        categories.name AS category_name, accounts.account_name
      FROM transactions
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date >= ? AND transactions.transaction_date < ?
        AND (UPPER(transactions.description) LIKE ? OR UPPER(COALESCE(transactions.original_description, '')) LIKE ?)
      ORDER BY transactions.transaction_date DESC, transactions.id
      LIMIT ${WORD_CANDIDATE_LIMIT}
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, start, next, like, like)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      original_description: string | null;
      amount_minor: number;
      currency: string;
      entry_type: "expense" | "income" | "transfer";
      category_name: string | null;
      account_name: string | null;
    }>();
  return result.results.map((row) => ({
    entryId: row.id,
    date: row.transaction_date,
    description: row.description,
    originalDescription: row.original_description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    categoryName: row.category_name ?? "Other",
    entryType: row.entry_type,
    accountName: row.account_name ?? undefined
  }));
}

async function loadMonthNote(db: D1Database, month: string, personScope: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const row = await db
    .prepare("SELECT note FROM monthly_snapshots WHERE household_id = ? AND year = ? AND month = ? AND person_scope = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, year, monthNumber, personScope)
    .first<{ note: string | null }>();
  return row?.note ?? null;
}

async function loadTransferCandidates(db: D1Database, entryId: string, currency: string) {
  const { candidates } = await loadTransferMatchCandidates(db, entryId);
  if (!candidates.length) {
    return [];
  }
  const linked = await db
    .prepare(`SELECT id FROM transactions WHERE household_id = ? AND transfer_group_id IS NOT NULL AND id IN (${candidates.map(() => "?").join(", ")})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...candidates.map((candidate) => candidate.id))
    .all<{ id: string }>();
  const linkedIds = new Set(linked.results.map((row) => row.id));
  return candidates.map((candidate) => ({
    entryId: candidate.id,
    date: candidate.date,
    description: candidate.description,
    accountId: candidate.accountId ?? "",
    accountName: candidate.accountName,
    amountMinor: candidate.amountMinor,
    currency,
    categoryName: candidate.categoryName,
    linked: linkedIds.has(candidate.id) || Boolean(candidate.linkedSplitExpenseId)
  }));
}

// The split linked to the entry, with the first person's share as the split
// editor's update takes it.
async function loadEntrySplit(db: D1Database, entryId: string, context: AskTurnContext): Promise<AskSplitExpenseFacts | null> {
  const expense = (await loadSplitExpenses(db)).find((item) => item.linkedTransactionId === entryId);
  if (!expense) {
    return null;
  }
  const firstId = context.people[0]?.id;
  const first = expense.shares.find((share) => share.personId === firstId);
  return {
    id: expense.id,
    groupId: expense.groupId ?? null,
    groupName: expense.groupId ? expense.groupName : "",
    date: expense.date,
    description: expense.description,
    categoryName: expense.categoryName,
    payerPersonName: expense.payerPersonName,
    totalAmountMinor: expense.totalAmountMinor,
    currency: expense.currency,
    ...(expense.homeAmountMinor !== undefined ? { homeAmountMinor: expense.homeAmountMinor } : {}),
    ...(expense.fxRateBasisPoints !== undefined ? { fxRateBasisPoints: expense.fxRateBasisPoints } : {}),
    paymentMethod: expense.paymentMethod,
    paymentStatus: expense.paymentStatus,
    ...(expense.note !== undefined ? { note: expense.note } : {}),
    firstBasisPoints: first?.ratioBasisPoints ?? 0,
    firstAmountMinor: first?.amountMinor ?? 0,
    closed: Boolean(expense.batchClosedAt)
  };
}

// The group's balance exactly as Splits shows it to the household's first
// person (positive: the other person owes them), as the skew check reads it.
async function loadGroupBalance(db: D1Database, groupId: string, context: AskTurnContext) {
  const viewer = context.people[0];
  if (!viewer) {
    return null;
  }
  const { categories, personNameById } = await loadRoutePageContext(db, viewer.id);
  const [groups, expenses, settlements, checkpoints] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db),
    loadSplitSettlements(db),
    loadSplitSettlementCheckpoints(db)
  ]);
  const page = buildSplitsPage(viewer.id, groups, expenses, settlements, [], categories, context.month, personNameById, checkpoints);
  return page.groups.find((group) => group.id === groupId)?.balanceMinor ?? null;
}

async function loadSimplifyPlan(db: D1Database, currency: string | null, context: AskTurnContext): Promise<AskSimplifyPlan> {
  const viewer = context.people[0];
  if (!viewer) {
    return { ok: false, reason: "none" };
  }
  try {
    const plan = await planSplitSettlementCheckpoint(db, { viewerPersonId: viewer.id, ...(currency ? { currency } : {}) });
    const existing = await db
      .prepare("SELECT id FROM split_settlement_checkpoints WHERE household_id = ? AND currency = ? AND settled_at IS NULL AND status IN ('open', 'partially_matched') LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, plan.currency)
      .first<{ id: string }>();
    if (existing) {
      return { ok: false, reason: "already" };
    }
    return {
      ok: true,
      currency: plan.currency,
      recordCount: plan.openExpenses.length + plan.openSettlements.length,
      fromPersonName: plan.net.fromPersonName,
      toPersonName: plan.net.toPersonName,
      amountMinor: plan.net.amountMinor
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/already exists/.test(message)) return { ok: false, reason: "already" };
    if (/one currency/.test(message)) return { ok: false, reason: "currencies" };
    if (/No open split records/.test(message)) return { ok: false, reason: "none" };
    return { ok: false, reason: "other" };
  }
}

async function loadMatches(db: D1Database, month: string): Promise<AskMatch[]> {
  const candidates = await loadSplitMatchCandidates(db, month);
  return candidates.map((candidate) => ({
    id: candidate.id,
    kind: candidate.kind,
    splitRecordId: candidate.splitRecordId,
    transactionId: candidate.transactionId,
    groupName: candidate.groupId === "split-group-none" ? "" : candidate.groupName,
    splitDescription: candidate.splitDescription,
    splitDate: candidate.splitDate,
    splitAmountMinor: candidate.splitAmountMinor,
    splitCurrency: normalizeSplitCurrency(candidate.splitCurrency),
    transactionDescription: candidate.transactionDescription,
    transactionDate: candidate.transactionDate,
    amountMinor: candidate.amountMinor,
    transactionCurrency: normalizeSplitCurrency(candidate.transactionCurrency),
    canLink: !candidate.requiresFxReview
  }));
}

async function loadPlanRows(db: D1Database, month: string): Promise<AskPlanRowFacts[]> {
  const rows = await loadMonthPlanRowsForDraft(db, month);
  if (!rows.length) {
    return [];
  }
  const links = await db
    .prepare(`
      SELECT monthly_plan_entry_links.monthly_plan_row_id, monthly_plan_entry_links.transaction_id
      FROM monthly_plan_entry_links
      INNER JOIN monthly_plan_rows ON monthly_plan_rows.id = monthly_plan_entry_links.monthly_plan_row_id
      WHERE monthly_plan_rows.household_id = ? AND monthly_plan_rows.year = ? AND monthly_plan_rows.month = ?
      ORDER BY monthly_plan_entry_links.id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...month.split("-").map(Number))
    .all<{ monthly_plan_row_id: string; transaction_id: string }>();
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    section: row.section,
    linkedEntryIds: links.results.filter((link) => link.monthly_plan_row_id === row.id).map((link) => link.transaction_id)
  }));
}
