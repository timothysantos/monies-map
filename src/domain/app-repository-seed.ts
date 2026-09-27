// Demo and empty-state seeding (H15a): reseeding the demo household, seeding
// the empty state, clearing demo data, and the idempotent backfills that keep
// an already seeded demo database aligned with the current demo fixtures.

import { ensureDemoSchema } from "./app-repository-schema";
import { recalculateMonthlySnapshots } from "./app-repository-snapshots";
import {
  accounts as demoAccounts,
  buildMonthIncomeRows,
  buildSummaryMonthsByView,
  categories as defaultCategories,
  demoMonths,
  household as defaultHousehold,
  importBatches as demoImportBatches,
  monthEntries as demoMonthEntries,
  monthPlanRows as demoMonthPlanRows,
  type DemoSettings
} from "./demo-data";
import { buildPlanDate, inferMonthKeyFromPlanRow, mapAccountKind, shiftPlanDate, slugify } from "./app-repository-helpers";
import { getCurrentMonthKey } from "../lib/month";
import { ensureDefaultCategoryMatchRules } from "./app-repository-category-match-rules";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { isShowcaseSeeded, reseedShowcaseData } from "./app-repository-showcase-seed";

const demoPeople = defaultHousehold.people;

const SEED_PERSON_IDS_BY_NAME = new Map(demoPeople.map((person) => [person.name, person.id]));

const DEMO_PRIMARY_PERSON_ID = demoPeople[0]?.id ?? "demo-primary";

const DEMO_PARTNER_PERSON_ID = demoPeople[1]?.id ?? "demo-partner";

const EMPTY_PRIMARY_PERSON_ID = "person-primary";

const EMPTY_PARTNER_PERSON_ID = "person-partner";

function findSeedAccountId(accountName?: string) {
  if (!accountName) {
    return null;
  }

  return demoAccounts.find((account) => account.name === accountName)?.id ?? null;
}

function findSeedAccountOwnerId(accountName?: string) {
  if (!accountName) {
    return null;
  }

  const account = demoAccounts.find((item) => item.name === accountName);
  if (!account || account.isJoint || !account.ownerLabel) {
    return null;
  }

  return SEED_PERSON_IDS_BY_NAME.get(account.ownerLabel) ?? null;
}

function findSeedCategoryId(categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  return defaultCategories.find((category) => category.name === categoryName)?.id ?? null;
}

const SHARED_ACCOUNT_INSTITUTION = "DBS";

const EMPTY_STATE_PEOPLE = [
  { id: EMPTY_PRIMARY_PERSON_ID, name: "Primary", role: "owner" },
  { id: EMPTY_PARTNER_PERSON_ID, name: "Partner", role: "partner" }
];

const OLD_SHOPPING_COLOR_HEX = "#D4B35D";

const SHOPPING_COLOR_HEX = "#D86B73";

function resolveSeededDemoTransactionDate(entryId: string, date: string, seedMonth?: string) {
  if (!entryId.startsWith("txn-oct-")) {
    return date;
  }

  const currentMonthKey = seedMonth ?? getCurrentMonthKey();
  const [year, month] = currentMonthKey.split("-").map(Number);
  return shiftPlanDate(date, year, month) ?? date;
}

export async function ensureSeedData(db: D1Database, settings: DemoSettings) {
  await ensureDemoSchema(db);
  // A showcase database never gets the default seed's backfill below (it
  // would insert default-seed rows); it is reseeded only if its own rows
  // are gone.
  if (settings.dataset === "showcase") {
    if (!(await isShowcaseSeeded(db))) {
      await reseedShowcaseData(db);
    }
    return;
  }
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM households WHERE id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const categoryCount = await db
    .prepare("SELECT COUNT(*) as count FROM categories WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const snapshotCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_snapshots WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const incomeRowCount = await db
    .prepare("SELECT COUNT(*) as count FROM monthly_plan_rows WHERE household_id = ? AND section_key = 'income'")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ count: number }>();

  const alreadySeeded =
    (existing?.count ?? 0) > 0 &&
    (categoryCount?.count ?? 0) > 0 &&
    (snapshotCount?.count ?? 0) > 0 &&
    (incomeRowCount?.count ?? 0) > 0;

  if (alreadySeeded) {
    await ensureDefaultCategoryPalette(db);
    await ensureDefaultCategoryMatchRules(db);
  } else {
    await reseedDemoData(db, settings);
  }

  const demoBackfillChanged = await backfillDemoPlannedItemSeedData(db);
  if (demoBackfillChanged) {
    for (const month of demoMonths) {
      await recalculateMonthlySnapshots(db, month);
    }
  }
}

