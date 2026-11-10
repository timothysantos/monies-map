// Card reward rules (DOMAIN.md "Card reward rule"): what each credit card
// pays back, in miles or cashback, and the deterministic engine behind
// Summary's "Miles and cashback" card. Pure: no database, no AI, no clock
// (the caller passes today). It says which of a person's OWN cards pays
// most; it never compares miles with dollars, never suggests one person's
// card for another person's spending, and is never investment advice.
//
// Every figure is an estimate: the way an entry was paid (online, by tap,
// in another currency) is read from its description and source, and the
// bank's statement points are the final word.
import { addDays, addMonths } from "./money-signals/format";

export type RewardUnit = "miles" | "cashback";
export type RewardChannel = "online" | "contactless" | "foreign";
export type RewardCycleKind = "calendar" | "statement";

export interface RewardCycle {
  kind: RewardCycleKind;
  // The first day of a statement month (1 to 28); 1 for a calendar month.
  day: number;
}

export interface RewardBonusRule {
  id: string;
  // Category names. Empty: any category.
  categories: string[];
  // Categories the bonus never applies to (they still earn the base rate).
  exceptCategories: string[];
  // Ways of paying. Empty: any way.
  channels: RewardChannel[];
  // "both": the category and the way of paying must match; "either": one
  // of them is enough (Citi Rewards: online, or shopping in a shop).
  match: "both" | "either";
  // Miles a dollar, or percent back.
  rate: number;
  // Eligible spending per cycle, in cents; null: no cap.
  capMinor: number | null;
  cycle: RewardCycle;
}

export interface CardRewardRules {
  unit: RewardUnit;
  baseRate: number;
  bonuses: RewardBonusRule[];
  // Categories that earn nothing and never count toward a minimum.
  excludedCategories: string[];
  // Cashback cards: the month's minimum spending and number of payments
  // for the bonus rates; below it only the base rate is paid.
  minSpendMinor: number | null;
  minCount: number | null;
  // The preset the rules came from, if any (card-reward-presets.ts).
  presetKey: string | null;
}

export const REWARD_CHANNELS: readonly RewardChannel[] = ["online", "contactless", "foreign"];
export const CARD_REWARD_LIMITS = Object.freeze({
  maxBonuses: 6,
  maxCategories: 30,
  maxNameLength: 60,
  maxMilesRate: 30,
  maxCashbackRate: 20,
  maxCapMinor: 10_000_000,
  maxCount: 50,
  bonusId: /^[a-z0-9-]{1,24}$/
});

export class CardRewardRulesRefused extends Error {}

// ---- Reading and checking rules -------------------------------------------

function readNames(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CardRewardRulesRefused(`${field} must be a list of category names.`);
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new CardRewardRulesRefused(`${field} must be a list of category names.`);
    const name = item.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > CARD_REWARD_LIMITS.maxNameLength) throw new CardRewardRulesRefused("A category name is too long.");
    names.add(name);
  }
  if (names.size > CARD_REWARD_LIMITS.maxCategories) throw new CardRewardRulesRefused("That is too many categories.");
  return [...names];
}

function readRate(value: unknown, unit: RewardUnit, field: string): number {
  const rate = typeof value === "string" ? Number(value) : value;
  const max = unit === "miles" ? CARD_REWARD_LIMITS.maxMilesRate : CARD_REWARD_LIMITS.maxCashbackRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > max) {
    throw new CardRewardRulesRefused(unit === "miles"
      ? `${field} must be between 0 and ${max} miles a dollar.`
      : `${field} must be between 0% and ${max}%.`);
  }
  return Math.round(rate * 100) / 100;
}

function readMinor(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const minor = typeof value === "string" ? Number(value) : value;
  if (typeof minor !== "number" || !Number.isInteger(minor) || minor <= 0 || minor > CARD_REWARD_LIMITS.maxCapMinor) {
    throw new CardRewardRulesRefused(`${field} must be a whole amount above $0.`);
  }
  return minor;
}

function readCycle(value: unknown): RewardCycle {
  const cycle = (value ?? {}) as { kind?: unknown; day?: unknown };
  if (cycle.kind === undefined || cycle.kind === "calendar") return { kind: "calendar", day: 1 };
  if (cycle.kind !== "statement") throw new CardRewardRulesRefused("A bonus resets each calendar month or each statement month.");
  const day = Number(cycle.day ?? 1);
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new CardRewardRulesRefused("The statement day must be from 1 to 28.");
  return { kind: "statement", day };
}

