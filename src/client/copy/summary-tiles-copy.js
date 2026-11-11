// Words for Summary's tiles and the sheet they open (design.md "Summary
// tiles"). Loaded with the tiles' lazy chunk, never in the first screen.

export const summaryTilesCopy = {
  open: "Open ›",
  chargeCount: (count) => `${count} ${count === 1 ? "charge" : "charges"}`,
  // A tile's title.
  titles: {
    subs: "Subscriptions and bills",
    coming: "Coming up",
    investments: "Investments",
    miles: "Miles and cashback",
    taxreliefs: "Tax reliefs",
    bankfees: "Bank fees this year"
  },
  // What a tile opens: the card's own name, as the sheet's title.
  sheetTitles: {
    subs: "Subscriptions and bills",
    coming: "Coming up",
    investments: "Investments over time",
    miles: "Miles and cashback",
    taxreliefs: "Tax reliefs",
    bankfees: "Bank fees this year"
  },
  roomLeft: "of room left",
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
