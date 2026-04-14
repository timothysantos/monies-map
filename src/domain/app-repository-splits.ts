import { household as demoHousehold } from "./demo-data";
import {
  countSharedTokens,
  diffDays,
  findCategoryId,
  groupSplits,
  slugify
} from "./app-repository-helpers";
import { closeSplitBatch, getOrCreateActiveSplitBatch } from "./app-repository-split-batches";
import { syncTransactionSplits } from "./app-repository-split-sync";
import type {
  SplitExpenseDto,
  SplitMatchCandidateDto,
  SplitSettlementDto
} from "../types/dto";

const DEMO_HOUSEHOLD_ID = demoHousehold.id;

const PERSON_IDS: Record<string, string> = {
  Tim: "person-tim",
  Joyce: "person-joyce"
};

export async function loadSplitExpenses(db: D1Database, month = "2025-10"): Promise<SplitExpenseDto[]> {
  const expenses = await db
    .prepare(`
      SELECT
        split_expenses.id,
        split_expenses.split_group_id,
        split_expenses.split_batch_id,
        split_expenses.expense_date,
        split_expenses.description,
        split_expenses.total_amount_minor,
        split_expenses.note,
        split_expenses.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        payer.id AS payer_person_id,
        payer.display_name AS payer_person_name,
        categories.name AS category_name,
        transactions.description AS linked_transaction_description
      FROM split_expenses
      LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
      INNER JOIN people AS payer ON payer.id = split_expenses.payer_person_id
      LEFT JOIN categories ON categories.id = split_expenses.category_id
      LEFT JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      WHERE split_expenses.household_id = ?
      ORDER BY split_expenses.expense_date DESC, split_expenses.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      expense_date: string;
      description: string;
      total_amount_minor: number;
      note: string | null;
      linked_transaction_id: string | null;
      group_name: string | null;
      batch_name: string | null;
      closed_on: string | null;
      payer_person_id: string;
      payer_person_name: string;
      category_name: string | null;
      linked_transaction_description: string | null;
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
    .bind(DEMO_HOUSEHOLD_ID)
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
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined,
    shares: shareMap.get(row.id) ?? []
  }));
}

export async function loadSplitSettlements(db: D1Database, month = "2025-10"): Promise<SplitSettlementDto[]> {
  const settlements = await db
    .prepare(`
      SELECT
        split_settlements.id,
        split_settlements.split_group_id,
        split_settlements.split_batch_id,
        split_settlements.settlement_date,
        split_settlements.amount_minor,
        split_settlements.note,
        split_settlements.linked_transaction_id,
        split_groups.group_name,
        split_batches.batch_name,
        split_batches.closed_on,
        from_person.id AS from_person_id,
        from_person.display_name AS from_person_name,
        to_person.id AS to_person_id,
        to_person.display_name AS to_person_name,
        transactions.description AS linked_transaction_description
      FROM split_settlements
      LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
      LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
      INNER JOIN people AS from_person ON from_person.id = split_settlements.from_person_id
      INNER JOIN people AS to_person ON to_person.id = split_settlements.to_person_id
      LEFT JOIN transactions ON transactions.id = split_settlements.linked_transaction_id
      WHERE split_settlements.household_id = ?
      ORDER BY split_settlements.settlement_date DESC, split_settlements.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      split_group_id: string | null;
      split_batch_id: string | null;
      settlement_date: string;
      amount_minor: number;
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
    note: row.note ?? undefined,
    linkedTransactionId: row.linked_transaction_id ?? undefined,
    linkedTransactionDescription: row.linked_transaction_description ?? undefined
  }));
}

