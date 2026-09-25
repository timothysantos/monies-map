export function splitAmountMinorWithRoundedRemainder(totalAmountMinor: number, firstBasisPoints: number) {
  const safeAmountMinor = Math.max(0, Number(totalAmountMinor ?? 0));
  const safeBasisPoints = Math.max(0, Math.min(10000, Number(firstBasisPoints ?? 0)));
  const firstAmount = Math.floor((safeAmountMinor * safeBasisPoints) / 10000);
  const secondAmount = safeAmountMinor - firstAmount;

  return {
    firstAmount,
    secondAmount
  };
}

export interface SplitShareAllocation {
  ratioBasisPoints: number;
  amountMinor: number;
}

// Moves a two-person split to a new total by its stored basis. The split
// workspace stores each share as a ratio plus an exact amount, not the mode it
// was entered in, so the stored ratio is the basis: an exact-amount share
// becomes the same proportion of the new total. An even split stays even: its
// stored ratio is only 4999/5001 because the odd cent went to one person, so
// the new total is split 50/50 with the default balancing remainder.
export function rebalanceSplitSharesForTotal(
  shares: SplitShareAllocation[],
  nextTotalAmountMinor: number
): SplitShareAllocation[] {
  if (shares.length !== 2) {
    throw new Error("A split expense needs exactly two shares to follow a new amount.");
  }

  const [first, second] = shares;
  const isEvenSplit = first.amountMinor > 0
    && second.amountMinor > 0
    && Math.abs(first.amountMinor - second.amountMinor) <= 1;
  const firstBasisPoints = isEvenSplit ? 5000 : Math.max(0, Math.min(10000, first.ratioBasisPoints));
  const { firstAmount, secondAmount } = splitAmountMinorWithRoundedRemainder(nextTotalAmountMinor, firstBasisPoints);

  return [
    { ratioBasisPoints: firstBasisPoints, amountMinor: firstAmount },
    { ratioBasisPoints: 10000 - firstBasisPoints, amountMinor: secondAmount }
  ];
}
