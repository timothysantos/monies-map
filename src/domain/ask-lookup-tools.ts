// Ask's read-only lookup tools (AGENTS.md "AI in Ask"; docs/flows/ask-flow.md
// "Hands-off"). Within one turn the model may call these to find the entry
// or balance a message is about ("split last night's dinner with Joyce"),
// then proposes an action as always. They only read, only the household's own
// rows, and answer as short compact text:
// - entry names go through promptEntryName (no phone, account, card or ID
//   number), notes are cut short and carry no digit runs;
// - no amount and no balance figure is ever returned: a split balance is
//   only who owes whom;
// - results are truncated (rows, characters).
// The loop that offers them (at most ASK_LOOKUP_LIMITS.maxModelCalls model
// calls a turn, each counted against the allowance) is in the turn route.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import {
  loadSplitExpenses,
  loadSplitGroups,
  loadSplitSettlementCheckpoints,
  loadSplitSettlements
} from "./app-repository-splits";
import { loadRoutePageContext } from "./route-context";
import { promptEntryName } from "./ask-answer-wording";
import { ASK_LOOKUP_LIMITS } from "./ask-lookup-spec";
export { ASK_LOOKUP_LIMITS, ASK_LOOKUP_TOOL_NAMES, type AskLookupToolName } from "./ask-lookup-spec";
import { buildSplitsPage } from "./splits-projection";

export interface AskLookupCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AskLookupResult {
  ok: boolean;
  text: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown, max = 80) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function whole(value: unknown, fallback: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
}

function cut(text: string) {
  return text.length > ASK_LOOKUP_LIMITS.maxResultChars ? `${text.slice(0, ASK_LOOKUP_LIMITS.maxResultChars - 1)}…` : text;
}

function safeNote(note: string | null) {
  return (note ?? "").replace(/\d[\d\s-]*\d/g, (run) => (run.replace(/\D/g, "").length >= 6 ? " " : run)).replace(/\s+/g, " ").trim().slice(0, ASK_LOOKUP_LIMITS.maxNoteChars);
}

interface EntryRow {
  id: string;
  transaction_date: string;
  description: string;
  entry_type: string;
  category_name: string | null;
  owner_name: string | null;
  note: string | null;
  on_splits: number;
}

const ENTRY_SELECT = `
  SELECT transactions.id, transactions.transaction_date, transactions.description, transactions.entry_type,
    categories.name AS category_name,
    COALESCE(owners.display_name, account_owners.display_name) AS owner_name,
    transactions.note,
    EXISTS (
      SELECT 1 FROM split_expenses
      WHERE split_expenses.household_id = transactions.household_id
        AND split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL
    ) AS on_splits
  FROM transactions
  INNER JOIN accounts ON accounts.id = transactions.account_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  LEFT JOIN people AS owners ON owners.id = transactions.owner_person_id
  LEFT JOIN people AS account_owners ON account_owners.id = accounts.owner_person_id
  WHERE transactions.household_id = ?
`;

function describeRow(row: EntryRow, withNote = false) {
  const parts = [
    `id ${row.id}`,
    row.transaction_date,
    promptEntryName({ description: row.description, categoryName: row.category_name ?? "" }),
    row.entry_type,
    row.category_name ?? "no category",
    row.owner_name ? `owner ${row.owner_name}` : "shared",
    row.on_splits ? "on splits" : "not on splits"
  ];
  const note = withNote ? safeNote(row.note) : "";
  return note ? `${parts.join(" | ")} | note: ${note}` : parts.join(" | ");
}

