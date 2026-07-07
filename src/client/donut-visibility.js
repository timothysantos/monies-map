export function getDonutItemId(item) {
  return item?.key ?? item?.label ?? "";
}

export function toggleHiddenDonutItemIds(hiddenIds, itemId) {
  const next = new Set(hiddenIds);
  if (!itemId) {
    return next;
  }
  if (next.has(itemId)) {
    next.delete(itemId);
  } else {
    next.add(itemId);
  }
  return next;
}

export function getVisibleDonutData(data, hiddenIds) {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds ?? []);
  return (data ?? []).filter((item) => !hidden.has(getDonutItemId(item)));
}

export function sumDonutValueMinor(data) {
  return (data ?? []).reduce((sum, item) => sum + Number(item.valueMinor ?? 0), 0);
}
