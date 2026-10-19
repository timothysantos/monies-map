export const NON_GROUP_SPLIT_ID = "split-group-none";

/**
 * Pick the group used by the one-tap split action. The last group wins when it
 * still exists; otherwise the server's default real group is the safe
 * fallback. Non-group expenses are intentionally excluded from the shortcut.
 */
export function getQuickSplitGroup(splitGroups = [], lastUsedGroupId = "") {
  const realGroups = splitGroups.filter((group) => group.id !== NON_GROUP_SPLIT_ID);
  if (!realGroups.length) {
    return null;
  }

  return realGroups.find((group) => group.id === lastUsedGroupId)
    ?? realGroups.find((group) => group.isDefault)
    ?? realGroups[0];
}
