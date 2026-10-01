// The import field a CSV column heading most likely holds, as the Data
// mapping step first guesses it. Kept free of browser-only imports so the
// intake queue (and its tests) can read a CSV with it.
export function inferImportMapping(header) {
  const normalized = header.toLowerCase().trim();

  if (
    [
      "date",
      "transaction date",
      "posting date",
      "posted date",
      "value date"
    ].includes(normalized)
  ) {
    return "date";
  }

  if (
    [
      "description",
      "details",
      "narrative",
      "merchant",
      "memo"
    ].includes(normalized)
  ) {
    return "description";
  }

  if (["amount", "transaction amount", "amt", "value"].includes(normalized)) {
    return "amount";
  }

  if ([
    "expense",
    "expenses",
    "expense amount",
    "debit",
    "debit amount",
    "withdrawal",
    "outflow"
  ].includes(normalized)) {
    return "expense";
  }

  if ([
    "income",
    "incomes",
    "income amount",
    "credit",
    "credit amount",
    "deposit",
    "inflow"
  ].includes(normalized)) {
    return "income";
  }

  if (["account", "wallet", "account name", "source account"].includes(normalized)) {
    return "account";
  }

  if (["category", "category name"].includes(normalized)) {
    return "category";
  }

  if (["note", "notes", "remarks"].includes(normalized)) {
    return "note";
  }

  if (["type", "transaction type", "entry type"].includes(normalized)) {
    return "type";
  }

  return "ignore";
}