/**
 * Checks and tidies rules from a person (Settings) or from storage. Throws
 * CardRewardRulesRefused with a plain reason; never guesses a value.
 */
export function readCardRewardRules(input: unknown): CardRewardRules {
  if (!input || typeof input !== "object") throw new CardRewardRulesRefused("Those rules could not be read.");
  const raw = input as Record<string, unknown>;
  if (raw.unit !== "miles" && raw.unit !== "cashback") throw new CardRewardRulesRefused("A card earns miles or cashback.");
  const unit = raw.unit;
  const bonusesInput = raw.bonuses ?? [];
  if (!Array.isArray(bonusesInput)) throw new CardRewardRulesRefused("The bonuses could not be read.");
  if (bonusesInput.length > CARD_REWARD_LIMITS.maxBonuses) throw new CardRewardRulesRefused(`A card can have at most ${CARD_REWARD_LIMITS.maxBonuses} bonuses.`);
  const ids = new Set<string>();
  const bonuses = bonusesInput.map((item, index): RewardBonusRule => {
    if (!item || typeof item !== "object") throw new CardRewardRulesRefused("A bonus could not be read.");
    const bonus = item as Record<string, unknown>;
    let id = typeof bonus.id === "string" && CARD_REWARD_LIMITS.bonusId.test(bonus.id) ? bonus.id : `bonus-${index + 1}`;
    while (ids.has(id)) id = `${id}-${index + 1}`.slice(0, 24);
    ids.add(id);
    const channelsInput = bonus.channels ?? [];
    if (!Array.isArray(channelsInput) || channelsInput.some((channel) => !REWARD_CHANNELS.includes(channel as RewardChannel))) {
      throw new CardRewardRulesRefused("A way of paying must be online, by tap or in another currency.");
    }
    const categories = readNames(bonus.categories, "Categories");
    const channels = [...new Set(channelsInput as RewardChannel[])];
    if (bonus.match !== undefined && bonus.match !== "both" && bonus.match !== "either") {
      throw new CardRewardRulesRefused("A bonus needs both the category and the way of paying, or either one.");
    }
    return {
      id,
      categories,
      exceptCategories: readNames(bonus.exceptCategories, "Categories left out"),
      channels,
      match: bonus.match === "either" && categories.length && channels.length ? "either" : "both",
      rate: readRate(bonus.rate, unit, "A bonus rate"),
      capMinor: readMinor(bonus.capMinor, "The bonus cap"),
      cycle: readCycle(bonus.cycle)
    };
  });
  const minCount = raw.minCount === undefined || raw.minCount === null || raw.minCount === "" ? null : Number(raw.minCount);
  if (minCount !== null && (!Number.isInteger(minCount) || minCount < 1 || minCount > CARD_REWARD_LIMITS.maxCount)) {
    throw new CardRewardRulesRefused(`The number of payments must be from 1 to ${CARD_REWARD_LIMITS.maxCount}.`);
  }
  return {
    unit,
    baseRate: readRate(raw.baseRate ?? 0, unit, "The usual rate"),
    bonuses,
    excludedCategories: readNames(raw.excludedCategories, "Categories that earn nothing"),
    // A monthly minimum belongs to cashback cards only.
    minSpendMinor: unit === "cashback" ? readMinor(raw.minSpendMinor, "The monthly minimum") : null,
    minCount: unit === "cashback" ? minCount : null,
    presetKey: typeof raw.presetKey === "string" && raw.presetKey.length <= 40 ? raw.presetKey : null
  };
}

/** The same rules, compared field by field (Settings: "the usual rules"). */
export function sameCardRewardRules(left: CardRewardRules, right: CardRewardRules) {
  // Read both the same way, so the order of fields never matters.
  const strip = (rules: CardRewardRules) => JSON.stringify({ ...readCardRewardRules(rules), presetKey: null });
  return strip(left) === strip(right);
}

// ---- How an entry was paid (an estimate) ----------------------------------

const ONLINE_PATTERNS: readonly RegExp[] = [
  /^AMAZE\*/i,
  /\bWWW\./i,
  /\.COM\b/i,
  /\.SG\b/i,
  /\bSHOPEE\b/i,
  /\bLAZADA\b/i,
  /\bAMAZON\b/i,
  /\bTAOBAO\b/i,
  /\bQOO10\b/i,
  /\bGRAB\*/i,
  /\bGRABFOOD\b/i,
  /\bFOODPANDA\b/i,
  /\bDELIVEROO\b/i,
  /\bNETFLIX\b/i,
  /\bSPOTIFY\b/i,
  /\bDISNEY\s*PLUS\b/i,
  /\bPAYPAL\b/i,
  /\bKLOOK\b/i,
  /\bAGODA\b/i,
  /\bAIRBNB\b/i,
  /\bTRIP\.COM\b/i,
  /\bGOOGLE\b/i,
  /\bAPPLE\.COM\b/i
];