export async function loadSplitMatchCandidates(db: D1Database, month = "2025-10"): Promise<SplitMatchCandidateDto[]> {
  const [expenses, settlements] = await Promise.all([
    loadSplitExpenses(db, month),
    loadSplitSettlements(db, month)
  ]);
  const transactionRows = await db
    .prepare(`
      SELECT
        transactions.id,
        transactions.transaction_date,
        transactions.description,
        transactions.amount_minor,
        transactions.entry_type,
        transactions.import_id
      FROM transactions
      INNER JOIN imports ON imports.id = transactions.import_id
      WHERE transactions.household_id = ?
        AND transactions.import_id IS NOT NULL
        AND imports.status = 'completed'
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC
    `)
    .bind(DEMO_HOUSEHOLD_ID)
    .all<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      entry_type: "expense" | "income" | "transfer";
      import_id: string;
    }>();

  const matches: SplitMatchCandidateDto[] = [];

  for (const expense of expenses.filter((item) => !item.linkedTransactionId)) {
    const candidate = transactionRows.results
      .filter((row) => row.entry_type === "expense")
      .map((row) => ({
        row,
        dateDelta: diffDays(expense.date, row.transaction_date),
        amountDelta: Math.abs(expense.totalAmountMinor - row.amount_minor),
        overlap: countSharedTokens(expense.description, row.description)
      }))
      .filter((item) => item.dateDelta <= 5 && item.amountDelta <= 150 && item.overlap > 0)
      .sort((left, right) => (
        left.amountDelta - right.amountDelta
        || left.dateDelta - right.dateDelta
        || right.overlap - left.overlap
      ))[0];

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `expense-match-${expense.id}-${candidate.row.id}`,
      kind: "expense",
      groupId: expense.groupId ?? "split-group-none",
      groupName: expense.groupName,
      splitRecordId: expense.id,
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: candidate.row.description,
      amountMinor: candidate.row.amount_minor,
      confidenceLabel: candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transaction could match this split expense"
    });
  }

  for (const settlement of settlements.filter((item) => !item.linkedTransactionId)) {
    const candidate = transactionRows.results
      .filter((row) => row.entry_type === "transfer")
      .map((row) => ({
        row,
        dateDelta: diffDays(settlement.date, row.transaction_date),
        amountDelta: Math.abs(settlement.amountMinor - row.amount_minor)
      }))
      .filter((item) => item.dateDelta <= 7 && item.amountDelta <= 150)
      .sort((left, right) => left.amountDelta - right.amountDelta || left.dateDelta - right.dateDelta)[0];

    if (!candidate) {
      continue;
    }

    matches.push({
      id: `settlement-match-${settlement.id}-${candidate.row.id}`,
      kind: "settlement",
      groupId: settlement.groupId ?? "split-group-none",
      groupName: settlement.groupName,
      splitRecordId: settlement.id,
      transactionId: candidate.row.id,
      transactionDate: candidate.row.transaction_date,
      transactionDescription: candidate.row.description,
      amountMinor: candidate.row.amount_minor,
      confidenceLabel: candidate.amountDelta === 0 && candidate.dateDelta <= 1 ? "High" : "Medium",
      reviewLabel: "Imported transfer could match this settle-up"
    });
  }

  return matches;
}