export async function reseedDemoData(db: D1Database, settings: DemoSettings, seedMonth?: string) {
  await ensureDemoSchema(db);
  await clearDemoData(db);
  await seedDemoData(db, settings, seedMonth);
}

export async function seedEmptyStateReferenceData(db: D1Database) {
  await ensureDemoSchema(db);

  await db
    .prepare(`
      INSERT INTO households (id, name, base_currency)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    .bind(defaultHousehold.id, defaultHousehold.name, defaultHousehold.baseCurrency)
    .run();

  const existingPeople = await loadSeedPeople(db);
  if (existingPeople.length) {
    await repairAccidentalEmptyStatePeople(db, existingPeople);
  } else {
    for (const person of EMPTY_STATE_PEOPLE) {
      await db
        .prepare(`
          INSERT INTO people (id, household_id, display_name, role)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `)
        .bind(person.id, defaultHousehold.id, person.name, person.role)
        .run();
    }
  }

  for (const category of defaultCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `)
      .bind(
        category.id,
        defaultHousehold.id,
        category.name,
        category.slug,
        category.slug,
        category.iconKey,
        category.colorHex,
        category.sortOrder,
        category.isSystem ? 1 : 0
      )
      .run();
  }

  await ensureDefaultCategoryMatchRules(db);
  await ensureDefaultCategoryPalette(db);
}

async function ensureDefaultCategoryPalette(db: D1Database) {
  await db
    .prepare(`
      UPDATE categories
      SET color_hex = CASE
        WHEN id = 'cat-shopping' THEN ?
        WHEN id = 'cat-healthcare' THEN ?
        ELSE color_hex
      END
      WHERE household_id = ?
        AND (
          (id = 'cat-shopping' AND color_hex = ?)
          OR (id = 'cat-healthcare' AND color_hex = ?)
        )
    `)
    .bind(
      SHOPPING_COLOR_HEX,
      OLD_SHOPPING_COLOR_HEX,
      DEFAULT_HOUSEHOLD_ID,
      OLD_SHOPPING_COLOR_HEX,
      SHOPPING_COLOR_HEX
    )
    .run();
}

async function loadSeedPeople(db: D1Database) {
  const people = await db
    .prepare(`
      SELECT id, display_name
      FROM people
      WHERE household_id = ?
      ORDER BY created_at
    `)
    .bind(defaultHousehold.id)
    .all<{ id: string; display_name: string }>();

  return people.results;
}

async function repairAccidentalEmptyStatePeople(
  db: D1Database,
  existingPeople: { id: string; display_name: string }[]
) {
  const accidentalIds = new Set(EMPTY_STATE_PEOPLE.map((person) => person.id));
  const canonicalPeople = existingPeople.filter((person) => !accidentalIds.has(person.id));
  const accidentalPeople = existingPeople.filter((person) => accidentalIds.has(person.id));

  if (canonicalPeople.length < 2 || !accidentalPeople.length) {
    return;
  }

  const replacements = new Map([
    [EMPTY_PRIMARY_PERSON_ID, canonicalPeople[0].id],
    [EMPTY_PARTNER_PERSON_ID, canonicalPeople[1].id]
  ]);

  for (const accidentalPerson of accidentalPeople) {
    const replacementPersonId = replacements.get(accidentalPerson.id);
    if (!replacementPersonId) {
      continue;
    }

    await reassignPersonReferences(db, accidentalPerson.id, replacementPersonId);
    await db
      .prepare("DELETE FROM people WHERE household_id = ? AND id = ?")
      .bind(defaultHousehold.id, accidentalPerson.id)
      .run();
  }
}

