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
