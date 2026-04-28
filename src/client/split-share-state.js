import { minorToDecimalString } from "./formatters";

function clampBasisPoints(value) {
  return Math.max(0, Math.min(10000, Math.round(Number(value ?? 0))));
}

function clampAmountMinor(value, totalAmountMinor) {
  const safeTotal = Math.max(0, Number(totalAmountMinor ?? 0));
  const safeValue = Math.max(0, Number(value ?? 0));
  return Math.min(safeValue, safeTotal);
}

export function buildSplitShareState({
  totalAmountMinor,
  splitBasisPoints = 5000,
  splitAmountMinor,
  splitValueMode = "percent"
}) {
  const safeTotal = Math.max(0, Number(totalAmountMinor ?? 0));
  const normalizedMode = splitValueMode === "amount" ? "amount" : "percent";

  if (normalizedMode === "amount") {
    const nextAmountMinor = clampAmountMinor(splitAmountMinor ?? 0, safeTotal);
    const nextBasisPoints = safeTotal > 0
      ? clampBasisPoints((nextAmountMinor / safeTotal) * 10000)
      : 0;

    return {
      splitValueMode: "amount",
      splitBasisPoints: nextBasisPoints,
      splitPercentInput: String(nextBasisPoints / 100),
      splitAmountMinor: nextAmountMinor,
      splitAmountInput: minorToDecimalString(nextAmountMinor)
    };
  }

  const nextBasisPoints = clampBasisPoints(splitBasisPoints);
  const nextAmountMinor = Math.round(safeTotal * (nextBasisPoints / 10000));

  return {
    splitValueMode: "percent",
    splitBasisPoints: nextBasisPoints,
    splitPercentInput: String(nextBasisPoints / 100),
    splitAmountMinor: nextAmountMinor,
    splitAmountInput: minorToDecimalString(nextAmountMinor)
  };
}

export function syncSplitShareState(draft, patch = {}, modeOverride, options = {}) {
  const nextDraft = { ...draft, ...patch };
  const shouldCommit = options.commit === true;
  const nextMode = modeOverride ?? nextDraft.splitValueMode;

  if (!shouldCommit) {
    if (Object.prototype.hasOwnProperty.call(patch, "splitPercentInput") && patch.splitPercentInput === "") {
      return {
        ...nextDraft,
        splitValueMode: nextMode
      };
    }

    if (Object.prototype.hasOwnProperty.call(patch, "splitAmountInput") && patch.splitAmountInput === "") {
      return {
        ...nextDraft,
        splitValueMode: nextMode
      };
    }
  }

  return {
    ...nextDraft,
    ...buildSplitShareState({
      totalAmountMinor: nextDraft.amountMinor,
      splitBasisPoints: nextDraft.splitBasisPoints,
      splitAmountMinor: nextDraft.splitAmountMinor,
      splitValueMode: nextMode
    })
  };
}
