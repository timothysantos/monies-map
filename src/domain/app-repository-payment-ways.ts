// Settings -> Payment ways (DOMAIN.md "Payment Way"): stored household-wide
// in app_settings under "payment_ways", beside the Shortcut settings, as
// {"people":{"<personId>":{"bankTransferAccountId":"…","cashAccountId":"…"}}}.
// Defaults and the rules for which accounts count live in payment-ways.ts.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildAuditEventStatement } from "./app-repository-audit";
import { ensureAppSettingsTable } from "./app-settings-table";
import {
  PAYMENT_WAYS_SETTINGS_KEY,
  parseStoredPaymentWays,
  resolvePaymentWays
} from "./payment-ways";
import type { AccountDto, PaymentWayDto, PersonDto } from "../types/dto";

// Every person's effective payment ways (defaults applied). Read-only apart
// from creating the settings table on an older database.
type PaymentWayInputs = { accounts: AccountDto[]; people: PersonDto[]; priorityIds: string[] };

export async function loadPaymentWays(
  db: D1Database,
  // A promise is fine: the stored choices are read meanwhile.
  inputs: PaymentWayInputs | Promise<PaymentWayInputs>
): Promise<PaymentWayDto[]> {
  const [row, input] = await Promise.all([
    ensureAppSettingsTable(db).then(() => db
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .bind(PAYMENT_WAYS_SETTINGS_KEY)
      .first<{ value_json: string }>()),
    inputs
  ]);
  return resolvePaymentWays(parseStoredPaymentWays(row?.value_json), input);
}

// Saves one person's two choices ("" = none) with an audit event in one
// batch, after checking them. The person's entry is merged into the stored
// JSON inside the statement (json_patch), so two people saved at once
// cannot overwrite each other.
export async function savePaymentWay(
  db: D1Database,
  input: { personId: string; bankTransferAccountId?: string; cashAccountId?: string }
): Promise<{ updated: true; paymentWay: PaymentWayDto }> {
  await ensureAppSettingsTable(db);
  const personId = input.personId.trim();
  const bankTransferAccountId = input.bankTransferAccountId?.trim() ?? "";
  const cashAccountId = input.cashAccountId?.trim() ?? "";

  const person = personId
    ? await db
      .prepare("SELECT id, display_name FROM people WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, personId)
      .first<{ id: string; display_name: string }>()
    : null;
  if (!person) {
    throw new Error("Choose a person in this household.");
  }
  const chosenIds = [bankTransferAccountId, cashAccountId].filter(Boolean);
  const accountRows = chosenIds.length
    ? (await db
      .prepare(`
        SELECT id, account_name, account_kind, is_active
        FROM accounts
        WHERE household_id = ? AND id IN (${chosenIds.map(() => "?").join(", ")})
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, ...chosenIds)
      .all<{ id: string; account_name: string; account_kind: string; is_active: number }>()).results
    : [];
  const accountFor = (accountId: string) => accountRows.find((row) => row.id === accountId);
  const bankAccount = bankTransferAccountId ? accountFor(bankTransferAccountId) : undefined;
  if (bankTransferAccountId && !(bankAccount && bankAccount.is_active && bankAccount.account_kind === "bank")) {
    throw new Error("Choose an active bank account for PayNow and bank transfers.");
  }
  const cashAccount = cashAccountId ? accountFor(cashAccountId) : undefined;
  if (cashAccountId && !(cashAccount && cashAccount.is_active && cashAccount.account_kind === "cash")) {
    throw new Error("Choose an active cash account for cash.");
  }

  const patch = JSON.stringify({ people: { [person.id]: { bankTransferAccountId, cashAccountId } } });
  await db.batch([
    db
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = json_patch(CASE WHEN json_valid(app_settings.value_json) THEN app_settings.value_json ELSE '{}' END, excluded.value_json),
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(PAYMENT_WAYS_SETTINGS_KEY, patch),
    buildAuditEventStatement(db, {
      entityType: "settings",
      entityId: PAYMENT_WAYS_SETTINGS_KEY,
      action: "payment_way_updated",
      detail: `Payment ways for ${person.display_name}: PayNow and bank transfers from ${bankAccount?.account_name ?? "none"}; cash from ${cashAccount?.account_name ?? "none"}.`
    })
  ]);

  return { updated: true, paymentWay: { personId: person.id, bankTransferAccountId, cashAccountId } };
}
