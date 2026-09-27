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

// A person's home-currency share of a ledger entry linked to a split recorded
// in another currency (a travel split: JPY shares matched to an SGD card
// row). The split keeps its own total and shares; only its home amount
// follows the ledger entry. So each person's home-currency share is what the
// split's shares would be if its total followed the ledger amount, as a
// same-currency split's do: the stored basis applied to the ledger amount
// with the same floor and balancing remainder (rebalanceSplitSharesForTotal),
// adding up exactly to the ledger amount. `shares` are in split-share people
// order (owner, partner, then by creation), so the balancing cent lands where
// it would for a same-currency split. Returns one amount per share, in order.
export function homeCurrencyShareAmounts(shares: SplitShareAllocation[], ledgerAmountMinor: number): number[] {
  const homeAmountMinor = Math.abs(Number(ledgerAmountMinor ?? 0));
  if (shares.length === 2) {
    return rebalanceSplitSharesForTotal(shares, homeAmountMinor).map((share) => share.amountMinor);
  }

  // Any other share count (never written by the split editor): floor each
  // share by its ratio and balance the remainder onto the last share.
  let allocated = 0;
  return shares.map((share, index) => {
    const ratio = Math.max(0, Math.min(10000, share.ratioBasisPoints));
    const amountMinor = index === shares.length - 1
      ? homeAmountMinor - allocated
      : Math.floor((homeAmountMinor * ratio) / 10000);
    allocated += amountMinor;
    return amountMinor;
  });
}
