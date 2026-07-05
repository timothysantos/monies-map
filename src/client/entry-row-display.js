import { messages } from "./copy/en-SG";

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
    : entry.ownershipType === "shared"
      ? "Shared ownership"
      : entry.ownerName ?? messages.common.emptyValue;
  const ownerTitle = isLinkedToSplits
    ? splitGroupName
      ? `On Splits: ${splitGroupName}`
      : "On Splits"
    : entry.ownershipType === "shared"
      ? "Shared ledger ownership. Add to splits separately to track this in Splits."
      : ownerLabel;

  return {
    ownerLabel,
    ownerTitle,
    ownerChipClassName: isLinkedToSplits
      ? "entry-chip-shared entry-chip-linked-split"
      : entry.ownershipType === "shared"
        ? "entry-chip-shared"
        : "entry-chip-owner",
    splitPercent,
    transferLabel: entry.entryType === "transfer"
      ? `${entry.linkedTransfer ? "Matched transfer" : "Transfer"} ${entry.transferDirection === "in" ? "in" : "out"}`
      : null,
    transferDetail: entry.linkedTransfer
      ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
      : entry.accountName,
    accountDetail: [
      entry.linkedTransfer ? entry.accountName : null,
      entry.accountOwnerLabel
    ].filter(Boolean).join(" - "),
    primarySignedAmountMinor: hasWeightedTotal ? signedTotalAmountMinor : signedAmountMinor,
    secondarySignedAmountMinor: hasWeightedTotal ? signedAmountMinor : null
  };
}

export function getEntryOwnerCue(entry, isLinkedToSplits = false) {
  const ownerKey = isLinkedToSplits
    ? "linked-splits"
    : entry.ownershipType === "shared"
      ? "shared-ownership"
      : entry.ownerName ?? entry.accountOwnerLabel ?? "unassigned";
  const color = getOwnerCueColor(ownerKey);

  return {
    style: {
      "--entry-owner-color": color,
      "--entry-owner-border-color": hexToRgba(color, 0.68)
    }
  };
}

function getVisibleSplitIndex(entry, viewId) {
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

function getOwnerCueColor(ownerKey) {
  const normalized = ownerKey.trim().toLowerCase();

  if (normalized.includes("tim")) {
    return "#74C69D";
  }

  if (normalized.includes("joyce")) {
    return "#F28482";
  }

  if (normalized === "linked-splits") {
    return "#2563EB";
  }

  if (normalized === "shared-ownership") {
    return "#B15E2F";
  }

  const palette = ["#6A7A73", "#7C8791", "#8FAE4B", "#C97B47", "#5EA89B", "#8B78E6"];
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return `rgba(106, 122, 115, ${alpha})`;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
