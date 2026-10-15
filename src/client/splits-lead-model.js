// What the Splits lead card says about the open group: the balance as one
// figure in its money tone, the plain words under it, and who it is with.
// Pure, so the sign rules (and what hidden money may reveal) are tested on
// their own; the component only lays it out.

import { splitsLeadCopy as copy } from "./copy/splits-lead-copy";
import { splitsStripCopy } from "./copy/splits-strip-copy";
import { messages } from "./copy/en-SG";

/**
 * @param {{
 *   group: { name: string, currency: string, entryCount: number, balanceMinor: number },
 *   viewId: string,
 *   people: Array<{ id?: string, name: string }>,
 *   areTotalsVisible: boolean,
 *   spendMinor: number,
 *   hasSettledBefore?: boolean
 * }} input
 */
export function buildSplitsLead({ group, viewId, people, areTotalsVisible, spendMinor, hasSettledBefore = false }) {
  const isHousehold = viewId === "household";
  const counterpart = isHousehold ? null : people.find((person) => person.id !== viewId) ?? null;
  const counterpartName = counterpart?.name ?? null;
  const base = {
    title: group.name,
    subtitle: `${group.currency} · ${splitsStripCopy.entryCount(group.entryCount)}`,
    counterpartName,
    spendMinor,
    // "Spent since last settle-up" once the group has been settled before,
    // "Group spend" while it never has (the figure is the same open set).
    spendLabel: hasSettledBefore ? copy.spentSinceSettleUp : copy.groupSpend,
    donutLabel: hasSettledBefore ? copy.sinceSettleUp : copy.groupSpend
  };

  // The household has no "you": the spend leads and no balance is claimed.
  if (isHousehold) {
    return { ...base, amountMinor: null, tone: "neutral", caption: "" };
  }

  const amountMinor = Math.abs(group.balanceMinor);
  // Hidden money says whom the balance is with and nothing about which side
  // of zero it is: no tone, no "owes", no "Settled up".
  if (!areTotalsVisible) {
    return {
      ...base,
      amountMinor,
      tone: "neutral",
      caption: counterpartName ? copy.balanceWith(counterpartName) : messages.splits.net
    };
  }
  if (group.balanceMinor === 0) {
    return { ...base, amountMinor, tone: "neutral", caption: messages.splits.settledUp };
  }
  const isOwedToYou = group.balanceMinor > 0;
  const caption = counterpartName
    ? (isOwedToYou ? copy.owesYou(counterpartName) : copy.youOweName(counterpartName))
    : (isOwedToYou ? messages.splits.youAreOwed : messages.splits.youOwe);
  return { ...base, amountMinor, tone: isOwedToYou ? "in" : "short", caption };
}

/**
 * The group's spend is the spend of its open period: expenses that no
 * settle-up has covered, the same open set the entry count and the balance
 * describe (splits-projection.ts: not in a closed batch and not in a
 * settlement checkpoint that is not reopened or voided; the projection
 * reports that as settlementStatus). The amount is the expense total in the
 * group's own currency, never converted. Deleted expenses are never sent.
 * `hasSettledBefore` is true when any record of the group was ever settled,
 * which is what makes the label say "since last settle-up".
 *
 * @param {Array<{ kind: string, totalAmountMinor: number, settlementStatus?: string }>} activity
 */
export function summariseGroupSpend(activity) {
  let spendMinor = 0;
  let hasSettledBefore = false;
  for (const item of activity) {
    if (item.settlementStatus === "settled") {
      hasSettledBefore = true;
    } else if (item.kind === "expense") {
      spendMinor += item.totalAmountMinor;
    }
  }
  return { spendMinor, hasSettledBefore };
}