async function reassignPersonReferences(db: D1Database, fromPersonId: string, toPersonId: string) {
  await db.prepare("UPDATE accounts SET owner_person_id = ? WHERE household_id = ? AND owner_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE imports SET imported_by_person_id = ? WHERE household_id = ? AND imported_by_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE transactions SET owner_person_id = ? WHERE household_id = ? AND owner_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_expenses SET payer_person_id = ? WHERE household_id = ? AND payer_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_settlements SET from_person_id = ? WHERE household_id = ? AND from_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE split_settlements SET to_person_id = ? WHERE household_id = ? AND to_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_notes SET created_by_person_id = ? WHERE household_id = ? AND created_by_person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_budgets SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_plan_rows SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db.prepare("UPDATE monthly_plan_match_hints SET person_id = ? WHERE household_id = ? AND person_id = ?").bind(toPersonId, defaultHousehold.id, fromPersonId).run();
  await db
    .prepare(`
      UPDATE split_expense_shares
      SET person_id = ?
      WHERE person_id = ?
        AND split_expense_id IN (
          SELECT id FROM split_expenses WHERE household_id = ?
        )
    `)
    .bind(toPersonId, fromPersonId, defaultHousehold.id)
    .run();
  await db
    .prepare(`
      UPDATE monthly_plan_row_splits
      SET person_id = ?
      WHERE person_id = ?
        AND monthly_plan_row_id IN (
          SELECT id FROM monthly_plan_rows WHERE household_id = ?
        )
    `)
    .bind(toPersonId, fromPersonId, defaultHousehold.id)
    .run();
}

export async function clearDemoData(db: D1Database) {
  await db.prepare("PRAGMA defer_foreign_keys = ON").run();
  const deletions = [
    "DELETE FROM split_activity_history",
    "DELETE FROM split_settlement_checkpoint_items",
    "DELETE FROM split_settlement_checkpoint_matches",
    "DELETE FROM split_settlement_checkpoints",
    "DELETE FROM split_expense_shares",
    "DELETE FROM split_expenses",
    "DELETE FROM split_settlements",
    "DELETE FROM split_batches",
    "DELETE FROM split_groups",
    "DELETE FROM monthly_plan_entry_links",
    "DELETE FROM monthly_plan_match_hints",
    "DELETE FROM transactions",
    "DELETE FROM monthly_plan_row_splits",
    "DELETE FROM monthly_plan_rows",
    "DELETE FROM monthly_budgets",
    "DELETE FROM monthly_notes",
    "DELETE FROM monthly_snapshots",
    "DELETE FROM monthly_snapshot_refreshes",
    "DELETE FROM statement_reconciliation_certificates",
    "DELETE FROM statement_chain_breaks",
    "DELETE FROM import_rows",
    "DELETE FROM imports",
    "DELETE FROM account_balance_checkpoints",
    "DELETE FROM app_error_diagnostics",
    "DELETE FROM audit_events",
    "DELETE FROM category_match_rule_issue_ignores",
    "DELETE FROM category_match_rule_suggestions",
    "DELETE FROM category_match_rules",
    "DELETE FROM login_identities",
    "DELETE FROM transfer_groups",
    "DELETE FROM categories",
    "DELETE FROM accounts",
    "DELETE FROM institutions",
    "DELETE FROM people",
    "DELETE FROM households"
  ];

  for (const statement of deletions) {
    await db.prepare(statement).run();
  }
  await db.prepare("PRAGMA defer_foreign_keys = OFF").run();
}

async function seedDemoData(db: D1Database, settings: DemoSettings, seedMonth?: string) {
  await db
    .prepare("INSERT INTO households (id, name, base_currency) VALUES (?, ?, ?)")
    .bind(defaultHousehold.id, defaultHousehold.name, defaultHousehold.baseCurrency)
    .run();

  for (const person of defaultHousehold.people) {
    await db
      .prepare("INSERT INTO people (id, household_id, display_name, role) VALUES (?, ?, ?, ?)")
      .bind(person.id, defaultHousehold.id, person.name, person.id === DEMO_PRIMARY_PERSON_ID ? "owner" : "partner")
      .run();
  }

  const institutionNames = Array.from(new Set([
    ...demoAccounts.map((account) => account.institution),
    SHARED_ACCOUNT_INSTITUTION
  ]));
  const institutionIds = new Map<string, string>();

  for (const name of institutionNames) {
    const id = `inst-${slugify(name)}`;
    institutionIds.set(name, id);
    await db
      .prepare("INSERT INTO institutions (id, household_id, name) VALUES (?, ?, ?)")
      .bind(id, defaultHousehold.id, name)
      .run();
  }

  for (const account of demoAccounts) {
    const ownerPersonId = SEED_PERSON_IDS_BY_NAME.get(account.ownerLabel) ?? null;
    await db
      .prepare(`
        INSERT INTO accounts (
          id, household_id, institution_id, owner_person_id,
          account_name, account_kind, currency, is_joint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        account.id,
        defaultHousehold.id,
        institutionIds.get(account.institution),
        ownerPersonId,
        account.name,
        mapAccountKind(account.kind),
        account.currency,
        account.isJoint ? 1 : 0
      )
      .run();
  }

  for (const category of defaultCategories) {
    await db
      .prepare(`
        INSERT INTO categories (
          id, household_id, name, slug, reporting_group,
          icon_key, color_hex, sort_order, is_system
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        category.id,
        defaultHousehold.id,
        category.name,
        category.slug,
        category.slug,
        category.iconKey,
        category.colorHex,
        category.sortOrder,
        category.isSystem ? 1 : 0
      )
      .run();
  }

  await ensureDefaultCategoryMatchRules(db);

  for (const item of demoImportBatches) {
    await db
      .prepare(`
        INSERT INTO imports (
          id, household_id, source_type, source_label, imported_at, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        item.id,
        defaultHousehold.id,
        item.sourceType,
        item.sourceLabel,
        item.importedAt,
        item.status,
        item.note ?? null
      )
      .run();
  }

  const transferGroupIdByTransactionId = new Map<string, string>();
  const transferEntries = demoMonthEntries.filter((entry) => entry.entryType === "transfer" && entry.linkedTransfer);
  if (transferEntries.length > 0) {
    const seen = new Set<string>();
    for (const entry of transferEntries) {
      const linkedId = entry.linkedTransfer?.transactionId;
      if (!linkedId || seen.has(entry.id) || seen.has(linkedId)) {
        continue;
      }

      const groupId = `tg-${entry.id}-${linkedId}`;
      transferGroupIdByTransactionId.set(entry.id, groupId);
      transferGroupIdByTransactionId.set(linkedId, groupId);
      seen.add(entry.id);
      seen.add(linkedId);

      await db
        .prepare("INSERT INTO transfer_groups (id, household_id, note, matched_confidence) VALUES (?, ?, ?, ?)")
        .bind(groupId, defaultHousehold.id, "Demo seeded transfer pair", 1)
        .run();
    }
  }

  for (const row of demoMonthPlanRows) {
    const monthKey = inferMonthKeyFromPlanRow(row.id, seedMonth);
    const [planYear, planMonth] = monthKey.split("-").map(Number);
    const planDate = buildPlanDate(monthKey, row.dayLabel);
    await db
      .prepare(`
        INSERT INTO monthly_plan_rows (
          id, household_id, year, month, person_id, ownership_type,
          section_key, category_id, label, plan_date, account_id,
          planned_amount_minor, actual_amount_minor, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        row.id,
        defaultHousehold.id,
        planYear,
        planMonth,
        row.ownerName ? SEED_PERSON_IDS_BY_NAME.get(row.ownerName) ?? null : null,
        row.ownershipType,
        row.section,
        findSeedCategoryId(row.categoryName),
        row.label,
        planDate,
        findSeedAccountId(row.accountName),
        row.plannedMinor,
        row.actualMinor,
        row.note ?? null
      )
      .run();

    for (const split of row.splits) {
      await db
        .prepare(`
          INSERT INTO monthly_plan_row_splits (
            id, monthly_plan_row_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${row.id}-${split.personId}`,
          row.id,
          split.personId,
          split.ratioBasisPoints,
          split.amountMinor
        )
        .run();
    }
  }

  for (const monthKey of demoMonths) {
    const [year, month] = monthKey.split("-").map(Number);
    const seededIncomeRows = [
      ...buildMonthIncomeRows(DEMO_PRIMARY_PERSON_ID, settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-${DEMO_PRIMARY_PERSON_ID}-${row.id}`,
        personId: DEMO_PRIMARY_PERSON_ID
      })),
      ...buildMonthIncomeRows(DEMO_PARTNER_PERSON_ID, settings.salaryPerPersonMinor).map((row) => ({
        ...row,
        id: `seed-${monthKey}-${DEMO_PARTNER_PERSON_ID}-${row.id}`,
        personId: DEMO_PARTNER_PERSON_ID
      }))
    ];

    for (const row of seededIncomeRows) {
      await db
        .prepare(`
          INSERT INTO monthly_plan_rows (
            id, household_id, year, month, person_id, ownership_type,
            section_key, category_id, label, plan_date, account_id,
            planned_amount_minor, actual_amount_minor, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          row.id,
          defaultHousehold.id,
          year,
          month,
          row.personId,
          "direct",
          "income",
          findSeedCategoryId(row.categoryName),
          row.label,
          null,
          null,
          row.plannedMinor,
          row.actualMinor,
          row.note ?? null
        )
        .run();
    }
  }

  const summaryMonthsByView = buildSummaryMonthsByView(settings.salaryPerPersonMinor);
  for (const [personScope, months] of Object.entries(summaryMonthsByView)) {
    for (const month of months) {
      const [year, monthNumber] = month.month.split("-").map(Number);
      await db
        .prepare(`
        INSERT INTO monthly_snapshots (
          id, household_id, year, month, person_scope,
          total_income_minor, estimated_expense_minor, total_expense_minor,
          savings_goal_minor, total_net_minor, total_shared_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          `snapshot-${personScope}-${month.month}`,
          defaultHousehold.id,
          year,
          monthNumber,
          personScope,
          month.plannedIncomeMinor,
          month.estimatedExpensesMinor,
          month.realExpensesMinor,
          month.savingsGoalMinor,
          month.realDiffMinor,
          0,
          month.note
        )
        .run();
    }
  }

  for (const entry of demoMonthEntries) {
    const directOwnerId = entry.ownerName
      ? SEED_PERSON_IDS_BY_NAME.get(entry.ownerName) ?? null
      : findSeedAccountOwnerId(entry.accountName);
    await db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, transfer_group_id, transaction_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, owner_person_id, offsets_category, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        entry.id,
        defaultHousehold.id,
        findSeedAccountId(entry.accountName),
        transferGroupIdByTransactionId.get(entry.id) ?? null,
        resolveSeededDemoTransactionDate(entry.id, entry.date, seedMonth),
        entry.description,
        entry.amountMinor,
        "SGD",
        entry.entryType,
        entry.transferDirection ?? null,
        findSeedCategoryId(entry.categoryName),
        directOwnerId,
        entry.offsetsCategory ? 1 : 0,
        entry.note ?? null
      )
      .run();
  }

  await seedDemoSplitData(db);

  for (const month of demoMonths) {
    await recalculateMonthlySnapshots(db, month);
  }
}

async function backfillDemoPlannedItemSeedData(db: D1Database) {
  let changed = false;

  for (const entry of demoMonthEntries) {
    const existingTransaction = await db
      .prepare("SELECT id, transaction_date FROM transactions WHERE id = ?")
      .bind(entry.id)
      .first<{ id: string; transaction_date: string }>();
    const seededDate = resolveSeededDemoTransactionDate(entry.id, entry.date);
    if (!existingTransaction) {
      const directOwnerId = entry.ownerName
        ? SEED_PERSON_IDS_BY_NAME.get(entry.ownerName) ?? null
        : findSeedAccountOwnerId(entry.accountName);
      await db
        .prepare(`
          INSERT INTO transactions (
            id, household_id, account_id, transfer_group_id, transaction_date,
            description, amount_minor, currency, entry_type, transfer_direction,
            category_id, owner_person_id, offsets_category, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          entry.id,
          defaultHousehold.id,
          findSeedAccountId(entry.accountName),
          null,
          seededDate,
          entry.description,
          entry.amountMinor,
          "SGD",
          entry.entryType,
          entry.transferDirection ?? null,
          findSeedCategoryId(entry.categoryName),
          directOwnerId,
          entry.offsetsCategory ? 1 : 0,
          entry.note ?? null
        )
        .run();

      changed = true;
    } else if (existingTransaction.transaction_date !== seededDate) {
      await db
        .prepare("UPDATE transactions SET transaction_date = ? WHERE id = ?")
        .bind(seededDate, entry.id)
        .run();
      changed = true;
    }
  }

  for (const row of demoMonthPlanRows) {
    for (const entryId of row.linkedEntryIds ?? []) {
      const existingLink = await db
        .prepare(`
          SELECT id
          FROM monthly_plan_entry_links
          WHERE monthly_plan_row_id = ? AND transaction_id = ?
        `)
        .bind(row.id, entryId)
        .first<{ id: string }>();
      if (existingLink) {
        continue;
      }

      const transactionExists = await db
        .prepare("SELECT id FROM transactions WHERE id = ?")
        .bind(entryId)
        .first<{ id: string }>();
      if (!transactionExists) {
        continue;
      }

      await db
        .prepare(`
          INSERT INTO monthly_plan_entry_links (
            id, monthly_plan_row_id, transaction_id
          ) VALUES (?, ?, ?)
        `)
        .bind(`${row.id}-${entryId}`, row.id, entryId)
        .run();

      changed = true;
    }
  }

  return changed;
}

async function seedDemoSplitData(db: D1Database) {
  const groupSeeds = [
    { id: "split-group-baby-river", name: "Baby River", iconKey: "heart-pulse", sortOrder: 1 },
    { id: "split-group-okaeri", name: "Okaeri", iconKey: "house", sortOrder: 2 }
  ];

  for (const group of groupSeeds) {
    await db
      .prepare(`
        INSERT INTO split_groups (
          id, household_id, group_name, icon_key, sort_order
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(group.id, DEFAULT_HOUSEHOLD_ID, group.name, group.iconKey, group.sortOrder)
      .run();
  }

  const batchSeeds = [
    {
      id: "split-batch-okaeri-closed",
      groupId: "split-group-okaeri",
      name: "Okaeri settled batch",
      openedOn: "2025-10-03",
      closedOn: "2025-10-22"
    },
    {
      id: "split-batch-baby-river-open",
      groupId: "split-group-baby-river",
      name: "Baby River current batch",
      openedOn: "2025-10-12",
      closedOn: null
    },
    {
      id: "split-batch-none-open",
      groupId: null,
      name: "Non-group current batch",
      openedOn: "2025-10-06",
      closedOn: null
    }
  ];

  for (const batch of batchSeeds) {
    await db
      .prepare(`
        INSERT INTO split_batches (
          id, household_id, split_group_id, batch_name, opened_on, closed_on
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(batch.id, DEFAULT_HOUSEHOLD_ID, batch.groupId, batch.name, batch.openedOn, batch.closedOn)
      .run();
  }

  const importedTransactionSeeds: Array<{
    id: string;
    importId: string;
    accountName: string;
    date: string;
    description: string;
    categoryName: string;
    entryType: "expense" | "income" | "transfer";
    transferDirection?: "in" | "out";
    ownershipType: "direct" | "shared";
    ownerName?: string;
    amountMinor: number;
    splitBasisPoints?: number;
    note?: string;
  }> = [
    {
      id: "txn-import-split-okaeri-linked",
      importId: "import-2025-10-citi",
      accountName: "Citi Rewards",
      date: "2025-10-03",
      description: "October dining imported from Citi",
      categoryName: "Food & Drinks",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: 71319,
      splitBasisPoints: 5000,
      note: "Imported dining charge already linked to the archived split batch."
    },
    {
      id: "txn-import-split-pantry-match",
      importId: "import-2025-10-citi",
      accountName: "Citi Rewards",
      date: "2025-10-18",
      description: "Pantry restock imported from Citi",
      categoryName: "Groceries",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Joyce",
      amountMinor: 18640,
      note: "Imported card row awaiting a split match."
    },
    {
      id: "txn-import-split-baby-river-linked",
      importId: "import-2025-10-uob",
      accountName: "UOB Lady's",
      date: "2025-10-12",
      description: "Baby River family support import",
      categoryName: "Family & Personal",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: 23407,
      splitBasisPoints: 5000,
      note: "Imported row already linked to the split expense."
    },
    {
      id: "txn-import-split-settlement-match",
      importId: "import-2025-10-uob",
      accountName: "UOB Savings",
      date: "2025-10-18",
      description: "Joyce paynow settle up",
      categoryName: "Transfer",
      entryType: "transfer",
      transferDirection: "in",
      ownershipType: "direct",
      ownerName: "Tim",
      amountMinor: 4580,
      note: "Imported transfer waiting to be linked to a split settlement."
    }
  ];

  for (const transaction of importedTransactionSeeds) {
    const directOwnerId = transaction.ownerName
      ? SEED_PERSON_IDS_BY_NAME.get(transaction.ownerName) ?? null
      : findSeedAccountOwnerId(transaction.accountName);
    await db
      .prepare(`
        INSERT INTO transactions (
          id, household_id, import_id, account_id, transaction_date,
          description, amount_minor, currency, entry_type, transfer_direction,
          category_id, owner_person_id, offsets_category, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        transaction.id,
        DEFAULT_HOUSEHOLD_ID,
        transaction.importId,
        findSeedAccountId(transaction.accountName),
        transaction.date,
        transaction.description,
        transaction.amountMinor,
        "SGD",
        transaction.entryType,
        transaction.transferDirection ?? null,
        findSeedCategoryId(transaction.categoryName),
        directOwnerId,
        0,
        transaction.note ?? null
      )
      .run();
  }

  const expenseSeeds = [
    {
      id: "split-expense-okaeri-dining",
      groupId: "split-group-okaeri",
      batchId: "split-batch-okaeri-closed",
      payerPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-03",
      description: "October dining",
      categoryName: "Food & Drinks",
      totalAmountMinor: 71319,
      note: "Manual split record before CSV was imported.",
      linkedTransactionId: "txn-import-split-okaeri-linked"
    },
    {
      id: "split-expense-baby-river-family",
      groupId: "split-group-baby-river",
      batchId: "split-batch-baby-river-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-12",
      description: "Family support",
      categoryName: "Family & Personal",
      totalAmountMinor: 23407,
      note: "Family spending tracked outside the bank import flow.",
      linkedTransactionId: "txn-import-split-baby-river-linked"
    },
    {
      id: "split-expense-nongroup-groceries",
      groupId: null,
      batchId: "split-batch-none-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-06",
      description: "October groceries",
      categoryName: "Groceries",
      totalAmountMinor: 24251,
      note: "Shared expense tracked without a named group."
    },
    {
      id: "split-expense-nongroup-pantry-match",
      groupId: null,
      batchId: "split-batch-none-open",
      payerPersonId: DEMO_PARTNER_PERSON_ID,
      date: "2025-10-18",
      description: "Pantry restock",
      categoryName: "Groceries",
      totalAmountMinor: 18640,
      note: "Tracked in splits before the imported grocery charge was reviewed."
    }
  ];

  for (const expense of expenseSeeds) {
    await db
      .prepare(`
        INSERT INTO split_expenses (
          id, household_id, split_group_id, split_batch_id, payer_person_id, expense_date,
          description, category_id, total_amount_minor, note, linked_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        expense.id,
        DEFAULT_HOUSEHOLD_ID,
        expense.groupId,
        expense.batchId,
        expense.payerPersonId,
        expense.date,
        expense.description,
        findSeedCategoryId(expense.categoryName),
        expense.totalAmountMinor,
        expense.note,
        expense.linkedTransactionId ?? null
      )
      .run();

    const primaryShare = Math.floor(expense.totalAmountMinor / 2);
    const secondaryShare = expense.totalAmountMinor - primaryShare;
    const shareRows = [
      { personId: DEMO_PRIMARY_PERSON_ID, amountMinor: primaryShare },
      { personId: DEMO_PARTNER_PERSON_ID, amountMinor: secondaryShare }
    ];

    for (const share of shareRows) {
      await db
        .prepare(`
          INSERT INTO split_expense_shares (
            id, split_expense_id, person_id, ratio_basis_points, amount_minor
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `${expense.id}-${share.personId}`,
          expense.id,
          share.personId,
          share.personId === DEMO_PRIMARY_PERSON_ID ? 5000 : 5000,
          share.amountMinor
        )
        .run();
    }
  }

  const settlementSeeds = [
    {
      id: "split-settlement-okaeri",
      groupId: "split-group-okaeri",
      batchId: "split-batch-okaeri-closed",
      fromPersonId: DEMO_PARTNER_PERSON_ID,
      toPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-22",
      amountMinor: 93150,
      note: "Manual settle-up recorded before bank transfer was linked."
    },
    {
      id: "split-settlement-nongroup-transfer-match",
      groupId: null,
      batchId: "split-batch-none-open",
      fromPersonId: DEMO_PARTNER_PERSON_ID,
      toPersonId: DEMO_PRIMARY_PERSON_ID,
      date: "2025-10-18",
      amountMinor: 4580,
      note: "Cash float settle-up waiting for the imported transfer row."
    }
  ];

  for (const settlement of settlementSeeds) {
    await db
      .prepare(`
        INSERT INTO split_settlements (
          id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id,
          settlement_date, amount_minor, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        settlement.id,
        DEFAULT_HOUSEHOLD_ID,
        settlement.groupId,
        settlement.batchId,
        settlement.fromPersonId,
        settlement.toPersonId,
        settlement.date,
        settlement.amountMinor,
        settlement.note
      )
      .run();
  }
}
