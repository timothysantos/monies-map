// Read-only reference data the entry draft parser needs (entry-draft.ts):
// accounts without balances, people in household order, category names,
// category rules, the Shortcut's account settings and the payment ways. It
// writes nothing (the settings loaders only create their table if it is
// missing, as on every Shortcut request), and the Shortcut API key it reads
// is never passed on.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { loadCategoryMatchRules } from "./app-repository-category-match-rules";
import { loadPaymentWays } from "./app-repository-payment-ways";
import { loadShortcutAccountReferences, loadShortcutSettings } from "./app-repository-shortcuts";
import type { EntryDraftContext } from "./entry-draft";

export async function loadEntryDraftContext(
  db: D1Database,
  input: { today: string; viewId?: string }
): Promise<EntryDraftContext> {
  const accounts = await loadShortcutAccountReferences(db);
  const settings = await loadShortcutSettings(db, accounts);
  const categoryMatchRules = await loadCategoryMatchRules(db);
  const people = await db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>();
  const categories = await db
    .prepare("SELECT name FROM categories WHERE household_id = ? ORDER BY sort_order, name")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ name: string }>();

  const householdPeople = people.results.map((person) => ({ id: person.id, name: person.display_name }));
  const paymentWays = await loadPaymentWays(db, {
    accounts,
    people: householdPeople,
    priorityIds: settings.defaultAccountPriorityIds
  });
  const viewerName = householdPeople.find((person) => person.id === input.viewId)?.name;
  return {
    today: input.today,
    accounts,
    people: householdPeople,
    categoryNames: categories.results.map((category) => category.name),
    categoryMatchRules,
    defaultAccountPriorityIds: settings.defaultAccountPriorityIds,
    foreignCurrencyAccountId: settings.foreignCurrencyAccountId || undefined,
    paymentWays,
    ...(viewerName ? { viewerName } : {})
  };
}
