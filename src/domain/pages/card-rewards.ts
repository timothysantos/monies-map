import { todayInAppTimeZone } from "../../lib/app-calendar";
import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import {
  CARD_REWARD_HOUSEHOLD_CHOICE as HOUSEHOLD_CHOICE,
  ensureCardRewardRules,
  loadCardRewardSuggestFrom,
  type CardRewardSuggestFrom,
  loadCardRewardRows,
  loadCardStatementDays,
  loadCreditCardAccounts
} from "../app-repository-card-rewards";
import {
  bestCardsNow,
  capNotices,
  cardsThisCycle,
  entryChannels,
  lookingBack,
  sameCardRewardRules,
  type BestCardNow,
  type CapNotice,
  type CardRewardRules,
  type CardThisCycle,
  type LookingBack,
  type RewardCard,
  type RewardEntry
} from "../card-rewards";
import { presetByKey, presetForAccountName, rulesFromPreset } from "../card-reward-presets";
import { addMonths } from "../money-signals/format";
import { resolvePageViewId } from "../route-context";

// GET /api/card-rewards (DOMAIN.md "Card reward rule"): Summary's "Miles
// and cashback" card for a view. Read-only apart from copying in a card's
// preset the first time it is read; no AI; not part of any first-screen
// payload (the card asks once the top summary is usable). Every read starts
// at once (one step): the credit cards, their rules, their statement days,
// the people and the cards' spending of the last 4 months (bounded by date,
// on the household-date index).
//
// GET /api/card-rewards/rules: Settings' "Cards and rewards" list.
//
// Rewards are about whole card amounts (the bank pays on what was charged),
// so a figure here is never a person's share of a split entry: its "View
// entries" opens the household view (data-fig-view on the card).

export const CARD_REWARD_ENTRIES_SQL = `
  SELECT
    transactions.id,
    transactions.account_id,
    transactions.transaction_date,
    transactions.amount_minor,
    transactions.description,
    transactions.external_reference,
    transactions.original_currency,
    transactions.currency,
    categories.name AS category_name
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id AND accounts.account_kind = 'credit_card'
  LEFT JOIN imports ON imports.id = transactions.import_id
  LEFT JOIN categories ON categories.id = transactions.category_id
  WHERE transactions.household_id = ?
    AND transactions.transaction_date >= ?
    AND transactions.transaction_date <= ?
    AND transactions.entry_type = 'expense'
    AND transactions.transfer_group_id IS NULL
    AND transactions.amount_minor > 0
    AND (transactions.import_id IS NULL OR imports.status = 'completed')
`;

interface EntryRow {
  id: string;
  account_id: string;
  transaction_date: string;
  amount_minor: number;
  description: string;
  external_reference: string | null;
  original_currency: string | null;
  currency: string | null;
  category_name: string | null;
}

export interface CardRewardBonusDto {
  bonusId: string;
  rate: number;
  categories: string[];
  channels: string[];
  match: "both" | "either";
  capMinor: number | null;
  eligibleMinor: number;
  eligibleIds: string[];
  usedMinor: number;
  roomMinor: number | null;
  resetsOn: string;
  period: string;
}

export interface CardRewardCardDto {
  accountId: string;
  name: string;
  ownerName: string;
  unit: "miles" | "cashback";
  baseRate: number;
  cycleKind: "calendar" | "statement";
  cycleStart: string;
  resetsOn: string;
  period: string;
  earned: number;
  // What the same days of the cycle before earned (the Miles change note).
  earnedBefore: number;
  spendMinor: number;
  ids: string[];
  bonuses: CardRewardBonusDto[];
  minimum: CardThisCycle["minimum"];
}

// One picture: a person's (each person's own cards, or a person view), or
// the household's (personId "household", name "") when it pools its miles.
export interface CardRewardPersonDto {
  personId: string;
  name: string;
  cards: CardRewardCardDto[];
  best: BestCardNow[];
  notices: CapNotice[];
  lookingBack: Array<LookingBack & { period: string }>;
}