export interface ChannelFacts {
  description: string;
  externalReference?: string | null;
  originalCurrency?: string | null;
  currency?: string | null;
}

/**
 * The ways an entry looks to have been paid: an Apple Pay Shortcut entry
 * was a tap (contactless); another currency is foreign; a web shop or an
 * Amaze charge is online. Empty when nothing says (the base rate, unless a
 * category bonus matches). Always an estimate.
 */
export function entryChannels(facts: ChannelFacts): RewardChannel[] {
  const channels: RewardChannel[] = [];
  const currency = (facts.originalCurrency || facts.currency || "SGD").toUpperCase();
  if (currency !== "SGD") channels.push("foreign");
  const description = facts.description ?? "";
  if (ONLINE_PATTERNS.some((pattern) => pattern.test(description))) channels.push("online");
  if (String(facts.externalReference ?? "").startsWith("shortcut:") && !channels.includes("online")) channels.push("contactless");
  return channels;
}

// ---- Cycles ---------------------------------------------------------------

const dayOf = (date: string) => Number(date.slice(8, 10));
const withDay = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;

/** The first day of the cycle a date falls in. */
export function cycleStart(date: string, cycle: RewardCycle): string {
  const month = date.slice(0, 7);
  const day = cycle.kind === "statement" ? cycle.day : 1;
  return dayOf(date) >= day ? withDay(month, day) : withDay(addMonths(month, -1), day);
}

/** The first day of the next cycle (the day a cap resets). */
export function nextCycleStart(date: string, cycle: RewardCycle): string {
  const start = cycleStart(date, cycle);
  return withDay(addMonths(start.slice(0, 7), 1), dayOf(start));
}

// ---- Earning --------------------------------------------------------------

export interface RewardEntry {
  id: string;
  date: string;
  accountId: string;
  amountMinor: number;
  categoryName: string;
  channels: RewardChannel[];
}

// Cap usage while entries are replayed in date order: per card, per bonus,
// per cycle start, the eligible spending already counted at the bonus rate.
export type CapUsage = Map<string, number>;

const usageKey = (accountId: string, bonusId: string, start: string) => `${accountId}|${bonusId}|${start}`;
const lower = (name: string) => name.toLowerCase();
const hasName = (list: readonly string[], name: string) => list.some((item) => lower(item) === lower(name));

export function isExcluded(rules: CardRewardRules, categoryName: string) {
  return hasName(rules.excludedCategories, categoryName);
}

/** Whether a bonus applies to an entry (before its cap). */
export function bonusMatches(bonus: RewardBonusRule, entry: Pick<RewardEntry, "categoryName" | "channels">) {
  if (hasName(bonus.exceptCategories, entry.categoryName)) return false;
  const categoryOk = !bonus.categories.length || hasName(bonus.categories, entry.categoryName);
  const channelOk = !bonus.channels.length || bonus.channels.some((channel) => entry.channels.includes(channel));
  if (bonus.match === "either" && bonus.categories.length && bonus.channels.length) {
    return (bonus.categories.length > 0 && hasName(bonus.categories, entry.categoryName)) || bonus.channels.some((channel) => entry.channels.includes(channel));
  }
  return categoryOk && channelOk;
}

export interface EarnPart {
  bonusId: string | null;
  amountMinor: number;
  rate: number;
}

export interface EarnQuote {
  // Miles, or cashback in cents, before any monthly minimum.
  earned: number;
  parts: EarnPart[];
  excluded: boolean;
}

// Whole miles (or cents) from a sum of parts: a hair of float error never
// takes one away.
const floorEarned = (value: number) => Math.floor(value + 1e-6);

// Miles for an amount in cents at miles a dollar, or cashback cents at a percent.
export function earnFor(unit: RewardUnit, amountMinor: number, rate: number) {
  // Rounded to a millionth, so 700 x 1.4 is 980 and not 979.99999.
  // Miles: dollars x miles a dollar; cashback cents: cents x percent / 100.
  const value = unit === "miles" ? (amountMinor / 100) * rate : (amountMinor * rate) / 100;
  return Math.round(value * 1e6) / 1e6;
}

/**
 * What one entry earns on a card, given the caps already used: the
 * highest-rate matching bonus first, up to its room, then the next, then
 * the base rate. Nothing for an excluded category. Does not change `usage`.
 */
