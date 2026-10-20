// Reads for the settled part of the Splits page (docs/flows/splits-flow.md,
// "Settled sections load on demand"). The page sends the records outside
// settled sections; for the records a settlement checkpoint covers it sends
// one summary per settlement and group, and, for a group with such records,
// the whole-group facts its Just for fun lines read. Both are counted here in
// SQL, grouped and bounded, so no settled row travels with the page. The
// rows themselves load when a section is opened or a search looks inside it
// (pages/splits-settled.ts).
//
// "In a settled section" is the open period's rule
// (partitionActivityBySettlement, split-open-period.ts): an active
// checkpoint (not reopened or voided) covers the record and its batch is not
// closed. Records are filtered to the view as the page filters them: a
// person sees an expense with a share for them and a settle-up they paid or
// received.
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { paymentMethodForLinkedAccount } from "./app-repository-splits";
import { normalizeSplitCurrency } from "./split-currency";
import { compareSettledSections, isSettlementPaid, type SettledSectionSummary } from "./split-open-period";
import type { SplitFactsPick, SplitGroupFacets } from "./split-group-facts";
import type { SplitSettlementCheckpointDto } from "../types/dto";

const ACTIVE_COVERING = `
  SELECT checkpoint_items.checkpoint_id, checkpoint_items.record_kind, checkpoint_items.record_id
  FROM split_settlement_checkpoint_items AS checkpoint_items
  INNER JOIN split_settlement_checkpoints AS covering ON covering.id = checkpoint_items.checkpoint_id
  WHERE covering.household_id = ? AND covering.status NOT IN ('reopened', 'voided')`;

export interface SettledSectionGroup {
  id: string;
  name: string;
  currency: string;
}

/**
 * One summary per settlement and group for the view: what the collapsed
 * section's heading and the archive row read (count, spend, date, paid).
 */
export async function loadSettledSectionSummaries(db: D1Database, viewId: string) {
  const rows = await db.prepare(`
    WITH covered AS (${ACTIVE_COVERING})
    SELECT covered.checkpoint_id, COALESCE(split_expenses.split_group_id, 'split-group-none') AS group_id,
      COALESCE(MAX(split_groups.group_name), 'Non-group expenses') AS group_name,
      COUNT(*) AS entry_count, SUM(split_expenses.total_amount_minor) AS spend_minor,
      MAX(split_expenses.expense_date) AS latest_date, MAX(split_expenses.currency) AS currency
    FROM covered
    INNER JOIN split_expenses ON split_expenses.id = covered.record_id AND covered.record_kind = 'expense'
    LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
    LEFT JOIN split_groups ON split_groups.id = split_expenses.split_group_id
    WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL AND split_batches.closed_on IS NULL
      AND (? = 'household' OR split_expenses.id IN (SELECT split_expense_id FROM split_expense_shares WHERE person_id = ?))
    GROUP BY covered.checkpoint_id, COALESCE(split_expenses.split_group_id, 'split-group-none')
    UNION ALL
    SELECT covered.checkpoint_id, COALESCE(split_settlements.split_group_id, 'split-group-none') AS group_id,
      COALESCE(MAX(split_groups.group_name), 'Non-group expenses') AS group_name,
      COUNT(*) AS entry_count, 0 AS spend_minor,
      MAX(split_settlements.settlement_date) AS latest_date, MAX(split_settlements.currency) AS currency
    FROM covered
    INNER JOIN split_settlements ON split_settlements.id = covered.record_id AND covered.record_kind = 'settlement'
    LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
    LEFT JOIN split_groups ON split_groups.id = split_settlements.split_group_id
    WHERE split_settlements.household_id = ? AND split_settlements.deleted_at IS NULL AND split_batches.closed_on IS NULL
      AND (? = 'household' OR split_settlements.from_person_id = ? OR split_settlements.to_person_id = ?)
    GROUP BY covered.checkpoint_id, COALESCE(split_settlements.split_group_id, 'split-group-none')
  `).bind(
    DEFAULT_HOUSEHOLD_ID,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId, viewId
  ).all<SettledSectionRow>();
  return rows.results;
}

type SettledSectionRow = { checkpoint_id: string; group_id: string; group_name: string; entry_count: number; spend_minor: number; latest_date: string; currency: string | null };

