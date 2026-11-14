// Words for Summary's tiles and the sheet they open (design.md "Summary
// tiles"). Loaded with the tiles' lazy chunk, never in the first screen.

export const summaryTilesCopy = {
  open: "Open ›",
  settledUp: "Settled up",
  chargeCount: (count) => `${count} ${count === 1 ? "charge" : "charges"}`,
  // Tile and sheet titles and subtitles are in summary-card-titles.js.
  roomLeft: "of room left",
  // The Tax reliefs tile's chip: short enough for one line in a half-width
  // tile; the card says "until 31 Dec" in full (taxReliefsCopy.daysLeft).
  taxDaysLeft: (days) => (days <= 0 ? "Last day" : `${days} ${days === 1 ? "day" : "days"} left`),
  // Under the Miles tile's ring: what the percent in its middle is of.
  bonusUsed: (cardName) => `of the ${cardName} bonus used`,
  milesSoFar: "miles so far",
  grewBy: (amount) => `Grew by ${amount}`,
  // The change note's quiet words after the arrow and percent.
  changeSinceJan: "since Jan",
  bankFeeKinds: {
    late_fee: "Late fees",
    interest: "Interest",
    annual_fee: "Annual fees",
    fx_fee: "Foreign currency fees",
    other_fee: "Card fees",
    failed_payment: "Payments that didn't go through",
    account_fee: "Account fees"
  },
  bankFees: {
    intro: "What the banks and cards charged this year, less any they refunded.",
    refunded: (amount) => `Another ${amount} was charged and then refunded, so it isn't counted.`,
    charges: (count) => `${count} ${count === 1 ? "charge" : "charges"}`
  }
};