export function quoteEntry(rules: CardRewardRules, accountId: string, usage: CapUsage, entry: RewardEntry): EarnQuote {
  if (entry.amountMinor <= 0 || isExcluded(rules, entry.categoryName)) {
    return { earned: 0, parts: [], excluded: true };
  }
  const matching = rules.bonuses.filter((bonus) => bonusMatches(bonus, entry)).sort((left, right) => right.rate - left.rate);
  let remaining = entry.amountMinor;
  const parts: EarnPart[] = [];
  for (const bonus of matching) {
    if (remaining <= 0 || bonus.rate <= rules.baseRate) break;
    const used = usage.get(usageKey(accountId, bonus.id, cycleStart(entry.date, bonus.cycle))) ?? 0;
    const room = bonus.capMinor === null ? remaining : Math.max(0, bonus.capMinor - used);
    const take = Math.min(remaining, room);
    if (take > 0) {
      parts.push({ bonusId: bonus.id, amountMinor: take, rate: bonus.rate });
      remaining -= take;
    }
  }
  if (remaining > 0) parts.push({ bonusId: null, amountMinor: remaining, rate: rules.baseRate });
  return { earned: parts.reduce((sum, part) => sum + earnFor(rules.unit, part.amountMinor, part.rate), 0), parts, excluded: false };
}

/** Counts a quote's bonus parts against their caps. */
export function applyQuote(rules: CardRewardRules, accountId: string, usage: CapUsage, entry: RewardEntry, quote: EarnQuote) {
  for (const part of quote.parts) {
    if (!part.bonusId) continue;
    const bonus = rules.bonuses.find((item) => item.id === part.bonusId);
    if (!bonus) continue;
    const key = usageKey(accountId, bonus.id, cycleStart(entry.date, bonus.cycle));
    usage.set(key, (usage.get(key) ?? 0) + part.amountMinor);
  }
}

export interface EarnedEntry {
  entry: RewardEntry;
  accountId: string;
  quote: EarnQuote;
  // After a cashback card's monthly minimum (the base rate when missed).
  earned: number;
}

/**
 * Replays entries in date order on the cards given by `cardFor` (the card
 * actually used, or the best one), then applies each cashback card's
 * monthly minimum: a month below it pays only the base rate. `months` that
 * are still running are judged as they stand.
 */
export function replayEarnings(
  entries: RewardEntry[],
  rulesByAccount: ReadonlyMap<string, CardRewardRules>,
  cardFor: (entry: RewardEntry, usage: CapUsage) => string | null,
  usage: CapUsage = new Map()
): EarnedEntry[] {
  const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const earned: EarnedEntry[] = [];
  for (const entry of sorted) {
    const accountId = cardFor(entry, usage);
    const rules = accountId ? rulesByAccount.get(accountId) : undefined;
    if (!accountId || !rules) continue;
    const quote = quoteEntry(rules, accountId, usage, entry);
    applyQuote(rules, accountId, usage, entry, quote);
    earned.push({ entry, accountId, quote, earned: quote.earned });
  }
  return applyMonthlyMinimums(earned, rulesByAccount);
}

export interface MonthlyMinimum {
  spentMinor: number;
  count: number;
  met: boolean;
}

/** A cashback card's month against its minimum spending and payments. */
export function monthlyMinimum(rules: CardRewardRules, earned: EarnedEntry[]): MonthlyMinimum {
  const counted = earned.filter((item) => !item.quote.excluded);
  const spentMinor = counted.reduce((sum, item) => sum + item.entry.amountMinor, 0);
  const count = counted.length;
  const met = (rules.minSpendMinor === null || spentMinor >= rules.minSpendMinor) && (rules.minCount === null || count >= rules.minCount);
  return { spentMinor, count, met };
}