/** The summaries' dates and paid state come from the checkpoints. */
export function summariseSettledSections(
  rows: SettledSectionRow[],
  checkpoints: Array<Pick<SplitSettlementCheckpointDto, "id" | "settlementDate" | "status" | "settledAt">>
): { sections: SettledSectionSummary[]; groups: SettledSectionGroup[] } {
  const byKey = new Map<string, SettledSectionSummary & { latestDate: string; groupName: string }>();
  for (const row of rows) {
    const key = `${row.checkpoint_id}|${row.group_id}`;
    const current = byKey.get(key);
    const currency = normalizeSplitCurrency(row.currency);
    if (!current) {
      byKey.set(key, {
        checkpointId: row.checkpoint_id,
        groupId: row.group_id,
        groupName: row.group_name,
        settlementDate: "",
        isPaid: true,
        entryCount: row.entry_count,
        spendMinor: row.spend_minor,
        currency,
        latestDate: row.latest_date
      });
      continue;
    }
    current.entryCount += row.entry_count;
    current.spendMinor += row.spend_minor;
    // The section's currency is its newest record's (the first in its list).
    if (row.latest_date > current.latestDate) {
      current.latestDate = row.latest_date;
      current.currency = currency;
    }
  }
  const groups = new Map<string, SettledSectionGroup>();
  const sections = [...byKey.values()].map(({ latestDate, groupName, ...section }) => {
    const checkpoint = checkpoints.find((candidate) => candidate.id === section.checkpointId);
    if (!groups.has(section.groupId)) {
      groups.set(section.groupId, { id: section.groupId, name: groupName, currency: section.currency });
    }
    return { ...section, settlementDate: checkpoint?.settlementDate ?? latestDate, isPaid: isSettlementPaid(checkpoint) };
  });
  sections.sort(compareSettledSections);
  return { sections, groups: [...groups.values()] };
}

type FacetRow = {
  facet: string;
  group_id: string;
  k: string | null;
  cur: string | null;
  n: number | null;
  amount: number | null;
  d: string | null;
  rn: number | null;
};

/**
 * The whole-group facets (split-group-facts.ts), every record settled or
 * not, of each group that has a settled section for the view, counted in one
 * grouped statement (none when nothing is settled). The order of a record
 * (`rn`) is its place in the page's activity list (newest date first, then
 * id), which breaks ties as the page's stable sorts did.
 */
