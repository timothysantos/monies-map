// Words for Summary's "Miles and cashback" card and Settings > Cards and
// rewards (DOMAIN.md "Card reward rule"). Plain words: "miles a dollar",
// "bonus room left", "estimate"; the bank's statement is the final word.
// Loaded with the card's and Settings' lazy chunks, never in the first
// screen. Built without the owner's review (owner, 2026-11-10: build and
// release, review later).

import { dayMonth } from "./subscriptions-copy";

const number = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 });
const rateNumber = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 });

export const formatMiles = (miles) => number.format(Math.max(0, Math.floor(miles)));
export const formatRate = (rate) => rateNumber.format(rate);

const CHANNEL_WORDS = { online: "online", contactless: "by tap", foreign: "in another currency" };

export function channelWords(channels) {
  const words = (channels ?? []).map((channel) => CHANNEL_WORDS[channel]).filter(Boolean);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : words[0] ?? "";
}

// "Food & Drinks", "Food & Drinks or Shopping", "anything".
export function categoryWords(categories) {
  if (!categories?.length) return "";
  return categories.length > 1 ? `${categories.slice(0, -1).join(", ")} or ${categories.at(-1)}` : categories[0];
}

// What a bonus is for: "Food & Drinks", "online", "Shopping, or online",
// "Food & Drinks paid online or by tap".
export function bonusWhat(bonus) {
  const categories = categoryWords(bonus.categories);
  const channels = channelWords(bonus.channels);
  if (categories && channels) {
    return bonus.match === "either" ? `${categories}, or paid ${channels}` : `${categories} paid ${channels}`;
  }
  if (channels) return `spending ${channels}`;
  return categories || "everything";
}

// "4 miles a dollar", "5% back".
export const rateText = (unit, rate) => (unit === "miles" ? `${formatRate(rate)} miles a dollar` : `${formatRate(rate)}% back`);

