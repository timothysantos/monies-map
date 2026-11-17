// Cash entries (DOMAIN.md "Cash Entry"): the defaults the cash pad opens
// with, and the one command both the pad and the "Log cash" Shortcut save
// through. The save itself is the existing all-or-nothing entry command
// (createEntryRecord): this module only decides the fields first, from the
// rules in cash-entry.ts, and never writes anything of its own.
//
// Reads are bounded: one person, the household's accounts, the trips on
// today, and at most CASH_RECENT_ROW_LIMIT of the person's cash payments
// since the earlier of the trip's first day and 7 days ago.

import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { ensureAppSettingsTable } from "./app-settings-table";
import { createEntryRecord } from "./app-repository-entry-commands";
import { buildCategoryGuess } from "./pages/category-guess";
import {
  convertForeignAmount,
  describeForeignAmount,
  FxRateUnavailableError
} from "./foreign-currency";
import { PAYMENT_WAYS_SETTINGS_KEY, parseStoredPaymentWays } from "./payment-ways";
import { readWaitingTapRows } from "./waiting-tap-statements";
import { CARD_RECENT_DAYS, QUICK_WORDS_DAYS, QUICK_WORDS_LIST_LIMIT, TAP_OFFER_WINDOW_MINUTES } from "./quick-pad-config";
import { entryTimeInAppTimeZone } from "../lib/entry-time";
import {
  addDays,
  buildCashAgainChips,
  CARD_DEFAULT_DESCRIPTION,
  CASH_DEFAULT_DESCRIPTION,
  isUndescribedQuickEntry,
  orderPadCards,
  waitingTapForCard,
  type PadCardFact,
  CASH_NOTE_MAX_LENGTH,
  CASH_RECENT_DAYS,
  cashEntryReference,
  chooseCashCurrency,
  isValidCashAmountMinor,
  isZeroDecimalCurrency,
  readCashCurrency,
  tidyCashDescription,
  tripOnToday,
  type CashAgainChip,
  type CashCurrencyReason,
  type CashTripFact
} from "./cash-entry";
import { todayInAppTimeZone } from "../lib/app-calendar";

export { FxRateUnavailableError };

const CASH_RECENT_ROW_LIMIT = 40;

// A card payment typed while an Apple Pay tap on that card waits for its
// amount: nothing is saved, and the pad offers the tap first (DOMAIN.md
// "Quick Entry"). The person may still save it as a new payment.
export class WaitingTapOfferError extends Error {
  constructor(readonly tap: PadWaitingTap) {
    super(`Is this the ${tap.merchant} payment from ${tap.time}?`);
  }
}

export class CashEntryRefusedError extends Error {
  constructor(message: string, readonly code: "person" | "amount" | "currency" | "wallet" | "category" | "request" | "note") {
    super(message);
  }
}

// No cash wallet for the person and none chosen: nothing is saved; the pad
// asks which account it came from (cash accounts first), per the Payment
// Way rule "cash is never recorded on a card or another default account".
export class CashWalletMissingError extends Error {
  constructor(readonly personName: string, readonly choices: CashWalletChoice[]) {
    super(`Which wallet did ${personName}'s cash come from? Choose one, or set a cash wallet in Settings, Payment ways.`);
  }
}

export interface CashWalletChoice {
  id: string;
  name: string;
  currency: string;
  kind: string;
}

export interface CashEntryDefaultsDto {
  personId: string;
  personName: string;
  // The person's cash wallet (Settings -> Payment ways), or null: then the
  // pad asks, offering `walletChoices`.
  wallet: CashWalletChoice | null;
  walletChoices: CashWalletChoice[];
  currency: string;
  currencyReason: CashCurrencyReason;
  trip: { id: string; name: string } | null;
  today: string;
  again: CashAgainChip[];
  // The person's most used categories on cash lately, for the chips after
  // Save (most used first).
  usualCategories: string[];
  // "Paid with": the person's own active cards, most recently used on this
  // trip (or in the last 7 days) first. Names only, never digits.
  cards: PadCardFact[];
  // The person's Apple Pay taps still waiting for their amount, newest first.
  waitingTaps: PadWaitingTap[];
  // The person's quick entries still waiting for a few words, newest first.
  undescribed: QuickEntryToDescribe[];
}

