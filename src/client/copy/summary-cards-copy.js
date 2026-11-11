// Words for Summary's "Investments" and "Tax reliefs" cards (DOMAIN.md
// "Investments Over Time" and "Tax Relief"), as the owner approved them on
// 10 Nov 2026. Loaded with the cards' lazy chunk, never in the first screen.
// Plain words only: the tax card shows room left and the deadline, never the
// tax a top-up saves and never advice.

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const shortMonth = (month) => SHORT_MONTHS[Number(String(month).slice(5, 7)) - 1] ?? "";
// "30 Sep".
export const dayMonth = (date) => `${Number(String(date).slice(8, 10))} ${shortMonth(String(date).slice(0, 7))}`;

export const investmentsCopy = {
  putInSince: "You put in since Jan",
  grewBy: "Grew by",
  paidOut: "Paid out (dividends, interest)",
  worthLegend: "Worth (statements)",
  putInLegend: "Money you put in",
  // When an account was already worth something at its start (its last
  // statement before 1 January, or its first one this year), the line
  // starts there: it says so.
  putInLegendFromStart: "Starting worth plus money you put in",
  chartLabel: (firstMonth, lastMonth) => `Worth of the investment accounts from ${shortMonth(firstMonth)} to ${shortMonth(lastMonth)}, at the months with a statement, with the money put in shown as a stepped line`,
  account: "Account",
  putIn: "Put in",
  worth: "Worth",
  statementOn: (date) => `statement ${dayMonth(date)}`,
  fromMonth: (month) => `from ${shortMonth(month)}`,
  phonePutIn: "You put in ",
  phoneSince: " since Jan · grew by ",
  showAccounts: "Tap for each account",
  hideAccounts: "Hide the accounts",
  accountsLabel: "Each investment account"
};

export const taxReliefsCopy = {
  filedIn: (year) => `Counts for the tax you file in ${Number(year) + 1}`,
  daysLeft: (days) => (days <= 0 ? "Last day, until 31 Dec" : `${days} ${days === 1 ? "day" : "days"} left, until 31 Dec`),
  reliefs: {
    srs: "SRS top-ups",
    cpf_self: "CPF cash top-up, for yourself",
    cpf_family: "CPF cash top-up, for family"
  },
  // The figure's name in its menu.
  reliefNames: {
    srs: "SRS top-ups",
    cpf_self: "CPF top-up for yourself",
    cpf_family: "CPF top-up for family"
  },
  of: " of ",
  roomLeft: (amount) => `${amount} more would still count this year.`,
  full: "Full limit reached.",
  charity: "Gifts to approved charities",
  charityName: "Charity gifts",
  // "counted 2½ times, so $1,250 off your income"
  charityCounted: (times, deduction) => ` · counted ${times} times, so ${deduction} off your income`,
  footnote: (year) => `Limits as published by IRAS for ${year}. The app doesn't know your income, so it doesn't show how much tax this saves.`,
  // The year's limits are not in the app yet: the latest known ones are used.
  footnoteFallback: (limitsYear, year) => `Limits as published by IRAS for ${limitsYear}, the latest the app knows; ${year}'s may differ. The app doesn't know your income, so it doesn't show how much tax this saves.`
};

// "2½" for 2.5, "3" for 3.
export function timesWords(times) {
  const whole = Math.floor(times);
  const half = Math.abs(times - whole - 0.5) < 1e-9;
  return half ? `${whole}½` : String(times);
}
