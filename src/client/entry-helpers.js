export function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildEntryDraft(view, accounts, categories, people) {
  const defaultOwnerName = view.id !== "household"
    ? people.find((person) => person.id === view.id)?.name ?? people[0]?.name ?? ""
    : people[0]?.name ?? "";
  const ownershipType = view.monthPage.selectedScope === "shared" ? "shared" : "direct";
  const defaultAccountName = accounts.find((account) => account.isActive !== false)?.name ?? accounts[0]?.name ?? "";
  const preferredCategoryName = categories.find((category) => category.name === "Other")?.name ?? categories[0]?.name ?? "";
  const draft = {
    id: "entry-draft",
    date: view.monthPage.month ? `${view.monthPage.month}-01` : new Date().toISOString().slice(0, 10),
    description: "",
    accountName: defaultAccountName,
    categoryName: preferredCategoryName,
    entryType: "expense",
    transferDirection: undefined,
    ownershipType,
    ownerName: ownershipType === "direct" ? defaultOwnerName : undefined,
    amountMinor: 0,
    totalAmountMinor: 0,
    viewerSplitRatioBasisPoints: view.id === "household" ? undefined : ownershipType === "shared" ? 5000 : 10000,
    offsetsCategory: false,
    note: "",
    linkedTransfer: undefined,
    splits: []
  };

  return normalizeEntryShape(draft, people);
}

export function normalizeEntryShape(entry, people, previousEntry = entry) {
  const nextEntry = {
    ...entry,
    amountMinor: Math.max(0, Number(entry.amountMinor ?? 0)),
    totalAmountMinor: entry.totalAmountMinor ?? entry.amountMinor ?? 0
  };

  if (typeof nextEntry.categoryName === "string" && nextEntry.categoryName === "Transfer") {
    nextEntry.entryType = "transfer";
    nextEntry.transferDirection = nextEntry.transferDirection ?? "out";
  }

  if (nextEntry.entryType === "transfer") {
    nextEntry.categoryName = "Transfer";
    nextEntry.transferDirection = nextEntry.transferDirection ?? "out";
  } else {
    nextEntry.transferDirection = undefined;
    if (nextEntry.categoryName === "Transfer") {
      nextEntry.categoryName = "Other";
    }
  }

  // A direct entry belongs entirely to one person, so keep its split shape explicit.
  if (nextEntry.ownershipType === "direct") {
    const ownerName = nextEntry.ownerName ?? previousEntry.ownerName ?? people[0]?.name ?? "";
    const owner = people.find((person) => person.name === ownerName);
    nextEntry.ownerName = ownerName;
    nextEntry.totalAmountMinor = nextEntry.amountMinor;
    nextEntry.viewerSplitRatioBasisPoints = 10000;
    nextEntry.splits = ownerName
      ? [{
          personId: owner?.id ?? ownerName.toLowerCase(),
          personName: ownerName,
          ratioBasisPoints: 10000,
          amountMinor: nextEntry.amountMinor
        }]
      : [];
    return nextEntry;
  }

  // Shared entries keep the visible person's ratio stable when the draft changes.
  const ratioPercent = getVisibleSplitPercent(previousEntry, "household")
    ?? Math.round((previousEntry.splits?.[0]?.ratioBasisPoints ?? 5000) / 100);
  const sharedSplits = applySharedSplit({
    ...nextEntry,
    totalAmountMinor: nextEntry.amountMinor,
    splits: previousEntry.splits
  }, people, ratioPercent, "household");
  nextEntry.ownerName = undefined;
  nextEntry.totalAmountMinor = nextEntry.amountMinor;
  nextEntry.viewerSplitRatioBasisPoints = undefined;
  nextEntry.splits = sharedSplits;
  return nextEntry;
}

export function applySharedSplit(entry, people, percentage, viewId = "household") {
  const fallbackPeople = people.slice(0, 2);
  const sharedPeople = entry.splits.length >= 2
    ? entry.splits.slice(0, 2).map((split) => ({
        personId: split.personId,
        personName: split.personName
      }))
    : fallbackPeople.map((person) => ({
        personId: person.id,
        personName: person.name
      }));
  const primaryIndex = getVisibleSplitIndex(entry, viewId);
  const secondaryIndex = primaryIndex === 0 ? 1 : 0;
  const totalAmountMinor = entry.totalAmountMinor ?? entry.amountMinor;
  const basisPoints = Math.max(0, Math.min(10000, Math.round(Number(percentage || 0) * 100)));
  const complement = 10000 - basisPoints;
  const primaryAmount = Math.round((totalAmountMinor * basisPoints) / 10000);
  const secondaryAmount = totalAmountMinor - primaryAmount;
  return [
    {
      ...sharedPeople[0],
      ratioBasisPoints: primaryIndex === 0 ? basisPoints : complement,
      amountMinor: primaryIndex === 0 ? primaryAmount : secondaryAmount
    },
    {
      ...sharedPeople[1],
      ratioBasisPoints: secondaryIndex === 1 ? complement : basisPoints,
      amountMinor: secondaryIndex === 1 ? secondaryAmount : primaryAmount
    }
  ];
}

