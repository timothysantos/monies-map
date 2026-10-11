// Each person's share of a split expense as the create expense card shows
// it: one row per person ("Tim's share 25% · $21.60") and the shares chip
// ("25 / 75"). It only reads the draft that the existing share calculation
// (split-share-state.js, through updateSplitExpenseDraft) keeps in step, so
// the card shows exactly what will be saved: the share person's basis
// points and amount, and the other person's rest of the total.

function formatPercent(basisPoints) {
  const percent = Math.round(basisPoints) / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, "");
}

/**
 * @param {any} draft a split expense draft
 * @param {{ name: string }[]} people the household, share person first or not
 * @returns {{ personName: string, basisPoints: number, percentLabel: string, amountMinor: number, isPrimary: boolean }[]}
 */
export function buildSplitShareRows(draft, people) {
  if (!draft || !Array.isArray(people) || people.length < 2) {
    return [];
  }
  const totalAmountMinor = Math.max(0, Number(draft.amountMinor ?? 0));
  const primaryName = draft.sharePersonName ?? people[0].name;
  const secondaryName = people.find((person) => person.name !== primaryName)?.name ?? people[1].name;
  const primaryBasisPoints = Math.max(0, Math.min(10000, Math.round(Number(draft.splitBasisPoints ?? 5000))));
  const primaryAmountMinor = Math.max(0, Math.min(totalAmountMinor, Number(draft.splitAmountMinor ?? 0)));
  return [
    { personName: primaryName, basisPoints: primaryBasisPoints, percentLabel: `${formatPercent(primaryBasisPoints)}%`, amountMinor: primaryAmountMinor, isPrimary: true },
    { personName: secondaryName, basisPoints: 10000 - primaryBasisPoints, percentLabel: `${formatPercent(10000 - primaryBasisPoints)}%`, amountMinor: totalAmountMinor - primaryAmountMinor, isPrimary: false }
  ];
}

/** "50 / 50": the shares chip, share person first. */
export function formatShareRatio(rows) {
  return rows.length ? rows.map((row) => formatPercent(row.basisPoints)).join(" / ") : "";
}
