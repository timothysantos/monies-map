// The usual reward rules of the Singapore credit cards the household holds
// (DOMAIN.md "Card reward rule"). ONE config module: every figure here is a
// best-known 2026 rule, simplified to what entries can show, and each one
// says where it came from and to check it once a year, because banks change
// rates, caps and lists of categories without warning.
//
// A preset is matched to an account by its name (`matches`), copied into the
// card's own rules the first time the card is read
// (app-repository-card-rewards.ts), and editable afterwards in Settings >
// Cards and rewards. "Reset to the usual rules" copies the preset again.
// Uncertain figures are not blockers: they are config (owner, 2026-11-10).
//
// Rates are miles a dollar for a miles card and percent back for a cashback
// card. Caps are eligible spending per cycle, in cents.
import type { CardRewardRules, RewardBonusRule } from "./card-rewards";

export interface CardRewardPreset {
  key: string;
  // A plain name for Settings ("UOB Lady's Card").
  name: string;
  matches: RegExp;
  // Where the figures came from, and what to check once a year.
  source: string;
  check: string;
  rules: Omit<CardRewardRules, "presetKey">;
}

// Categories most cards pay nothing on (tax, insurance, school fees,
// government, transfers, charity and money moved to savings). Names that a
// household does not have are harmless.
export const USUAL_EXCLUDED_CATEGORIES: readonly string[] = Object.freeze([
  "Tax", "Insurance", "Education", "Church", "Transfer", "Loans", "Investments", "Savings", "Fees"
]);

const calendar = { kind: "calendar" as const, day: 1 };
// A statement month starts on this day until the card's own statement day is
// known (the seed reads it from the latest statement balance).
const statement = { kind: "statement" as const, day: 1 };

function bonus(rule: Partial<RewardBonusRule> & Pick<RewardBonusRule, "id" | "rate">): RewardBonusRule {
  return {
    categories: [],
    exceptCategories: [],
    channels: [],
    match: "both",
    capMinor: null,
    cycle: calendar,
    ...rule
  };
}

