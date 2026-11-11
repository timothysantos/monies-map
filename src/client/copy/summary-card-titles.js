// Every Summary card's title and its one quiet subtitle line, in one list
// (owner decision, 2026-11-11, "Summary card titles" in design.md). The desktop
// card, the tile, the opened sheet or dialog, the Arrange cards row, the guides
// and every aria label read these; a rename is a one-line edit here.
//
// A title is a short name for what the card is: sentence case, no "The", no
// time words. The subtitle says the period or basis, and may carry live words
// (months, a year) from data the card already has, so it is a function.
// `planSimple` is the plan card's Simple view; the other keys are the
// registered card ids (summary-card-order.js).
// "Dec 2025": an own helper, so this list imports nothing. The first screen and
// the lazy cards both read it, and an import would split that module into a
// chunk of its own (a file more in the first screen, scripts/check-initial-bundle.mjs).
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatMonthLabel = (month) => `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const longMonth = (month) => new Intl.DateTimeFormat("en-SG", { month: "long" }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
// "Dec 2025 to Nov 2026", or just "Nov 2026" for one month.
const range = (first, last) => (first === last ? formatMonthLabel(first) : `${formatMonthLabel(first)} to ${formatMonthLabel(last)}`);
// Without live words (the Arrange cards list has no data) a subtitle drops them.
const byMonth = ({ first = "", last = "" } = {}) => (first ? `By month, ${range(first, last)}` : "By month");

export const SUMMARY_CARD_TITLES = {
  insights: { title: "Money insights", subtitle: () => "Needs a look, and went well" },
  plan: { title: "Plan vs actual", subtitle: byMonth },
  planSimple: { title: "Earned vs spent", subtitle: byMonth },
  changed: { title: "What changed", subtitle: ({ month = "", baseMonth = "" } = {}) => (month ? `${longMonth(month)} so far, against the same days of ${longMonth(baseMonth)}` : "This month so far, against the same days of last month") },
  mix: { title: "Spending mix", subtitle: ({ first = "", last = "" } = {}) => (first ? `By category, ${range(first, last)}` : "By category") },
  subs: { title: "Subscriptions and bills", subtitle: () => "A month" },
  coming: { title: "Coming up", subtitle: ({ days = 30 } = {}) => `Next ${days} days` },
  investments: { title: "Investments", subtitle: () => "On the latest statements" },
  miles: { title: "Miles and cashback", subtitle: () => "This month, estimate" },
  taxreliefs: { title: "Tax reliefs", subtitle: ({ year = "" } = {}) => (year ? `For ${year}` : "For this year") },
  bankfees: { title: "Bank fees", subtitle: () => "This year" },
  accounts: { title: "Accounts", subtitle: () => "Balances on the latest statements" }
};

/** The first and last month of a list of { month }, for a "By month" subtitle. */
export const monthsContext = (months) => {
  const sorted = months.map((item) => item.month).sort();
  return { first: sorted[0], last: sorted.at(-1) };
};

export const cardTitle = (id) => SUMMARY_CARD_TITLES[id].title;
/** @param {string} id @param {Record<string, any>} [context] the live words the subtitle needs (months, year) */
export const cardSubtitle = (id, context = {}) => SUMMARY_CARD_TITLES[id].subtitle(context);
