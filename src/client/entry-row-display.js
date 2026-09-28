import { messages } from "./copy/en-SG";
import { entryAmountTone } from "../domain/money-tone";

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
    amountTone: entryAmountTone(entry.entryType, signedAmountMinor),
    secondarySignedAmountMinor: hasWeightedTotal ? signedAmountMinor : null
  };
}

export function getSplitGroupChipStyle(groupName) {
  // Eight hues of the category palette; the chip is its tint with a darker
  // ink (5.4:1 or more), as every pastel surface is.
  const palette = ["#5C90C9", "#33A471", "#9385D9", "#D07E43", "#499DA4", "#C0862A", "#DA6DA1", "#7C8791"];
  const hash = Array.from(String(groupName)).reduce(
    (value, character) => ((value << 5) - value + character.charCodeAt(0)) | 0,
    0
  );
  const colour = palette[Math.abs(hash) % palette.length];

  return {
    "--split-group-chip-bg": `color-mix(in srgb, ${colour} 16%, white)`,
    "--split-group-chip-color": `color-mix(in srgb, ${colour} 55%, var(--text))`,
    "--split-group-chip-border": `color-mix(in srgb, ${colour} 45%, white)`
  };
}

export function getEntryOwnerCue(entry, isLinkedToSplits = false) {
  const ownerKey = isLinkedToSplits
    ? "linked-splits"
    : entry.ownerName ?? entry.accountOwnerLabel ?? "unassigned";
  const color = getOwnerCueColor(ownerKey);

  return {
    style: {
      "--entry-owner-color": color,
      // Solid, so the 5px edge keeps 3:1 against the row.
      "--entry-owner-border-color": hexToRgba(color, 1)
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

function getOwnerCueColor(ownerKey) {
  const normalized = ownerKey.trim().toLowerCase();

  // Colours from the category palette (src/domain/category-palette.ts), in
  // the former hue families: green, coral, terracotta for Splits.
  if (normalized.includes("tim")) {
    return "#33A471";
  }

  if (normalized.includes("joyce")) {
    return "#DE726D";
  }

  if (normalized === "linked-splits") {
    return "#BF7D51";
  }

  const palette = ["#6A7A73", "#7C8791", "#7F9B43", "#BF7D51", "#48988A", "#9385D9"];
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