export interface PadWaitingTap {
  id: string;
  merchant: string;
  date: string;
  // The household's clock time the tap arrived, "HH:MM".
  time: string;
  accountId: string;
  accountName: string;
  otherCurrencyAccountId: string;
  receivedAt: string;
}

export interface QuickEntryToDescribe {
  entryId: string;
  personId: string;
  date: string;
  // "HH:MM" when the entry has a time, else "".
  time: string;
  // What was paid, in the currency paid.
  amountMinor: number;
  currency: string;
  accountName: string;
  description: string;
  categoryName: string;
}

interface AccountRow {
  id: string;
  account_name: string;
  account_kind: string;
  currency: string;
  owner_person_id: string | null;
  is_joint: number;
  is_active: number;
}

interface PersonRow {
  id: string;
  display_name: string;
}

async function loadPerson(db: D1Database, personId: string) {
  return db
    .prepare("SELECT id, display_name FROM people WHERE household_id = ? AND id = ? AND is_active = 1")
    .bind(DEFAULT_HOUSEHOLD_ID, personId)
    .first<PersonRow>();
}

async function loadTripsOnToday(db: D1Database, today: string): Promise<CashTripFact[]> {
  try {
    const result = await db
      .prepare(`
        SELECT id, name, start_date, end_date, currency, put_away_at
        FROM trip_events
        WHERE household_id = ? AND put_away_at IS NULL AND start_date <= ? AND end_date >= ?
        LIMIT 20
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, today, today)
      .all<{ id: string; name: string; start_date: string | null; end_date: string | null; currency: string | null; put_away_at: string | null }>();
    return result.results.map((row) => ({
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      currency: row.currency,
      putAway: Boolean(row.put_away_at)
    }));
  } catch {
    // An older database without trips: no trip is on.
    return [];
  }
}

async function loadAccountsAndWays(db: D1Database) {
  await ensureAppSettingsTable(db);
  const [accounts, waysRow] = await db.batch([
    db
      .prepare(`
        SELECT id, account_name, account_kind, currency, owner_person_id, is_joint, is_active
        FROM accounts WHERE household_id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID),
    db.prepare("SELECT value_json FROM app_settings WHERE key = ?").bind(PAYMENT_WAYS_SETTINGS_KEY)
  ]);
  return {
    accounts: (accounts.results ?? []) as AccountRow[],
    stored: parseStoredPaymentWays((waysRow.results?.[0] as { value_json?: string } | undefined)?.value_json)
  };
}

function toChoice(row: AccountRow): CashWalletChoice {
  return { id: row.id, name: row.account_name, currency: row.currency.toUpperCase(), kind: row.account_kind };
}

// The person's cash wallet: their chosen cash account while it is an active
// cash account (payment-ways.ts resolvePaymentWays), else none.
function resolveCashWallet(accounts: AccountRow[], stored: ReturnType<typeof parseStoredPaymentWays>, personId: string) {
  const chosenId = stored.people[personId]?.cashAccountId;
  const account = chosenId ? accounts.find((row) => row.id === chosenId) : undefined;
  return account && account.is_active && account.account_kind === "cash" ? account : null;
}

// When there is no cash wallet: the person's own active accounts and the
// joint ones, cash accounts first, then bank accounts, then the rest.
function walletChoicesFor(accounts: AccountRow[], personId: string): CashWalletChoice[] {
  const rank = (row: AccountRow) => (row.account_kind === "cash" ? 0 : row.account_kind === "bank" ? 1 : 2);
  return accounts
    .filter((row) => row.is_active && (row.owner_person_id === personId || row.is_joint))
    .sort((left, right) => rank(left) - rank(right) || left.account_name.localeCompare(right.account_name))
    .map(toChoice);
}

interface RecentCashRow {
  transaction_date: string;
  description: string;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  category_name: string | null;
  note: string | null;
}

