// Read-only context for Ask's turn (ask-turn.ts): the household's people in
// share order, the entry draft reader's context (wallets, categories, rules,
// payment ways), the split groups, this month's plan line names, and the
// entry or card in focus. The entry in focus is loaded from the household's
// own rows by its id: an id from another household, or one that does not
// exist, is no focus at all. Writes nothing.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { loadAskHabits } from "./app-repository-ask-habits";
import { loadMonthPlanRowsForDraft } from "./app-repository-months";
import { loadEntryDraftContext } from "./entry-draft-context";
import { findClosedStatementCheckpointForTransaction } from "./app-repository-entry-commands";
import type { AskTurnCategory, AskTurnContext, AskTurnDraftFocus, AskTurnFocus, AskTurnFocusEntry, AskTurnGroup, AskTurnListFocus, AskTurnMessage, AskTurnPerson } from "./ask-turn";
import type { EntryType } from "../types/dto";

const MAX_ID_LENGTH = 200;
const MAX_FIELD_LENGTH = 200;

export interface AskTurnRequestInput {
  text: string;
  history: AskTurnMessage[];
  viewId: string;
  scope: string;
  month: string;
  page: string;
  focus: unknown;
  // The signed-in person asking (loadAskerPersonId), when known.
  askerPersonId?: string;
}

export async function loadAskTurnContext(db: D1Database, input: AskTurnRequestInput, today: string): Promise<AskTurnContext> {
  // Every read starts at once: they all come before the model call. The
  // draft context gets the view and asker as sent; it only names a person
  // it finds among the household's own, as checking them first would.
  const [people, groups, categories, entry, planRows, habits, focusEntry] = await Promise.all([
    loadPeople(db),
    loadGroups(db),
    loadCategoryRecords(db),
    loadEntryDraftContext(db, { today, viewId: input.viewId, askerPersonId: input.askerPersonId }),
    loadMonthPlanRowsForDraft(db, input.month),
    loadAskHabits(db),
    loadSavedEntryFocus(db, input.focus)
  ]);
  const viewId = input.viewId === "household" || people.some((person) => person.id === input.viewId) ? input.viewId : "household";
  const askerPersonId = people.some((person) => person.id === input.askerPersonId) ? input.askerPersonId : undefined;
  const planLines = [...new Set(planRows.map((row) => row.label.trim()).filter(Boolean))];
  const context: AskTurnContext = {
    today,
    month: input.month,
    viewId,
    scope: input.scope,
    page: input.page,
    people,
    ...(askerPersonId ? { askerPersonId } : {}),
    entry,
    groups,
    planLines,
    nicknames: nicknamesFrom(habits.habits, people),
    categories,
    focus: null,
    history: input.history,
    text: input.text
  };
  context.focus = focusEntry ?? readFocus(input.focus, context);
  return context;
}

// A saved entry in focus, read with the rest (null for any other focus).
async function loadSavedEntryFocus(db: D1Database, value: unknown): Promise<AskTurnFocus> {
  const focus = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (focus?.kind === "saved_entry" && typeof focus.entryId === "string" && focus.entryId.length <= MAX_ID_LENGTH) {
    const entry = await loadFocusEntry(db, focus.entryId);
    return entry ? { kind: "saved_entry", entry } : null;
  }
  return null;
}

