// SQL seeding for the Ledger check-up's API tests, on the demo household
// (Tim, Joyce; accounts acct-uob-savings, acct-uob-one, acct-uob-lady,
// acct-citi-rewards). Dates are relative to today so the tests do not age out.
// Everything is invented; the shapes (a flight entered twice and settled, a
// month with no statement, fourteen $450 transfers) follow the household's real
// problems with nothing copied from them.
import { todayInAppTimeZone } from "../../src/lib/app-calendar.ts";

export const TODAY = todayInAppTimeZone();

export function daysAgo(days, from = TODAY) {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export const SAVINGS = "acct-uob-savings";
export const TIM_CARD = "acct-uob-one";
export const JOYCE_CARD = "acct-uob-lady";
export const JOYCE_CITI = "acct-citi-rewards";

export async function categoryId(db, name) {
  return (await db.prepare("SELECT id FROM categories WHERE household_id = 'household-1' AND name = ?").bind(name).first())?.id
    ?? (await db.prepare("SELECT id FROM categories WHERE household_id = 'household-1' ORDER BY id LIMIT 1").first()).id;
}

let counter = 0;
export function nextId(prefix) {
  counter += 1;
  return `${prefix}-${String(counter).padStart(8, "0")}`;
}

// A fresh account with no entries (the demo accounts carry seeded history).
export async function insertAccount(db, { id = nextId("acct"), name = "Test account", kind = "bank", owner = "person-tim", joint = false, active = true, opening = 0 } = {}) {
  const institution = (await db.prepare("SELECT id FROM institutions WHERE household_id = 'household-1' ORDER BY id LIMIT 1").first()).id;
  await db.prepare(`
    INSERT INTO accounts (id, household_id, institution_id, owner_person_id, account_name, account_kind, currency, opening_balance_minor, is_joint, is_active)
    VALUES (?, 'household-1', ?, ?, ?, ?, 'SGD', ?, ?, ?)
  `).bind(id, institution, owner, name, kind, opening, joint ? 1 : 0, active ? 1 : 0).run();
  return id;
}

export async function insertImport(db, { id = nextId("imp"), type = "csv", status = "completed", importedAt, label = "Bank file" } = {}) {
  await db.prepare("INSERT INTO imports (id, household_id, source_type, source_label, imported_at, status) VALUES (?, 'household-1', ?, ?, ?, ?)")
    .bind(id, type, label, importedAt ?? `${TODAY}T01:00:00Z`, status).run();
  return id;
}

export async function insertImportRow(db, { importId, hash, index = 1 }) {
  const id = nextId("row");
  await db.prepare("INSERT INTO import_rows (id, import_id, row_index, raw_row_json, normalized_hash, status) VALUES (?, ?, ?, '{}', ?, 'imported')")
    .bind(id, importId, index, hash).run();
  return id;
}

export async function insertEntry(db, input) {
  const id = input.id ?? nextId("txn");
  await db.prepare(`
    INSERT INTO transactions (
      id, household_id, import_id, import_row_id, account_id, transfer_group_id, transaction_date, post_date, description, amount_minor, currency,
      entry_type, transfer_direction, category_id, owner_person_id, external_reference, original_amount_minor, original_currency,
      bank_certification_status, transfer_review_dismissed_at, created_at
    ) VALUES (?, 'household-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `).bind(
    id, input.importId ?? null, input.importRowId ?? null, input.account ?? SAVINGS, input.transferGroupId ?? null, input.date, input.postDate ?? null,
    input.description ?? "FAIRPRICE XTRA SINGAPORE SG", input.amountMinor ?? 1234, input.currency ?? "SGD", input.type ?? "expense", input.direction ?? null,
    input.categoryId ?? null, input.owner ?? null, input.externalReference ?? null, input.originalAmountMinor ?? null, input.originalCurrency ?? null,
    input.certified ? "statement_certified" : "provisional", input.transferDismissedAt ?? null, input.createdAt ?? null
  ).run();
  return id;
}

export async function insertSplitExpense(db, input) {
  const id = input.id ?? nextId("exp");
  const people = input.shares ?? [["person-tim", Math.floor(input.amountMinor / 2)], ["person-joyce", input.amountMinor - Math.floor(input.amountMinor / 2)]];
  await db.batch([
    db.prepare(`
      INSERT INTO split_expenses (id, household_id, split_group_id, payer_person_id, expense_date, description, total_amount_minor, currency, payment_method, payment_status, linked_transaction_id, deleted_at, created_at)
      VALUES (?, 'household-1', ?, ?, ?, ?, ?, ?, 'card', 'recorded', ?, ?, ?)
    `).bind(id, input.groupId ?? null, input.payer ?? "person-tim", input.date, input.description ?? "Flights", input.amountMinor, input.currency ?? "SGD", input.linkedTransactionId ?? null, input.deletedAt ?? null, input.createdAt ?? `${input.date}T10:00:00Z`),
    ...people.map(([person, amount]) => db.prepare("INSERT INTO split_expense_shares (id, split_expense_id, person_id, ratio_basis_points, amount_minor) VALUES (?, ?, ?, ?, ?)")
      .bind(nextId("share"), id, person, Math.round((amount / input.amountMinor) * 10_000), amount))
  ]);
  return id;
}

export async function insertGroup(db, { id = nextId("grp"), name = "Okaeri trip" } = {}) {
  await db.prepare("INSERT INTO split_groups (id, household_id, group_name, currency, expense_source, sort_order) VALUES (?, 'household-1', ?, 'SGD', 'mixed', 90)").bind(id, name).run();
  return id;
}

export async function insertSettlementCheckpoint(db, { id = nextId("cp"), date, status = "matched", recordIds = [] }) {
  await db.batch([
    db.prepare("INSERT INTO split_settlement_checkpoints (id, household_id, from_person_id, to_person_id, amount_minor, currency, settlement_date, status, matched_amount_minor) VALUES (?, 'household-1', 'person-joyce', 'person-tim', 100000, 'SGD', ?, ?, 100000)").bind(id, date, status),
    ...recordIds.map((recordId) => db.prepare("INSERT INTO split_settlement_checkpoint_items (id, checkpoint_id, record_kind, record_id) VALUES (?, ?, 'expense', ?)").bind(nextId("cpi"), id, recordId))
  ]);
  return id;
}

// A monthly statement for a bank account whose balance matches the entries:
// one entry in the middle of the month, a checkpoint with the running balance
// and a certified certificate from a completed statement import. The entries
// are stamped before the certificate, as a statement import writes them.
export async function seedStatementMonths(db, accountId, months, { amounts = [], opening = 0, certifiedAt } = {}) {
  await db.prepare("UPDATE accounts SET opening_balance_minor = ? WHERE id = ?").bind(opening, accountId).run();
  let balance = opening;
  const ids = {};
  for (const [index, month] of months.entries()) {
    const net = amounts[index] ?? -10_000;
    balance += net;
    const importId = await insertImport(db, { type: "pdf", importedAt: `${month}-28T10:00:00Z`, label: `Statement ${month}` });
    const [year, number] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    ids[month] = await insertEntry(db, {
      account: accountId, date: `${month}-15`, amountMinor: Math.abs(net), type: net < 0 ? "expense" : "income", importId,
      description: `STATEMENT ROW ${month}`, certified: true, createdAt: "2020-01-01 00:00:00"
    });
    await db.batch([
      db.prepare("INSERT INTO account_balance_checkpoints (id, household_id, account_id, checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor) VALUES (?, 'household-1', ?, ?, ?, ?, ?)")
        .bind(nextId("chk"), accountId, month, `${month}-01`, `${month}-${String(last).padStart(2, "0")}`, balance),
      db.prepare(`
        INSERT INTO statement_reconciliation_certificates (id, household_id, import_id, account_id, checkpoint_month, statement_start_date, statement_end_date, statement_balance_minor, projected_ledger_balance_minor, delta_minor, status, created_at)
        VALUES (?, 'household-1', ?, ?, ?, ?, ?, ?, ?, 0, 'certified', ?)
      `).bind(nextId("cert"), importId, accountId, month, `${month}-01`, `${month}-${String(last).padStart(2, "0")}`, balance, balance, certifiedAt ?? "2020-01-02 00:00:00")
    ]);
  }
  return { balance, entryIds: ids };
}

export async function insertPlanRow(db, input) {
  const id = input.id ?? nextId("plan");
  const [year, month] = input.month.split("-").map(Number);
  await db.prepare(`
    INSERT INTO monthly_plan_rows (id, household_id, year, month, person_id, ownership_type, section_key, category_id, label, plan_date, planned_amount_minor, actual_amount_minor)
    VALUES (?, 'household-1', ?, ?, ?, 'direct', ?, ?, ?, ?, ?, ?)
  `).bind(id, year, month, input.person ?? "person-tim", input.section ?? "planned_items", input.categoryId ?? null, input.label, input.planDate ?? null, input.plannedMinor, input.actualMinor ?? 0).run();
  return id;
}
