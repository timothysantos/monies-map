import { todayInAppTimeZone } from "../../lib/app-calendar";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { resolvePageViewId } from "../route-context";
import { buildTaxReliefsYear, hasTaxReliefs, TAX_RELIEF_CATEGORY_KEYS, type TaxReliefRow, type TaxReliefsYear } from "../tax-reliefs";

// GET /api/tax-reliefs (DOMAIN.md "Tax Relief"): Summary's "Tax reliefs"
// card. Read-only, no AI, never on the first screen: the card asks once the
// top summary is usable. One step: the people, and this year's entries whose
// category or transfer purpose is one of the three relief categories
// (matched in SQL, so only those rows leave D1).
//
// The figures are whole amounts in every view and open in the household
// view (data-fig-view on the card). A person view shows that person alone.

export interface TaxReliefsDto extends Partial<TaxReliefsYear> {
  viewId: string;
  today: string;
  // Empty when nobody put anything into a relief this year: no card.
  people: TaxReliefsYear["people"];
}

// The category name without case, spaces or hyphens (taxReliefCategoryKind).
const NAME_KEY = (column: string) => `lower(replace(replace(${column}, ' ', ''), '-', ''))`;
const KEYS = TAX_RELIEF_CATEGORY_KEYS.map((key) => `'${key}'`).join(", ");

export const TAX_RELIEF_ROWS_SQL = `
  SELECT
    transactions.id,
    transactions.transaction_date,
    transactions.entry_type,
    transactions.transfer_direction,
    transactions.amount_minor,
    transactions.owner_person_id,
    categories.name AS category_name,
    purpose_categories.name AS purpose_category_name,
    transactions.transfer_purpose_person_id
  FROM transactions
  LEFT JOIN imports ON imports.id = transactions.import_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  LEFT JOIN categories AS purpose_categories ON purpose_categories.id = transactions.transfer_purpose_category_id
  WHERE transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date <= ?
    AND (transactions.import_id IS NULL OR imports.status = 'completed')
    AND (${NAME_KEY("categories.name")} IN (${KEYS}) OR ${NAME_KEY("purpose_categories.name")} IN (${KEYS}))
`;

interface Row {
  id: string;
  transaction_date: string;
  entry_type: string;
  transfer_direction: string | null;
  amount_minor: number;
  owner_person_id: string | null;
  category_name: string | null;
  purpose_category_name: string | null;
  transfer_purpose_person_id: string | null;
}

export function readTaxReliefRows(rows: Row[]): TaxReliefRow[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.transaction_date,
    entryType: row.entry_type,
    transferDirection: row.transfer_direction,
    amountMinor: row.amount_minor,
    ownerPersonId: row.owner_person_id,
    categoryName: row.category_name,
    purposeCategoryName: row.purpose_category_name,
    purposePersonId: row.transfer_purpose_person_id
  }));
}

/** The year's relief facts for every person (the card and the December reminder). */
export async function loadTaxReliefsYear(db: D1Database, today: string) {
  const year = today.slice(0, 4);
  const [people, rows] = await Promise.all([
    db.prepare("SELECT id, display_name FROM people WHERE household_id = ? AND is_active = 1 ORDER BY created_at")
      .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>(),
    db.prepare(TAX_RELIEF_ROWS_SQL).bind(DEFAULT_HOUSEHOLD_ID, `${year}-01-01`, `${year}-12-31`).all<Row>()
  ]);
  const householdPeople = people.results.map((person) => ({ id: person.id, name: person.display_name }));
  return { householdPeople, reliefs: buildTaxReliefsYear({ today, people: householdPeople, rows: readTaxReliefRows(rows.results) }) };
}

export async function buildTaxReliefsDto(db: D1Database, selectedViewId = "household", today = todayInAppTimeZone()): Promise<TaxReliefsDto> {
  const { householdPeople, reliefs } = await loadTaxReliefsYear(db, today);
  const viewId = resolvePageViewId(selectedViewId, householdPeople);
  const inView = { ...reliefs, people: viewId === "household" ? reliefs.people : reliefs.people.filter((person) => person.personId === viewId) };
  return hasTaxReliefs(inView) ? { viewId, today, ...inView } : { viewId, today, people: [] };
}
