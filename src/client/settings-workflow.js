// Settings page selectors and draft builders live here so the panel can stay
// focused on rendering, local state wiring, and user events.

export function buildSafeSettingsPage(settingsPage) {
  return settingsPage ?? {
    demo: { emptyState: false, lastSeededAt: new Date().toISOString() },
    categoryMatchRules: [],
    categoryMatchRuleSuggestions: [],
    unresolvedTransfers: [],
    reconciliationExceptions: [],
    recentAuditEvents: []
  };
}

export function getVisibleSettingsAccounts(accounts, viewId) {
  const scopedAccounts = viewId === "household"
    ? accounts
    : accounts.filter((account) => account.isJoint || account.ownerPersonId === viewId);

  return scopedAccounts
    .slice()
    .sort((left, right) => (
      Number(right.isActive) - Number(left.isActive)
      || left.institution.localeCompare(right.institution)
      || left.name.localeCompare(right.name)
    ));
}

export function getVisibleSettingsCategories(categories) {
  return categories.slice().sort((left, right) => left.name.localeCompare(right.name));
}

export function groupSettingsAuditEventsByDate(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = event.createdAt.slice(0, 10);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(event);
  }

  return Array.from(grouped.entries()).map(([date, dayEvents]) => ({
    date,
    events: dayEvents
  }));
}

export function buildCheckpointHistoryYears(history) {
  return Array.from(new Set(history.map((item) => item.month.slice(0, 4)).filter(Boolean)))
    .sort((left, right) => right.localeCompare(left));
}

export function filterCheckpointHistoryByYear(history, year) {
  return history.filter((item) => !year || item.month.startsWith(`${year}-`));
}

export function buildCreateAccountDialog() {
  return {
    mode: "create",
    accountId: "",
    name: "",
    institution: "",
    kind: "bank",
    currency: "SGD",
    openingBalance: "0.00",
    ownerPersonId: "",
    isJoint: false
  };
}

export function buildEditAccountDialog(account, formatMinorInput) {
  return {
    mode: "edit",
    accountId: account.id,
    name: account.name,
    institution: account.institution,
    kind: account.kind,
    currency: account.currency,
    openingBalance: formatMinorInput(account.openingBalanceMinor ?? 0),
    ownerPersonId: account.ownerPersonId ?? "",
    isJoint: account.isJoint
  };
}

export function buildReconciliationDialog(account, formatCheckpointStatementInputMinor) {
  return {
    accountId: account.id,
    accountName: account.name,
    accountKind: account.kind,
    checkpointMonth: account.latestCheckpointMonth ?? "",
    statementStartDate: account.latestCheckpointStartDate ?? "",
    statementEndDate: account.latestCheckpointEndDate ?? "",
    statementBalance: formatCheckpointStatementInputMinor(
      account.latestCheckpointBalanceMinor ?? account.balanceMinor ?? 0,
      account.kind
    ),
    note: account.latestCheckpointNote ?? "",
    history: account.checkpointHistory ?? []
  };
}

export function buildStatementComparePanel(account, checkpoint) {
  if (!checkpoint?.month) {
    return null;
  }

  return {
    accountId: account.id,
    accountName: account.name,
    checkpointMonth: checkpoint.month,
    statementStartDate: checkpoint.statementStartDate,
    statementEndDate: checkpoint.statementEndDate,
    deltaMinor: checkpoint.deltaMinor
  };
}

export function buildCreateCategoryDialog(fallbackTheme) {
  return {
    mode: "create",
    categoryId: "",
    name: "",
    slug: "",
    iconKey: fallbackTheme.iconKey,
    colorHex: fallbackTheme.colorHex
  };
}

export function buildEditCategoryDialog(category) {
  return {
    mode: "edit",
    categoryId: category.id,
    name: category.name,
    slug: category.slug,
    iconKey: category.iconKey,
    colorHex: category.colorHex
  };
}

export function buildCreateCategoryRuleDialog(categories) {
  return {
    mode: "create",
    ruleId: "",
    sourceSuggestionId: "",
    pattern: "",
    categoryId: categories.find((category) => category.name === "Other")?.id ?? categories[0]?.id ?? "",
    priority: 100,
    isActive: true,
    note: ""
  };
}

export function buildEditCategoryRuleDialog(rule) {
  return {
    mode: "edit",
    ruleId: rule.id,
    sourceSuggestionId: "",
    pattern: rule.pattern,
    categoryId: rule.categoryId,
    priority: rule.priority,
    isActive: rule.isActive,
    note: rule.note ?? ""
  };
}

export function buildSuggestionCategoryRuleDialog(suggestion, buildSuggestionNote) {
  return {
    mode: "create",
    ruleId: "",
    sourceSuggestionId: suggestion.id,
    pattern: suggestion.pattern,
    categoryId: suggestion.categoryId,
    priority: 100,
    isActive: true,
    note: buildSuggestionNote(suggestion.sourceCount)
  };
}

export function buildPersonDialog(person) {
  return {
    personId: person.id,
    name: person.name
  };
}
