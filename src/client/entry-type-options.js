// Entry type choices for the entry editor. A statement certifies which way
// the money moved, not how the app files it: income and transfer in add to
// the balance, expense and transfer out take from it. A certified entry may
// only be refiled within its direction (the server's bank-fact lock compares
// the signed amount the same way).

import { ENTRY_TYPE_LABELS } from "./enum-labels";

/** @param {{ entryType: string, transferDirection?: string | null }} entry */
export function getEntryMoneyDirection(entry) {
  return entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")
    ? "in"
    : "out";
}

/**
 * @param {{ entryType: string, transferDirection?: string | null }} entry
 * @param {{ bankFactsLocked?: boolean }} [options]
 */
export function getEntryTypeOptions(entry, { bankFactsLocked = false } = {}) {
  const types = !bankFactsLocked
    ? ["expense", "income", "transfer"]
    : getEntryMoneyDirection(entry) === "in"
      ? ["income", "transfer"]
      : ["expense", "transfer"];
  return types.map((value) => ({ value, label: ENTRY_TYPE_LABELS[value] }));
}

// The direction a switch to Transfer starts with. A locked entry keeps the
// direction its statement certified.
/**
 * @param {{ entryType: string, transferDirection?: string | null }} entry
 * @param {{ bankFactsLocked?: boolean }} [options]
 */
export function getTransferDirectionForTypeSwitch(entry, { bankFactsLocked = false } = {}) {
  if (bankFactsLocked) {
    return getEntryMoneyDirection(entry);
  }
  return entry.transferDirection ?? "out";
}

// The one line under the Edit entry card of a certified entry. The full rule
// (which fields lock, and which types it can switch between) is
// getBankFactsLockMessage, on the lock chip as its description.
export const BANK_FACTS_LOCK_LINE = "Bank details are locked to the statement. Category, owner, note and splits stay editable.";

/** @param {{ entryType: string, transferDirection?: string | null }} entry */
export function getBankFactsLockMessage(entry) {
  const typeChoice = getEntryMoneyDirection(entry) === "in"
    ? "Income and Transfer in"
    : "Expense and Transfer out";
  return `This row is statement certified. Description, date, posted date, wallet and amount are locked to the saved statement. Type can switch between ${typeChoice}, and you can change the note, category, owner or splits.`;
}
