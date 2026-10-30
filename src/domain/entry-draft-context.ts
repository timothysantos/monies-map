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

// The person asking: the person the signed-in login (its Cloudflare Access
// email, getAuthenticatedEmail) belongs to, or undefined with no login or an
// unregistered one. Ask reads "I", "me" and "my" as this person. A read
// only: a household without the login table yet simply has no asker.
export async function loadAskerPersonId(db: D1Database, email: string | undefined): Promise<string | undefined> {
  const login = email?.trim().toLowerCase();
  if (!login) return undefined;
  try {
    const row = await db
      .prepare("SELECT person_id FROM login_identities WHERE household_id = ? AND provider = ? AND email = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", login)
      .first<{ person_id: string }>();
    return row?.person_id || undefined;
  } catch {
    return undefined;
  }
}

export async function loadEntryDraftContext(
  db: D1Database,
  input: { today: string; viewId?: string; askerPersonId?: string }
): Promise<EntryDraftContext> {
  // Every read starts at once (this runs before Ask's model call and on
  // each entry draft); the Shortcut settings and payment ways finish when
  // the accounts and people they resolve against arrive.
  const accountsRead = loadShortcutAccountReferences(db);
  const settingsRead = loadShortcutSettings(db, accountsRead);
  const peopleRead = db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{ id: string; display_name: string }>()
    .then((people) => people.results.map((person) => ({ id: person.id, name: person.display_name })));
  const [accounts, settings, categoryMatchRules, householdPeople, categories, paymentWays] = await Promise.all([
    accountsRead,
    settingsRead,
    loadCategoryMatchRules(db),
    peopleRead,
    db
      .prepare("SELECT name FROM categories WHERE household_id = ? ORDER BY sort_order, name")
      .bind(DEFAULT_HOUSEHOLD_ID)
      .all<{ name: string }>(),
    loadPaymentWays(db, Promise.all([accountsRead, peopleRead, settingsRead]).then(([accountList, people, shortcutSettings]) => ({
      accounts: accountList,
      people,
      priorityIds: shortcutSettings.defaultAccountPriorityIds
    })))
  ]);
  // "I", "me" and "my": the person asking, else the person being viewed.
  const viewerName = householdPeople.find((person) => person.id === input.askerPersonId)?.name
    ?? householdPeople.find((person) => person.id === input.viewId)?.name;
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