// The person's cash payments (expenses on a cash account they own) since a
// day, newest first, bounded.
async function loadRecentCash(db: D1Database, personId: string, since: string, today: string) {
  const result = await db
    .prepare(`
      SELECT transactions.transaction_date, transactions.description, transactions.amount_minor, transactions.currency,
        transactions.original_amount_minor, transactions.original_currency, categories.name AS category_name, transactions.note
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date BETWEEN ? AND ?
        AND transactions.entry_type = 'expense'
        AND accounts.account_kind = 'cash'
        AND transactions.owner_person_id = ?
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC, transactions.id DESC
      LIMIT ${CASH_RECENT_ROW_LIMIT}
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, since, today, personId)
    .all<RecentCashRow>();
  return result.results;
}

// The note the person wrote, without the line the app adds to a foreign
// amount ("Paid IDR 35,000 cash. Saved as about ...").
function personNote(note: string | null) {
  const lines = String(note ?? "").split("\n").filter((line) => line && !/^Paid [A-Z]{3} [\d,.]+.*Saved as about/.test(line));
  return lines.join("\n") || null;
}

// The person's own active cards (credit cards they own), most recently
// used by them since `since` first.
async function loadPadCards(db: D1Database, accounts: AccountRow[], personId: string, since: string, today: string) {
  const cards = accounts
    .filter((row) => row.is_active && row.account_kind === "credit_card" && row.owner_person_id === personId)
    .map((row) => ({ id: row.id, name: row.account_name, currency: row.currency.toUpperCase() }));
  if (!cards.length) return [];
  const used = await db
    .prepare(`
      SELECT account_id, MAX(transaction_date) AS last_date
      FROM transactions
      WHERE household_id = ? AND owner_person_id = ? AND entry_type = 'expense'
        AND transaction_date BETWEEN ? AND ?
        AND account_id IN (${cards.map(() => "?").join(", ")})
      GROUP BY account_id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, personId, since, today, ...cards.map((card) => card.id))
    .all<{ account_id: string; last_date: string }>();
  return orderPadCards(cards, new Map(used.results.map((row) => [row.account_id, row.last_date])));
}

// The person's waiting taps, newest first, with the card's name.
async function loadPadWaitingTaps(db: D1Database, accounts: AccountRow[], personId: string): Promise<PadWaitingTap[]> {
  const rows = (await readWaitingTapRows(db)).filter((row) => row.person_id === personId);
  return rows
    .map((row) => ({
      id: row.id,
      merchant: row.merchant,
      date: row.tap_date,
      time: entryTimeInAppTimeZone(new Date(row.received_at)) ?? "",
      accountId: row.account_id,
      accountName: accounts.find((account) => account.id === row.account_id)?.account_name ?? "",
      otherCurrencyAccountId: row.other_currency_account_id ?? "",
      receivedAt: row.received_at
    }))
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
}

interface QuickEntryRow {
  id: string;
  owner_person_id: string | null;
  transaction_date: string;
  transaction_time: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  note: string | null;
  external_reference: string | null;
  category_name: string | null;
  account_name: string;
}

/**
 * Quick entries still waiting for a few words (DOMAIN.md "Quick Entry"):
 * made on the pad or by Log cash, still the pad's own name, in Other, no
 * note of the person's, from the last QUICK_WORDS_DAYS days. Newest first,
 * at most QUICK_WORDS_LIST_LIMIT, for the given people (all when empty).
 * Read only; bounded by the date window and a LIMIT.
 */
export async function loadUndescribedQuickEntries(
  db: D1Database,
  input: { personIds?: string[]; today?: string }
): Promise<QuickEntryToDescribe[]> {
  const today = input.today ?? todayInAppTimeZone();
  const since = addDays(today, -(QUICK_WORDS_DAYS - 1));
  const people = input.personIds ?? [];
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.owner_person_id, transactions.transaction_date, transactions.transaction_time,
        transactions.description, transactions.amount_minor, transactions.currency, transactions.original_amount_minor,
        transactions.original_currency, transactions.note, transactions.external_reference,
        categories.name AS category_name, accounts.account_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ?
        AND transactions.transaction_date BETWEEN ? AND ?
        AND transactions.entry_type = 'expense'
        AND transactions.external_reference LIKE 'cash:%'
        AND transactions.description IN (?, ?)
        ${people.length ? `AND transactions.owner_person_id IN (${people.map(() => "?").join(", ")})` : ""}
      ORDER BY transactions.transaction_date DESC, transactions.created_at DESC, transactions.rowid DESC
      LIMIT ${QUICK_WORDS_LIST_LIMIT * 4}
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, since, today, CASH_DEFAULT_DESCRIPTION, CARD_DEFAULT_DESCRIPTION, ...people)
    .all<QuickEntryRow>();
  return result.results
    .filter((row) => isUndescribedQuickEntry({
      date: row.transaction_date,
      description: row.description,
      categoryName: row.category_name,
      personNote: personNote(row.note),
      reference: row.external_reference
    }, today, QUICK_WORDS_DAYS))
    .slice(0, QUICK_WORDS_LIST_LIMIT)
    .map((row) => ({
      entryId: row.id,
      personId: row.owner_person_id ?? "",
      date: row.transaction_date,
      time: row.transaction_time ?? "",
      amountMinor: Number(row.original_amount_minor ?? row.amount_minor),
      currency: String(row.original_currency ?? row.currency).toUpperCase(),
      accountName: row.account_name,
      description: row.description,
      categoryName: row.category_name ?? "Other"
    }));
}

