import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { resolvePersonId } from "./app-repository-lookups";

export async function syncMonthlyPlanRowSplits(
  db: D1Database,
  input: {
    rowId: string;
    ownershipType: "direct" | "shared";
    plannedMinor: number;
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  await db.prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?").bind(input.rowId).run();

  if (input.ownershipType === "direct") {
    const ownerId = await resolvePersonId(db, input.ownerName);
    await db
      .prepare(`
        INSERT INTO monthly_plan_row_splits (
          id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.rowId}-split-direct`,
        input.rowId,
        ownerId,
        10000,
        input.plannedMinor
      )
      .run();
    return;
  }

  const people = await db
    .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 2")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();

  const [firstPerson, secondPerson] = people.results;
  if (!firstPerson || !secondPerson) {
    throw new Error("Shared plan rows require two people");
  }

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round((input.plannedMinor * firstBasisPoints) / 10000);
  const secondAmount = input.plannedMinor - firstAmount;

  await db
    .prepare(`
      INSERT INTO monthly_plan_row_splits (
        id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.rowId}-split-1`,
      input.rowId,
      firstPerson.id,
      firstBasisPoints,
      firstAmount,
      `${input.rowId}-split-2`,
      input.rowId,
      secondPerson.id,
      secondBasisPoints,
      secondAmount
    )
    .run();
}

export async function syncTransactionSplits(
  db: D1Database,
  input: {
    transactionId: string;
    ownershipType: "direct" | "shared";
    amountMinor: number;
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  await db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").bind(input.transactionId).run();

  if (input.ownershipType === "direct") {
    const ownerId = await resolvePersonId(db, input.ownerName);
    await db
      .prepare(`
        INSERT INTO transaction_splits (
          id, transaction_id, person_id, ratio_basis_points, amount_minor
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        `${input.transactionId}-split-direct`,
        input.transactionId,
        ownerId,
        10000,
        input.amountMinor
      )
      .run();
    return;
  }

  const people = await db
    .prepare("SELECT id FROM people WHERE household_id = ? ORDER BY created_at LIMIT 2")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string }>();

  const [firstPerson, secondPerson] = people.results;
  if (!firstPerson || !secondPerson) {
    throw new Error("Shared entries require two people");
  }

  const firstBasisPoints = Math.max(0, Math.min(10000, input.splitBasisPoints ?? 5000));
  const secondBasisPoints = 10000 - firstBasisPoints;
  const firstAmount = Math.round((input.amountMinor * firstBasisPoints) / 10000);
  const secondAmount = input.amountMinor - firstAmount;

  await db
    .prepare(`
      INSERT INTO transaction_splits (
        id, transaction_id, person_id, ratio_basis_points, amount_minor
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `)
    .bind(
      `${input.transactionId}-split-1`,
      input.transactionId,
      firstPerson.id,
      firstBasisPoints,
      firstAmount,
      `${input.transactionId}-split-2`,
      input.transactionId,
      secondPerson.id,
      secondBasisPoints,
      secondAmount
    )
    .run();
}
