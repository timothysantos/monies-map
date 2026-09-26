import { moneyWithCurrency } from "./formatters";

export function groupSplitActivityByDate(items) {
  const grouped = new Map();

  for (const item of items) {
    const current = grouped.get(item.date) ?? { date: item.date, items: [] };
    current.items.push(item);
    grouped.set(item.date, current);
  }

  return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function groupSplitActivityByBatch(items) {
  const grouped = new Map();

  for (const item of items) {
    const batchId = item.batchId ?? `split-batch-fallback-${item.groupId}`;
    const current = grouped.get(batchId) ?? {
      batchId,
      label: item.batchLabel ?? `${item.groupName} settled batch`,
      closedAt: item.batchClosedAt ?? item.date,
      items: []
    };
    current.items.push(item);
    if (item.batchClosedAt && item.batchClosedAt > current.closedAt) {
      current.closedAt = item.batchClosedAt;
    }
    grouped.set(batchId, current);
  }

  return [...grouped.values()]
    .map((batch) => ({
      ...batch,
      groups: groupSplitActivityByDate(batch.items)
    }))
    .sort((left, right) => right.closedAt.localeCompare(left.closedAt));
}

export function formatArchiveDate(date) {
  const value = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("en-SG", { month: "short", day: "2-digit" }).format(value);
}

export function getArchivedBatchSummary(batch, viewId) {
  const settlement = batch.items
    .filter((item) => item.kind === "settlement")
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date))[0];

  if (!settlement) {
    return {
      title: batch.label,
      subtitle: `${batch.items.length} archived ${batch.items.length === 1 ? "entry" : "entries"}`
    };
  }

  const title = `${settlement.fromPersonName} fully settled up with ${settlement.toPersonName}`;
  const amount = moneyWithCurrency(settlement.totalAmountMinor, settlement.currency ?? "SGD");
  if (viewId !== "household") {
    return {
      title,
      subtitle: settlement.toPersonId === viewId ? `${settlement.fromPersonName} paid you ${amount}` : `You paid ${settlement.toPersonName} ${amount}`
    };
  }

  return {
    title,
    subtitle: `${settlement.fromPersonName} paid ${settlement.toPersonName} ${amount}`
  };
}

// The category donut for the active group's currency: open expenses in that
// currency across groups. Currencies are never added together, so an SGD
// group shows the SGD chart and a JPY group the JPY chart (empty when no
// yen expense is open), never dollars and yen summed.
export function selectSplitDonutChart(splitsPage, currency = "SGD") {
  if (!currency || currency === "SGD") {
    return splitsPage?.donutChart ?? [];
  }
  return splitsPage?.donutChartsByCurrency?.[currency] ?? [];
}

// The Splits money check-in's records for one group's activity, in the
// group's currency. The household sees the group's totals; a person sees
// their own part: their split share of each expense (an expense they have no
// share in is left out) and the settlements, which carry no spend.
export function buildSplitInsightRecords(activity, viewId) {
  const isHousehold = viewId === "household";
  return activity.flatMap((item) => {
    const isExpense = item.kind === "expense";
    const amountMinor = isExpense && !isHousehold
      ? item.shares?.find((share) => share.personId === viewId)?.amountMinor ?? 0
      : item.totalAmountMinor;
    if (isExpense && !amountMinor) {
      return [];
    }
    return [{
      amountMinor,
      entryType: isExpense ? "expense" : "transfer",
      categoryName: item.categoryName ?? "Split expense",
      description: item.description,
      date: item.date
    }];
  });
}