function applyMonthlyMinimums(earned: EarnedEntry[], rulesByAccount: ReadonlyMap<string, CardRewardRules>): EarnedEntry[] {
  const groups = new Map<string, EarnedEntry[]>();
  for (const item of earned) {
    const rules = rulesByAccount.get(item.accountId);
    if (!rules || rules.unit !== "cashback" || (rules.minSpendMinor === null && rules.minCount === null)) continue;
    const key = `${item.accountId}|${item.entry.date.slice(0, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, items] of groups) {
    const rules = rulesByAccount.get(key.split("|")[0])!;
    if (monthlyMinimum(rules, items).met) continue;
    for (const item of items) {
      item.earned = item.quote.excluded ? 0 : earnFor(rules.unit, item.entry.amountMinor, rules.baseRate);
    }
  }
  return earned;
}

// ---- The person's picture: this cycle, best card now, cap notices, looking back

export interface RewardCard {
  accountId: string;
  name: string;
  personId: string;
  rules: CardRewardRules;
}

export interface BonusProgress {
  bonusId: string;
  rate: number;
  categories: string[];
  channels: RewardChannel[];
  match: "both" | "either";
  capMinor: number | null;
  cycleStart: string;
  resetsOn: string;
  // All matching spending this cycle (the openable figure), and how much of
  // it counted at the bonus rate (at most the cap).
  eligibleMinor: number;
  eligibleIds: string[];
  usedMinor: number;
  roomMinor: number | null;
}

export interface CardThisCycle {
  accountId: string;
  name: string;
  personId: string;
  unit: RewardUnit;
  cycleStart: string;
  resetsOn: string;
  // Miles, or cashback cents, rounded down.
  earned: number;
  spendMinor: number;
  ids: string[];
  bonuses: BonusProgress[];
  minimum: (MonthlyMinimum & { needMinor: number; needCount: number }) | null;
}

// A card's own "this cycle": its statement month when any bonus runs by
// statement, else the calendar month.
export function cardCycle(rules: CardRewardRules): RewardCycle {
  return rules.bonuses.find((bonus) => bonus.cycle.kind === "statement")?.cycle ?? { kind: "calendar", day: 1 };
}

/**
 * Each card's figures for the cycle `today` is in: what it earned, its
 * spending, and how much of each capped bonus is used. `entries` must reach
 * back to the start of every cycle (the caller loads a few months).
 */
export function cardsThisCycle(cards: RewardCard[], entries: RewardEntry[], today: string): CardThisCycle[] {
  const rulesByAccount = new Map(cards.map((card) => [card.accountId, card.rules]));
  const actual = replayEarnings(entries.filter((entry) => entry.date <= today), rulesByAccount, (entry) => entry.accountId);
  return cards.map((card) => {
    const cycle = cardCycle(card.rules);
    const start = cycleStart(today, cycle);
    const mine = actual.filter((item) => item.accountId === card.accountId);
    const inCycle = mine.filter((item) => item.entry.date >= start);
    const bonuses = card.rules.bonuses.map((bonus): BonusProgress => {
      const bonusStart = cycleStart(today, bonus.cycle);
      const inBonusCycle = mine.filter((item) => item.entry.date >= bonusStart && !item.quote.excluded && bonusMatches(bonus, item.entry));
      const usedMinor = inBonusCycle.reduce((sum, item) => sum + item.quote.parts.filter((part) => part.bonusId === bonus.id).reduce((total, part) => total + part.amountMinor, 0), 0);
      return {
        bonusId: bonus.id,
        rate: bonus.rate,
        categories: bonus.categories,
        channels: bonus.channels,
        match: bonus.match,
        capMinor: bonus.capMinor,
        cycleStart: bonusStart,
        resetsOn: nextCycleStart(today, bonus.cycle),
        eligibleMinor: inBonusCycle.reduce((sum, item) => sum + item.entry.amountMinor, 0),
        eligibleIds: inBonusCycle.map((item) => item.entry.id).sort(),
        usedMinor,
        roomMinor: bonus.capMinor === null ? null : Math.max(0, bonus.capMinor - usedMinor)
      };
    });
    let minimum: CardThisCycle["minimum"] = null;
    if (card.rules.unit === "cashback" && (card.rules.minSpendMinor !== null || card.rules.minCount !== null)) {
      const month = mine.filter((item) => item.entry.date.slice(0, 7) === today.slice(0, 7));
      const state = monthlyMinimum(card.rules, month);
      minimum = {
        ...state,
        needMinor: Math.max(0, (card.rules.minSpendMinor ?? 0) - state.spentMinor),
        needCount: Math.max(0, (card.rules.minCount ?? 0) - state.count)
      };
    }
    return {
      accountId: card.accountId,
      name: card.name,
      personId: card.personId,
      unit: card.rules.unit,
      cycleStart: start,
      resetsOn: nextCycleStart(today, cycle),
      earned: floorEarned(inCycle.reduce((sum, item) => sum + item.earned, 0)),
      spendMinor: inCycle.reduce((sum, item) => sum + item.entry.amountMinor, 0),
      ids: inCycle.map((item) => item.entry.id).sort(),
      bonuses,
      minimum
    };
  });
}

/**
 * Miles (or cashback cents) a set of entries earned on one card, replayed
 * from the start of its cycle: the rule behind a card's "this month"
 * figure (money-figures.ts), worked out again from Entries' own rows.
 */
export function earnedOnCard(rules: CardRewardRules, accountId: string, entries: RewardEntry[]): number {
  const map = new Map([[accountId, rules]]);
  return floorEarned(replayEarnings(entries.filter((entry) => entry.accountId === accountId), map, (entry) => entry.accountId)
    .reduce((sum, item) => sum + item.earned, 0));
}

export interface BestCardNow {
  categoryName: string;
  unit: RewardUnit;
  accountId: string;
  // The rate the next dollar earns there now (miles a dollar or percent),
  // given the caps left, for the way this person usually pays here.
  rate: number;
  bonusId: string | null;
  roomMinor: number | null;
  // Ways of paying the bonus needs ("online", "contactless"), when it needs one.
  needs: RewardChannel[];
  // The card most of this category's spending went on lately, and its rate now.
  usualAccountId: string | null;
  usualRate: number | null;
}

// The rate a card pays now for one entry's kind of spending: the best
// matching bonus with room left in the current cycle, else the base rate.
function rateNow(card: RewardCard, usage: CapUsage, entry: RewardEntry, today: string) {
  const { rules } = card;
  if (isExcluded(rules, entry.categoryName)) return { rate: 0, bonus: null as RewardBonusRule | null, roomMinor: null as number | null };
  let best = { rate: rules.baseRate, bonus: null as RewardBonusRule | null, roomMinor: null as number | null };
  for (const bonus of rules.bonuses) {
    if (!bonusMatches(bonus, entry) || bonus.rate <= best.rate) continue;
    const used = usage.get(usageKey(card.accountId, bonus.id, cycleStart(today, bonus.cycle))) ?? 0;
    const roomMinor = bonus.capMinor === null ? null : Math.max(0, bonus.capMinor - used);
    if (roomMinor === 0) continue;
    best = { rate: bonus.rate, bonus, roomMinor };
  }
  return best;
}

export interface PersonRewardsInput {
  // Whose choice of cards: the cards with this personId are the ones a
  // suggestion may name (a person's own, or every household card under
  // "household" when the household pools its miles).
  personId: string;
  cards: RewardCard[];
  // The spending on those cards, back to the start of the window; all of it
  // uses up caps.
  entries: RewardEntry[];
  today: string;
  // Whose spending the suggestions are about: entries on these accounts
  // (a person view in a pooling household: that person's cards). Default:
  // every card in the choice.
  spendingAccounts?: ReadonlySet<string>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * "Best card now" for the person's top categories (by spending in the last
 * 3 months on their cards), given the caps left this cycle and the way they
 * usually pay for each. One answer per unit they hold: a miles card is never
 * weighed against a cashback card. Only their own cards.
 */
export function bestCardsNow(input: PersonRewardsInput, topCount = 3): BestCardNow[] {
  const cards = input.cards.filter((card) => card.personId === input.personId);
  if (!cards.length) return [];
  const own = new Set(cards.map((card) => card.accountId));
  const rulesByAccount = new Map(cards.map((card) => [card.accountId, card.rules]));
  const windowStart = `${addMonths(input.today.slice(0, 7), -3)}-01`;
  const entries = input.entries.filter((entry) => own.has(entry.accountId) && entry.date <= input.today);
  // The caps used so far this cycle.
  const usage: CapUsage = new Map();
  replayEarnings(entries, rulesByAccount, (entry) => entry.accountId, usage);
  const spending = input.spendingAccounts ?? own;
  const recent = entries.filter((entry) => entry.date >= windowStart && spending.has(entry.accountId));
  const byCategory = new Map<string, RewardEntry[]>();
  for (const entry of recent) {
    if (cards.every((card) => isExcluded(card.rules, entry.categoryName))) continue;
    byCategory.set(entry.categoryName, [...(byCategory.get(entry.categoryName) ?? []), entry]);
  }
  const top = [...byCategory.entries()]
    .map(([name, list]) => ({ name, list, total: list.reduce((sum, entry) => sum + entry.amountMinor, 0) }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
    .slice(0, topCount);
  const answers: BestCardNow[] = [];
  for (const { name, list, total } of top) {
    const spentOn = new Map<string, number>();
    for (const entry of list) spentOn.set(entry.accountId, (spentOn.get(entry.accountId) ?? 0) + entry.amountMinor);
    const usualAccountId = [...spentOn.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    for (const unit of ["miles", "cashback"] as const) {
      const unitCards = cards.filter((card) => card.rules.unit === unit);
      if (!unitCards.length) continue;
      // The rate each card pays on this category's usual mix of ways to pay.
      const scored = unitCards.map((card) => {
        let weighted = 0;
        let lead: ReturnType<typeof rateNow> | null = null;
        for (const entry of list) {
          const now = rateNow(card, usage, entry, input.today);
          weighted += now.rate * entry.amountMinor;
          if (!lead || now.rate > lead.rate) lead = now;
        }
        return { card, rate: round2(weighted / total), lead };
      }).sort((left, right) => right.rate - left.rate || left.card.name.localeCompare(right.card.name));
      const best = scored[0];
      if (!best || best.rate <= 0) continue;
      const usual = usualAccountId ? scored.find((item) => item.card.accountId === usualAccountId) : undefined;
      const bonus = best.lead?.bonus ?? null;
      answers.push({
        categoryName: name,
        unit,
        accountId: best.card.accountId,
        rate: best.rate,
        bonusId: bonus?.id ?? null,
        roomMinor: bonus ? best.lead?.roomMinor ?? null : null,
        needs: bonus ? bonus.channels.filter((channel) => channel !== "foreign") : [],
        usualAccountId: usual ? usualAccountId : null,
        usualRate: usual ? usual.rate : null
      });
    }
  }
  return answers;
}

export type CapNotice =
  | { kind: "used_up"; accountId: string; bonusId: string; resetsOn: string; baseRate: number; unit: RewardUnit; categories: string[]; channels: RewardChannel[]; alternative: { accountId: string; bonusId: string; roomMinor: number | null; rate: number } | null }
  | { kind: "nearly"; accountId: string; bonusId: string; resetsOn: string; roomMinor: number; unit: RewardUnit }
  | { kind: "minimum"; accountId: string; needMinor: number; needCount: number; unit: RewardUnit };

const overlaps = (left: RewardBonusRule | BonusProgress, right: RewardBonusRule) =>
  (!left.categories.length || !right.categories.length || left.categories.some((name) => hasName(right.categories, name)))
  && (!left.channels.length || !right.channels.length || left.channels.some((channel) => right.channels.includes(channel)));

// A bonus counts as nearly used once this much of its cap is gone.
export const NEARLY_USED_SHARE = 0.75;

/**
 * Cap notices for one person this cycle: a bonus used up (with another of
 * their own cards of the same kind that still has room for that spending),
 * a bonus nearly used, and a cashback card short of its monthly minimum.
 */
export function capNotices(personId: string, cards: RewardCard[], thisCycle: CardThisCycle[]): CapNotice[] {
  const mine = thisCycle.filter((card) => card.personId === personId);
  const cardById = new Map(cards.map((card) => [card.accountId, card]));
  const notices: CapNotice[] = [];
  for (const card of mine) {
    const rules = cardById.get(card.accountId)?.rules;
    if (!rules) continue;
    for (const bonus of card.bonuses) {
      if (bonus.capMinor === null || bonus.roomMinor === null) continue;
      if (bonus.roomMinor === 0) {
        let alternative: Extract<CapNotice, { kind: "used_up" }>["alternative"] = null;
        for (const other of mine) {
          if (other.accountId === card.accountId || other.unit !== card.unit) continue;
          const otherRules = cardById.get(other.accountId)?.rules;
          for (const otherBonus of otherRules?.bonuses ?? []) {
            const progress = other.bonuses.find((item) => item.bonusId === otherBonus.id);
            if (!progress || progress.roomMinor === 0 || otherBonus.rate <= (otherRules?.baseRate ?? 0) || !overlaps(bonus, otherBonus)) continue;
            if (!alternative || otherBonus.rate > alternative.rate) {
              alternative = { accountId: other.accountId, bonusId: otherBonus.id, roomMinor: progress.roomMinor, rate: otherBonus.rate };
            }
          }
        }
        notices.push({ kind: "used_up", accountId: card.accountId, bonusId: bonus.bonusId, resetsOn: bonus.resetsOn, baseRate: rules.baseRate, unit: card.unit, categories: bonus.categories, channels: bonus.channels, alternative });
      } else if (bonus.usedMinor >= bonus.capMinor * NEARLY_USED_SHARE) {
        notices.push({ kind: "nearly", accountId: card.accountId, bonusId: bonus.bonusId, resetsOn: bonus.resetsOn, roomMinor: bonus.roomMinor, unit: card.unit });
      }
    }
    if (card.minimum && !card.minimum.met && card.minimum.spentMinor > 0) {
      notices.push({ kind: "minimum", accountId: card.accountId, needMinor: card.minimum.needMinor, needCount: card.minimum.needCount, unit: card.unit });
    }
  }
  const order = { used_up: 0, nearly: 1, minimum: 2 };
  return notices.sort((left, right) => order[left.kind] - order[right.kind]);
}

export interface LookingBackChange {
  categoryName: string;
  fromAccountId: string;
  toAccountId: string;
  // The spending that would have moved (an openable figure) and what it
  // would have added (miles, or cashback cents).
  spendMinor: number;
  ids: string[];
  gain: number;
}

export interface LookingBack {
  unit: RewardUnit;
  startDate: string;
  endDate: string;
  earned: number;
  best: number;
  // best - earned, never below 0, rounded down.
  gain: number;
  ids: string[];
  changes: LookingBackChange[];
}

// The window looked back over: the last 3 whole calendar months.
export function lookingBackWindow(today: string) {
  const month = today.slice(0, 7);
  return { startDate: `${addMonths(month, -3)}-01`, endDate: addDays(`${month}-01`, -1) };
}

/**
 * Looking back over the last 3 whole months: what the person's spending
 * earned, against what the best of their own cards of the same kind would
 * have earned, replaying the caps in date order (each entry goes to the
 * card that pays most for it at that point). Miles and cashback apart;
 * never one converted into the other. Entries before the window count
 * toward caps only.
 */
export function lookingBack(input: PersonRewardsInput): LookingBack[] {
  const cards = input.cards.filter((card) => card.personId === input.personId);
  const { startDate, endDate } = lookingBackWindow(input.today);
  const results: LookingBack[] = [];
  for (const unit of ["miles", "cashback"] as const) {
    const unitCards = cards.filter((card) => card.rules.unit === unit);
    if (!unitCards.length) continue;
    const own = new Set(unitCards.map((card) => card.accountId));
    const rulesByAccount = new Map(unitCards.map((card) => [card.accountId, card.rules]));
    const entries = input.entries.filter((entry) => own.has(entry.accountId) && entry.date <= endDate);
    if (!entries.some((entry) => entry.date >= startDate && (input.spendingAccounts ?? own).has(entry.accountId))) continue;
    const actual = replayEarnings(entries, rulesByAccount, (entry) => entry.accountId);
    const best = replayEarnings(entries, rulesByAccount, (entry, usage) => {
      let choice = entry.accountId;
      let top = -1;
      for (const card of unitCards) {
        const earned = quoteEntry(card.rules, card.accountId, usage, entry).earned;
        // Ties stay on the card actually used.
        if (earned > top + 1e-9 || (Math.abs(earned - top) <= 1e-9 && card.accountId === entry.accountId)) {
          top = earned;
          choice = card.accountId;
        }
      }
      return choice;
    });
    const spending = input.spendingAccounts ?? own;
    const inWindow = (item: EarnedEntry) => item.entry.date >= startDate && spending.has(item.entry.accountId);
    const earned = actual.filter(inWindow).reduce((sum, item) => sum + item.earned, 0);
    const bestTotal = best.filter(inWindow).reduce((sum, item) => sum + item.earned, 0);
    const actualById = new Map(actual.map((item) => [item.entry.id, item]));
    const changes = new Map<string, LookingBackChange>();
    for (const item of best.filter(inWindow)) {
      const was = actualById.get(item.entry.id);
      if (!was || was.accountId === item.accountId) continue;
      const key = `${item.entry.categoryName}|${was.accountId}|${item.accountId}`;
      const change = changes.get(key) ?? { categoryName: item.entry.categoryName, fromAccountId: was.accountId, toAccountId: item.accountId, spendMinor: 0, ids: [], gain: 0 };
      change.spendMinor += item.entry.amountMinor;
      change.ids.push(item.entry.id);
      change.gain += item.earned - was.earned;
      changes.set(key, change);
    }
    const gain = Math.max(0, floorEarned(bestTotal - earned));
    const movedIds = [...changes.values()].flatMap((change) => change.ids).sort();
    const top = [...changes.values()]
      .filter((change) => change.gain >= 1)
      .sort((left, right) => right.gain - left.gain || left.categoryName.localeCompare(right.categoryName))
      .slice(0, 3)
      .map((change) => ({ ...change, gain: floorEarned(change.gain), ids: change.ids.sort() }));
    results.push({
      unit,
      startDate,
      endDate,
      earned: floorEarned(earned),
      best: floorEarned(bestTotal),
      gain,
      ids: gain > 0 ? movedIds : [],
      changes: gain > 0 ? top : []
    });
  }
  return results;
}