async function loadPeople(db: D1Database): Promise<AskTurnPerson[]> {
  const result = await db
    .prepare(`
      SELECT id, display_name
      FROM people
      WHERE household_id = ?
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END, created_at, id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();
  return result.results.map((person) => ({ id: person.id, name: person.display_name }));
}

async function loadGroups(db: D1Database): Promise<AskTurnGroup[]> {
  const result = await db
    .prepare("SELECT id, group_name, currency FROM split_groups WHERE household_id = ? ORDER BY sort_order, group_name")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; group_name: string; currency: string }>();
  return result.results.map((group) => ({ id: group.id, name: group.group_name, currency: group.currency || "SGD" }));
}

// Any other focus, read from what the page sent and the context (a saved
// entry is read beside the context, loadSavedEntryFocus).
function readFocus(value: unknown, context: AskTurnContext): AskTurnFocus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const focus = value as Record<string, unknown>;
  if (focus.kind === "saved_entry") {
    return null;
  }
  if (focus.kind === "draft" && focus.draft && typeof focus.draft === "object") {
    return { kind: "draft", draft: readDraft(focus.draft as Record<string, unknown>, context) };
  }
  if (focus.kind === "split_group" && typeof focus.groupId === "string") {
    const group = context.groups.find((candidate) => candidate.id === focus.groupId);
    return group ? { kind: "split_group", group } : null;
  }
  if (focus.kind === "insight" && typeof focus.topic === "string") {
    return { kind: "insight", topic: focus.topic.slice(0, 60) };
  }
  if (focus.kind === "entry_list" && focus.list && typeof focus.list === "object") {
    return { kind: "entry_list", list: readList(focus.list as Record<string, unknown>, context) };
  }
  return null;
}

// The Entries answer card in focus, as the page sent it: its month, the
// words it searched (cut short) and only the household's own categories.
function readList(raw: Record<string, unknown>, context: AskTurnContext): AskTurnListFocus {
  const month = typeof raw.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month) ? raw.month : context.month;
  const search = typeof raw.search === "string" ? raw.search.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((name): name is string => typeof name === "string" && context.entry.categoryNames.includes(name)).slice(0, 6)
    : [];
  return { month, search, categories };
}

async function loadCategoryRecords(db: D1Database): Promise<AskTurnCategory[]> {
  const result = await db
    .prepare("SELECT id, name, color_hex, is_system FROM categories WHERE household_id = ? ORDER BY sort_order, name")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; name: string; color_hex: string; is_system: number }>();
  return result.results.map((row) => ({ id: row.id, name: row.name, colorHex: row.color_hex, isSystem: Boolean(row.is_system) }));
}

// The household's own entry, or null for an id that is not one.
export async function loadFocusEntry(db: D1Database, entryId: string): Promise<AskTurnFocusEntry | null> {
  const row = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.currency,
        transactions.entry_type,
        transactions.owner_person_id,
        transactions.account_id,
        transactions.note,
        transactions.post_date,
        transactions.transfer_direction,
        transactions.transfer_group_id,
        transactions.bank_certification_status,
        owners.display_name AS owner_name,
        accounts.owner_person_id AS account_owner_person_id,
        accounts.account_name,
        categories.name AS category_name,
        (
          SELECT COUNT(*) FROM split_expenses
          WHERE split_expenses.household_id = transactions.household_id
            AND split_expenses.linked_transaction_id = transactions.id
            AND split_expenses.deleted_at IS NULL
        ) AS linked_splits
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN people AS owners ON owners.id = transactions.owner_person_id
      WHERE transactions.household_id = ? AND transactions.id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, entryId)
    .first<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      currency: string;
      entry_type: EntryType;
      owner_person_id: string | null;
      account_id: string;
      note: string | null;
      post_date: string | null;
      transfer_direction: "in" | "out" | null;
      transfer_group_id: string | null;
      bank_certification_status: string;
      owner_name: string | null;
      account_owner_person_id: string | null;
      account_name: string;
      category_name: string | null;
      linked_splits: number;
    }>();
  if (!row) {
    return null;
  }
  // The same lock the entry update checks (assertUnlockedBankFactsForEntryUpdate).
  const lock = row.bank_certification_status === "statement_certified"
    ? await findClosedStatementCheckpointForTransaction(db, { accountId: row.account_id, transactionDate: row.transaction_date })
    : null;
  return {
    entryId: row.id,
    description: row.description,
    categoryName: row.category_name ?? "Other",
    date: row.transaction_date,
    entryType: row.entry_type,
    accountName: row.account_name,
    currency: row.currency,
    amountMinor: row.amount_minor,
    // The payer Add to Splits records (createSplitExpenseFromEntryRecord).
    payerPersonId: row.owner_person_id ?? row.account_owner_person_id,
    linkedToSplits: Number(row.linked_splits) > 0,
    accountId: row.account_id,
    ownerName: row.owner_name,
    note: row.note ?? "",
    postDate: row.post_date,
    transferDirection: row.transfer_direction,
    linkedToTransfer: Boolean(row.transfer_group_id),
    lockedMonth: lock?.checkpoint_month ?? null
  };
}

// The card being filled, as the page sent it: names only where they are
// the household's own, so nothing the page made up reaches the prompt.
function readDraft(raw: Record<string, unknown>, context: AskTurnContext): AskTurnDraftFocus {
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH) : "");
  const variant: EntryType = raw.variant === "income" || raw.variant === "transfer" ? raw.variant : "expense";
  const account = context.entry.accounts.find((candidate) => candidate.id === raw.accountId);
  const categoryName = context.entry.categoryNames.find((name) => name === raw.categoryName) ?? "";
  const ownerName = raw.ownerName === "Shared" ? "Shared" : context.people.find((person) => person.name === raw.ownerName)?.name ?? "";
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "";
  const amountMinor = typeof raw.amountMinor === "number" && Number.isInteger(raw.amountMinor) && raw.amountMinor > 0 ? raw.amountMinor : 0;
  const group = context.groups.find((candidate) => candidate.id === raw.splitGroupId);
  return {
    variant,
    description: text(raw.description),
    date,
    accountName: account?.name ?? "",
    categoryName,
    ownerName,
    amountMinor,
    shareOn: raw.shareOn === true,
    splitGroupName: group?.name ?? ""
  };
}

// The nicknames the household confirmed ("J" means Joyce), from Ask's habits;
// none when the table is missing.
function nicknamesFrom(habits: Awaited<ReturnType<typeof loadAskHabits>>["habits"], people: AskTurnPerson[]) {
  return habits
    .filter((habit) => habit.kind === "alias")
    .flatMap((habit) => {
      const person = people.find((candidate) => candidate.id === (habit.value as { personId: string }).personId);
      return person ? [{ alias: habit.key, person: person.name }] : [];
    });
}