export async function loadSplitGroupFacets(db: D1Database, viewId: string): Promise<Map<string, SplitGroupFacets>> {
  const facetsByGroup = new Map<string, SplitGroupFacets>();
  // D1 allows only a few terms in one compound SELECT, so the facets go in
  // three statements sent as one batch (one round trip).
  const facetCte = `
    WITH covered AS (${ACTIVE_COVERING}),
    settled_groups AS (
      SELECT COALESCE(split_expenses.split_group_id, 'split-group-none') AS group_id
      FROM covered
      INNER JOIN split_expenses ON split_expenses.id = covered.record_id AND covered.record_kind = 'expense'
      LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
      WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL AND split_batches.closed_on IS NULL
        AND (? = 'household' OR split_expenses.id IN (SELECT split_expense_id FROM split_expense_shares WHERE person_id = ?))
      UNION
      SELECT COALESCE(split_settlements.split_group_id, 'split-group-none') AS group_id
      FROM covered
      INNER JOIN split_settlements ON split_settlements.id = covered.record_id AND covered.record_kind = 'settlement'
      LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
      WHERE split_settlements.household_id = ? AND split_settlements.deleted_at IS NULL AND split_batches.closed_on IS NULL
        AND (? = 'household' OR split_settlements.from_person_id = ? OR split_settlements.to_person_id = ?)
    ),
    e AS (
      SELECT split_expenses.id, COALESCE(split_expenses.split_group_id, 'split-group-none') AS group_id,
        split_expenses.expense_date AS d, split_expenses.description AS description,
        split_expenses.total_amount_minor AS amount, split_expenses.currency AS cur,
        COALESCE(categories.name, 'Other') AS category, split_expenses.payment_method AS method,
        linked_accounts.account_kind AS account_kind, payer.display_name AS payer,
        CASE WHEN split_batches.closed_on IS NOT NULL
          OR split_expenses.id IN (SELECT record_id FROM covered WHERE record_kind = 'expense') THEN 1 ELSE 0 END AS is_covered,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(split_expenses.split_group_id, 'split-group-none')
          ORDER BY split_expenses.expense_date DESC, split_expenses.id DESC
        ) AS rn
      FROM split_expenses
      INNER JOIN people AS payer ON payer.id = split_expenses.payer_person_id
      LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
      LEFT JOIN categories ON categories.id = split_expenses.category_id
      LEFT JOIN transactions ON transactions.id = split_expenses.linked_transaction_id
      LEFT JOIN accounts AS linked_accounts ON linked_accounts.id = transactions.account_id
      WHERE split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL
        AND COALESCE(split_expenses.split_group_id, 'split-group-none') IN (SELECT group_id FROM settled_groups)
        AND (? = 'household' OR split_expenses.id IN (SELECT split_expense_id FROM split_expense_shares WHERE person_id = ?))
    ),
    p AS (SELECT * FROM e WHERE amount > 0),
    s AS (
      SELECT COALESCE(split_settlements.split_group_id, 'split-group-none') AS group_id,
        split_settlements.settlement_date AS d, split_settlements.amount_minor AS amount, split_settlements.currency AS cur,
        CASE WHEN split_batches.closed_on IS NOT NULL
          OR split_settlements.id IN (SELECT record_id FROM covered WHERE record_kind = 'settlement') THEN 1 ELSE 0 END AS is_covered
      FROM split_settlements
      LEFT JOIN split_batches ON split_batches.id = split_settlements.split_batch_id
      WHERE split_settlements.household_id = ? AND split_settlements.deleted_at IS NULL
        AND COALESCE(split_settlements.split_group_id, 'split-group-none') IN (SELECT group_id FROM settled_groups)
        AND (? = 'household' OR split_settlements.from_person_id = ? OR split_settlements.to_person_id = ?)
    )
  `;
  const facetBinds = [
    DEFAULT_HOUSEHOLD_ID,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId, viewId,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId,
    DEFAULT_HOUSEHOLD_ID, viewId, viewId, viewId
  ];
  const facetSelects = [
    `
    SELECT 'date' AS facet, group_id, d AS k, cur, COUNT(*) AS n, SUM(amount) AS amount, NULL AS d, NULL AS rn FROM p GROUP BY group_id, d, cur
    UNION ALL
    SELECT 'desc', group_id, description, cur, n, amount, d, rn FROM (
      SELECT group_id, description, cur, amount, d, rn,
        COUNT(*) OVER (PARTITION BY group_id, description, cur) AS n,
        ROW_NUMBER() OVER (PARTITION BY group_id, description, cur ORDER BY amount ASC, d ASC, rn ASC) AS pick
      FROM p
    ) WHERE pick = 1
    UNION ALL
    SELECT 'cat', group_id, category, cur, COUNT(*), SUM(amount), NULL, NULL FROM p GROUP BY group_id, category, cur
    UNION ALL
    SELECT 'method', group_id, COALESCE(method, 'cash'), account_kind, COUNT(*), NULL, NULL, NULL FROM p GROUP BY group_id, method, account_kind
    `,
    `
    SELECT 'payer' AS facet, group_id, payer AS k, cur, COUNT(*) AS n, SUM(amount) AS amount, NULL AS d, NULL AS rn FROM p GROUP BY group_id, payer, cur
    UNION ALL
    SELECT 'priciest', group_id, description, cur, NULL, amount, d, rn FROM (
      SELECT group_id, description, cur, amount, d, rn,
        ROW_NUMBER() OVER (PARTITION BY group_id, cur ORDER BY amount DESC, d ASC, rn ASC) AS pick
      FROM p
    ) WHERE pick = 1
    UNION ALL
    SELECT 'latest', group_id, description, cur, NULL, amount, d, rn FROM (
      SELECT group_id, description, cur, amount, d, rn,
        ROW_NUMBER() OVER (PARTITION BY group_id, cur ORDER BY d DESC, rn DESC) AS pick
      FROM p
    ) WHERE pick <= 2
    UNION ALL
    SELECT 'first', group_id, description, cur, NULL, amount, d, rn FROM (
      SELECT group_id, description, cur, amount, d, rn,
        ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY d ASC, rn ASC) AS pick
      FROM p
    ) WHERE pick = 1
    `,
    `
    SELECT 'first-any' AS facet, group_id, NULL AS k, NULL AS cur, COUNT(*) AS n, NULL AS amount, MIN(d) AS d, NULL AS rn FROM e GROUP BY group_id
    UNION ALL
    SELECT 'covered', group_id, NULL, NULL, SUM(is_covered), NULL, NULL, NULL
      FROM (SELECT group_id, is_covered FROM e UNION ALL SELECT group_id, is_covered FROM s) GROUP BY group_id
    UNION ALL
    SELECT 'settle', group_id, NULL, cur, COUNT(*), MAX(amount), d, NULL FROM s WHERE amount > 0 GROUP BY group_id, d, cur
    `,
  ];
  const results = await db.batch<FacetRow>(facetSelects.map((select) => db.prepare(`${facetCte}${select}`).bind(...facetBinds)));
  const rows = { results: results.flatMap((result) => result.results ?? []) };

  const facetsOf = (groupId: string) => {
    let facets = facetsByGroup.get(groupId);
    if (!facets) {
      facets = { coveredCount: 0, dates: [], descriptions: [], categories: [], methods: [], payers: [], priciest: [], latest: [], settlements: [] };
      facetsByGroup.set(groupId, facets);
    }
    return facets;
  };
  const pickOf = (row: FacetRow): SplitFactsPick => ({
    description: row.k ?? "",
    amountMinor: row.amount ?? 0,
    date: row.d ?? "",
    currency: normalizeSplitCurrency(row.cur),
    order: row.rn ?? 0
  });
  for (const row of rows.results) {
    const facets = facetsOf(row.group_id);
    const currency = normalizeSplitCurrency(row.cur);
    const count = row.n ?? 0;
    switch (row.facet) {
      case "date":
        facets.dates.push({ date: row.k ?? "", currency, count, sumMinor: row.amount ?? 0 });
        break;
      case "desc":
        facets.descriptions.push({ description: row.k ?? "", currency, count, smallest: pickOf(row) });
        break;
      case "cat":
        facets.categories.push({ name: row.k ?? "", currency, sumMinor: row.amount ?? 0 });
        break;
      case "method": {
        // `cur` carries the linked account's kind here: a linked card or bank
        // row decides how the expense was paid (as the page's rows read it).
        const method = paymentMethodForLinkedAccount(row.cur as Parameters<typeof paymentMethodForLinkedAccount>[0], (row.k ?? "cash") as Parameters<typeof paymentMethodForLinkedAccount>[1]);
        facets.methods.push({ method, count });
        break;
      }
      case "payer":
        facets.payers.push({ name: row.k ?? "", currency, count, sumMinor: row.amount ?? 0 });
        break;
      case "priciest":
        facets.priciest.push(pickOf(row));
        break;
      case "latest":
        facets.latest.push(pickOf(row));
        break;
      case "first":
        facets.first = pickOf(row);
        break;
      case "first-any":
        facets.firstExpenseDate = row.d ?? undefined;
        break;
      case "covered":
        facets.coveredCount = count;
        break;
      case "settle":
        facets.settlements.push({ date: row.d ?? "", currency, count, maxMinor: row.amount ?? 0 });
        break;
      default:
        break;
    }
  }
  return facetsByGroup;
}

