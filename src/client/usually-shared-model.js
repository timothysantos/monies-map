// What the "Usually shared" section needs from the server's list, as pure
// functions (no React): which entries are ticked, what one Add posts, when
// it needs "Yes, add all N", and the months a group's figure opens over.
// The server decides every group; the page only chooses among them.

// More entries than this in one Add need the person's "Yes, add all N"
// (USUALLY_SHARED_CONFIRM_ABOVE in src/domain/usually-shared.ts).
export const CONFIRM_ABOVE = 10;
export const NON_GROUP_ID = "split-group-none";

/** The ids ticked in a group: all of them unless the person unticked some. */
export function tickedEntries(group, unticked) {
  const off = unticked ?? new Set();
  return group.entries.filter((entry) => !off.has(entry.id));
}

/** Whether adding `count` entries needs the confirm step. */
export function needsConfirm(count) {
  return count > CONFIRM_ABOVE;
}

/** The body POST /api/splits/expenses/add-usual takes for one group's ticked entries. */
export function buildAddBody(group, unticked, { confirmed = false } = {}) {
  const ids = tickedEntries(group, unticked).map((entry) => entry.id);
  return {
    groups: [{
      splitGroupId: group.groupId === NON_GROUP_ID ? null : group.groupId,
      payerShareBasisPoints: group.basisPoints,
      entryIds: ids
    }],
    ...(confirmed && needsConfirm(ids.length) ? { confirmedCount: ids.length } : {})
  };
}

/** The "YYYY-MM:YYYY-MM" months the group's entries fall in (data-fig-period). */
export function figurePeriod(group) {
  const months = group.entries.map((entry) => entry.date.slice(0, 7)).sort();
  return `${months[0]}:${months[months.length - 1]}`;
}

/** The ids an Add made, as the Undo posts them. */
export function undoBody(result) {
  return { splitExpenseIds: result.undoSplitExpenseIds ?? [] };
}

/** What the list holds after an Add: the groups the Add finished with are gone, a partly added one keeps what was refused. */
export function groupsAfterAdd(groups, groupKey, result) {
  const addedIds = new Set((result.added ?? []).map((row) => row.entryId));
  return groups
    .map((group) => group.key === groupKey ? { ...group, entries: group.entries.filter((entry) => !addedIds.has(entry.id)) } : group)
    .filter((group) => group.entries.length > 0)
    .map((group) => ({ ...group, totalMinor: group.entries.reduce((sum, entry) => sum + entry.amountMinor, 0) }));
}

/** The distinct reasons entries were refused, each once. */
export function refusedReasons(result) {
  return [...new Set((result.refused ?? []).map((row) => row.reason))];
}
