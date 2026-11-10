// "Add to Splits" for the picked Entries rows, as pure functions: which
// picked rows can go on Splits, the share choices, the preview line, the body
// the one bulk command takes and the notice words. The server decides every
// refusal again (src/domain/app-repository-splits.ts, addEntriesToSplitsRecord);
// this only keeps the bar from sending what it already knows cannot go, and
// says so.
import { pickSplitsCopy as copy } from "./copy/pick-splits-copy";
import { getQuickSplitGroup, NON_GROUP_SPLIT_ID } from "./split-picker-defaults";
import { BULK_RECATEGORISE_CONFIRM_ABOVE } from "../domain/entry-category-bulk";

export { NON_GROUP_SPLIT_ID };

// The payer's own share, in basis points (the command's payerShareBasisPoints).
export const SHARE_HALF = 5000;
export const SHARE_OTHER_OWES_ALL = 0;
export const SHARE_ALL_PAYERS = 10000;

/**
 * Sorts the picked rows: those that can go on Splits (an expense not already
 * on Splits), those already on Splits, and income or transfers.
 * @returns {{ ids: string[], payerNames: string[], alreadyOn: number, leftOut: number }}
 */
export function splitsPlanFor(rows) {
  const ids = [];
  const payers = new Set();
  let alreadyOn = 0;
  let leftOut = 0;
  for (const row of rows) {
    const entry = row.ledgerEntry ?? row;
    if (entry.entryType !== "expense") {
      leftOut += 1;
      continue;
    }
    if (entry.linkedSplitExpenseId || row.linkedSplitExpenseId) {
      alreadyOn += 1;
      continue;
    }
    ids.push(entry.id);
    payers.add(entry.ownerName ?? entry.accountOwnerLabel ?? "");
  }
  return { ids, payerNames: [...payers].filter(Boolean), alreadyOn, leftOut };
}

/**
 * The group to start on: the one used most recently on Splits when it still
 * exists, else the household's default, else the first. A household with one
 * group has it preselected. "" when there is no group at all.
 */
export function defaultSplitGroupId(groups, lastUsedGroupId = "") {
  if (groups.length === 1) return groups[0].id;
  return getQuickSplitGroup(groups, lastUsedGroupId || "")?.id ?? groups[0]?.id ?? "";
}

/**
 * The two people and the payer's name for the words. When the picked entries
 * were paid by one person that person is named and so is the other; when
 * both paid some, the words say "the other person" and "the payer".
 */
export function splitPeopleFor(payerNames, people) {
  const [first, second] = people;
  if (payerNames.length === 1 && first && second) {
    const payer = payerNames[0] === first.name ? first : payerNames[0] === second.name ? second : null;
    if (payer) return { payerName: payer.name, otherName: payer === first ? second.name : first.name };
  }
  return { payerName: copy.payerFallback, otherName: copy.otherPersonFallback };
}

/** The share choices as labelled pills: [{ basisPoints, label, words }]. */
export function shareChoicesFor({ payerName, otherName }) {
  return [
    { basisPoints: SHARE_HALF, label: copy.halfEach, words: copy.shareWords.half },
    { basisPoints: SHARE_OTHER_OWES_ALL, label: copy.otherOwesAll(otherName), words: copy.shareWords.otherOwesAll(otherName) },
    { basisPoints: SHARE_ALL_PAYERS, label: copy.allPayers(payerName), words: copy.shareWords.allPayers(payerName) }
  ];
}

/** "12 entries to Splits with Joyce, half each, in Okaeri". */
export function previewLine({ count, people, shareBasisPoints, group }) {
  const choice = shareChoicesFor(people).find((candidate) => candidate.basisPoints === shareBasisPoints) ?? shareChoicesFor(people)[0];
  const inGroup = group && group.id !== NON_GROUP_SPLIT_ID ? group.name : "";
  return copy.preview({ count, otherName: people.otherName, share: choice.words, groupName: inGroup });
}

/** More than 10 entries need the person's "Yes, add all N" first. */
export function needsAddConfirm(count) {
  return count > BULK_RECATEGORISE_CONFIRM_ABOVE;
}

/** The body POST /api/splits/expenses/add-chosen takes. */
export function chosenAddBody({ ids, groupId, shareBasisPoints, confirmed = false }) {
  return {
    splitGroupId: !groupId || groupId === NON_GROUP_SPLIT_ID ? null : groupId,
    payerShareBasisPoints: shareBasisPoints,
    entryIds: ids,
    ...(confirmed && needsAddConfirm(ids.length) ? { confirmedCount: ids.length } : {})
  };
}

/** The notice after an add: what went on Splits, then what did not and why. */
export function addedNotice(result, plan) {
  const refused = result.refused ?? [];
  // A stale pick: the server found it on Splits meanwhile.
  const lateAlready = refused.filter((row) => /already linked/i.test(row.reason)).length;
  const other = refused.length - lateAlready;
  const parts = [copy.added(result.addedCount)];
  const already = plan.alreadyOn + lateAlready;
  if (already) parts.push(copy.alreadyOn(already));
  if (plan.leftOut) parts.push(copy.leftOut(plan.leftOut));
  if (other) parts.push(copy.couldNot(other));
  return parts.length === 1 ? parts[0] : `${parts[0]}. ${parts.slice(1).join(". ")}`;
}

/** The first reason, when nothing could be added. */
export function noneAddedReason(result) {
  const reasons = [...new Set((result.refused ?? []).map((row) => row.reason))];
  return reasons[0] ?? copy.noneAdded;
}
