// Settings page selectors and draft builders live here so the panel can stay
// focused on rendering, local state wiring, and user events.

export function buildSafeSettingsPage(settingsPage) {
  return settingsPage ?? {
    demo: { emptyState: false, lastSeededAt: new Date().toISOString() },
    shortcutSettings: {
      endpointPath: "/api/shortcuts/entries/create",
      apiKey: "",
      apiKeySource: "none",
      defaultAccountPriorityIds: [],
      defaultParams: ""
    },
    categoryMatchRules: [],
    categoryMatchRuleSuggestions: [],
    unresolvedTransfers: [],
    reconciliationExceptions: [],
    recentAuditEvents: [],
    errorDiagnostics: []
  };
}

export function buildShortcutSettingsDraft(shortcutSettings, accounts) {
  const activeAccountIds = new Set(accounts.filter((account) => account.isActive).map((account) => account.id));
  const savedPriorityIds = (shortcutSettings?.defaultAccountPriorityIds ?? []).filter((accountId) => activeAccountIds.has(accountId));
  const remainingPriorityIds = accounts
    .filter((account) => account.isActive && !savedPriorityIds.includes(account.id))
    .map((account) => account.id);
  return {
    apiKey: shortcutSettings?.apiKey ?? "",
    defaultParams: shortcutSettings?.defaultParams ?? "",
    defaultAccountPriorityIds: [...savedPriorityIds, ...remainingPriorityIds]
  };
}

export function reorderShortcutAccountPriorityIds(accountIds, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= accountIds.length || toIndex >= accountIds.length) {
    return accountIds;
  }
  const nextIds = accountIds.slice();
  const [moved] = nextIds.splice(fromIndex, 1);
  nextIds.splice(toIndex, 0, moved);
  return nextIds;
}

function normalizeCategoryRuleText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getCategoryRuleParts(rule) {
  return String(rule?.pattern ?? "")
    .split(",")
    .map((part) => normalizeCategoryRuleText(part))
    .filter(Boolean);
}

function getCategoryRuleSignature(rule) {
  return getCategoryRuleParts(rule).slice().sort().join("|");
}

function categoryRulePartCanShareMatch(leftPart, rightPart) {
  if (leftPart === rightPart) {
    return true;
  }

  if (leftPart.length <= 3) {
    return rightPart.split(" ").includes(leftPart);
  }

  if (rightPart.length <= 3) {
    return leftPart.split(" ").includes(rightPart);
  }

  return leftPart.includes(rightPart) || rightPart.includes(leftPart);
}

function categoryRulePartsOverlap(leftParts, rightParts) {
  if (!leftParts.length || !rightParts.length) {
    return false;
  }

  return leftParts.every((leftPart) =>
    rightParts.some((rightPart) => categoryRulePartCanShareMatch(leftPart, rightPart))
  ) || rightParts.every((rightPart) =>
    leftParts.some((leftPart) => categoryRulePartCanShareMatch(leftPart, rightPart))
  );
}

export function findDuplicateCategoryMatchRules(rules) {
  const activeRules = (rules ?? [])
    .filter((rule) => rule?.isActive !== false)
    .map((rule) => ({
      rule,
      parts: getCategoryRuleParts(rule),
      signature: getCategoryRuleSignature(rule)
    }))
    .filter((item) => item.parts.length > 0);

  const issues = [];

  for (let leftIndex = 0; leftIndex < activeRules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeRules.length; rightIndex += 1) {
      const left = activeRules[leftIndex];
      const right = activeRules[rightIndex];
      const sameCategory = Boolean(left.rule.categoryId && right.rule.categoryId)
        ? left.rule.categoryId === right.rule.categoryId
        : left.rule.categoryName === right.rule.categoryName;
      const isExactDuplicate = left.signature === right.signature;
      const isOverlap = !isExactDuplicate && categoryRulePartsOverlap(left.parts, right.parts);

      if (!isExactDuplicate && !isOverlap) {
        continue;
      }

      issues.push({
        id: [left.rule.id, right.rule.id].sort().join(":"),
        kind: sameCategory
          ? (isExactDuplicate ? "duplicate" : "overlap")
          : "conflict",
        rules: [left.rule, right.rule].sort((first, second) => (
          first.priority - second.priority
          || first.pattern.localeCompare(second.pattern)
        ))
      });
    }
  }

  return issues.sort((left, right) => (
    Number(right.kind === "conflict") - Number(left.kind === "conflict")
    || left.rules[0].pattern.localeCompare(right.rules[0].pattern)
  ));
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
