import { messages } from "./copy/en-SG";
import { entriesMessages } from "./copy/en-SG-entries";
import { entryAmountTone } from "../domain/money-tone";
import { paletteColour } from "./palette-colour";
import { getPersonColour } from "./person-colour";
import { formatEntryTime } from "../lib/entry-time";

export function buildEntryRowDisplay(entry, viewId, isLinkedToSplits = false) {
  const splitPercent = getVisibleSplitPercent(entry, viewId);
  const signedAmountMinor = getSignedAmountMinor(entry);
  const signedTotalAmountMinor = getSignedTotalAmountMinor(entry);
  const hasWeightedTotal = signedTotalAmountMinor != null && signedTotalAmountMinor !== signedAmountMinor;
  const splitGroupName = entry.linkedSplitGroupName && entry.linkedSplitGroupName !== "Non-group expenses"
    ? entry.linkedSplitGroupName
    : "";
  const ownerLabel = isLinkedToSplits
    ? splitGroupName
      ? `On splits · ${splitGroupName}`
      : "On splits"
    : entry.ownerName ?? entry.accountOwnerLabel ?? messages.common.emptyValue;
  const ownerTitle = isLinkedToSplits
    ? splitGroupName
      ? `On Splits: ${splitGroupName}`
      : "On Splits"
    : ownerLabel;

  return {
    ownerLabel,
    ownerTitle,
    ownerChipClassName: isLinkedToSplits
      ? "entry-chip-shared entry-chip-linked-split"
      : "entry-chip-owner",
    linkedSplitGroupName: isLinkedToSplits ? splitGroupName : "",
    linkedSplitGroupStyle: isLinkedToSplits && splitGroupName
      ? getSplitGroupChipStyle(splitGroupName)
      : undefined,
    splitPercent,
    transferLabel: getTransferLabel(entry),
    // A matched transfer is settled bookkeeping, so its chip is a quiet
    // line; an unmatched one keeps the pill that asks for a look.
    isTransferMatched: Boolean(entry.linkedTransfer) && (entry.entryType === "transfer" || Boolean(entry.transferPurpose?.role)),
    transferDetail: entry.linkedTransfer
      ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
      : entry.accountName,
    accountDetail: [
      entry.linkedTransfer ? entry.accountName : null,
      entry.accountOwnerLabel
    ].filter(Boolean).join(" - "),
    // "2:32 pm" for an entry made on its own day (Apple Pay, typed in), else "".
    timeLabel: formatEntryTime(entry.time),
    primarySignedAmountMinor: hasWeightedTotal ? signedTotalAmountMinor : signedAmountMinor,
    amountTone: entryAmountTone(entry.entryType, signedAmountMinor),
    secondarySignedAmountMinor: hasWeightedTotal ? signedAmountMinor : null
  };
}

// A transfer's chip. A transfer that says what it pays for stays visibly a
// transfer: in a person view it reads as spending (or a payback) in its
// category, so the chip names who it went to or came from; the household
// row adds what it was for.
function getTransferLabel(entry) {
  const purpose = entry.transferPurpose;
  const copy = entriesMessages.transferPurpose;
  if (purpose?.role === "sent") {
    return copy.sentChip(purpose.toPersonName);
  }
  if (purpose?.role === "received") {
    return copy.receivedChip(entry.ownerName ?? entry.accountOwnerLabel ?? messages.common.emptyValue);
  }
  if (entry.entryType !== "transfer") {
    return null;
  }
  const label = `${entry.linkedTransfer ? "Matched transfer" : "Transfer"} ${entry.transferDirection === "in" ? "in" : "out"}`;
  return purpose ? copy.householdChip(label, purpose.categoryName) : label;
}

export function getSplitGroupChipStyle(groupName) {
  // Eight hues of the category palette; the chip is its tint with a darker
  // ink (5:1 or more), as every pastel surface is.
  const palette = ["#46788E", "#758C4D", "#625A7A", "#B16739", "#699696", "#C67D3F", "#A77899", "#6E858A"];
  const hash = Array.from(String(groupName)).reduce(
    (value, character) => ((value << 5) - value + character.charCodeAt(0)) | 0,
    0
  );
  const colour = paletteColour(palette[Math.abs(hash) % palette.length]);

  return {
    "--split-group-chip-bg": `color-mix(in srgb, ${colour} 16%, var(--paper))`,
    "--split-group-chip-color": `color-mix(in srgb, ${colour} 55%, var(--text))`,
    "--split-group-chip-border": `color-mix(in srgb, ${colour} 45%, var(--paper))`
  };
}

export function getEntryOwnerCue(entry, isLinkedToSplits = false) {
  const ownerKey = isLinkedToSplits
    ? "linked-splits"
    : entry.ownerName ?? entry.accountOwnerLabel ?? "unassigned";
  const color = paletteColour(getPersonColour(ownerKey));

  return {
    style: {
      "--entry-owner-color": color,
      // Solid, so the 5px edge keeps 3:1 against the row.
      "--entry-owner-border-color": color
    }
  };
}

function getVisibleSplitIndex(entry, viewId) {
  if (entry.linkedSplitExpenseId && entry.linkedSplitShares?.length) {
    if (viewId === "household") {
      return 0;
    }

    const matchingIndex = entry.linkedSplitShares.findIndex((split) => split.personId === viewId);
    return matchingIndex === -1 ? 0 : matchingIndex;
  }

  if (entry.ownershipType !== "shared" || !entry.splits.length) {
    return -1;
  }

  if (viewId === "household") {
    return 0;
  }

  const matchingIndex = entry.splits.findIndex((split) => split.personId === viewId);
  return matchingIndex === -1 ? 0 : matchingIndex;
}

function getVisibleSplitPercent(entry, viewId) {
  if (entry.linkedSplitExpenseId && entry.linkedSplitShares?.length) {
    if (typeof entry.viewerSplitRatioBasisPoints === "number") {
      return entry.viewerSplitRatioBasisPoints / 100;
    }

    const splitIndex = getVisibleSplitIndex(entry, viewId);
    return entry.linkedSplitShares[splitIndex]?.ratioBasisPoints / 100;
  }

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

function getSignedAmountMinor(entry) {
  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return entry.amountMinor;
  }

  if (entry.entryType === "transfer" && entry.transferDirection === "out") {
    return -entry.amountMinor;
  }

  return -entry.amountMinor;
}

function getTotalAmountMinor(entry) {
  if (typeof entry.totalAmountMinor === "number") {
    return entry.totalAmountMinor;
  }

  if (entry.ownershipType === "shared" && entry.splits?.length) {
    return entry.splits.reduce((sum, split) => sum + Number(split.amountMinor ?? 0), 0);
  }

  return entry.amountMinor;
}

function getSignedTotalAmountMinor(entry) {
  const totalAmountMinor = getTotalAmountMinor(entry);
  if (typeof totalAmountMinor !== "number") {
    return null;
  }

  if (entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")) {
    return totalAmountMinor;
  }

  return -totalAmountMinor;
}
