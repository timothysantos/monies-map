import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { slugify } from "./app-repository-helpers";
import { recordAuditEvent } from "./app-repository-audit";
import type { CategoryDto } from "../types/dto";

export async function loadCategories(db: D1Database): Promise<CategoryDto[]> {
  const result = await db
    .prepare(`
      SELECT id, name, slug, icon_key, color_hex, sort_order, is_system
      FROM categories
      WHERE household_id = ?
      ORDER BY sort_order, name
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      name: string;
      slug: string;
      icon_key: string;
      color_hex: string;
      sort_order: number;
      is_system: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug ?? slugify(row.name),
    iconKey: row.icon_key,
    colorHex: row.color_hex,
    sortOrder: row.sort_order,
    isSystem: Boolean(row.is_system)
  }));
}

export async function updateCategoryRecord(
  db: D1Database,
  input: {
    categoryId: string;
    name?: string;
    slug?: string;
    iconKey?: string;
    colorHex?: string;
  }
) {
  const existing = await db
    .prepare(`
      SELECT name, slug, icon_key, color_hex
      FROM categories
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
    .first<{ name: string; slug: string; icon_key: string; color_hex: string }>();

  if (!existing) {
    throw new Error(`Unknown category: ${input.categoryId}`);
  }

  const name = input.name?.trim() || existing.name;
  const slug = input.slug?.trim() || slugify(name);
  const iconKey = input.iconKey ?? existing.icon_key;
  const colorHex = input.colorHex ?? existing.color_hex;

  await db
    .prepare(`
      UPDATE categories
      SET name = ?, slug = ?, icon_key = ?, color_hex = ?
      WHERE household_id = ? AND id = ?
    `)
    .bind(name, slug, iconKey, colorHex, DEFAULT_HOUSEHOLD_ID, input.categoryId)
    .run();

  return { categoryId: input.categoryId, updated: true };
}

export async function createCategoryRecord(
  db: D1Database,
  input: {
    name: string;
    slug?: string;
    iconKey?: string;
    colorHex?: string;
  }
) {
  const name = input.name.trim();
  const slug = input.slug?.trim() || slugify(name);
  const iconKey = input.iconKey ?? "receipt";
  const colorHex = input.colorHex ?? "#6A7A73";

  const existing = await db
    .prepare(`
      SELECT id
      FROM categories
      WHERE household_id = ? AND (slug = ? OR lower(name) = lower(?))
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, slug, name)
    .first<{ id: string }>();

  if (existing) {
    throw new Error(`Category already exists: ${name}`);
  }

  const sortOrderResult = await db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order FROM categories WHERE household_id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .first<{ max_sort_order: number }>();

  const categoryId = `cat-${slug}-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(`
      INSERT INTO categories (
        id, household_id, name, slug, reporting_group,
        icon_key, color_hex, sort_order, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    .bind(
      categoryId,
      DEFAULT_HOUSEHOLD_ID,
      name,
      slug,
      slug,
      iconKey,
      colorHex,
      (sortOrderResult?.max_sort_order ?? 0) + 10
    )
    .run();

  await recordAuditEvent(db, {
    entityType: "category",
    entityId: categoryId,
    action: "category_created",
    detail: `Created category ${name}.`
  });

  return { categoryId, created: true };
}

export async function deleteCategoryRecord(
  db: D1Database,
  input: {
    categoryId: string;
  }
) {
  const existing = await db
    .prepare(`
      SELECT id, name
      FROM categories
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
    .first<{ id: string; name: string }>();

  if (!existing) {
    throw new Error(`Unknown category: ${input.categoryId}`);
  }

  const references = await Promise.all([
    db.prepare("SELECT id FROM transactions WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>(),
    db.prepare("SELECT id FROM monthly_plan_rows WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>(),
    db.prepare("SELECT id FROM monthly_budgets WHERE household_id = ? AND category_id = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
      .first<{ id: string }>()
  ]);

  if (references.some(Boolean)) {
    throw new Error(`Category is in use and cannot be deleted: ${existing.name}`);
  }

  await db
    .prepare("DELETE FROM categories WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
    .run();

  await recordAuditEvent(db, {
    entityType: "category",
    entityId: existing.id,
    action: "category_deleted",
    detail: `Deleted category ${existing.name}.`
  });

  return { categoryId: existing.id, deleted: true };
}