export async function loadCashEntryDefaults(
  db: D1Database,
  input: { personId: string; today?: string }
): Promise<CashEntryDefaultsDto> {
  const today = input.today ?? todayInAppTimeZone();
  const [person, { accounts, stored }, trips] = await Promise.all([
    loadPerson(db, input.personId),
    loadAccountsAndWays(db),
    loadTripsOnToday(db, today)
  ]);
  if (!person) {
    throw new CashEntryRefusedError("Choose a person in this household.", "person");
  }
  const wallet = resolveCashWallet(accounts, stored, person.id);
  const trip = tripOnToday(trips, today);
  // The Again chips and the last-used currency: this trip's days, or the
  // last 7 days when no trip is on.
  const recentSince = addDays(today, -CASH_RECENT_DAYS);
  const since = trip?.startDate && trip.startDate < recentSince ? trip.startDate : recentSince;
  const recent = await loadRecentCash(db, person.id, since, today);
  const paid = recent.map((row) => ({
    date: row.transaction_date,
    description: row.description,
    amountMinor: Number(row.original_amount_minor ?? row.amount_minor),
    currency: String(row.original_currency ?? row.currency).toUpperCase(),
    categoryName: row.category_name,
    note: personNote(row.note)
  }));
  const choice = chooseCashCurrency({
    today,
    trips,
    recentCash: paid.filter((row) => row.date >= recentSince),
    walletCurrency: wallet?.currency ?? "SGD"
  });
  const againRows = trip ? paid : paid.filter((row) => row.date >= recentSince);
  const cardSince = trip?.startDate && trip.startDate < recentSince ? trip.startDate : addDays(today, -CARD_RECENT_DAYS);
  const [cards, waitingTaps, undescribed] = await Promise.all([
    loadPadCards(db, accounts, person.id, cardSince, today),
    loadPadWaitingTaps(db, accounts, person.id),
    loadUndescribedQuickEntries(db, { personIds: [person.id], today })
  ]);
  const counts = new Map<string, number>();
  for (const row of paid) {
    if (row.categoryName && row.categoryName !== "Other") counts.set(row.categoryName, (counts.get(row.categoryName) ?? 0) + 1);
  }
  return {
    personId: person.id,
    personName: person.display_name,
    wallet: wallet ? toChoice(wallet) : null,
    walletChoices: wallet ? [] : walletChoicesFor(accounts, person.id),
    currency: choice.currency,
    currencyReason: choice.reason,
    trip: choice.trip,
    today,
    again: buildCashAgainChips(againRows),
    usualCategories: [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 3).map(([name]) => name),
    cards,
    waitingTaps,
    undescribed
  };
}

export interface CashEntryInput {
  requestId: string;
  personId: string;
  // In `currency`'s minor units (x100, whole units for a zero-decimal one).
  amountMinor: number;
  // Left out: the pad's default (trip, last used, wallet).
  currency?: string | null;
  description?: string | null;
  categoryName?: string | null;
  note?: string | null;
  // "cash" (the default): the person's cash wallet. "card": one of the
  // person's own cards, named by accountId; a payment in another currency
  // is then a Foreign Currency Estimate, as an Apple Pay one is.
  way?: "cash" | "card" | null;
  // Cash: only when the person has no cash wallet, the account they chose.
  // Card: the card.
  accountId?: string | null;
  // A card payment saved although a tap on that card waits (the person
  // said it is a new payment, not that tap).
  newPayment?: boolean;
  // Left out: today. The pad sends the day it was typed, so an entry that
  // waited on the phone overnight keeps its day.
  date?: string | null;
}

