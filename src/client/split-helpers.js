import { money } from "./formatters";

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
  const amount = money(settlement.totalAmountMinor);
  if (viewId === "person-tim") {
    return {
      title,
      subtitle: settlement.toPersonId === viewId ? `${settlement.fromPersonName} paid you ${amount}` : `You paid ${settlement.toPersonName} ${amount}`
    };
  }
  if (viewId === "person-joyce") {
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
