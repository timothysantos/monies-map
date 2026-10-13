// Words for an Entries filter, shared by the Ask answer card's chips and the
// Entries page's "From Ask" chip, so both name a filter the same way. Plain
// words (AGENTS.md "Readability"). A threshold the person typed ("over
// $50") is not a balance, so money privacy does not mask it.

import { unmaskedMoney } from "../formatters";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCOPE_WORDS = { direct: "Direct", shared: "Shared", direct_plus_shared: "Direct + Shared" };

export const entryFilterCopy = {
  fromAsk: "From Ask",
  clear: "Clear the filters from Ask",
  backToAsk: (summary) => `${summary}. Back to Ask`,
  types: {
    expense: "Spending",
    income: "Income",
    transfer: "Transfers"
  },
  over: (amount) => `over ${amount}`,
  under: (amount) => `under ${amount}`,
  between: (low, high) => `${low} to ${high}`,
  search: (words) => `“${words}”`,
  entries: (count) => (count === 1 ? "1 entry" : `${count} entries`),
  moreCount: (first, count) => `${first} +${count}`
};

export function formatFilterMonth(monthKey) {
  const [year, month] = String(monthKey ?? "").split("-").map(Number);
  return month ? `${SHORT_MONTHS[month - 1]} ${year}` : "";
}

// "Serene · Shared", "Ethan" (Direct + Shared), "Household".
export function formatFilterView({ viewId, scope }, people = []) {
  if (!viewId || viewId === "household") {
    return "Household";
  }
  const name = people.find((person) => person.id === viewId)?.name ?? "";
  if (!name) {
    return "";
  }
  return scope && scope !== "direct_plus_shared" ? `${name} · ${SCOPE_WORDS[scope] ?? scope}` : name;
}

function listOf(names) {
  if (names.length <= 2) {
    return names.join(", ");
  }
  return entryFilterCopy.moreCount(names[0], names.length - 1);
}

function amountPart(minAmountMinor, maxAmountMinor) {
  const hasMin = Number.isFinite(minAmountMinor);
  const hasMax = Number.isFinite(maxAmountMinor);
  if (hasMin && hasMax) return entryFilterCopy.between(unmaskedMoney(minAmountMinor), unmaskedMoney(maxAmountMinor));
  if (hasMin) return entryFilterCopy.over(unmaskedMoney(minAmountMinor));
  if (hasMax) return entryFilterCopy.under(unmaskedMoney(maxAmountMinor));
  return "";
}

/**
 * The list filters as short labels, in a fixed order: category, wallet,
 * type, amount, search, entries. `withContext` adds the month and the view first (the
 * Ask answer card; the Entries page shows those in its own header).
 * @returns {{ key: string, label: string }[]}
 */
export function describeFilterParts(filter, { accounts = [], people = [], withContext = false } = {}) {
  const parts = [];
  if (withContext) {
    const month = formatFilterMonth(filter.month);
    if (month) parts.push({ key: "month", label: month });
    const view = formatFilterView(filter, people);
    if (view) parts.push({ key: "view", label: view });
  }
  if (filter.categories?.length) {
    parts.push({ key: "category", label: listOf(filter.categories) });
  }
  if (filter.wallets?.length) {
    const names = filter.wallets.map((wallet) => accounts.find((account) => account.id === wallet || account.name === wallet)?.name ?? wallet);
    parts.push({ key: "wallet", label: listOf(names) });
  }
  if (filter.type && entryFilterCopy.types[filter.type]) {
    parts.push({ key: "type", label: entryFilterCopy.types[filter.type] });
  }
  const amount = amountPart(filter.minAmountMinor, filter.maxAmountMinor);
  if (amount) {
    parts.push({ key: "amount", label: amount });
  }
  if (filter.search) {
    parts.push({ key: "search", label: entryFilterCopy.search(filter.search) });
  }
  if (filter.entryIds?.length) {
    parts.push({ key: "entries", label: entryFilterCopy.entries(filter.entryIds.length) });
  }
  return parts;
}