export const cardRewardsCopy = {
  title: "Miles and cashback",
  estimate: "Estimate",
  finalWord: "An estimate from your entries. Your card statement's points are the final word.",
  household: "Household",
  milesSoFar: "Miles so far",
  backSoFar: "Cashback so far",
  milesFrom: (name) => `Miles from ${name}`,
  backFrom: (name) => `Cashback from ${name}`,
  bonusSpending: (name) => `Bonus spending on ${name}`,
  miles: (miles) => `${formatMiles(miles)} miles`,
  // The card's own month: "this month" or "since 18 Oct".
  since: (card) => (card.cycleKind === "statement" ? `since ${dayMonth(card.cycleStart)}` : "this month"),
  // A capped bonus's bar: "of $1,000 bonus spending · 4 miles a dollar on Food & Drinks"
  barOf: (cap) => `of ${cap} bonus spending`,
  barFor: (unit, bonus) => `${rateText(unit, bonus.rate)} on ${bonusWhat(bonus)}`,
  roomLeft: (room, resetsOn) => `${room} bonus room left until ${dayMonth(resetsOn)}`,
  usedUp: (resetsOn) => `Used up until ${dayMonth(resetsOn)}`,
  noCap: (unit, bonus) => `${rateText(unit, bonus.rate)} on ${bonusWhat(bonus)}, no cap`,
  minimumToGo: (need, count) => [need ? `${need} more spending` : "", count ? `${count} more payment${count === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ") + " this month for its cashback",
  minimumMet: "Monthly minimum reached",
  owner: (name) => name,

  bestTitle: "Best card now",
  bestRow: (unit, rate) => rateText(unit, rate),
  bestNeeds: (channels) => `when paid ${channelWords(channels)}`,
  bestRoom: (room) => `${room} bonus room left`,
  bestUsual: (name) => `Lately on ${name}`,
  bestSame: "Already the card you use most",
  orCashback: (name, rate) => `or ${name}, ${formatRate(rate)}% back`,
  nothingBest: "Not enough spending on these cards yet to suggest one.",

  noticesTitle: "Bonus caps",
  usedUpNotice: (card, resetsOn, base, unit, what) => `The bonus on ${card} is used up until ${dayMonth(resetsOn)}; ${what} there now earns ${rateText(unit, base)}.`,
  alternative: (card, room) => (room === null ? `${card} still pays its bonus on it.` : `${card} has ${room} of bonus room left.`),
  nearlyNotice: (card, room, resetsOn) => `${card} has ${room} of bonus room left until ${dayMonth(resetsOn)}.`,
  minimumNotice: (card, need, count) => `${card} needs ${cardRewardsCopy.minimumToGo(need, count)}.`,

  backTitle: (startMonth, endMonth) => `Looking back, ${startMonth} to ${endMonth}`,
  backMiles: "more miles with the best card each time",
  backCashback: "more back with the best card each time",
  backAbout: "About",
  backNone: (unit) => (unit === "miles" ? "The best card was used for nearly every dollar. Nicely done." : "The best cashback card was used nearly every time."),
  change: (category, from, to) => `${category} on ${from} → ${to}`,
  changeMiles: (miles) => `about ${formatMiles(miles)} more miles`,

  notSetUp: (count) => `${count} card${count === 1 ? "" : "s"} not set up yet: Settings, Cards and rewards.`,
  showMore: "Show every card",
  showLess: "Show fewer",

  settings: {
    title: "Cards and rewards",
    status: (count) => `${count} card${count === 1 ? "" : "s"}`,
    intro: "What each credit card pays back, for the Miles and cashback card on Summary. These are the banks' usual rules, simplified: your card statement is the final word.",
    suggestFrom: "Suggest cards from",
    suggestHousehold: "The whole household",
    suggestOwn: "Each person's own cards",
    suggestHint: "The whole household: any card can be suggested for anyone's spending, as when you pool your miles.",
    savedSuggest: (label) => `Cards are now suggested from: ${label}.`,
    cardsTitle: "Your cards",
    notSetUp: "Not set up",
    unitMiles: "Miles",
    unitCashback: "Cashback",
    // "Miles · 0.4 a dollar, 4 on Food & Drinks up to $1,000 a month"
    summary: (rules, money) => {
      if (!rules) return "Not set up";
      const base = rules.unit === "miles" ? `${formatRate(rules.baseRate)} a dollar` : `${formatRate(rules.baseRate)}% back`;
      const bonus = rules.bonuses[0];
      const first = bonus ? `, ${rules.unit === "miles" ? formatRate(bonus.rate) : `${formatRate(bonus.rate)}%`} on ${bonusWhat(bonus)}${bonus.capMinor ? ` up to ${money(bonus.capMinor)} a ${bonus.cycle.kind === "statement" ? "statement month" : "month"}` : ""}` : "";
      const more = rules.bonuses.length > 1 ? ` (+${rules.bonuses.length - 1} more)` : "";
      return `${rules.unit === "miles" ? "Miles" : "Cashback"} · ${base}${first}${more}`;
    },
    usualChip: "Usual rules",
    changedChip: "Changed",
    editTitle: (name) => `${name}: rewards`,
    unitField: "Earns",
    baseField: (unit) => (unit === "miles" ? "Usual rate (miles a dollar)" : "Usual rate (% back)"),
    bonusHeading: (index) => `Bonus ${index}`,
    bonusCategories: "Categories",
    anyCategory: "Any category",
    bonusChannel: "Paid",
    channelOptions: [
      { value: "", label: "Any way" },
      { value: "online", label: "Online" },
      { value: "contactless", label: "By tap" },
      { value: "online,contactless", label: "Online or by tap" },
      { value: "foreign", label: "In another currency" }
    ],
    bonusMatch: "Counts when",
    matchBoth: "Both the category and the way paid match",
    matchEither: "Either one matches",
    bonusRate: (unit) => (unit === "miles" ? "Bonus rate (miles a dollar)" : "Bonus rate (% back)"),
    bonusCap: "Bonus spending cap ($, blank for none)",
    bonusResets: "Cap starts again",
    resetsCalendar: "Each calendar month",
    resetsStatement: "Each statement month",
    statementDay: "Statement month starts on day",
    bonusExcept: "Not for",
    noneLeftOut: "None left out",
    removeBonus: "Remove this bonus",
    addBonus: "Add a bonus",
    excluded: "Earns nothing on",
    noneExcluded: "Nothing left out",
    minSpend: "Monthly minimum spending ($, blank for none)",
    minCount: "Payments needed a month (blank for none)",
    usualFrom: (source) => `Usual rules: ${source}`,
    check: (text) => text,
    reset: "Reset to the usual rules",
    resetNone: "Clear these rules",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    setUp: "Set up",
    selected: (count) => `${count} chosen`,
    saved: (name) => `${name}: rewards saved.`,
    wasReset: (name) => `${name}: back to the usual rules.`,
    restored: (name) => `${name}: put back as it was.`,
    undo: "Undo",
    loadFailed: "Cards and rewards could not be read. Try again later.",
    saveFailed: "That didn't save. Try again.",
    badNumber: "Check the numbers: use digits only, like 4 or 1000.",
    empty: "No credit cards yet. Add one under Accounts."
  }
};