export async function createSplitGroupRecord(
  db: D1Database,
  input: { name: string }
) {
  const id = `split-group-${slugify(input.name)}-${Date.now()}`;
  await db
    .prepare(`
      INSERT INTO split_groups (
        id, household_id, group_name, sort_order
      ) VALUES (?, ?, ?, ?)
    `)
    .bind(id, DEMO_HOUSEHOLD_ID, input.name.trim(), Date.now())
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
    splitBasisPoints?: number;
  }
) {
  const payerPersonId = PERSON_IDS[input.payerPersonName];
  if (!payerPersonId) {
    throw new Error("Unknown split expense payer.");
  }

  const id = `split-expense-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  const categoryId = findCategoryId(input.categoryName);
  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round(input.amountMinor * (firstBasisPoints / 10000));
  const secondAmount = input.amountMinor - firstAmount;
  const shares = [
    { personId: "person-tim", ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { personId: "person-joyce", ratioBasisPoints: secondBasisPoints, amountMinor: secondAmount }
  ];

  await db
    .prepare(`
      INSERT INTO split_expenses (
        id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
        description, category_id, total_amount_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      payerPersonId,
      input.date,
      input.description.trim(),
      categoryId,
      input.amountMinor,
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

export async function createSplitSettlementRecord(
  db: D1Database,
  input: {
    groupId?: string | null;
    date: string;
    fromPersonName: string;
    toPersonName: string;
    amountMinor: number;
    note?: string;
  }
) {
  const fromPersonId = PERSON_IDS[input.fromPersonName];
  const toPersonId = PERSON_IDS[input.toPersonName];
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("Settlement requires two different people.");
  }

  const id = `split-settlement-${Date.now()}`;
  const batchId = await getOrCreateActiveSplitBatch(db, {
    groupId: input.groupId || null,
    date: input.date
  });
  await db
    .prepare(`
      INSERT INTO split_settlements (
        id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
        settlement_date, amount_minor, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.groupId || null,
      batchId,
      fromPersonId,
      toPersonId,
      input.date,
      input.amountMinor,
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
  }
) {
  const payerPersonId = PERSON_IDS[input.payerPersonName];
  if (!payerPersonId) {
    throw new Error("Unknown split expense payer.");
  }

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id
      FROM split_expenses
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.splitExpenseId, DEMO_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null }>();
  if (!existing) {
    throw new Error("Split expense not found.");
  }

  const nextGroupId = input.groupId || null;
  const batchId = existing.split_group_id === nextGroupId
    ? existing.split_batch_id
    : await getOrCreateActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });

  await db
    .prepare(`
      UPDATE split_expenses
      SET split_group_id = ?, split_batch_id = ?, payer_person_id = ?, expense_date = ?, description = ?,
          category_id = ?, total_amount_minor = ?, note = ?
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.groupId || null,
      batchId ?? null,
      payerPersonId,
      input.date,
      input.description.trim(),
      findCategoryId(input.categoryName),
      input.amountMinor,
      input.note ?? null,
      input.splitExpenseId,
      DEMO_HOUSEHOLD_ID
    )
    .run();

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round(input.amountMinor * (firstBasisPoints / 10000));
  const secondAmount = input.amountMinor - firstAmount;

  await db.prepare("DELETE FROM split_expense_shares WHERE split_expense_id = ?").bind(input.splitExpenseId).run();
  await db
    .prepare(`
      INSERT INTO split_expense_shares (
        id, split_expense_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.splitExpenseId}-person-tim`,
      input.splitExpenseId,
      "person-tim",
      firstBasisPoints,
      firstAmount,
      `${input.splitExpenseId}-person-joyce`,
      input.splitExpenseId,
      "person-joyce",
      secondBasisPoints,
      secondAmount
    )
    .run();

  return { splitExpenseId: input.splitExpenseId };
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
  }
) {
  const fromPersonId = PERSON_IDS[input.fromPersonName];
  const toPersonId = PERSON_IDS[input.toPersonName];
  if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
    throw new Error("Settlement requires two different people.");
  }

  const existing = await db
    .prepare(`
      SELECT split_group_id, split_batch_id
      FROM split_settlements
      WHERE id = ? AND household_id = ?
    `)
    .bind(input.settlementId, DEMO_HOUSEHOLD_ID)
    .first<{ split_group_id: string | null; split_batch_id: string | null }>();
  if (!existing) {
    throw new Error("Split settlement not found.");
  }

  const nextGroupId = input.groupId || null;
  const batchId = existing.split_group_id === nextGroupId
    ? existing.split_batch_id
    : await getOrCreateActiveSplitBatch(db, { groupId: nextGroupId, date: input.date });

  await db
    .prepare(`
      UPDATE split_settlements
      SET split_group_id = ?, split_batch_id = ?, from_person_id = ?, to_person_id = ?,
          settlement_date = ?, amount_minor = ?, note = ?
      WHERE id = ? AND household_id = ?
    `)
    .bind(
      input.groupId || null,
      batchId ?? null,
      fromPersonId,
      toPersonId,
      input.date,
      input.amountMinor,
      input.note ?? null,
      input.settlementId,
      DEMO_HOUSEHOLD_ID
    )
    .run();
  if (batchId) {
    await closeSplitBatch(db, { batchId, closedOn: input.date });
  }

  return { settlementId: input.settlementId };
}