async function findEntries(db: D1Database, args: Record<string, unknown>, today: string): Promise<AskLookupResult> {
  const text = str(args.text, 60).toLowerCase();
  const category = str(args.category, 60);
  const person = str(args.person, 40);
  const from = ISO_DATE.test(str(args.from, 10)) ? str(args.from, 10) : "";
  const to = ISO_DATE.test(str(args.to, 10)) ? str(args.to, 10) : today;
  const limit = whole(args.limit, ASK_LOOKUP_LIMITS.maxRows, ASK_LOOKUP_LIMITS.maxRows);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (text) {
    clauses.push("LOWER(transactions.description) LIKE ? ESCAPE '\\'");
    binds.push(`%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  if (category) {
    clauses.push("categories.name = ?");
    binds.push(category);
  }
  if (person) {
    clauses.push("LOWER(COALESCE(owners.display_name, account_owners.display_name)) = LOWER(?)");
    binds.push(person);
  }
  if (from) {
    clauses.push("transactions.transaction_date >= ?");
    binds.push(from);
  }
  clauses.push("transactions.transaction_date <= ?");
  binds.push(to);
  const result = await db
    .prepare(`${ENTRY_SELECT} AND ${clauses.join(" AND ")} ORDER BY transactions.transaction_date DESC, transactions.created_at DESC LIMIT ${limit}`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...binds)
    .all<EntryRow>();
  if (!result.results.length) {
    return { ok: true, text: "No entries matched." };
  }
  return { ok: true, text: cut(result.results.map((row) => describeRow(row)).join("\n")) };
}

async function getEntry(db: D1Database, args: Record<string, unknown>): Promise<AskLookupResult> {
  const id = str(args.id, 200);
  if (!id) return { ok: false, text: "Give the entry id." };
  const row = await db.prepare(`${ENTRY_SELECT} AND transactions.id = ?`).bind(DEFAULT_HOUSEHOLD_ID, id).first<EntryRow>();
  return row ? { ok: true, text: cut(describeRow(row, true)) } : { ok: false, text: "No such entry." };
}

async function listRecent(db: D1Database, args: Record<string, unknown>): Promise<AskLookupResult> {
  const limit = whole(args.n ?? args.limit, 5, ASK_LOOKUP_LIMITS.maxRows);
  const result = await db
    .prepare(`${ENTRY_SELECT} ORDER BY transactions.created_at DESC, transactions.transaction_date DESC LIMIT ${limit}`)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<EntryRow>();
  return result.results.length ? { ok: true, text: cut(result.results.map((row) => describeRow(row)).join("\n")) } : { ok: true, text: "No entries yet." };
}

// Who owes whom in a group (or everywhere), never how much.
async function getSplitBalances(db: D1Database, args: Record<string, unknown>, today: string): Promise<AskLookupResult> {
  const people = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id LIMIT 2")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();
  const [first, second] = people.results;
  if (!first || !second) return { ok: true, text: "There is no one to split with." };
  const { categories, personNameById } = await loadRoutePageContext(db, first.id);
  const [groups, expenses, settlements, checkpoints] = await Promise.all([
    loadSplitGroups(db),
    loadSplitExpenses(db),
    loadSplitSettlements(db),
    loadSplitSettlementCheckpoints(db)
  ]);
  const page = buildSplitsPage(first.id, groups, expenses, settlements, [], categories, today.slice(0, 7), personNameById, checkpoints);
  const wanted = str(args.group, 60).toLowerCase();
  const rows = page.groups.filter((group) => !wanted || group.name.toLowerCase() === wanted);
  if (!rows.length) return { ok: true, text: wanted ? "No such group." : "No groups." };
  return {
    ok: true,
    text: cut(rows.slice(0, ASK_LOOKUP_LIMITS.maxRows).map((group) => {
      const balance = group.balanceMinor ?? 0;
      const line = balance === 0 ? "settled" : balance > 0 ? `${second.display_name} owes ${first.display_name}` : `${first.display_name} owes ${second.display_name}`;
      return `${group.name}: ${line}`;
    }).join("\n"))
  };
}

// How a shop has been filed: category counts (top 3) and how often it was split.
async function getCategoryHistory(db: D1Database, args: Record<string, unknown>): Promise<AskLookupResult> {
  const merchant = str(args.merchant, 60).toLowerCase();
  if (!merchant) return { ok: false, text: "Give the shop name." };
  const like = `%${merchant.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const categories = await db
    .prepare(`
      SELECT COALESCE(categories.name, 'no category') AS name, COUNT(*) AS n
      FROM transactions LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ? AND transactions.entry_type = 'expense'
        AND LOWER(transactions.description) LIKE ? ESCAPE '\\'
      GROUP BY name ORDER BY n DESC, name LIMIT 3
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, like)
    .all<{ name: string; n: number }>();
  if (!categories.results.length) return { ok: true, text: "No entries at that shop." };
  const split = await db
    .prepare(`
      SELECT COUNT(*) AS total,
        SUM(EXISTS (SELECT 1 FROM split_expenses WHERE split_expenses.linked_transaction_id = transactions.id AND split_expenses.deleted_at IS NULL)) AS split
      FROM transactions
      WHERE household_id = ? AND entry_type = 'expense' AND LOWER(description) LIKE ? ESCAPE '\\'
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, like)
    .first<{ total: number; split: number | null }>();
  return {
    ok: true,
    text: cut(`${categories.results.map((row) => `${row.name} x${row.n}`).join(", ")}; on splits ${split?.split ?? 0} of ${split?.total ?? 0}`)
  };
}

// One tool call as the model named it. An unknown tool or a failing read is
// an answer the model can read, never an error for the turn.
export async function runLookupTool(db: D1Database, call: AskLookupCall, today: string): Promise<AskLookupResult> {
  const args = call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};
  try {
    switch (call.tool) {
      case "find_entries": return await findEntries(db, args, today);
      case "get_entry": return await getEntry(db, args);
      case "get_split_balances": return await getSplitBalances(db, args, today);
      case "list_recent_entries": return await listRecent(db, args);
      case "get_category_history": return await getCategoryHistory(db, args);
      default: return { ok: false, text: "Unknown lookup." };
    }
  } catch {
    return { ok: false, text: "That could not be looked up." };
  }
}

// The per-turn budget: how many model calls and tokens are left.
export function lookupBudgetLeft(used: { modelCalls: number; tokens: number }) {
  return used.modelCalls < ASK_LOOKUP_LIMITS.maxModelCalls && used.tokens < ASK_LOOKUP_LIMITS.maxTurnTokens;
}