export interface CashEntrySaved {
  entryId: string;
  created: boolean;
  date: string;
  description: string;
  categoryName: string;
  personId: string;
  personName: string;
  accountId: string;
  accountName: string;
  // What was saved in the wallet's currency.
  amountMinor: number;
  accountCurrency: string;
  // What the person paid, in the currency they paid in.
  paidAmountMinor: number;
  paidCurrency: string;
  // The note the person wrote, and the whole note as saved (with the line
  // a foreign amount adds), so a note added after Save keeps that line.
  note: string | null;
  storedNote: string | null;
}

async function loadSavedCashEntry(db: D1Database, reference: string, by: "reference" | "id" = "reference"): Promise<CashEntrySaved | null> {
  const row = await db
    .prepare(`
      SELECT transactions.id, transactions.transaction_date, transactions.description, transactions.amount_minor, transactions.currency,
        transactions.original_amount_minor, transactions.original_currency, transactions.note, transactions.account_id,
        accounts.account_name, categories.name AS category_name, people.id AS person_id, people.display_name
      FROM transactions
      INNER JOIN accounts ON accounts.id = transactions.account_id
      LEFT JOIN categories ON categories.id = transactions.category_id
      LEFT JOIN people ON people.id = transactions.owner_person_id
      WHERE transactions.household_id = ? AND ${by === "id" ? "transactions.id" : "transactions.external_reference"} = ?
      LIMIT 1
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, reference)
    .first<{
      id: string; transaction_date: string; description: string; amount_minor: number; currency: string;
      original_amount_minor: number | null; original_currency: string | null; note: string | null; account_id: string;
      account_name: string; category_name: string | null; person_id: string | null; display_name: string | null;
    }>();
  if (!row) return null;
  return {
    entryId: row.id,
    created: false,
    date: row.transaction_date,
    description: row.description,
    categoryName: row.category_name ?? "Other",
    personId: row.person_id ?? "",
    personName: row.display_name ?? "",
    accountId: row.account_id,
    accountName: row.account_name,
    amountMinor: Number(row.amount_minor),
    accountCurrency: row.currency,
    paidAmountMinor: Number(row.original_amount_minor ?? row.amount_minor),
    paidCurrency: String(row.original_currency ?? row.currency).toUpperCase(),
    note: personNote(row.note),
    storedNote: row.note
  };
}

// An entry the pad finished another way (a waiting tap completed from the
// pad), in the shape the pad shows after Save.
export function loadPadSavedEntry(db: D1Database, entryId: string) {
  return loadSavedCashEntry(db, entryId, "id");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Saves one cash payment. A request id already saved returns that entry
// (nothing written, nothing recomputed: a retry after a lost answer can
// never be a second entry, even if the rate or the habits changed since).
export async function createCashEntry(
  db: D1Database,
  input: CashEntryInput,
  options: { offlineRates?: boolean; today?: string; now?: string } = {}
): Promise<CashEntrySaved> {
  const reference = cashEntryReference(input.requestId);
  const replay = await loadSavedCashEntry(db, reference);
  if (replay) {
    // One person's request id never answers for another person.
    if (replay.personId !== input.personId) {
      throw new CashEntryRefusedError("This payment was already saved for someone else.", "request");
    }
    return replay;
  }

  const today = options.today ?? todayInAppTimeZone();
  const date = input.date && ISO_DAY.test(input.date) && input.date <= today && input.date >= addDays(today, -31) ? input.date : today;
  const defaults = await loadCashEntryDefaults(db, { personId: input.personId, today: date });
  const requestedCurrency = input.currency == null || input.currency === "" ? null : readCashCurrency(input.currency);
  if (input.currency && !requestedCurrency) {
    throw new CashEntryRefusedError("Choose a currency such as IDR or SGD.", "currency");
  }
  const currency = requestedCurrency ?? defaults.currency;
  if (!isValidCashAmountMinor(input.amountMinor, currency)) {
    throw new CashEntryRefusedError(
      isZeroDecimalCurrency(currency) && Number.isInteger(input.amountMinor) && input.amountMinor > 0
        ? `${currency} has no cents. Type a whole amount.`
        : "Type an amount more than zero.",
      "amount"
    );
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > CASH_NOTE_MAX_LENGTH) {
    throw new CashEntryRefusedError(`Keep the note to ${CASH_NOTE_MAX_LENGTH} letters or fewer.`, "note");
  }

  const byCard = input.way === "card";
  let wallet = byCard ? null : defaults.wallet;
  if (byCard) {
    // Only one of the person's own cards: another person's card, or a card
    // put away, is never paid with from this pad.
    const card = defaults.cards.find((row) => row.id === input.accountId);
    if (!card) {
      throw new CashEntryRefusedError("Choose one of your own cards.", "wallet");
    }
    wallet = { id: card.id, name: card.name, currency: card.currency, kind: "credit_card" };
    if (!input.newPayment) {
      const tap = waitingTapForCard(defaults.waitingTaps, {
        cardId: card.id,
        now: options.now ?? new Date().toISOString(),
        windowMinutes: TAP_OFFER_WINDOW_MINUTES
      });
      if (tap) {
        throw new WaitingTapOfferError(tap);
      }
    }
  } else if (input.accountId) {
    const { accounts } = await loadAccountsAndWays(db);
    const chosen = accounts.find((row) => row.id === input.accountId && row.is_active);
    if (!chosen) {
      throw new CashEntryRefusedError("Choose an active wallet in this household.", "wallet");
    }
    wallet = toChoice(chosen);
  }
  if (!wallet) {
    throw new CashWalletMissingError(defaults.personName, defaults.walletChoices);
  }

  const description = tidyCashDescription(input.description) || (byCard ? CARD_DEFAULT_DESCRIPTION : CASH_DEFAULT_DESCRIPTION);
  let categoryName = typeof input.categoryName === "string" ? input.categoryName.trim() : "";
  if (categoryName) {
    const known = await db
      .prepare("SELECT 1 AS found FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, categoryName)
      .first<{ found: number }>();
    if (!known) {
      throw new CashEntryRefusedError("Choose one of the household's categories.", "category");
    }
  } else {
    const guess = description === CASH_DEFAULT_DESCRIPTION || description === CARD_DEFAULT_DESCRIPTION ? null : await buildCategoryGuess(db, { description });
    categoryName = guess?.categoryName ?? "Other";
  }

  // Cash or a card in another currency is saved like any foreign amount (a
  // Foreign Currency Estimate): the wallet's or card's currency at the day's
  // rate, the amount paid kept beside it, so the card's statement row later
  // replaces the estimate instead of adding a second entry.
  let savedAmountMinor = input.amountMinor;
  let foreignNote = "";
  let original: { amountMinor: number; currency: string } | undefined;
  if (currency !== wallet.currency) {
    const conversion = await convertForeignAmount(db, {
      amountMinor: input.amountMinor,
      fromCurrency: currency,
      toCurrency: wallet.currency,
      offline: options.offlineRates
    });
    savedAmountMinor = conversion.amountMinor;
    original = { amountMinor: input.amountMinor, currency };
    foreignNote = describeForeignAmount({
      originalAmountMinor: input.amountMinor,
      originalCurrency: currency,
      accountCurrency: wallet.currency,
      conversion,
      cash: !byCard
    });
  }

  const storedNote = [foreignNote, note].filter(Boolean).join("\n") || null;
  try {
    const created = await createEntryRecord(db, {
      date,
      description,
      accountId: wallet.id,
      categoryName,
      amountMinor: savedAmountMinor,
      originalAmountMinor: original?.amountMinor,
      originalCurrency: original?.currency,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: defaults.personName,
      note: storedNote ?? undefined,
      externalReference: reference
    });
    return {
      entryId: created.entryId,
      created: created.created,
      date,
      description,
      categoryName,
      personId: defaults.personId,
      personName: defaults.personName,
      accountId: wallet.id,
      accountName: wallet.name,
      amountMinor: savedAmountMinor,
      accountCurrency: wallet.currency,
      paidAmountMinor: input.amountMinor,
      paidCurrency: currency,
      note: note || null,
      storedNote
    };
  } catch (error) {
    // Two copies of one request at once: the other one saved it.
    const saved = await loadSavedCashEntry(db, reference);
    if (saved && saved.personId === input.personId) return saved;
    throw error;
  }
}
