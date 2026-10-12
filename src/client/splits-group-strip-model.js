// Pure rules for the Splits group strip and the All groups sheet: the order of
// the tiles, the one plain-words balance line each shows, and the last-used
// group that is remembered per viewer. No React here so the rules can be
// tested on their own.

import { messages } from "./copy/en-SG";

export const NON_GROUP_ID = "split-group-none";
const LAST_GROUP_KEY_PREFIX = "monies-map:splits-last-group:";

// The line under a group's name. "Settled" belongs to a real group at zero;
// Non-group expenses is not a group, so it says "No balance". Hidden money
// never reveals a sign or an amount.
export function balanceLineFor(group, { areTotalsVisible }) {
  if (!areTotalsVisible) {
    return messages.splits.balanceHidden;
  }
  if (group.balanceMinor === 0) {
    return group.id === NON_GROUP_ID ? messages.splits.noBalance : messages.splits.settled;
  }
  return group.summaryText;
}

// Owed to you, then you owe, then Non-group expenses, then settled groups.
// Household has no "you", so it keeps the server's order for open balances.
// Hidden money uses one stable order (by name, Non-group expenses last) so the
// order cannot hint at who owes whom.
export function orderGroups(groups, { areTotalsVisible, isHousehold }) {
  const nonGroup = groups.filter((group) => group.id === NON_GROUP_ID);
  const real = groups.filter((group) => group.id !== NON_GROUP_ID);
  if (!areTotalsVisible) {
    return [...real].sort((left, right) => left.name.localeCompare(right.name)).concat(nonGroup);
  }
  const open = real.filter((group) => group.balanceMinor !== 0);
  const settled = real.filter((group) => group.balanceMinor === 0);
  const owed = isHousehold ? open : open.filter((group) => group.balanceMinor > 0);
  const owe = isHousehold ? [] : open.filter((group) => group.balanceMinor < 0);
  return [...owed, ...owe, ...nonGroup, ...settled];
}

function isSettledGroup(group, areTotalsVisible) {
  return areTotalsVisible && group.id !== NON_GROUP_ID && group.balanceMinor === 0;
}

// Strip tiles: the open group leads, the rest follow the order above.
export function buildStripTiles(groups, { activeGroupId, areTotalsVisible, isHousehold }) {
  const ordered = orderGroups(groups, { areTotalsVisible, isHousehold });
  const active = activeGroupId ? ordered.find((group) => group.id === activeGroupId) : null;
  const sequence = active ? [active, ...ordered.filter((group) => group !== active)] : ordered;
  return sequence.map((group) => ({
    id: group.id,
    name: group.name,
    iconKey: group.iconKey,
    balanceLine: balanceLineFor(group, { areTotalsVisible }),
    entryCount: group.entryCount,
    isActive: group === active,
    isSettled: isSettledGroup(group, areTotalsVisible)
  }));
}

// Sheet rows: the same order; real groups at zero fold into one row.
export function buildSheetRows(groups, { activeGroupId, areTotalsVisible, isHousehold }) {
  const rows = orderGroups(groups, { areTotalsVisible, isHousehold }).map((group) => ({
    id: group.id,
    name: group.name,
    iconKey: group.iconKey,
    balanceLine: balanceLineFor(group, { areTotalsVisible }),
    isActive: group.id === activeGroupId,
    isSettled: isSettledGroup(group, areTotalsVisible)
  }));
  return { open: rows.filter((row) => !row.isSettled), settled: rows.filter((row) => row.isSettled) };
}

// How many tiles fit one desktop row (the row never wraps or scrolls). The
// open group always shows, so the answer is at least one.
export function countTilesThatFit({ rowWidth, controlWidth, leadWidth, tileWidth, gap, total }) {
  const afterLead = rowWidth - controlWidth - gap - leadWidth;
  const extra = afterLead >= 0 ? Math.floor((afterLead + gap) / (tileWidth + gap)) : 0;
  return Math.min(total, 1 + extra);
}

function storageKey(viewId) {
  return `${LAST_GROUP_KEY_PREFIX}${viewId}`;
}

export function readLastGroupId(viewId) {
  try {
    return window.localStorage.getItem(storageKey(viewId)) || null;
  } catch {
    return null;
  }
}

export function writeLastGroupId(viewId, groupId) {
  try {
    window.localStorage.setItem(storageKey(viewId), groupId);
  } catch {
    // Storage can be blocked; the strip still works for this visit.
  }
}
