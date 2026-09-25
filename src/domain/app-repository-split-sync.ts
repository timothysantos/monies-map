import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { resolvePersonId } from "./app-repository-lookups";
import { splitAmountMinorWithRoundedRemainder } from "./split-allocation";

// The statements that replace a plan row's splits. Lookups and checks run
// now, so the caller can put the delete and inserts in the same batch as the
// row write and a bad owner can never leave the row without splits.
export async function buildMonthlyPlanRowSplitStatements(
  db: D1Database,
  input: {
    rowId: string;
    ownershipType: "direct" | "shared";
    plannedMinor: number;
    ownerName?: string;
    splitBasisPoints?: number;
  }
) {
  const clearSplits = db.prepare("DELETE FROM monthly_plan_row_splits WHERE monthly_plan_row_id = ?").bind(input.rowId);

  if (input.ownershipType === "direct") {
    const ownerId = await resolvePersonId(db, input.ownerName);
    return [
      clearSplits,
      db
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
    ];
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
  const { firstAmount, secondAmount } = splitAmountMinorWithRoundedRemainder(input.plannedMinor, firstBasisPoints);

  return [
    clearSplits,
    db
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
  ];
}