export function entryMatchesScope(entry, viewId, scope) {
  if (viewId === "household") {
    return scope === "shared" ? entry.ownershipType === "shared" : true;
  }

  const personId = viewId;
  if (scope === "shared") {
    return entry.ownershipType === "shared" && entry.splits.some((split) => split.personId === personId);
  }

  if (scope === "direct") {
    return entry.ownershipType === "direct" && entry.splits.some((split) => split.personId === personId);
  }

  return entry.splits.some((split) => split.personId === personId);
}

export function getVisibleSplitIndex(entry, viewId) {
  if (entry.ownershipType !== "shared" || !entry.splits.length) {
    return -1;
  }

  if (viewId === "household") {
    return 0;
  }

  const matchingIndex = entry.splits.findIndex((split) => split.personId === viewId);
  return matchingIndex === -1 ? 0 : matchingIndex;
}

export function getVisibleSplitPercent(entry, viewId) {
  if (entry.ownershipType !== "shared") {
    return null;
  }

  if (typeof entry.viewerSplitRatioBasisPoints === "number") {
    return entry.viewerSplitRatioBasisPoints / 100;
  }

  const splitIndex = getVisibleSplitIndex(entry, viewId);
  if (splitIndex === -1) {
    return null;
  }

  return entry.splits[splitIndex]?.ratioBasisPoints / 100;
}

export function groupEntriesByDate(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const current = grouped.get(entry.date) ?? { date: entry.date, entries: [], netMinor: 0 };
    current.entries.push(entry);
    current.netMinor += getSignedAmountMinor(entry);
    grouped.set(entry.date, current);
  }

  return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function getSignedAmountMinor(entry) {
  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return entry.amountMinor;
  }

  if (entry.entryType === "transfer" && entry.transferDirection === "out") {
    return -entry.amountMinor;
  }

  return -entry.amountMinor;
}

export function getSignedTotalAmountMinor(entry) {
  if (typeof entry.totalAmountMinor !== "number") {
    return null;
  }

  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return entry.totalAmountMinor;
  }

  return -entry.totalAmountMinor;
}

export function getTransferWallets(entry) {
  if (entry.transferDirection === "in") {
    return {
      fromWalletName: entry.linkedTransfer?.accountName ?? "Unmatched",
      toWalletName: entry.accountName
    };
  }

  return {
    fromWalletName: entry.accountName,
    toWalletName: entry.linkedTransfer?.accountName ?? "Unmatched"
  };
}

export function getTransferMatchCandidates(entry, entries) {
  const amountMinor = entry.totalAmountMinor ?? entry.amountMinor;

  // Transfer matching stays heuristic: amount first, then opposite direction and date proximity.
  return entries
    .filter((candidate) => {
      if (candidate.id === entry.id) {
        return false;
      }

      const candidateAmountMinor = candidate.totalAmountMinor ?? candidate.amountMinor;
      if (candidateAmountMinor !== amountMinor) {
        return false;
      }

      if (candidate.accountName === entry.accountName) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftOpposite = left.transferDirection && entry.transferDirection
        ? left.transferDirection !== entry.transferDirection
        : false;
      const rightOpposite = right.transferDirection && entry.transferDirection
        ? right.transferDirection !== entry.transferDirection
        : false;
      if (leftOpposite !== rightOpposite) {
        return leftOpposite ? -1 : 1;
      }

      const leftGap = Math.abs(daysBetween(entry.date, left.date));
      const rightGap = Math.abs(daysBetween(entry.date, right.date));
      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }

      return left.accountName.localeCompare(right.accountName);
    })
    .slice(0, 5);
}

export function daysBetween(left, right) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

export function normalizeMatchText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function textOverlapScore(left, right) {
  const leftTokens = new Set(normalizeMatchText(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeMatchText(right).split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function getAmountToneClass(amountMinor) {
  if (amountMinor > 0) {
    return "positive";
  }
  if (amountMinor < 0) {
    return "negative";
  }
  return "";
}
