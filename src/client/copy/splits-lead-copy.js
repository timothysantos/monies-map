// Words for the Splits lead card (group balance, History and the search field)
// and the phone's Simplify settlement placement. Kept out of en-SG.js so the
// first screen does not carry them; the Splits route loads this file.
export const splitsLeadCopy = {
  groupBalanceLabel: "Group balance",
  owesYou: (name) => `${name} owes you`,
  youOweName: (name) => `You owe ${name}`,
  balanceWith: (name) => `Balance with ${name}`,
  groupSpend: "Group spend",
  // The open period only: expenses no settle-up has covered yet.
  spentSinceSettleUp: "Spent since last settle-up",
  // The same words short enough for the middle of the donut.
  sinceSettleUp: "Since last settle-up",
  history: "History",
  searchGroup: (groupName) => `Search ${groupName}`
};
