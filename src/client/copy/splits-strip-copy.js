// Words for the Splits group strip, its All groups sheet and the floating
// group bar. Kept out of en-SG.js so the first screen does not carry them.
export const splitsStripCopy = {
  done: "Done",
  newTile: "New",
  allTile: "All",
  allGroups: "All groups",
  createGroup: "Create group",
  close: "Close",
  allMore: (count) => `All · ${count} more`,
  balanceHidden: "Balance hidden",
  noBalance: "No balance",
  settled: "Settled",
  settledGroups: (count) => `${count} settled ${count === 1 ? "group" : "groups"}`,
  entryCount: (count) => `${count} ${count === 1 ? "entry" : "entries"}`,
  chooseGroupHint: "Choose which split group to open."
};
