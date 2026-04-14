import { household as demoHousehold } from "./demo-data";

const DEMO_HOUSEHOLD_ID = demoHousehold.id;

export async function resolveAccountId(db: D1Database, accountName?: string) {
  if (!accountName) {
    return null;
  }

  const account = await db
    .prepare("SELECT id FROM accounts WHERE household_id = ? AND account_name = ?")
    .bind(DEMO_HOUSEHOLD_ID, accountName)
    .first<{ id: string }>();

  if (!account) {
    throw new Error(`Unknown account: ${accountName}`);
  }

  return account.id;
}

export async function resolveCategoryId(db: D1Database, categoryName?: string) {
  if (!categoryName) {
    return null;
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEMO_HOUSEHOLD_ID, categoryName)
    .first<{ id: string }>();

  if (!category) {
    throw new Error(`Unknown category: ${categoryName}`);
  }

  return category.id;
}

export async function resolvePersonId(db: D1Database, personName?: string) {
  if (!personName) {
    throw new Error("Missing owner name");
  }

  const person = await db
    .prepare("SELECT id FROM people WHERE household_id = ? AND display_name = ?")
    .bind(DEMO_HOUSEHOLD_ID, personName)
    .first<{ id: string }>();

  if (!person) {
    throw new Error(`Unknown owner: ${personName}`);
  }

  return person.id;
}