export interface CardRewardsDto {
  viewId: string;
  today: string;
  // Whose cards a suggestion may name: the whole household's (the default)
  // or each person's own.
  suggestFrom: CardRewardSuggestFrom;
  people: CardRewardPersonDto[];
  // Credit cards with no rules (no preset matched): Settings can set them up.
  notSetUp: number;
}

// "YYYY-MM:YYYY-MM": the months a figure's entries fall in.
const periodOf = (startDate: string, endDate: string) => `${startDate.slice(0, 7)}:${endDate.slice(0, 7)}`;
const dayBefore = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

async function loadPeople(db: D1Database) {
  const result = await db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at")
    .bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>();
  return result.results.map((row) => ({ id: row.id, name: row.display_name }));
}

// The first day read: four whole months back, so looking back (3 whole
// months) and any statement month that began last month have their caps.
export function cardRewardsWindowStart(today: string) {
  return `${addMonths(today.slice(0, 7), -4)}-01`;
}

export async function buildCardRewardsDto(db: D1Database, selectedViewId = "household", today = todayInAppTimeZone()): Promise<CardRewardsDto> {
  const start = cardRewardsWindowStart(today);
  const [accounts, rows, statementDays, people, entryRows, suggestFrom] = await Promise.all([
    loadCreditCardAccounts(db),
    loadCardRewardRows(db),
    loadCardStatementDays(db),
    loadPeople(db),
    db.prepare(CARD_REWARD_ENTRIES_SQL).bind(DEFAULT_HOUSEHOLD_ID, start, today).all<EntryRow>(),
    loadCardRewardSuggestFrom(db)
  ]);
  const rules = await ensureCardRewardRules(db, { accounts, rows, statementDays });
  const viewId = resolvePageViewId(selectedViewId, people);

  // A card belongs to its owner; a joint card or one with no owner is
  // nobody's to choose, so it is left out of the suggestions.
  const cards: RewardCard[] = accounts
    .filter((account) => account.owner_person_id && !account.is_joint && rules.has(account.id))
    .map((account) => ({ accountId: account.id, name: account.account_name, personId: account.owner_person_id!, rules: rules.get(account.id)!.rules }));
  const activeIds = new Set(accounts.filter((account) => account.is_active).map((account) => account.id));
  const entries: RewardEntry[] = entryRows.results.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    date: row.transaction_date,
    amountMinor: row.amount_minor,
    categoryName: row.category_name ?? "Other",
    channels: entryChannels({ description: row.description, externalReference: row.external_reference, originalCurrency: row.original_currency, currency: row.currency })
  }));
  const thisCycle = cardsThisCycle(cards, entries, today);

  const ownerName = new Map(people.map((person) => [person.id, person.name]));
  const cardDto = (card: CardThisCycle): CardRewardCardDto => {
    const cardRules = rules.get(card.accountId)!.rules;
    return {
      accountId: card.accountId,
      name: card.name,
      ownerName: ownerName.get(card.personId) ?? "",
      unit: card.unit,
      baseRate: cardRules.baseRate,
      cycleKind: cardRules.bonuses.some((bonus) => bonus.cycle.kind === "statement") ? "statement" : "calendar",
      cycleStart: card.cycleStart,
      resetsOn: card.resetsOn,
      period: periodOf(card.cycleStart, dayBefore(card.resetsOn)),
      earned: card.earned,
      earnedBefore: card.earnedBefore,
      spendMinor: card.spendMinor,
      ids: card.ids,
      bonuses: card.bonuses.map(({ cycleStart: bonusStart, ...bonus }) => ({ ...bonus, period: periodOf(bonusStart, dayBefore(bonus.resetsOn)) })),
      minimum: card.minimum
    };
  };
  // A card is listed while in use, or when it earned this cycle.
  const listed = (card: CardThisCycle) => card.ids.length > 0 || activeIds.has(card.accountId);

  // Which cards a suggestion may name (owner decision, 2026-11-10): the
  // whole household's (it pools its miles; the default) or each person's
  // own. Suggestions only name cards still in use.
  const usable = cards.filter((card) => activeIds.has(card.accountId));
  const pooled = suggestFrom === "household";
  const choiceFor = (personId: string) => (pooled
    ? usable.map((card) => ({ ...card, personId: HOUSEHOLD_CHOICE }))
    : usable.filter((card) => card.personId === personId));
  const suggestions = (personId: string, spendingAccounts?: ReadonlySet<string>) => {
    const choice = choiceFor(personId);
    const chooser = pooled ? HOUSEHOLD_CHOICE : personId;
    const input = { personId: chooser, cards: choice, entries, today, spendingAccounts };
    const cycleForChoice = thisCycle.map((card) => ({ ...card, personId: pooled ? HOUSEHOLD_CHOICE : card.personId }));
    return {
      best: bestCardsNow(input),
      notices: capNotices(chooser, choice, cycleForChoice),
      lookingBack: lookingBack(input).map((item) => ({ ...item, period: periodOf(item.startDate, item.endDate) }))
    };
  };

  const result: CardRewardPersonDto[] = [];
  if (viewId === "household" && pooled) {
    // One household picture: every card, its miles added up on the page.
    const listedCards = thisCycle.filter(listed);
    if (listedCards.length) {
      result.push({ personId: "household", name: "", cards: listedCards.map(cardDto), ...suggestions("household") });
    }
  } else {
    const shown = viewId === "household" ? people : people.filter((person) => person.id === viewId);
    for (const person of shown) {
      const ownCards = thisCycle.filter((card) => card.personId === person.id);
      // A person view in a pooling household: their spending, any card.
      const spendingAccounts = pooled ? new Set(ownCards.map((card) => card.accountId)) : undefined;
      if (!ownCards.length) continue;
      result.push({ personId: person.id, name: person.name, cards: ownCards.filter(listed).map(cardDto), ...suggestions(person.id, spendingAccounts) });
    }
  }
  return {
    viewId,
    today,
    suggestFrom,
    people: result,
    notSetUp: accounts.filter((account) => account.is_active && !rules.has(account.id)).length
  };
}