/**
 * Which settlement checkpoint covers each record (active checkpoints only):
 * the lazy rows and the settled search mark their records with it, as the
 * page did.
 */
export async function loadActiveCheckpointMembership(db: D1Database) {
  const rows = await db.prepare(`
    SELECT covering.id, covering.status, covering.settlement_date, checkpoint_items.record_id
    FROM split_settlement_checkpoint_items AS checkpoint_items
    INNER JOIN split_settlement_checkpoints AS covering ON covering.id = checkpoint_items.checkpoint_id
    WHERE covering.household_id = ? AND covering.status NOT IN ('reopened', 'voided')
    ORDER BY covering.settlement_date DESC, covering.created_at DESC
  `).bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; status: SplitSettlementCheckpointDto["status"]; settlement_date: string; record_id: string }>();
  const checkpoints = new Map<string, Pick<SplitSettlementCheckpointDto, "id" | "status" | "settlementDate"> & { includedRecordIds: string[] }>();
  for (const row of rows.results) {
    const checkpoint = checkpoints.get(row.id) ?? { id: row.id, status: row.status, settlementDate: row.settlement_date, includedRecordIds: [] };
    checkpoint.includedRecordIds.push(row.record_id);
    checkpoints.set(row.id, checkpoint);
  }
  return [...checkpoints.values()];
}

/** The settlement and group of a split expense in a settled section, if any. */
export async function findSettledSectionOfExpense(db: D1Database, splitExpenseId: string) {
  return db.prepare(`
    WITH covered AS (${ACTIVE_COVERING})
    SELECT covered.checkpoint_id AS checkpoint_id, COALESCE(split_expenses.split_group_id, 'split-group-none') AS group_id
    FROM covered
    INNER JOIN split_expenses ON split_expenses.id = covered.record_id AND covered.record_kind = 'expense'
    LEFT JOIN split_batches ON split_batches.id = split_expenses.split_batch_id
    WHERE split_expenses.id = ? AND split_expenses.household_id = ? AND split_expenses.deleted_at IS NULL AND split_batches.closed_on IS NULL
    LIMIT 1
  `).bind(DEFAULT_HOUSEHOLD_ID, splitExpenseId, DEFAULT_HOUSEHOLD_ID).first<{ checkpoint_id: string; group_id: string }>();
}
