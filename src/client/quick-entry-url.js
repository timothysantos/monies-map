import { parseDraftMoneyInput } from "./formatters";

export const QUICK_EXPENSE_PARAMS = [
  "action",
  "amount",
  "merchant",
  "description",
  "date",
  "account",
  "account_id",
  "category",
  "note",
  "owner",
  "shared"
];

export function buildQuickExpenseDraftPatch({ searchParams, accountOptions, categoryOptions, ownerOptions, defaultAccountPriorityIds = [], fallbackOwnerName }) {
  const warnings = [];
  const rawAmount = searchParams.get("amount");
  const rawDescription = searchParams.get("merchant") ?? searchParams.get("description");
  const rawAccount = searchParams.get("account");
  const account = findQuickExpenseAccount(accountOptions, {
    accountId: searchParams.get("account_id"),
    accountName: rawAccount,
    defaultAccountPriorityIds
  });
  const categoryName = findCaseInsensitiveOption(categoryOptions, searchParams.get("category")) ?? "Other";
  const ownerName = findCaseInsensitiveOption(ownerOptions.filter((option) => option !== "Shared"), searchParams.get("owner"))
    ?? fallbackOwnerName
    ?? "";
  const amountMinor = Math.abs(parseDraftMoneyInput(rawAmount ?? "0"));
  const description = isQuickExpensePlaceholder(rawDescription) ? "" : rawDescription ?? "";
  const date = normalizeQuickExpenseDate(searchParams.get("date")) || new Date().toISOString().slice(0, 10);

  if (!hasQuickExpenseAmount(rawAmount)) {
    warnings.push("Shortcut did not pass an amount. Check that the URL uses the real Amount variable, not placeholder text.");
  }
  if (isQuickExpensePlaceholder(rawDescription)) {
    warnings.push("Shortcut did not pass a merchant or description.");
  }
  if (rawAccount && !account && isQuickExpensePlaceholder(rawAccount)) {
    warnings.push("Shortcut did not pass a card or account.");
  }

  return {
    draft: {
      ...(date ? { date } : {}),
      ...(description ? { description } : {}),
      ...(account ? {
        accountId: account.value,
        accountName: account.accountName,
        accountOwnerLabel: account.ownerLabel
      } : {}),
      categoryName,
      amountMinor,
      totalAmountMinor: amountMinor,
      entryType: "expense",
      transferDirection: undefined,
      ownershipType: "direct",
      ownerName,
      note: isQuickExpensePlaceholder(searchParams.get("note")) ? "" : searchParams.get("note") ?? "",
      addToSplits: false,
      splitGroupId: ""
    },
    warning: warnings.join(" ")
  };
}

export function buildEffectiveQuickExpenseParams(searchParams, shortcutSettings) {
  const defaults = new URLSearchParams(String(shortcutSettings?.defaultParams ?? "").trim().replace(/^\?/, ""));
  const next = new URLSearchParams(defaults);
  for (const [key, value] of searchParams.entries()) {
    next.set(key, value);
  }
  return next;
}

function hasQuickExpenseAmount(value) {
  return /\d/.test(String(value ?? "")) && !isQuickExpensePlaceholder(value);
}

function isQuickExpensePlaceholder(value) {
  return /^\s*\[[^\]]+\]\s*$/.test(String(value ?? ""));
}

function findQuickExpenseAccount(accountOptions, { accountId, accountName, defaultAccountPriorityIds = [] }) {
  if (accountId) {
    const byId = accountOptions.find((option) => option.value === accountId || option.id === accountId);
    if (byId) {
      return byId;
    }
  }

  if (accountName) {
    const normalizedAccountName = normalizeQuickExpenseToken(accountName);
    const exactMatch = accountOptions.find((option) => (
      normalizeQuickExpenseToken(option.accountName) === normalizedAccountName
      || normalizeQuickExpenseToken(option.label) === normalizedAccountName
      || normalizeQuickExpenseToken(option.value) === normalizedAccountName
    ));
    if (exactMatch) {
      return exactMatch;
    }

    const partialMatches = accountOptions.filter((option) => (
      normalizeQuickExpenseToken(option.accountName).includes(normalizedAccountName)
      || normalizeQuickExpenseToken(option.label).includes(normalizedAccountName)
    ));
    return partialMatches.length === 1 ? partialMatches[0] : undefined;
  }

  return defaultAccountPriorityIds
    .map((defaultAccountId) => accountOptions.find((option) => option.value === defaultAccountId || option.id === defaultAccountId))
    .find(Boolean);
}

function findCaseInsensitiveOption(options, value) {
  if (!value) {
    return undefined;
  }
  const normalizedValue = normalizeQuickExpenseToken(value);
  return options.find((option) => normalizeQuickExpenseToken(option) === normalizedValue);
}

function normalizeQuickExpenseToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeQuickExpenseDate(value) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}