export interface CardRewardRulesCardDto {
  accountId: string;
  name: string;
  ownerName: string;
  isActive: boolean;
  rules: CardRewardRules | null;
  usual: { name: string; source: string; check: string } | null;
  // The rules are the usual ones (the preset's, as Reset would write them).
  isUsual: boolean;
  updatedAt: string | null;
}

export interface CardRewardRulesDto {
  suggestFrom: CardRewardSuggestFrom;
  cards: CardRewardRulesCardDto[];
}

export async function buildCardRewardRulesDto(db: D1Database): Promise<CardRewardRulesDto> {
  const [accounts, people, rows, statementDays, suggestFrom] = await Promise.all([
    loadCreditCardAccounts(db),
    loadPeople(db),
    loadCardRewardRows(db),
    loadCardStatementDays(db),
    loadCardRewardSuggestFrom(db)
  ]);
  const rules = await ensureCardRewardRules(db, { accounts, rows, statementDays });
  const names = new Map(people.map((person) => [person.id, person.name]));
  return {
    suggestFrom,
    cards: accounts.map((account) => {
      const stored = rules.get(account.id) ?? null;
      const preset = presetByKey(stored?.rules.presetKey) ?? presetForAccountName(account.account_name);
      const usualRules = preset ? rulesFromPreset(preset, statementDays.get(account.id) ?? null) : null;
      return {
        accountId: account.id,
        name: account.account_name,
        ownerName: account.is_joint ? "Shared" : names.get(account.owner_person_id ?? "") ?? "",
        isActive: Boolean(account.is_active),
        rules: stored?.rules ?? null,
        usual: preset ? { name: preset.name, source: preset.source, check: preset.check } : null,
        isUsual: Boolean(stored && usualRules && sameCardRewardRules(stored.rules, usualRules)),
        updatedAt: stored?.updatedAt ?? null
      };
    })
  };
}