export async function linkSplitExpenseMatch(
  db: D1Database,
  input: { splitExpenseId: string; transactionId: string }
) {
  await db
    .prepare("UPDATE split_expenses SET linked_transaction_id = ? WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, input.splitExpenseId, DEMO_HOUSEHOLD_ID)
    .run();

  return { ok: true };
}

export async function linkSplitSettlementMatch(
  db: D1Database,
  input: { settlementId: string; transactionId: string }
) {
  await db
    .prepare("UPDATE split_settlements SET linked_transaction_id = ? WHERE id = ? AND household_id = ?")
    .bind(input.transactionId, input.settlementId, DEMO_HOUSEHOLD_ID)
    .run();

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
        transactions.ownership_type,
        transactions.owner_person_id,
        transactions.note,
        transactions.category_id,
        transactions.entry_type,
        accounts.owner_person_id AS account_owner_person_id
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      WHERE transactions.household_id = ?
        AND transactions.id = ?
    `)
    .bind(DEMO_HOUSEHOLD_ID, input.entryId)
    .first<{
      id: string;
      transaction_date: string;
      description: string;
      amount_minor: number;
      ownership_type: "direct" | "shared";
      owner_person_id: string | null;
      note: string | null;
      category_id: string | null;
      entry_type: "expense" | "income" | "transfer";
      account_owner_person_id: string | null;
    }>();

  if (!entry) {
    throw new Error("Entry not found.");
  }

  if (entry.entry_type !== "expense") {
    throw new Error("Only expense entries can be added to splits.");
  }

  const existingSplit = await db
    .prepare("SELECT id FROM split_expenses WHERE household_id = ? AND linked_transaction_id = ?")
    .bind(DEMO_HOUSEHOLD_ID, input.entryId)
    .first<{ id: string }>();

  if (existingSplit) {
    throw new Error("This entry is already linked to a split expense.");
  }

  const payerPersonId = entry.owner_person_id ?? entry.account_owner_person_id;
  if (!payerPersonId) {
    throw new Error("This entry does not have a clear payer. Assign an owner first.");
  }

  if (entry.ownership_type !== "shared") {
    await db
      .prepare(`
        UPDATE transactions
        SET ownership_type = 'shared',
            owner_person_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ?
          AND id = ?
      `)
      .bind(DEMO_HOUSEHOLD_ID, input.entryId)
      .run();

    await syncTransactionSplits(db, {
      transactionId: input.entryId,
      ownershipType: "shared",
      amountMinor: entry.amount_minor,
      splitBasisPoints: 5000
    });
  }

  const id = `split-expense-${Date.now()}`;
  await db
    .prepare(`
      INSERT INTO split_expenses (
        id, household_id, split_group_id, payer_person_id, expense_date,
        description, category_id, total_amount_minor, note, linked_transaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      DEMO_HOUSEHOLD_ID,
      input.splitGroupId || null,
      payerPersonId,
      entry.transaction_date,
      entry.description,
      entry.category_id,
      entry.amount_minor,
      entry.note,
      entry.id
    )
    .run();

  const transactionSplits = await db
    .prepare(`
      SELECT person_id, ratio_basis_points, amount_minor
      FROM transaction_splits
      WHERE transaction_id = ?
      ORDER BY created_at
    `)
    .bind(input.entryId)
    .all<{
      person_id: string;
      ratio_basis_points: number;
      amount_minor: number;
    }>();

  for (const split of transactionSplits.results) {
    await db
      .prepare(`
        INSERT INTO split_expense_shares (
          id, split_expense_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(`${id}-${split.person_id}`, id, split.person_id, split.ratio_basis_points, split.amount_minor)
      .run();
  }

  return { splitExpenseId: id };
}