export const CARD_REWARD_PRESETS: readonly CardRewardPreset[] = Object.freeze([
  {
    key: "uob-ladys",
    name: "UOB Lady's Card",
    matches: /\blady'?s\b/i,
    source: "uob.com.sg Lady's Card: 10X UNI$ (4 miles a dollar) on one chosen category, S$1,000 a calendar month; 1X (0.4) elsewhere.",
    check: "Check yearly: the cap, the chosen category (Tim: Dining, filed here as Food & Drinks) and the categories UOB lists.",
    rules: {
      unit: "miles",
      baseRate: 0.4,
      bonuses: [bonus({ id: "chosen", categories: ["Food & Drinks"], rate: 4, capMinor: 100_000, cycle: calendar })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "citi-rewards",
    name: "Citi Rewards",
    matches: /\bciti\b.*\brewards?\b/i,
    source: "citibank.com.sg Citi Rewards: 10X (4 miles a dollar) on online spending and on shopping (clothes, shoes, bags, department stores), not travel, S$1,000 a statement month; 1X (0.4) elsewhere. Amaze (AMAZE*) counts as online.",
    check: "Check yearly: the cap, the statement day, and which online spending Citi leaves out.",
    rules: {
      unit: "miles",
      baseRate: 0.4,
      bonuses: [bonus({ id: "online-shopping", categories: ["Shopping"], channels: ["online"], match: "either", exceptCategories: ["Travel"], rate: 4, capMinor: 100_000, cycle: statement })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "hsbc-revolution",
    name: "HSBC Revolution",
    matches: /\brevolution\b/i,
    source: "hsbc.com.sg Visa Revolution: 10X (4 miles a dollar) on online and contactless spending in its listed categories (dining, shopping, travel, entertainment, beauty), 1X (0.4) elsewhere.",
    check: "Check: the cap was S$1,000 a calendar month for 2026 and HSBC changes its category list; check yearly.",
    rules: {
      unit: "miles",
      baseRate: 0.4,
      bonuses: [bonus({ id: "online-tap", categories: ["Food & Drinks", "Shopping", "Travel", "Entertainment", "Beauty"], channels: ["online", "contactless"], rate: 4, capMinor: 100_000, cycle: calendar })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "citi-premiermiles",
    name: "Citi PremierMiles",
    matches: /\bpremier\s*miles\b|\bciti\b.*\bmiles\b/i,
    source: "citibank.com.sg PremierMiles: 1.2 miles a dollar in Singapore dollars, 2.2 in other currencies, no cap.",
    check: "Check yearly: the local and foreign rates.",
    rules: {
      unit: "miles",
      baseRate: 1.2,
      bonuses: [bonus({ id: "foreign", channels: ["foreign"], rate: 2.2 })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "uob-prvi-miles",
    name: "UOB PRVI Miles",
    matches: /\bpri?vi\b|\bprivi\b/i,
    source: "uob.com.sg PRVI Miles: 1.4 miles a dollar in Singapore dollars, 2.4 in other currencies, no cap.",
    check: "Check yearly: the local and foreign rates.",
    rules: {
      unit: "miles",
      baseRate: 1.4,
      bonuses: [bonus({ id: "foreign", channels: ["foreign"], rate: 2.4 })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "uob-one",
    name: "UOB One Card",
    matches: /\buob\s*one\b/i,
    source: "uob.com.sg One Card: about 3.33% back when a month has at least S$600 of spending and 5 payments (higher tiers at S$1,000 and S$2,000), paid each quarter. Simplified here to its monthly minimum, 3.33% on the first S$1,000.",
    check: "Check yearly: the tiers, the 5 payments a month and the quarterly payout.",
    rules: {
      unit: "cashback",
      baseRate: 0,
      bonuses: [bonus({ id: "tier", rate: 3.33, capMinor: 100_000, cycle: calendar })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: 60_000,
      minCount: 5
    }
  },
  {
    key: "ocbc-365",
    name: "OCBC 365",
    matches: /\b365\b/i,
    source: "ocbc.com OCBC 365: 5% back on dining and food delivery, 3% on groceries and on recurring bills, 0.25% elsewhere, when a month has at least S$800 of spending; about S$80 back a month at most.",
    check: "Check yearly: the S$800 minimum, the rates and the monthly cap.",
    rules: {
      unit: "cashback",
      baseRate: 0.25,
      bonuses: [
        bonus({ id: "dining", categories: ["Food & Drinks"], rate: 5, capMinor: 120_000, cycle: calendar }),
        bonus({ id: "groceries", categories: ["Groceries"], rate: 3, capMinor: 50_000, cycle: calendar }),
        bonus({ id: "bills", categories: ["Bills"], rate: 3, capMinor: 30_000, cycle: calendar })
      ],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: 80_000,
      minCount: null
    }
  },
  {
    key: "ocbc-infinity",
    name: "OCBC Infinity Cashback",
    matches: /\binfinity\b/i,
    source: "ocbc.com Infinity Cashback: 1.6% back on everything, no minimum, no cap.",
    check: "Check yearly: the rate.",
    rules: {
      unit: "cashback",
      baseRate: 1.6,
      bonuses: [],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: null,
      minCount: null
    }
  },
  {
    key: "dbs-live-fresh",
    name: "DBS Live Fresh",
    matches: /\blive\s*fresh\b/i,
    source: "dbs.com.sg Live Fresh: 5% back on online and contactless spending when a month has at least S$800 of spending, about S$32 back a month at most; 0.3% elsewhere.",
    check: "Check yearly: the S$800 minimum, the rate and the cap.",
    rules: {
      unit: "cashback",
      baseRate: 0.3,
      bonuses: [bonus({ id: "online-tap", channels: ["online", "contactless"], rate: 5, capMinor: 64_000, cycle: calendar })],
      excludedCategories: [...USUAL_EXCLUDED_CATEGORIES],
      minSpendMinor: 80_000,
      minCount: null
    }
  }
]);

/**
 * The preset for an account, by its name; null when none matches. The
 * order above matters: "Citi Rewards" is tried before "Citi ... Miles".
 */
export function presetForAccountName(accountName: string): CardRewardPreset | null {
  return CARD_REWARD_PRESETS.find((preset) => preset.matches.test(accountName)) ?? null;
}

export function presetByKey(key: string | null | undefined): CardRewardPreset | null {
  return CARD_REWARD_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * A card's rules from its preset. A statement month starts on the card's
 * statement day when it is known (the day after its latest statement ended).
 */
export function rulesFromPreset(preset: CardRewardPreset, statementDay: number | null = null): CardRewardRules {
  const day = statementDay && statementDay >= 1 && statementDay <= 28 ? statementDay : 1;
  return {
    ...structuredClone(preset.rules),
    bonuses: preset.rules.bonuses.map((rule) => ({
      ...structuredClone(rule),
      cycle: rule.cycle.kind === "statement" ? { kind: "statement" as const, day } : { ...rule.cycle }
    })),
    presetKey: preset.key
  };
}
