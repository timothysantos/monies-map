// The showcase demo dataset: a fictional two-adult Singapore household with
// 17 months of history ending at the seed month, built to show every feature
// in a live walkthrough (docs/demo-tour.md). Pure and deterministic: the same
// seed month and cutoff day always produce the same rows. Only the demo
// worker uses it, when `DEMO_DATASET` is "showcase"; the default demo seed
// (demo-data.ts, app-repository-seed.ts) is unchanged.
//
// Everything here is invented: the people, employer, clients, pet and the
// masked account numbers. Merchant names are ordinary Singapore businesses so
// the category rules and the entries read naturally.
//
// Months are named by their offset from the seed month (M0): M-16 is the
// oldest, M-1 the last complete month. Both work full time on modest pay
// (net of CPF, which is not shown as income): Ethan about $5,700 a month,
// Serene about $4,400, with a 13th-month AWS in December and a small
// mid-year bonus for Ethan in July (calendar months, so they land wherever
// the seed month puts them). Every month both pay into the joint POSB
// account, and money goes to Endowus, StashAway and (quarterly) IBKR.
// The stories:
// - M-13 Bali long weekend, the same-season month for M-1
// - M-11 the one month with no plan (the Simple view shows by default)
// - M-9 a heavier family month, a little over plan
// - M-7 Ethan's pay rise; Japan flights booked; M-5 the Japan trip (JPY split group)
// - M-6 Mochi's vet bill, a little over plan
// - M-2 aircon and sofa: the clearly over-plan month, part paid from StashAway
// - M-1 Serene's SRS top-up, the one unresolved transfer
// - M0 the month in progress, cut at `cutoffDay`, with two Apple Pay entries

import { categories as defaultCategories } from "./demo-data";
import { defaultCategoryMatchRules } from "./category-match-defaults";
import type { CategoryDto } from "../types/dto";

export const SHOWCASE_DATASET = "showcase";
export const SHOWCASE_MONTH_COUNT = 17;

export const SHOWCASE_PEOPLE = [
  { id: "person-ethan", name: "Ethan", role: "owner" as const },
  { id: "person-serene", name: "Serene", role: "partner" as const }
];

const ETHAN = "person-ethan";
const SERENE = "person-serene";

export const SHOWCASE_ACCOUNT_IDS = {
  ethanBank: "acct-ethan-ocbc-360",
  sereneBank: "acct-serene-uob-one",
  joint: "acct-joint-posb",
  ethanCard: "acct-ethan-citi-rewards",
  ethanTransportCard: "acct-ethan-dbs-live-fresh",
  sereneCard: "acct-serene-uob-ladys",
  sereneGroceryCard: "acct-serene-ocbc-365",
  ethanEndowus: "acct-ethan-endowus",
  ethanIbkr: "acct-ethan-ibkr",
  sereneStashAway: "acct-serene-stashaway",
  ethanIfast: "acct-ethan-ifast"
} as const;

const A = SHOWCASE_ACCOUNT_IDS;

export type ShowcaseAccountKind = "bank" | "credit_card" | "investment";

export interface ShowcaseAccount {
  id: string;
  institutionId: string;
  ownerPersonId: string | null;
  name: string;
  kind: ShowcaseAccountKind;
  openingBalanceMinor: number;
  isJoint: boolean;
  slug: string;
  statementParserKey: string | null;
  activityParserKey: string | null;
  // An investment account whose monthly statement says what it was worth
  // (DOMAIN.md, "Investment Statement Value"): the parser of that statement.
  valueStatementParserKey?: string;
}

export const SHOWCASE_INSTITUTIONS = [
  { id: "inst-ocbc", name: "OCBC" },
  { id: "inst-uob", name: "UOB" },
  { id: "inst-citibank", name: "Citibank" },
  { id: "inst-dbs", name: "DBS" },
  { id: "inst-endowus", name: "Endowus" },
  { id: "inst-stashaway", name: "StashAway" },
  { id: "inst-ibkr", name: "Interactive Brokers" },
  { id: "inst-ifast", name: "iFAST" }
];

export const SHOWCASE_ACCOUNTS: ShowcaseAccount[] = [
  { id: A.ethanBank, institutionId: "inst-ocbc", ownerPersonId: ETHAN, name: "OCBC 360 Account", kind: "bank", openingBalanceMinor: 1_420_000, isJoint: false, slug: "ocbc-360", statementParserKey: "ocbc_360_pdf", activityParserKey: "ocbc_360_activity_csv" },
  { id: A.sereneBank, institutionId: "inst-uob", ownerPersonId: SERENE, name: "UOB One Account", kind: "bank", openingBalanceMinor: 1_065_000, isJoint: false, slug: "uob-one", statementParserKey: "uob_savings_pdf", activityParserKey: "uob_current_transactions_xls" },
  // DBS has no statement parser: its monthly CSV files are generic and its
  // balances are entered by hand as statement checkpoints.
  { id: A.joint, institutionId: "inst-dbs", ownerPersonId: null, name: "POSB Joint Account", kind: "bank", openingBalanceMinor: 480_000, isJoint: true, slug: "posb-joint", statementParserKey: null, activityParserKey: null },
  { id: A.ethanCard, institutionId: "inst-citibank", ownerPersonId: ETHAN, name: "Citi Rewards Card", kind: "credit_card", openingBalanceMinor: 0, isJoint: false, slug: "citi-rewards", statementParserKey: "citibank_credit_card_pdf", activityParserKey: "citibank_credit_card_activity_csv" },
  { id: A.ethanTransportCard, institutionId: "inst-dbs", ownerPersonId: ETHAN, name: "DBS Live Fresh Card", kind: "credit_card", openingBalanceMinor: 0, isJoint: false, slug: "dbs-live-fresh", statementParserKey: null, activityParserKey: null },
  { id: A.sereneCard, institutionId: "inst-uob", ownerPersonId: SERENE, name: "UOB Lady's Card", kind: "credit_card", openingBalanceMinor: 0, isJoint: false, slug: "uob-ladys", statementParserKey: "uob_credit_card_pdf", activityParserKey: "uob_credit_card_current_transactions_xls" },
  { id: A.sereneGroceryCard, institutionId: "inst-ocbc", ownerPersonId: SERENE, name: "OCBC 365 Card", kind: "credit_card", openingBalanceMinor: 0, isJoint: false, slug: "ocbc-365", statementParserKey: "ocbc_365_credit_card_pdf", activityParserKey: "ocbc_credit_card_activity_csv" },
  // Investment accounts: money moved in is invested (DOMAIN.md, "Money
  // job"). Their monthly transaction files are generic CSVs; their
  // checkpoints are the money put in, typed from the platform's statement
  // (market gains are not tracked here).
  { id: A.ethanEndowus, institutionId: "inst-endowus", ownerPersonId: ETHAN, name: "Endowus Core Portfolio", kind: "investment", openingBalanceMinor: 1_860_000, isJoint: false, slug: "endowus", statementParserKey: null, activityParserKey: null },
  { id: A.ethanIbkr, institutionId: "inst-ibkr", ownerPersonId: ETHAN, name: "IBKR Brokerage", kind: "investment", openingBalanceMinor: 1_240_000, isJoint: false, slug: "ibkr", statementParserKey: null, activityParserKey: null },
  { id: A.sereneStashAway, institutionId: "inst-stashaway", ownerPersonId: SERENE, name: "StashAway General Investing", kind: "investment", openingBalanceMinor: 960_000, isJoint: false, slug: "stashaway", statementParserKey: null, activityParserKey: null, valueStatementParserKey: "stashaway_pdf" },
  // Unit trusts Ethan bought before the history starts and no longer adds
  // to: no money moves in or out, only the monthly statement's worth.
  { id: A.ethanIfast, institutionId: "inst-ifast", ownerPersonId: ETHAN, name: "iFAST Wrap Account", kind: "investment", openingBalanceMinor: 1_520_000, isJoint: false, slug: "ifast", statementParserKey: null, activityParserKey: null, valueStatementParserKey: "ifast_wrap_pdf" }
];

const CUSTOM_CATEGORIES: CategoryDto[] = [
  { id: "cat-freelance-income", name: "Freelance Income", slug: "freelance-income", iconKey: "banknote-arrow-up", colorHex: "#2E9E8F", sortOrder: 175, isSystem: false },
  { id: "cat-pet-care", name: "Pet Care", slug: "pet-care", iconKey: "heart-pulse", colorHex: "#B86FB0", sortOrder: 176, isSystem: false }
];

export const SHOWCASE_CATEGORIES: CategoryDto[] = [...defaultCategories, ...CUSTOM_CATEGORIES];

const CATEGORY_ID_BY_NAME = new Map(SHOWCASE_CATEGORIES.map((category) => [category.name, category.id]));

function categoryId(name: string) {
  const id = CATEGORY_ID_BY_NAME.get(name);
  if (!id) {
    throw new Error(`Showcase category missing: ${name}`);
  }
  return id;
}

const CUSTOM_RULES = [
  { id: "catrule-showcase-harbourline", pattern: "HARBOURLINE LOGISTICS", categoryName: "Salary", priority: 12, note: "Ethan's employer." },
  { id: "catrule-showcase-lumen-studio", pattern: "LUMEN STUDIO", categoryName: "Salary", priority: 12, note: "Serene's employer." },
  { id: "catrule-showcase-kite-co", pattern: "KITE & CO", categoryName: "Freelance Income", priority: 12 },
  { id: "catrule-showcase-pet-lovers", pattern: "PET LOVERS CENTRE", categoryName: "Pet Care", priority: 20, note: "Mochi's food and litter." },
  { id: "catrule-showcase-tampines-tc", pattern: "TAMPINES TOWN COUNCIL", categoryName: "Bills", priority: 25 },
  { id: "catrule-showcase-singtel", pattern: "SINGTEL", categoryName: "Bills", priority: 25 },
  { id: "catrule-showcase-sheng-siong", pattern: "SHENG SIONG", categoryName: "Groceries", priority: 40 }
];

export interface ShowcaseCategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  priority: number;
  note: string | null;
}

// The app's default rules (resolved by category name, as the default seed
// does) plus the household's own.
export const SHOWCASE_CATEGORY_RULES: ShowcaseCategoryRule[] = (() => {
  const rules: ShowcaseCategoryRule[] = [];
  const patterns = new Set<string>();
  for (const rule of [...defaultCategoryMatchRules, ...CUSTOM_RULES]) {
    const id = CATEGORY_ID_BY_NAME.get(rule.categoryName);
    if (!id || patterns.has(rule.pattern)) {
      continue;
    }
    patterns.add(rule.pattern);
    rules.push({ id: rule.id, pattern: rule.pattern, categoryId: id, priority: rule.priority, note: rule.note ?? null });
  }
  return rules;
})();

export const SHOWCASE_SPLIT_GROUPS = [
  { id: "split-group-japan-trip", name: "Japan trip", iconKey: "plane", sortOrder: 1, currency: "JPY" },
  { id: "split-group-home-bills", name: "Home & Bills", iconKey: "house", sortOrder: 2, currency: "SGD" },
  { id: "split-group-dinners", name: "Dinners out", iconKey: "utensils", sortOrder: 3, currency: "SGD" }
];

const JAPAN = "split-group-japan-trip";
const HOME = "split-group-home-bills";
const DINNERS = "split-group-dinners";

// ---- Row shapes (one per stored table) -------------------------------------

export type EntryType = "expense" | "income" | "transfer";

export interface ShowcaseTransaction {
  id: string;
  accountId: string;
  date: string;
  postDate: string | null;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  transferDirection: "in" | "out" | null;
  categoryId: string;
  ownerPersonId: string | null;
  offsetsCategory: boolean;
  note: string | null;
  transferGroupId: string | null;
  importId: string | null;
  importRowId: string | null;
  certified: boolean;
  createdAt: string;
  planKey: string | null;
  // `shortcut:<id>` marks an entry the Apple Pay Shortcut saved (DOMAIN.md,
  // "Added By"); such entries are typed in, never imported.
  externalReference: string | null;
}

export interface ShowcaseImport {
  id: string;
  sourceType: "csv" | "pdf";
  sourceLabel: string;
  parserKey: string;
  importedAt: string;
  status: "completed" | "rolled_back";
  note: string | null;
}

export interface ShowcaseImportRow {
  id: string;
  importId: string;
  rowIndex: number;
  accountId: string;
  rawRowJson: string;
  normalizedHash: string;
}

// What an investment statement said the account was worth at month end.
export interface ShowcaseInvestmentValue {
  id: string;
  accountId: string;
  month: string;
  asOfDate: string;
  totalAssetsMinor: number;
  marketValueMinor: number;
  cashMinor: number;
  importId: string;
  createdAt: string;
}

export interface ShowcaseCheckpoint {
  id: string;
  accountId: string;
  month: string;
  startDate: string;
  endDate: string;
  statementBalanceMinor: number;
  note: string | null;
}

export interface ShowcaseCertificate {
  id: string;
  importId: string;
  accountId: string;
  month: string;
  startDate: string;
  endDate: string;
  statementRowCount: number;
  importedRowCount: number;
  needsReviewRowCount: number;
  debitTotalMinor: number;
  creditTotalMinor: number;
  netTotalMinor: number;
  statementBalanceMinor: number;
  projectedLedgerBalanceMinor: number;
  deltaMinor: number;
  exceptionCount: number;
  status: "certified" | "exception";
  createdAt: string;
}

export interface ShowcaseReconciliationException {
  id: string;
  accountId: string;
  month: string;
  kind: "missing_bank_row";
  title: string;
  note: string;
  createdAt: string;
}

export interface ShowcasePlanRow {
  id: string;
  month: string;
  personId: string | null;
  ownershipType: "direct" | "shared";
  section: "income" | "planned_items" | "budget_buckets";
  categoryId: string;
  label: string;
  planDate: string | null;
  accountId: string | null;
  plannedMinor: number;
  notes: string | null;
  createdAt: string;
  planKey: string | null;
}

export interface ShowcasePlanLink {
  id: string;
  planRowId: string;
  transactionId: string;
  createdAt: string;
}

export interface ShowcaseSnapshotNote {
  id: string;
  month: string;
  personScope: string;
  note: string;
}

export interface ShowcaseSplitBatch {
  id: string;
  groupId: string;
  name: string;
  openedOn: string;
  closedOn: string | null;
  createdAt: string;
}

export interface ShowcaseSplitShare {
  id: string;
  splitExpenseId: string;
  personId: string;
  ratioBasisPoints: number;
  amountMinor: number;
  createdAt: string;
}

export interface ShowcaseSplitExpense {
  id: string;
  groupId: string;
  batchId: string;
  payerPersonId: string;
  date: string;
  description: string;
  categoryId: string;
  totalAmountMinor: number;
  currency: "SGD" | "JPY";
  homeAmountMinor: number | null;
  fxRateBasisPoints: number | null;
  paymentMethod: "cash" | "card" | "bank";
  paymentStatus: "recorded" | "awaiting_statement" | "certified";
  deletedAt: string | null;
  note: string | null;
  linkedTransactionId: string | null;
  createdAt: string;
  shares: ShowcaseSplitShare[];
}

export interface ShowcaseSplitSettlement {
  id: string;
  groupId: string;
  batchId: string;
  fromPersonId: string;
  toPersonId: string;
  date: string;
  amountMinor: number;
  currency: "SGD" | "JPY";
  paymentMethod: "cash" | "bank";
  paymentStatus: "recorded" | "certified";
  note: string | null;
  linkedTransactionId: string | null;
  createdAt: string;
}

export interface ShowcaseSettlementCheckpoint {
  id: string;
  fromPersonId: string | null;
  toPersonId: string | null;
  amountMinor: number;
  currency: "SGD";
  settlementDate: string;
  status: "open";
  note: string;
  createdAt: string;
  items: Array<{ id: string; recordKind: "expense" | "settlement"; recordId: string }>;
}

export interface ShowcaseSplitHistory {
  id: string;
  recordKind: "expense";
  recordId: string;
  action: "deleted";
  groupId: string;
  groupName: string;
  description: string;
  amountMinor: number;
  currency: "SGD";
  occurredAt: string;
}

export interface ShowcaseRuleSuggestion {
  id: string;
  pattern: string;
  categoryId: string;
  sourceCount: number;
  sampleDescriptionsJson: string;
}

// A trip or event the showcase puts its travel entries on (DOMAIN.md
// "Trip or Event"): fictional, from the showcase's own entries.
export interface ShowcaseTripEvent {
  id: string;
  name: string;
  iconKey: string;
  startDate: string;
  endDate: string;
  currency: string | null;
  splitGroupId: string | null;
  entryIds: string[];
  createdAt: string;
}

export interface ShowcaseDataset {
  seedMonth: string;
  cutoffDate: string;
  months: string[];
  transactions: ShowcaseTransaction[];
  transferGroups: Array<{ id: string; note: string }>;
  imports: ShowcaseImport[];
  importRows: ShowcaseImportRow[];
  checkpoints: ShowcaseCheckpoint[];
  investmentValues: ShowcaseInvestmentValue[];
  certificates: ShowcaseCertificate[];
  reconciliationExceptions: ShowcaseReconciliationException[];
  planRows: ShowcasePlanRow[];
  planLinks: ShowcasePlanLink[];
  snapshotNotes: ShowcaseSnapshotNote[];
  splitBatches: ShowcaseSplitBatch[];
  splitExpenses: ShowcaseSplitExpense[];
  splitSettlements: ShowcaseSplitSettlement[];
  settlementCheckpoints: ShowcaseSettlementCheckpoint[];
  splitHistory: ShowcaseSplitHistory[];
  ruleSuggestions: ShowcaseRuleSuggestion[];
  tripEvents: ShowcaseTripEvent[];
  peopleCreatedAt: string[];
}

// ---- Calendar helpers (plain YYYY-MM-DD dates, UTC arithmetic) ------------

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function dayOf(month: string, day: number) {
  return `${month}-${String(Math.min(Math.max(1, day), daysInMonth(month))).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function monthEnd(month: string) {
  return dayOf(month, 31);
}

// SQLite CURRENT_TIMESTAMP shape (UTC), which is how the app stores times.
function stamp(date: string, time: string) {
  return `${date} ${time}`;
}

// ---- Deterministic randomness ---------------------------------------------

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Seeded by the month offset and a stream name, never the calendar month, so
// the amounts are the same whichever month the demo is seeded in.
function rngFor(offset: number, stream: string) {
  let state = hashString(`${stream}:${offset}`);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng: () => number, minMinor: number, maxMinor: number) {
  return minMinor + Math.floor(rng() * (maxMinor - minMinor + 1));
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)];
}

// ---- Pay (take-home, after CPF) --------------------------------------------

// Ethan's pay rise lands at M-7, after his annual review.
function ethanSalaryFor(offset: number) {
  return offset <= -8 ? 542_000 : 568_000;
}

const SERENE_SALARY_MINOR = 438_000;
const MID_YEAR_BONUS_MINOR = 180_000;

// ---- Builder ----------------------------------------------------------------

const ACCOUNT_BY_ID = new Map(SHOWCASE_ACCOUNTS.map((account) => [account.id, account]));

type AddInput = {
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
  entryType: EntryType;
  category: string;
  transferDirection?: "in" | "out";
  offsetsCategory?: boolean;
  note?: string;
  planKey?: string;
  postLagDays?: number;
  externalReference?: string;
};

function signedMinor(row: { entryType: EntryType; transferDirection: "in" | "out" | null; amountMinor: number }) {
  return row.entryType === "income" || (row.entryType === "transfer" && row.transferDirection === "in")
    ? row.amountMinor
    : -row.amountMinor;
}

export function buildShowcaseDataset(options: { seedMonth: string; cutoffDay?: number }): ShowcaseDataset {
  const seedMonth = options.seedMonth;
  if (!/^\d{4}-\d{2}$/.test(seedMonth)) {
    throw new Error(`Invalid showcase seed month: ${seedMonth}`);
  }
  const cutoffDate = dayOf(seedMonth, options.cutoffDay ?? daysInMonth(seedMonth));
  const months = Array.from({ length: SHOWCASE_MONTH_COUNT }, (_, index) => shiftMonth(seedMonth, index - (SHOWCASE_MONTH_COUNT - 1)));
  const monthAt = (offset: number) => months[offset + SHOWCASE_MONTH_COUNT - 1];
  const offsetOf = (month: string) => months.indexOf(month) - (SHOWCASE_MONTH_COUNT - 1);

  const transactions: ShowcaseTransaction[] = [];
  const transferGroups: Array<{ id: string; note: string }> = [];
  const splitExpenses: ShowcaseSplitExpense[] = [];
  const splitSettlements: ShowcaseSplitSettlement[] = [];
  const sequenceByMonth = new Map<string, number>();
  // Bank rows the statement printed but the ledger never received (the
  // deliberate mismatch). They move the real statement balance, and so the
  // card payment, without being ledger entries.
  const unrecordedStatementRows: Array<{ accountId: string; postDate: string; amountMinor: number; description: string }> = [];

  function nextId(date: string) {
    const month = date.slice(0, 7);
    const sequence = (sequenceByMonth.get(month) ?? 0) + 1;
    sequenceByMonth.set(month, sequence);
    return `showcase-${month}-${String(sequence).padStart(3, "0")}`;
  }

  function add(input: AddInput): ShowcaseTransaction | null {
    if (input.date > cutoffDate) {
      return null;
    }
    const account = ACCOUNT_BY_ID.get(input.accountId);
    if (!account) {
      throw new Error(`Unknown showcase account ${input.accountId}`);
    }
    const lag = account.kind === "credit_card" && !input.externalReference ? input.postLagDays ?? 1 : 0;
    const row: ShowcaseTransaction = {
      id: nextId(input.date),
      accountId: input.accountId,
      date: input.date,
      postDate: addDays(input.date, lag),
      description: input.description,
      amountMinor: input.amountMinor,
      entryType: input.entryType,
      transferDirection: input.transferDirection ?? null,
      categoryId: categoryId(input.category),
      ownerPersonId: account.ownerPersonId,
      offsetsCategory: input.offsetsCategory ?? false,
      note: input.note ?? null,
      transferGroupId: null,
      importId: null,
      importRowId: null,
      certified: false,
      createdAt: "",
      planKey: input.planKey ?? null,
      externalReference: input.externalReference ?? null
    };
    transactions.push(row);
    return row;
  }

  // Trips and events: the entries that exist by the cutoff (a trip whose
  // entries are all later is left out).
  const tripEvents: ShowcaseTripEvent[] = [];
  const japanBookedEarly: Array<ShowcaseTransaction | null> = [];
  function tripEvent(input: Omit<ShowcaseTripEvent, "entryIds" | "createdAt">, rows: Array<ShowcaseTransaction | null>) {
    const entryIds = rows.filter((row): row is ShowcaseTransaction => row !== null).map((row) => row.id);
    if (entryIds.length) {
      tripEvents.push({ ...input, entryIds, createdAt: stamp(input.startDate, "09:00:00") });
    }
  }

  function expense(accountId: string, date: string, description: string, amountMinor: number, category: string, extra: Partial<AddInput> = {}) {
    return add({ accountId, date, description, amountMinor, entryType: "expense", category, ...extra });
  }

  function transferPair(input: { date: string; fromAccountId: string; toAccountId: string; amountMinor: number; outDescription: string; inDescription: string; groupNote: string; note?: string }) {
    const out = add({ accountId: input.fromAccountId, date: input.date, description: input.outDescription, amountMinor: input.amountMinor, entryType: "transfer", transferDirection: "out", category: "Transfer", note: input.note });
    const into = add({ accountId: input.toAccountId, date: input.date, description: input.inDescription, amountMinor: input.amountMinor, entryType: "transfer", transferDirection: "in", category: "Transfer", postLagDays: 0 });
    if (!out || !into) {
      return null;
    }
    const groupId = `showcase-tg-${out.id}`;
    transferGroups.push({ id: groupId, note: input.groupNote });
    out.transferGroupId = groupId;
    into.transferGroupId = groupId;
    return { out, into };
  }

  function balanceAt(accountId: string, endDate: string) {
    const account = ACCOUNT_BY_ID.get(accountId)!;
    const opening = account.kind === "credit_card" ? -account.openingBalanceMinor : account.openingBalanceMinor;
    return transactions.reduce((sum, row) => (
      row.accountId === accountId && (row.postDate ?? row.date) <= endDate ? sum + signedMinor(row) : sum
    ), opening);
  }

  function realStatementBalanceAt(accountId: string, endDate: string) {
    return balanceAt(accountId, endDate) - unrecordedStatementRows
      .filter((row) => row.accountId === accountId && row.postDate <= endDate)
      .reduce((sum, row) => sum + row.amountMinor, 0);
  }

  // ---- Splits ---------------------------------------------------------------

  function shares(expenseId: string, totalMinor: number, createdAt: string): ShowcaseSplitShare[] {
    const first = Math.floor(totalMinor / 2);
    return [
      { id: `${expenseId}-${ETHAN}`, splitExpenseId: expenseId, personId: ETHAN, ratioBasisPoints: 5000, amountMinor: first, createdAt },
      // A second later, so the owner's share is always read first.
      { id: `${expenseId}-${SERENE}`, splitExpenseId: expenseId, personId: SERENE, ratioBasisPoints: 5000, amountMinor: totalMinor - first, createdAt: bumpSecond(createdAt) }
    ];
  }

  function splitExpense(input: {
    groupId: string;
    payer: string;
    date: string;
    description: string;
    category: string;
    totalMinor: number;
    currency?: "SGD" | "JPY";
    linked?: ShowcaseTransaction | null;
    paymentMethod?: "cash" | "card" | "bank";
    paymentStatus?: "recorded" | "awaiting_statement" | "certified";
    note?: string;
    deletedAt?: string;
  }) {
    if (input.date > cutoffDate) {
      return null;
    }
    const currency = input.currency ?? "SGD";
    const id = `split-expense-showcase-${input.date}-${splitExpenses.length + 1}`;
    const createdAt = stamp(input.date, "12:00:00");
    const homeAmountMinor = currency !== "SGD" && input.linked ? input.linked.amountMinor : null;
    const record: ShowcaseSplitExpense = {
      id,
      groupId: input.groupId,
      batchId: "",
      payerPersonId: input.payer,
      date: input.date,
      description: input.description,
      categoryId: categoryId(input.category),
      totalAmountMinor: input.totalMinor,
      currency,
      homeAmountMinor,
      fxRateBasisPoints: homeAmountMinor != null ? Math.round((homeAmountMinor * 10000) / input.totalMinor) : null,
      paymentMethod: input.paymentMethod ?? (input.linked ? "card" : "cash"),
      paymentStatus: input.paymentStatus ?? (input.linked ? "certified" : "recorded"),
      deletedAt: input.deletedAt ?? null,
      note: input.note ?? null,
      linkedTransactionId: input.linked?.id ?? null,
      createdAt,
      shares: shares(id, input.totalMinor, createdAt)
    };
    splitExpenses.push(record);
    return record;
  }

  function linkedSplit(groupId: string, payer: string, row: ShowcaseTransaction | null, description: string, category: string, note?: string) {
    if (!row) {
      return null;
    }
    return splitExpense({ groupId, payer, date: row.date, description, category, totalMinor: row.amountMinor, linked: row, note });
  }

  const cardPayers = [
    { cardId: A.ethanCard, bankId: A.ethanBank, day: 18, out: "BILL PAYMENT CITI CARD XXXX-XXXX-XXXX-0000", into: "PAYMENT RECEIVED - THANK YOU" },
    { cardId: A.ethanTransportCard, bankId: A.ethanBank, day: 20, out: "BILL PAYMENT DBS CARD XXXX-XXXX-XXXX-0000", into: "PAYMENT - DBS INTERNET/WIRELESS" },
    { cardId: A.sereneCard, bankId: A.sereneBank, day: 15, out: "BILL PAYMENT UOB CARD XXXX-XXXX-XXXX-0000", into: "PAYMENT - THANK YOU" },
    { cardId: A.sereneGroceryCard, bankId: A.sereneBank, day: 22, out: "BILL PAYMENT OCBC CARD XXXX-XXXX-XXXX-0000", into: "PAYMENT BY INTERNET BANKING" }
  ];

  // Weekday lunches and coffee are mostly hawker and food court; delivery
  // is the pricier evening fallback.
  const ethanDining = ["YA KUN KAYA TOAST", "TOAST BOX", "KOUFU FOOD COURT", "KOPITIAM TAMPINES", "GRAB*GRABFOOD", "FOODPANDA", "OLD CHANG KEE", "MCDONALD'S TAMPINES", "STARBUCKS", "PEPPER LUNCH"] as const;
  const sereneDining = ["GRAB*GRABFOOD", "DELIVEROO", "TIONG BAHRU BAKERY", "SALADSTOP!", "KOPITIAM TAMPINES", "PARIS BAGUETTE", "HEYTEA", "LUCKIN COFFEE", "GENKI SUSHI"] as const;
  const deliveryApps = new Set<string>(["GRAB*GRABFOOD", "FOODPANDA", "DELIVEROO"]);
  const dinnerPlaces = ["DIN TAI FUNG TAMPINES 1", "SONG FA BAK KUT TEH", "HAIDILAO VIVOCITY", "SUSHIRO TAMPINES", "JUMBO SEAFOOD RIVERSIDE", "ASTONS SPECIALITIES", "NANDOS JEWEL"] as const;
  const groceryStores = ["NTUC FAIRPRICE TAMPINES", "SHENG SIONG TAMPINES", "COLD STORAGE TAMPINES 1", "NTUC FAIRPRICE XTRA"] as const;
  const modulo = (value: number, base: number) => ((value % base) + base) % base;

  for (let offset = -(SHOWCASE_MONTH_COUNT - 1); offset <= 0; offset += 1) {
    const month = monthAt(offset);
    const calendarMonth = Number(month.slice(5, 7));
    const rng = rngFor(offset, "month");
    const d = (day: number) => dayOf(month, day);

    // Card bills first: each pays the previous statement in full.
    if (offset > -(SHOWCASE_MONTH_COUNT - 1)) {
      const previousEnd = monthEnd(monthAt(offset - 1));
      for (const payer of cardPayers) {
        const owedMinor = -realStatementBalanceAt(payer.cardId, previousEnd);
        if (owedMinor > 0) {
          transferPair({ date: d(payer.day), fromAccountId: payer.bankId, toAccountId: payer.cardId, amountMinor: owedMinor, outDescription: payer.out, inDescription: payer.into, groupNote: "Card bill payment" });
        }
      }
    }

    // Income: take-home pay after CPF.
    const ethanSalaryMinor = ethanSalaryFor(offset);
    add({ accountId: A.ethanBank, date: d(25), description: "SALARY HARBOURLINE LOGISTICS PTE LTD", amountMinor: ethanSalaryMinor, entryType: "income", category: "Salary", note: offset === -7 ? "First month at the new pay after the annual review." : undefined });
    add({ accountId: A.sereneBank, date: d(27), description: "SALARY LUMEN STUDIO PTE LTD", amountMinor: SERENE_SALARY_MINOR, entryType: "income", category: "Salary" });
    if (calendarMonth === 12) {
      add({ accountId: A.ethanBank, date: d(25), description: "AWS HARBOURLINE LOGISTICS PTE LTD", amountMinor: ethanSalaryMinor, entryType: "income", category: "Extra Income", note: "13th-month pay (AWS)." });
      add({ accountId: A.sereneBank, date: d(27), description: "AWS LUMEN STUDIO PTE LTD", amountMinor: SERENE_SALARY_MINOR, entryType: "income", category: "Extra Income", note: "13th-month pay (AWS)." });
    }
    if (calendarMonth === 7) {
      add({ accountId: A.ethanBank, date: d(25), description: "BONUS HARBOURLINE LOGISTICS PTE LTD", amountMinor: MID_YEAR_BONUS_MINOR, entryType: "income", category: "Extra Income", note: "Small mid-year performance bonus." });
    }
    if (modulo(offset, 3) === 0) {
      add({ accountId: A.sereneBank, date: d(11), description: "PAYNOW FROM KITE & CO", amountMinor: between(rng, 35_000, 80_000), entryType: "income", category: "Freelance Income", note: "Weekend logo job for a small cafe." });
    }
    add({ accountId: A.ethanBank, date: monthEnd(month), description: "OCBC 360 BONUS INTEREST", amountMinor: between(rng, 2_400, 4_200), entryType: "income", category: "Income" });
    add({ accountId: A.sereneBank, date: monthEnd(month), description: "UOB ONE BONUS INTEREST", amountMinor: between(rng, 1_600, 3_000), entryType: "income", category: "Income" });

    // Household account: contributions in, home costs and groceries out.
    transferPair({ date: d(26), fromAccountId: A.ethanBank, toAccountId: A.joint, amountMinor: 90_000, outDescription: "FAST TRANSFER TO POSB XXX-XXXXX-0", inDescription: "FAST TRANSFER FROM ETHAN", groupNote: "Household account contribution" });
    transferPair({ date: d(28), fromAccountId: A.sereneBank, toAccountId: A.joint, amountMinor: 70_000, outDescription: "FUNDS TRANSFER TO POSB XXX-XXXXX-0", inDescription: "FAST TRANSFER FROM SERENE", groupNote: "Household account contribution" });
    expense(A.joint, d(1), "HDB HOUSING LOAN GIRO", 62_000, "Loans", { planKey: "hdb", note: offset === -16 ? "The cash part of the instalment; CPF pays the rest." : undefined });
    expense(A.joint, d(8), "TAMPINES TOWN COUNCIL S&CC", 7_850, "Bills", { planKey: "scc" });
    const saturdays = Array.from({ length: daysInMonth(month) }, (_, index) => d(index + 1)).filter((date) => weekday(date) === 6);
    saturdays.forEach((date, index) => {
      expense(A.joint, date, groceryStores[(index + offset + 16) % groceryStores.length], between(rng, 7_200, 14_600), "Groceries");
    });
    if (modulo(offset, 4) === 2) {
      expense(A.joint, d(9), "PAYNOW TO COOLBREEZE AIRCON SVC", 12_000, "Home", { note: offset === -2 ? "Servicing. The technician said both units were on their last legs." : "Aircon servicing, every four months." });
    }
    if (offset === -11) {
      expense(A.joint, d(12), "INCOME INSURANCE HOME GIRO", 26_800, "Insurance", { note: "Yearly HDB home contents cover." });
    }

    // Ethan: bank. Investments go out after payday.
    expense(A.ethanBank, d(1), "PAYNOW TRANSFER - PARENTS ALLOWANCE", 50_000, "Family & Personal", { planKey: "allowance", note: offset === -16 ? "For Mum and Dad, every month." : undefined });
    expense(A.ethanBank, d(3), "AIA SINGAPORE GIRO", 18_640, "Insurance", { planKey: "aia" });
    transferPair({ date: d(26), fromAccountId: A.ethanBank, toAccountId: A.ethanEndowus, amountMinor: 60_000, outDescription: "GIRO ENDOWUS SINGAPORE PTE LTD", inDescription: "DEPOSIT RECEIVED - CORE PORTFOLIO", groupNote: "Monthly investment" });
    if (modulo(offset, 3) === 0) {
      transferPair({ date: d(27), fromAccountId: A.ethanBank, toAccountId: A.ethanIbkr, amountMinor: 100_000, outDescription: "FAST TRANSFER TO INTERACTIVE BROKERS", inDescription: "CASH RECEIPT - ELECTRONIC FUND TRANSFER", groupNote: "Quarterly investment" });
    }

    // Ethan: Citi Rewards for food, shopping and streaming.
    expense(A.ethanCard, d(4), "APPLE.COM/BILL", 398, "Subscriptions MO", { planKey: "icloud" });
    // Netflix went up from $15.98 to $18.98 two months ago (the Subscriptions
    // and bills row says "Went up").
    expense(A.ethanCard, d(9), "NETFLIX.COM", offset <= -3 ? 1_598 : 1_898, "Subscriptions MO", { planKey: "netflix" });
    for (let index = 0; index < 13; index += 1) {
      const day = 1 + index * 2 + Math.floor(rng() * 2);
      const place = pick(rng, ethanDining);
      expense(A.ethanCard, d(day), place, deliveryApps.has(place) ? between(rng, 1_650, 3_400) : between(rng, 480, 1_650), "Food & Drinks", { postLagDays: 1 + (index % 2) });
    }
    if (offset % 2 === 0) {
      expense(A.ethanCard, d(16), pick(rng, ["SHOPEE SINGAPORE", "LAZADA SINGAPORE", "DECATHLON TAMPINES", "UNIQLO TAMPINES 1"]), between(rng, 1_800, 8_900), "Shopping");
    }
    if (offset % 3 === -1) {
      expense(A.ethanCard, d(23), "GOLDEN VILLAGE TAMPINES", 2_700, "Entertainment");
    }

    // Ethan: DBS Live Fresh for transport, the gym and the home bills he
    // pays for both (shared in Home & Bills).
    expense(A.ethanTransportCard, d(2), "ANYTIME FITNESS TAMPINES", 9_800, "Sports & Hobbies", { planKey: "gym" });
    expense(A.ethanTransportCard, d(14), "SINGTEL MOBILE BILL", 4_280, "Bills", { planKey: "singtel" });
    const spMinor = [12_420, 13_880, 15_240, 16_360, 15_150, 13_730, 11_960, 10_820, 11_410, 12_990, 14_260, 15_870, 16_140, 15_480, 13_090, 11_750, 12_320][offset + 16];
    const sp = expense(A.ethanTransportCard, d(10), "SP DIGITAL PTE LTD", spMinor, "Bills");
    linkedSplit(HOME, ETHAN, sp, "SP Group utilities", "Bills");
    const fibre = expense(A.ethanTransportCard, d(12), "MYREPUBLIC BROADBAND", 4_599, "Bills");
    linkedSplit(HOME, ETHAN, fibre, "Home fibre broadband", "Bills");
    for (let week = 0; week < 4; week += 1) {
      expense(A.ethanTransportCard, d(7 + week * 7), "BUS/MRT SIMPLYGO", between(rng, 1_480, 2_640), "Public Transport");
    }
    expense(A.ethanTransportCard, d(6 + Math.floor(rng() * 6)), "GRAB*TRIP", between(rng, 1_160, 2_640), "Taxi");
    expense(A.ethanTransportCard, d(19 + Math.floor(rng() * 6)), "GRAB*TRIP", between(rng, 1_080, 2_920), "Taxi", { postLagDays: 2 });

    // Serene: bank.
    expense(A.sereneBank, d(1), "PAYNOW TRANSFER - MUM", 30_000, "Family & Personal", { planKey: "serene-parents" });
    expense(A.sereneBank, d(5), "PRUDENTIAL ASSURANCE GIRO", 14_280, "Insurance", { planKey: "prudential" });
    transferPair({ date: d(28), fromAccountId: A.sereneBank, toAccountId: A.sereneStashAway, amountMinor: 40_000, outDescription: "PAYNOW TO STASHAWAY SG", inDescription: "DEPOSIT - FAST", groupNote: "Monthly investment" });

    // Serene: UOB Lady's for food, beauty and clothes.
    expense(A.sereneCard, d(2), "STARHUB MOBILE", 2_800, "Bills", { planKey: "starhub" });
    expense(A.sereneCard, d(7), "SPOTIFY SINGAPORE", 1_198, "Subscriptions MO", { planKey: "spotify" });
    // Viu for most of a year, stopped three months ago (Subscriptions and
    // bills folds it under "stopped").
    if (offset >= -9 && offset <= -3) {
      expense(A.sereneCard, d(15), "VIU PREMIUM SUBSCRIPTION", 898, "Subscriptions MO");
    }
    for (let index = 0; index < 11; index += 1) {
      const day = 2 + index * 2 + Math.floor(rng() * 3);
      const place = pick(rng, sereneDining);
      expense(A.sereneCard, d(day), place, deliveryApps.has(place) ? between(rng, 1_800, 3_600) : between(rng, 520, 1_890), "Food & Drinks", { postLagDays: 1 + (index % 2) });
    }
    for (let week = 0; week < 3; week += 1) {
      expense(A.sereneCard, d(9 + week * 8), "BUS/MRT SIMPLYGO", between(rng, 1_040, 2_060), "Public Transport");
    }
    expense(A.sereneCard, d(13), "GRAB*TRIP", between(rng, 1_240, 2_560), "Taxi");
    expense(A.sereneCard, d(27), "GRAB*TRIP", between(rng, 1_420, 2_980), "Taxi");
    if (offset % 2 !== 0) {
      expense(A.sereneCard, d(18), pick(rng, ["UNIQLO BUGIS", "SHOPEE SINGAPORE", "LOVE BONITO", "DAISO TAMPINES", "LAZADA SINGAPORE"]), between(rng, 1_500, 9_800), "Shopping");
    }
    if (offset % 2 === 0) {
      expense(A.sereneCard, d(24), "CREATIVE SALON TAMPINES", 6_800, "Beauty");
    }
    expense(A.sereneCard, d(20), "WATSONS TAMPINES 1", between(rng, 1_100, 3_400), "Beauty");

    // Serene: OCBC 365 for the cat, the pharmacy and midweek top-ups.
    expense(A.sereneGroceryCard, d(6), "PET LOVERS CENTRE", between(rng, 4_800, 7_600), "Pet Care");
    expense(A.sereneGroceryCard, d(12), "GUARDIAN HEALTH & BEAUTY", between(rng, 1_250, 3_600), "Healthcare");
    const topUp = expense(A.sereneGroceryCard, d(17), "NTUC FAIRPRICE TAMPINES", between(rng, 2_400, 5_200), "Groceries");
    // Serene always puts these top-ups on Splits, except the last two months'
    // (not added yet), which Splits lists as "Usually shared, not on Splits
    // yet" so the showcase shows that section.
    if (offset <= -3) {
      linkedSplit(HOME, SERENE, topUp, "NTUC FairPrice top-up", "Groceries");
    }

    // Dinners the two of them split, from M-8 on, alternating who pays.
    if (offset >= -8) {
      const dinners = offset === 0 ? 2 : 3;
      for (let index = 0; index < dinners; index += 1) {
        const payer = (offset + index) % 2 === 0 ? ETHAN : SERENE;
        const place = dinnerPlaces[(offset + 8 + index * 3) % dinnerPlaces.length];
        const date = d(5 + index * 9 + Math.floor(rng() * 3));
        const amountMinor = between(rng, 5_800, 13_800);
        const row = expense(payer === ETHAN ? A.ethanCard : A.sereneCard, date, place, amountMinor, "Food & Drinks");
        linkedSplit(DINNERS, payer, row, titleCase(place), "Food & Drinks");
      }
    }

    // ---- Month stories --------------------------------------------------
    if (offset === -13) {
      const bali = [
        expense(A.ethanCard, d(8), "AIRASIA SINGAPORE", 48_640, "Travel", { note: "Bali long weekend, return flights for two." }),
        expense(A.ethanCard, d(15), "UBUD RIVERSIDE VILLA BALI ID", 52_480, "Travel", { postLagDays: 2 }),
        expense(A.ethanCard, d(16), "WARUNG MADE SEMINYAK ID", 3_860, "Food & Drinks", { postLagDays: 2 }),
        expense(A.sereneCard, d(16), "UBUD ART MARKET ID", 4_240, "Shopping", { postLagDays: 2 })
      ];
      tripEvent({ id: "showcase-trip-bali", name: "Bali trip", iconKey: "plane", startDate: d(15), endDate: d(17), currency: "IDR", splitGroupId: null }, bali);
    }
    if (offset === -12) {
      const ikea = expense(A.ethanCard, d(20), "IKEA TAMPINES", 28_450, "Home");
      linkedSplit(HOME, ETHAN, ikea, "IKEA shelves and a desk lamp", "Home");
    }
    if (offset === -9) {
      expense(A.ethanCard, d(12), "TAKASHIMAYA DEPT STORE", 26_800, "Gifts", { note: "Gifts for both families." });
      expense(A.sereneCard, d(13), "TAKASHIMAYA DEPT STORE", 14_900, "Gifts");
      expense(A.ethanBank, d(14), "ATM WITHDRAWAL TAMPINES MRT", 60_000, "Gifts", { note: "Red packets for the family visits." });
      expense(A.sereneCard, d(19), "DISNEY PLUS", 11_898, "Subscriptions YR");
      expense(A.ethanCard, d(21), "BOON TONG KEE", 16_800, "Food & Drinks", { note: "Family dinner." });
    }
    if (offset === -7) {
      japanBookedEarly.push(expense(A.sereneCard, d(9), "SINGAPORE AIRLINES", 118_000, "Travel", { planKey: "japan-flights", note: "Tokyo and Kyoto flights for both of us, from the sale." }));
    }
    // Bank fees (Money insights "fees this year"): Citi's annual fee, waived
    // a week later on request; currency fees on the Japan trip; a late fee
    // on Serene's card early this month.
    if (offset === -6) {
      expense(A.ethanCard, d(2), "ANNUAL MEMBERSHIP FEE", 19_620, "Fees");
      add({ accountId: A.ethanCard, date: d(9), description: "ANNUALMEMBERFEEREV", amountMinor: 19_620, entryType: "income", category: "Fees", note: "Waived after a call to the bank." });
    }
    if (offset === -5) {
      for (const [day, amountMinor] of [[7, 452], [10, 318], [12, 206]]) {
        expense(A.ethanCard, d(day), "CCY CONVERSION FEE", amountMinor, "Fees");
      }
    }
    if (offset === 0) {
      expense(A.sereneCard, d(3), "LATE PAYMENT CHARGE", 10_000, "Fees", { note: "Paid the bill two days late." });
    }
    // Tax reliefs (Summary's "Tax reliefs" card): this calendar year Ethan
    // tops up his SRS twice and his CPF to the limit and gives to a charity;
    // Serene tops up her CPF halfway. Only months of the seed's own year.
    // The top-ups are money moved, not spent: transfers out filed under the
    // relief's category. The gift is spending.
    if (month.slice(0, 4) === seedMonth.slice(0, 4)) {
      const topUp = (accountId: string, date: string, description: string, amountMinor: number, category: string, note?: string) => add({
        accountId, date, description, amountMinor, entryType: "transfer", transferDirection: "out", category, note
      });
      if (calendarMonth === 2) {
        topUp(A.ethanBank, d(5), "CPF BOARD CASH TOP-UP", 800_000, "CPF top-up", "Retirement top-up, the full amount for the year.");
      }
      if (calendarMonth === 3) {
        topUp(A.ethanBank, d(18), "SRS CONTRIBUTION OCBC", 600_000, "SRS top-up");
        topUp(A.sereneBank, d(20), "CPF BOARD CASH TOP-UP", 400_000, "CPF top-up");
      }
      if (calendarMonth === 6) {
        expense(A.ethanCard, d(14), "GIVING.SG DONATION", 50_000, "Charity gift", { note: "Food bank appeal." });
      }
      if (calendarMonth === 9) {
        topUp(A.ethanBank, d(22), "SRS CONTRIBUTION OCBC", 400_000, "SRS top-up");
      }
    }
    if (offset === -6) {
      expense(A.sereneGroceryCard, d(20), "MOUNT PLEASANT VET CENTRE", 38_600, "Pet Care", { note: "Mochi's yearly vaccination, check-up and a dental clean." });
    }
    if (offset === -5) {
      const hotel = expense(A.ethanCard, d(6), "AGODA.COM HOTEL TOKYO JP", 152_880, "Travel", { postLagDays: 2 });
      const ryokan = expense(A.sereneCard, d(10), "RAKUTEN TRAVEL KYOTO JP", 83_720, "Travel", { postLagDays: 2 });
      const shinkansen = expense(A.sereneCard, d(9), "JR CENTRAL SHINKANSEN JP", 25_790, "Travel", { postLagDays: 2 });
      const kaiseki = expense(A.ethanCard, d(12), "GION KAISEKI KYOTO JP", 32_760, "Food & Drinks", { postLagDays: 2 });
      const japanShops = [
        expense(A.sereneCard, d(7), "UNIQLO GINZA JP", 8_940, "Shopping", { postLagDays: 2 }),
        expense(A.ethanCard, d(8), "BIC CAMERA SHINJUKU JP", 21_450, "Shopping", { postLagDays: 2 }),
        expense(A.ethanCard, d(11), "FAMILYMART KYOTO JP", 1_280, "Food & Drinks", { postLagDays: 2 }),
        expense(A.sereneCard, d(7), "DON QUIJOTE SHIBUYA JP", 18_640, "Shopping", { postLagDays: 2 }),
        expense(A.ethanCard, d(7), "ICHIRAN RAMEN SHIBUYA JP", 4_280, "Food & Drinks", { postLagDays: 2 }),
        expense(A.sereneCard, d(13), "TOKYO STATION SOUVENIRS JP", 9_650, "Gifts", { postLagDays: 2 }),
        expense(A.ethanCard, d(8), "POKEMON CENTER TOKYO JP", 21_400, "Gifts", { postLagDays: 2, note: "Birthday present for our nephew." }),
        expense(A.ethanCard, d(11), "MK TAXI KYOTO JP", 3_860, "Taxi", { postLagDays: 2 })
      ];
      tripEvent(
        { id: "showcase-trip-japan", name: "Japan trip", iconKey: "plane", startDate: d(6), endDate: d(13), currency: "JPY", splitGroupId: JAPAN },
        [...japanBookedEarly, hotel, ryokan, shinkansen, kaiseki, ...japanShops]
      );
      const jpy = (yen: number) => yen * 100;
      const travel = (payer: string, day: number, description: string, yen: number, category: string, linked: ShowcaseTransaction | null = null, note?: string) =>
        splitExpense({ groupId: JAPAN, payer, date: d(day), description, category, totalMinor: jpy(yen), currency: "JPY", linked, note });
      travel(ETHAN, 6, "Tokyo hotel, 4 nights", 168_000, "Travel", hotel, "Paid on Ethan's card; the card row shows the SGD amount.");
      travel(ETHAN, 6, "Suica top-ups", 10_000, "Public Transport");
      travel(SERENE, 7, "Tsukiji breakfast", 6_800, "Food & Drinks");
      travel(ETHAN, 8, "teamLab tickets", 7_600, "Entertainment");
      travel(SERENE, 9, "Shinkansen to Kyoto", 28_340, "Travel", shinkansen);
      travel(SERENE, 10, "Kyoto ryokan, 2 nights", 92_000, "Travel", ryokan);
      travel(ETHAN, 11, "Nishiki market lunch", 5_400, "Food & Drinks");
      travel(ETHAN, 12, "Kaiseki dinner", 36_000, "Food & Drinks", kaiseki);
      travel(SERENE, 13, "Airport limousine bus", 6_400, "Public Transport");
    }
    if (offset === -4) {
      add({ accountId: A.sereneCard, date: d(8), description: "UNIQLO BUGIS REFUND", amountMinor: 3_990, entryType: "income", category: "Shopping", offsetsCategory: true, note: "Returned a jacket that didn't fit." });
      expense(A.sereneCard, d(21), "SISTIC CONCERT TICKETS", 19_600, "Entertainment");
    }
    if (offset === -3) {
      expense(A.ethanCard, d(15), "RAFFLES MEDICAL TAMPINES", 6_800, "Healthcare");
    }
    if (offset === -2) {
      const aircon = expense(A.ethanCard, d(11), "COURTS MEGASTORE TAMPINES", 268_000, "Home", { note: "Both aircon units replaced in the same week. 5-year warranty." });
      linkedSplit(HOME, ETHAN, aircon, "Aircon replacement", "Home", "Split 50/50 like the other home costs.");
      transferPair({ date: d(18), fromAccountId: A.sereneStashAway, toAccountId: A.sereneBank, amountMinor: 200_000, outDescription: "WITHDRAWAL TO BANK ACCOUNT", inDescription: "FAST TRANSFER FROM STASHAWAY", groupNote: "Investment withdrawal", note: "Took some out of StashAway for the sofa." });
      const sofa = expense(A.sereneCard, d(19), "CASTLERY PTE LTD", 159_000, "Home", { note: "Finally bought the sofa." });
      linkedSplit(HOME, SERENE, sofa, "New sofa", "Home");
      // The statement also printed a ride that never reached the ledger.
      unrecordedStatementRows.push({ accountId: A.sereneGroceryCard, postDate: d(26), amountMinor: 4_280, description: "GRAB*TRIP" });
    }
    if (offset === -1) {
      add({ accountId: A.sereneBank, date: d(12), description: "FAST TRANSFER TO SRS A/C XXXX-0000", amountMinor: 100_000, entryType: "transfer", transferDirection: "out", category: "Transfer", note: "SRS top-up for the tax relief. The SRS account isn't tracked here." });
    }
    if (offset === 0) {
      // Paid with Apple Pay and saved by the phone shortcut: not in any
      // bank file yet.
      if (cutoffDate > dayOf(month, 1)) {
        expense(A.sereneCard, addDays(cutoffDate, -1), "COLD STORAGE TAMPINES 1", 2_365, "Groceries", { externalReference: "shortcut:showcase-apple-pay-1" });
      }
      expense(A.ethanCard, cutoffDate, "TIONG BAHRU HAWKER CENTRE", 850, "Food & Drinks", { note: "Added from the phone shortcut.", externalReference: "shortcut:showcase-apple-pay-2" });
      // A big online buy that uses up Citi Rewards' $1,000 bonus this month
      // (Miles and cashback: "used up until …"), not in any bank file yet.
      expense(A.ethanCard, cutoffDate, "LAZADA SINGAPORE", 108_900, "Shopping", { note: "A new monitor for the study.", postLagDays: 0 });
    }
  }

  // ---- Home & Bills: two settled batches and the current one --------------
  const homeSettleDates = [dayOf(monthAt(-10), 28), dayOf(monthAt(-4), 28)];
  const homeBatches: ShowcaseSplitBatch[] = [
    { id: "split-batch-home-bills-1", groupId: HOME, name: "Home & Bills settled batch", openedOn: "", closedOn: homeSettleDates[0], createdAt: "" },
    { id: "split-batch-home-bills-2", groupId: HOME, name: "Home & Bills settled batch", openedOn: "", closedOn: homeSettleDates[1], createdAt: "" },
    { id: "split-batch-home-bills-current", groupId: HOME, name: "Home & Bills current batch", openedOn: "", closedOn: null, createdAt: "" }
  ];
  for (const record of splitExpenses.filter((item) => item.groupId === HOME)) {
    record.batchId = record.date <= homeSettleDates[0] ? homeBatches[0].id : record.date <= homeSettleDates[1] ? homeBatches[1].id : homeBatches[2].id;
  }
  homeBatches.forEach((batch, index) => {
    const records = splitExpenses.filter((item) => item.batchId === batch.id);
    batch.openedOn = records[0]?.date ?? homeSettleDates[1];
    batch.createdAt = stamp(batch.openedOn, "12:00:00");
    if (!batch.closedOn) {
      return;
    }
    // The settle-up pays off exactly what the batch's records left owing.
    const owedToEthan = records.reduce((sum, item) => sum + owedToEthanBy(item), 0);
    const from = owedToEthan >= 0 ? SERENE : ETHAN;
    const amountMinor = Math.abs(owedToEthan);
    const pair = transferPair({
      date: batch.closedOn,
      fromAccountId: from === SERENE ? A.sereneBank : A.ethanBank,
      toAccountId: from === SERENE ? A.ethanBank : A.sereneBank,
      amountMinor,
      outDescription: from === SERENE ? "PAYNOW TO ETHAN" : "PAYNOW TO SERENE",
      inDescription: from === SERENE ? "PAYNOW FROM SERENE" : "PAYNOW FROM ETHAN",
      groupNote: "Split settle-up",
      note: `Home & Bills settle-up ${index + 1}.`
    });
    splitSettlements.push({
      id: `split-settlement-showcase-home-${index + 1}`,
      groupId: HOME,
      batchId: batch.id,
      fromPersonId: from,
      toPersonId: from === SERENE ? ETHAN : SERENE,
      date: batch.closedOn,
      amountMinor,
      currency: "SGD",
      paymentMethod: "bank",
      paymentStatus: "certified",
      note: "PayNow settle-up for the batch.",
      linkedTransactionId: pair?.into.id ?? null,
      createdAt: stamp(batch.closedOn, "13:00:00")
    });
  });

  // ---- Dinners out: one open batch, one archived duplicate ----------------
  const dinnersBatch: ShowcaseSplitBatch = { id: "split-batch-dinners-current", groupId: DINNERS, name: "Dinners out current batch", openedOn: "", closedOn: null, createdAt: "" };
  const duplicateDate = dayOf(monthAt(-6), 21);
  splitExpense({ groupId: DINNERS, payer: SERENE, date: duplicateDate, description: "Haidilao Vivocity (entered twice)", category: "Food & Drinks", totalMinor: 13_480, paymentMethod: "card", note: "Entered twice by mistake; the card row is linked to the other one.", deletedAt: stamp(duplicateDate, "14:05:00") });
  // Recorded in Splits before the bank row arrived: the one intended match
  // suggestion, against the UOB current-transactions import.
  const suggestionDate = addDays(cutoffDate, -2);
  if (suggestionDate.slice(0, 7) === seedMonth) {
    splitExpense({ groupId: DINNERS, payer: SERENE, date: suggestionDate, description: "Jumbo Seafood dinner", category: "Food & Drinks", totalMinor: 16_860, paymentMethod: "card", paymentStatus: "awaiting_statement", note: "Serene paid; the card row comes with the next import." });
    expense(A.sereneCard, addDays(cutoffDate, -1), "JUMBO SEAFOOD RIVERSIDE", 16_860, "Food & Drinks", { postLagDays: 0 });
  }
  const dinnerRecords = splitExpenses.filter((item) => item.groupId === DINNERS);
  dinnersBatch.openedOn = dinnerRecords.map((item) => item.date).sort()[0] ?? dayOf(monthAt(-8), 1);
  dinnersBatch.createdAt = stamp(dinnersBatch.openedOn, "12:00:00");
  dinnerRecords.forEach((item) => { item.batchId = dinnersBatch.id; });

  // ---- Japan trip: one open batch, a partial cash settle-up ---------------
  const japanBatch: ShowcaseSplitBatch = { id: "split-batch-japan-trip-current", groupId: JAPAN, name: "Japan trip current batch", openedOn: dayOf(monthAt(-5), 6), closedOn: null, createdAt: stamp(dayOf(monthAt(-5), 6), "12:00:00") };
  splitExpenses.filter((item) => item.groupId === JAPAN).forEach((item) => { item.batchId = japanBatch.id; });
  splitSettlements.push({
    id: "split-settlement-showcase-japan-1",
    groupId: JAPAN,
    batchId: japanBatch.id,
    fromPersonId: SERENE,
    toPersonId: ETHAN,
    date: dayOf(monthAt(-5), 14),
    amountMinor: 2_000_000,
    currency: "JPY",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "Leftover yen handed over at the airport.",
    linkedTransactionId: null,
    createdAt: stamp(dayOf(monthAt(-5), 14), "13:00:00")
  });

  // ---- SGD simplification over the two SGD groups' open records -----------
  const checkpointDate = dayOf(monthAt(-1), 6);
  const simplified = splitExpenses.filter((item) => (
    item.currency === "SGD"
    && !item.deletedAt
    && item.date <= monthEnd(monthAt(-2))
    && (item.batchId === homeBatches[2].id || item.batchId === dinnersBatch.id)
  ));
  const simplifiedOwedToEthan = simplified.reduce((sum, item) => sum + owedToEthanBy(item), 0);
  const settlementCheckpointId = "split-checkpoint-showcase-sgd";
  const settlementCheckpoints: ShowcaseSettlementCheckpoint[] = [{
    id: settlementCheckpointId,
    fromPersonId: simplifiedOwedToEthan === 0 ? null : simplifiedOwedToEthan > 0 ? SERENE : ETHAN,
    toPersonId: simplifiedOwedToEthan === 0 ? null : simplifiedOwedToEthan > 0 ? ETHAN : SERENE,
    amountMinor: Math.abs(simplifiedOwedToEthan),
    currency: "SGD",
    settlementDate: checkpointDate,
    status: "open",
    note: "Home & Bills and Dinners out in one payment.",
    createdAt: stamp(checkpointDate, "12:30:00"),
    items: simplified.map((item) => ({ id: `${settlementCheckpointId}-expense-${item.id}`, recordKind: "expense" as const, recordId: item.id }))
  }];

  const deleted = splitExpenses.find((item) => item.deletedAt)!;
  const splitHistory: ShowcaseSplitHistory[] = [{
    id: "split-history-showcase-1",
    recordKind: "expense",
    recordId: deleted.id,
    action: "deleted",
    groupId: DINNERS,
    groupName: "Dinners out",
    description: deleted.description,
    amountMinor: deleted.totalAmountMinor,
    currency: "SGD",
    occurredAt: deleted.deletedAt!
  }];

  // ---- Imports, statements and checkpoints --------------------------------
  const importsResult = assignImports({ transactions, months, monthAt, offsetOf, cutoffDate, seedMonth, balanceAt, realStatementBalanceAt, unrecordedStatementRows });

  // ---- Month plans ----------------------------------------------------------
  const { planRows, planLinks } = buildPlans({ months, monthAt, offsetOf, transactions });

  const snapshotNotes: ShowcaseSnapshotNote[] = [
    { month: monthAt(-13), personScope: "household", note: "Bali long weekend. Flights and the villa went on Ethan's card." },
    { month: monthAt(-11), personScope: "household", note: "No plan this month: we only kept track of what came in and went out." },
    { month: monthAt(-7), personScope: ETHAN, note: "Pay rise from this month." },
    { month: monthAt(-9), personScope: "household", note: "Family gifts, red packets and a big family dinner: a little over the plan." },
    { month: monthAt(-6), personScope: SERENE, note: "Mochi's vaccination and dental clean. A little over the plan." },
    { month: monthAt(-5), personScope: "household", note: "Japan trip. Hotel, ryokan and Shinkansen are shared in the Japan trip split group." },
    { month: monthAt(-2), personScope: "household", note: "Both aircon units died in the same week and we finally bought the sofa. Over plan, on purpose; $2,000 came out of StashAway." },
    ...months.filter((month) => month.endsWith("-12")).map((month) => ({ month, personScope: "household", note: "AWS month. Most of the 13th-month pay goes to savings." }))
  ].reduce<ShowcaseSnapshotNote[]>((notes, item) => {
    // One note per month and view: a story month that is also December
    // keeps both lines in one note.
    const id = `snapshot-${item.personScope}-${item.month}`;
    const existing = notes.find((note) => note.id === id);
    if (existing) {
      existing.note = `${existing.note} ${item.note}`;
    } else {
      notes.push({ ...item, id });
    }
    return notes;
  }, []);

  const ruleSuggestions: ShowcaseRuleSuggestion[] = [{
    id: "catrule-suggestion-showcase-ya-kun",
    pattern: "YA KUN",
    categoryId: categoryId("Food & Drinks"),
    sourceCount: transactions.filter((row) => row.description === "YA KUN KAYA TOAST").length,
    sampleDescriptionsJson: JSON.stringify(["YA KUN KAYA TOAST"])
  }];

  const firstStamp = stamp(dayOf(monthAt(-16), 1), "01:00:00");
  return {
    seedMonth,
    cutoffDate,
    months,
    transactions,
    transferGroups,
    ...importsResult,
    planRows,
    planLinks,
    snapshotNotes,
    splitBatches: [...homeBatches, dinnersBatch, japanBatch],
    splitExpenses,
    splitSettlements,
    settlementCheckpoints,
    splitHistory,
    ruleSuggestions,
    tripEvents,
    peopleCreatedAt: [firstStamp, bumpSecond(firstStamp)]
  };
}

// What a split expense leaves the partner owing Ethan (negative: Ethan owes).
function owedToEthanBy(item: ShowcaseSplitExpense) {
  const ethanShare = item.shares.find((share) => share.personId === ETHAN)?.amountMinor ?? 0;
  const sereneShare = item.shares.find((share) => share.personId === SERENE)?.amountMinor ?? 0;
  return item.payerPersonId === ETHAN ? sereneShare : -ethanShare;
}

function bumpSecond(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + 1);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => (word === "ps.cafe" ? "PS.Cafe" : word.length <= 2 && word !== "at" ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

// ---- Imports ------------------------------------------------------------------

function assignImports(input: {
  transactions: ShowcaseTransaction[];
  months: string[];
  monthAt: (offset: number) => string;
  offsetOf: (month: string) => number;
  cutoffDate: string;
  seedMonth: string;
  balanceAt: (accountId: string, endDate: string) => number;
  realStatementBalanceAt: (accountId: string, endDate: string) => number;
  unrecordedStatementRows: Array<{ accountId: string; postDate: string; amountMinor: number; description: string }>;
}) {
  const { transactions, monthAt, offsetOf, cutoffDate, seedMonth } = input;
  const imports: ShowcaseImport[] = [];
  const importRows: ShowcaseImportRow[] = [];
  const checkpoints: ShowcaseCheckpoint[] = [];
  const investmentValues: ShowcaseInvestmentValue[] = [];
  const certificates: ShowcaseCertificate[] = [];
  const reconciliationExceptions: ShowcaseReconciliationException[] = [];
  const importById = new Map<string, ShowcaseImport>();
  const firstMonth = monthAt(-(SHOWCASE_MONTH_COUNT - 1));
  const historyLastMonth = monthAt(-7);
  const cutoffDay = Number(cutoffDate.slice(8, 10));
  // Statements for a month are imported early the next month; the last one
  // no later than the cutoff day, so nothing is imported "tomorrow".
  const statementImportDate = (month: string) => {
    const next = shiftMonthKey(month, 1);
    return next === seedMonth ? dayOfMonth(next, Math.min(3, cutoffDay)) : dayOfMonth(next, 3);
  };

  // Rows posting in the month in progress are cleared no later than today.
  for (const row of transactions) {
    if (row.postDate && row.postDate > cutoffDate) {
      row.postDate = cutoffDate;
    }
  }

  SHOWCASE_ACCOUNTS.forEach((account, accountIndex) => {
    const minute = String(10 + accountIndex * 4).padStart(2, "0");
    const accountRows = transactions
      .filter((row) => row.accountId === account.id)
      .sort((left, right) => (left.postDate ?? left.date).localeCompare(right.postDate ?? right.date) || left.id.localeCompare(right.id));

    const ensureImport = (item: ShowcaseImport) => {
      if (!importById.has(item.id)) {
        importById.set(item.id, item);
        imports.push(item);
      }
      return importById.get(item.id)!;
    };
    const attach = (row: ShowcaseTransaction, item: ShowcaseImport, certified: boolean) => {
      const rowIndex = importRows.filter((existing) => existing.importId === item.id).length;
      const importRowId = `${item.id}-row-${String(rowIndex + 1).padStart(3, "0")}`;
      const bankDate = row.postDate ?? row.date;
      importRows.push({
        id: importRowId,
        importId: item.id,
        rowIndex,
        accountId: account.id,
        rawRowJson: JSON.stringify({ date: bankDate, description: row.description, amount: (signedAmount(row) / 100).toFixed(2) }),
        normalizedHash: `${bankDate}|${row.description}|${row.amountMinor}|${account.id}|${row.entryType}`
      });
      row.importId = item.id;
      row.importRowId = importRowId;
      row.certified = certified;
      row.createdAt = item.importedAt;
    };

    const historyImport: ShowcaseImport = {
      id: `import-showcase-${account.slug}-history`,
      sourceType: "csv",
      sourceLabel: `${account.slug}-history-${firstMonth}-to-${historyLastMonth}`,
      parserKey: "generic_csv",
      importedAt: stamp(dayOfMonth(monthAt(-6), 2), `02:${minute}:00`),
      status: "completed",
      note: "Older activity brought in when the household started using the app."
    };

    const genericCsvNote = account.kind === "investment"
      ? `Monthly transactions CSV from ${SHOWCASE_INSTITUTIONS.find((item) => item.id === account.institutionId)?.name ?? "the platform"}.`
      : "Monthly CSV from DBS digibank; the balance is entered by hand.";

    for (const row of accountRows) {
      // Saved by the Apple Pay Shortcut: typed in, not imported.
      if (row.externalReference) {
        row.createdAt = stamp(row.date, "11:42:00");
        continue;
      }
      const postMonth = (row.postDate ?? row.date).slice(0, 7);
      const postOffset = offsetOf(postMonth);
      if (postOffset <= -7) {
        attach(row, ensureImport(historyImport), false);
        continue;
      }

      const statementDue = account.id === A.sereneGroceryCard && postOffset === -1;
      if (postOffset <= -1 && !statementDue) {
        const importDate = statementImportDate(postMonth);
        if (account.statementParserKey) {
          attach(row, ensureImport({
            id: `import-showcase-${account.slug}-${postMonth}`,
            sourceType: "pdf",
            sourceLabel: `${account.slug}-statement-${postMonth}`,
            parserKey: account.statementParserKey,
            importedAt: stamp(importDate, `01:${minute}:00`),
            status: "completed",
            note: null
          }), true);
        } else {
          attach(row, ensureImport({
            id: `import-showcase-${account.slug}-${postMonth}`,
            sourceType: "csv",
            sourceLabel: `${account.slug}-${postMonth}`,
            parserKey: "generic_csv",
            importedAt: stamp(importDate, `01:${minute}:00`),
            status: "completed",
            note: genericCsvNote
          }), false);
        }
        continue;
      }

      // The month in progress (and the OCBC card's statement that is still
      // due): current activity files, except entries made today by hand.
      if (row.date >= cutoffDate || !account.activityParserKey) {
        row.createdAt = stamp(row.date, "04:00:00");
        continue;
      }
      attach(row, ensureImport({
        id: `import-showcase-${account.slug}-activity-${seedMonth}`,
        sourceType: "csv",
        sourceLabel: `${account.slug}-current-activity-${cutoffDate}`,
        parserKey: account.activityParserKey,
        importedAt: stamp(cutoffDate, `00:${minute}:00`),
        status: "completed",
        note: null
      }), false);
    }

    // Investment statements for M-6..M-1, each imported early the next
    // month with no rows of its own: what the account was worth on the
    // month's last day. The worth is the money put in so far plus a gain
    // that grows slowly with a small monthly wobble, so it reads like a
    // real portfolio and never falls below what went in.
    if (account.valueStatementParserKey) {
      const isIfast = account.valueStatementParserKey === "ifast_wrap_pdf";
      for (let offset = -6; offset <= -1; offset += 1) {
        const month = monthAt(offset);
        const asOfDate = dayOfMonth(month, 31);
        const rng = rngFor(offset, `${account.slug}-worth`);
        const gainBasisPoints = (isIfast ? 1_150 : 420) + (offset + 6) * (isIfast ? 40 : 35) + between(rng, -45, 45);
        const totalAssetsMinor = Math.round(input.balanceAt(account.id, asOfDate) * (10_000 + gainBasisPoints) / 10_000);
        const cashMinor = isIfast ? between(rng, 4_000, 16_000) : 0;
        const valueImport = ensureImport({
          id: `import-showcase-${account.slug}-worth-${month}`,
          sourceType: "pdf",
          sourceLabel: `${account.slug}-statement-${month}`,
          parserKey: account.valueStatementParserKey,
          importedAt: stamp(statementImportDate(month), `01:${minute}:30`),
          status: "completed",
          note: null
        });
        investmentValues.push({
          id: `investment-value-showcase-${account.slug}-${month}`,
          accountId: account.id,
          month,
          asOfDate,
          totalAssetsMinor,
          marketValueMinor: totalAssetsMinor - cashMinor,
          cashMinor,
          importId: valueImport.id,
          createdAt: valueImport.importedAt
        });
      }
    }

    // Statement checkpoints for M-6..M-1 (M-2 for the OCBC card, whose
    // M-1 statement is still due and whose M-2 statement is the mismatch).
    const lastStatementOffset = account.id === A.sereneGroceryCard ? -2 : -1;
    for (let offset = -6; offset <= lastStatementOffset; offset += 1) {
      const month = monthAt(offset);
      const startDate = dayOfMonth(month, 1);
      const endDate = dayOfMonth(month, 31);
      const computedMinor = input.balanceAt(account.id, endDate);
      const statementMinor = input.realStatementBalanceAt(account.id, endDate);
      const deltaMinor = computedMinor - statementMinor;
      const checkpointId = `checkpoint-showcase-${account.slug}-${month}`;
      checkpoints.push({
        id: checkpointId,
        accountId: account.id,
        month,
        startDate,
        endDate,
        statementBalanceMinor: statementMinor,
        note: account.statementParserKey
          ? null
          : account.kind === "investment"
            ? "Money put in, from the platform's monthly statement; market gains aren't tracked here."
            : `Balance from the ${account.name.startsWith("POSB") ? "POSB" : "DBS"} e-statement.`
      });
      if (!account.statementParserKey) {
        continue;
      }
      const statementImport = importById.get(`import-showcase-${account.slug}-${month}`);
      if (!statementImport) {
        throw new Error(`Showcase statement missing for ${account.slug} ${month}`);
      }
      const statementRows = transactions.filter((row) => row.importId === statementImport.id);
      const missingRows = input.unrecordedStatementRows.filter((row) => row.accountId === account.id && row.postDate >= startDate && row.postDate <= endDate);
      const signedRows = [...statementRows.map((row) => signedAmount(row)), ...missingRows.map((row) => -row.amountMinor)];
      const exceptionCount = missingRows.length;
      certificates.push({
        id: `statement-cert-showcase-${account.slug}-${month}`,
        importId: statementImport.id,
        accountId: account.id,
        month,
        startDate,
        endDate,
        statementRowCount: signedRows.length,
        importedRowCount: statementRows.length,
        needsReviewRowCount: missingRows.length,
        debitTotalMinor: signedRows.filter((value) => value < 0).reduce((sum, value) => sum - value, 0),
        creditTotalMinor: signedRows.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
        netTotalMinor: signedRows.reduce((sum, value) => sum + value, 0),
        statementBalanceMinor: statementMinor,
        projectedLedgerBalanceMinor: computedMinor,
        deltaMinor,
        exceptionCount,
        status: exceptionCount ? "exception" : "certified",
        createdAt: statementImport.importedAt
      });
      for (const missing of missingRows) {
        reconciliationExceptions.push({
          id: `recon-exception-showcase-${account.slug}-${month}`,
          accountId: account.id,
          month,
          kind: "missing_bank_row",
          title: `${missing.description} ${(missing.amountMinor / 100).toFixed(2)} is on the statement but not in the ledger`,
          note: "The statement row needed review during the import and was left out, so the card is off by this amount.",
          createdAt: statementImport.importedAt
        });
      }
    }
  });

  // One import rolled back the same day it was committed (its rows are gone).
  const rolledBackMonth = monthAt(-1);
  imports.push({
    id: `import-showcase-citi-rewards-duplicate-${rolledBackMonth}`,
    sourceType: "csv",
    sourceLabel: `citi-rewards-current-activity-${dayOfMonth(rolledBackMonth, 12)}`,
    parserKey: "citibank_credit_card_activity_csv",
    importedAt: stamp(dayOfMonth(rolledBackMonth, 12), "03:40:00"),
    status: "rolled_back",
    note: "Imported the wrong file; rolled back."
  });

  return { imports, importRows, checkpoints, investmentValues, certificates, reconciliationExceptions };
}

function signedAmount(row: ShowcaseTransaction) {
  return signedMinor(row);
}

function shiftMonthKey(month: string, offset: number) {
  return shiftMonth(month, offset);
}

function dayOfMonth(month: string, day: number) {
  return dayOf(month, day);
}

// ---- Month plans --------------------------------------------------------------

type PlanTemplate = {
  key: string;
  personId: string | null;
  section: "income" | "planned_items" | "budget_buckets";
  category: string;
  label: string;
  plannedMinor: number;
  day?: number;
  accountId?: string;
  note?: string;
};

// A month's plan. Spending budgets sit a little above a typical month, so
// most months finish a little under; modest savings targets and the
// investment lines sit beside them, and a bonus month saves more. M-11 has
// no plan at all.
function planTemplatesFor(offset: number, month: string): PlanTemplate[] {
  if (offset === -11) {
    return [];
  }
  const calendarMonth = Number(month.slice(5, 7));
  const ethanSalaryMinor = ethanSalaryFor(offset);
  const templates: PlanTemplate[] = [
    { key: "salary", personId: ETHAN, section: "income", category: "Salary", label: "Salary", plannedMinor: ethanSalaryMinor },
    { key: "serene-salary", personId: SERENE, section: "income", category: "Salary", label: "Salary", plannedMinor: SERENE_SALARY_MINOR },
    // Household costs paid from the joint account: household view only.
    { key: "hdb", personId: null, section: "planned_items", category: "Loans", label: "HDB loan", plannedMinor: 62_000, day: 1, accountId: A.joint },
    { key: "scc", personId: null, section: "planned_items", category: "Bills", label: "Town council S&CC", plannedMinor: 7_850, day: 8, accountId: A.joint },
    { key: "groceries", personId: null, section: "budget_buckets", category: "Groceries", label: "Groceries", plannedMinor: 55_000 },
    // Ethan.
    { key: "allowance", personId: ETHAN, section: "planned_items", category: "Family & Personal", label: "Parents allowance", plannedMinor: 50_000, day: 1, accountId: A.ethanBank },
    { key: "aia", personId: ETHAN, section: "planned_items", category: "Insurance", label: "AIA premium", plannedMinor: 18_640, day: 3, accountId: A.ethanBank },
    { key: "gym", personId: ETHAN, section: "planned_items", category: "Sports & Hobbies", label: "Gym membership", plannedMinor: 9_800, day: 2, accountId: A.ethanTransportCard },
    { key: "icloud", personId: ETHAN, section: "planned_items", category: "Subscriptions MO", label: "iCloud storage", plannedMinor: 398, day: 4, accountId: A.ethanCard },
    { key: "netflix", personId: ETHAN, section: "planned_items", category: "Subscriptions MO", label: "Netflix", plannedMinor: 1_898, day: 9, accountId: A.ethanCard },
    { key: "singtel", personId: ETHAN, section: "planned_items", category: "Bills", label: "Singtel mobile", plannedMinor: 4_280, day: 14, accountId: A.ethanTransportCard },
    { key: "ethan-food", personId: ETHAN, section: "budget_buckets", category: "Food & Drinks", label: "Food & Drinks", plannedMinor: 45_000 },
    { key: "ethan-transport", personId: ETHAN, section: "budget_buckets", category: "Public Transport", label: "Public Transport", plannedMinor: 9_000 },
    { key: "ethan-taxi", personId: ETHAN, section: "budget_buckets", category: "Taxi", label: "Taxi", plannedMinor: 5_000 },
    { key: "ethan-bills", personId: ETHAN, section: "budget_buckets", category: "Bills", label: "Bills", plannedMinor: 9_000, note: "His half of SP Group and the fibre broadband." },
    { key: "ethan-shopping", personId: ETHAN, section: "budget_buckets", category: "Shopping", label: "Shopping", plannedMinor: 5_000 },
    { key: "ethan-savings", personId: ETHAN, section: "planned_items", category: "Savings", label: "Savings", plannedMinor: 100_000 },
    { key: "ethan-endowus", personId: ETHAN, section: "planned_items", category: "Investments", label: "Endowus monthly", plannedMinor: 60_000, note: "GIRO from OCBC 360 after payday." },
    // Serene.
    { key: "serene-parents", personId: SERENE, section: "planned_items", category: "Family & Personal", label: "Mum's allowance", plannedMinor: 30_000, day: 1, accountId: A.sereneBank },
    { key: "starhub", personId: SERENE, section: "planned_items", category: "Bills", label: "StarHub mobile", plannedMinor: 2_800, day: 2, accountId: A.sereneCard },
    { key: "prudential", personId: SERENE, section: "planned_items", category: "Insurance", label: "Prudential premium", plannedMinor: 14_280, day: 5, accountId: A.sereneBank },
    { key: "spotify", personId: SERENE, section: "planned_items", category: "Subscriptions MO", label: "Spotify", plannedMinor: 1_198, day: 7, accountId: A.sereneCard },
    { key: "serene-food", personId: SERENE, section: "budget_buckets", category: "Food & Drinks", label: "Food & Drinks", plannedMinor: 36_000 },
    { key: "serene-transport", personId: SERENE, section: "budget_buckets", category: "Public Transport", label: "Public Transport", plannedMinor: 5_500 },
    { key: "serene-taxi", personId: SERENE, section: "budget_buckets", category: "Taxi", label: "Taxi", plannedMinor: 5_000 },
    { key: "serene-bills", personId: SERENE, section: "budget_buckets", category: "Bills", label: "Bills", plannedMinor: 9_000, note: "Her half of SP Group and the fibre broadband." },
    { key: "serene-groceries", personId: SERENE, section: "budget_buckets", category: "Groceries", label: "Groceries", plannedMinor: 4_500, note: "Midweek top-ups on the OCBC card." },
    { key: "serene-shopping", personId: SERENE, section: "budget_buckets", category: "Shopping", label: "Shopping", plannedMinor: 6_000 },
    { key: "serene-pets", personId: SERENE, section: "budget_buckets", category: "Pet Care", label: "Pet Care", plannedMinor: 7_000 },
    { key: "serene-health", personId: SERENE, section: "budget_buckets", category: "Healthcare", label: "Healthcare", plannedMinor: 3_000 },
    { key: "serene-beauty", personId: SERENE, section: "budget_buckets", category: "Beauty", label: "Beauty", plannedMinor: 6_500 },
    { key: "serene-savings", personId: SERENE, section: "planned_items", category: "Savings", label: "Savings", plannedMinor: 80_000 },
    { key: "serene-stashaway", personId: SERENE, section: "planned_items", category: "Investments", label: "StashAway monthly", plannedMinor: 40_000, note: "PayNow from UOB One after payday." }
  ];

  if (calendarMonth === 12) {
    templates.splice(2, 0,
      { key: "ethan-aws", personId: ETHAN, section: "income", category: "Extra Income", label: "AWS (13th month)", plannedMinor: ethanSalaryMinor },
      { key: "serene-aws", personId: SERENE, section: "income", category: "Extra Income", label: "AWS (13th month)", plannedMinor: SERENE_SALARY_MINOR }
    );
    templates.find((template) => template.key === "ethan-savings")!.plannedMinor += 300_000;
    templates.find((template) => template.key === "serene-savings")!.plannedMinor += 250_000;
  }
  if (calendarMonth === 7) {
    templates.splice(2, 0, { key: "ethan-bonus", personId: ETHAN, section: "income", category: "Extra Income", label: "Mid-year bonus", plannedMinor: MID_YEAR_BONUS_MINOR });
    templates.find((template) => template.key === "ethan-savings")!.plannedMinor += 100_000;
  }
  if (((offset % 3) + 3) % 3 === 0) {
    templates.push({ key: "ethan-ibkr", personId: ETHAN, section: "planned_items", category: "Investments", label: "IBKR top-up", plannedMinor: 100_000, note: "Quarterly." });
  }
  if (offset === -4) {
    templates.push({ key: "concert", personId: SERENE, section: "budget_buckets", category: "Entertainment", label: "Concert tickets", plannedMinor: 20_000 });
  }
  if (offset === -13) {
    templates.push({ key: "bali", personId: ETHAN, section: "budget_buckets", category: "Travel", label: "Travel", plannedMinor: 110_000, note: "Bali long weekend." });
  }
  if (offset === -9) {
    templates.push({ key: "gifts", personId: ETHAN, section: "budget_buckets", category: "Gifts", label: "Gifts", plannedMinor: 55_000, note: "Family gifts and red packets." });
  }
  if (offset === -7) {
    templates.push({ key: "japan-flights", personId: SERENE, section: "planned_items", category: "Travel", label: "Japan flights", plannedMinor: 120_000, day: 9, accountId: A.sereneCard });
  }
  if (offset === -5) {
    templates.push(
      { key: "japan-ethan", personId: ETHAN, section: "budget_buckets", category: "Travel", label: "Travel", plannedMinor: 165_000, note: "The Tokyo hotel, on his card." },
      { key: "japan-serene", personId: SERENE, section: "budget_buckets", category: "Travel", label: "Travel", plannedMinor: 115_000, note: "The Kyoto ryokan and the Shinkansen, on her card." },
      { key: "japan-gifts", personId: ETHAN, section: "budget_buckets", category: "Gifts", label: "Gifts", plannedMinor: 30_000, note: "Souvenirs and the nephew's present." },
      { key: "japan-shopping", personId: SERENE, section: "budget_buckets", category: "Shopping", label: "Japan shopping", plannedMinor: 30_000 }
    );
  }
  return templates;
}

function buildPlans(input: {
  months: string[];
  monthAt: (offset: number) => string;
  offsetOf: (month: string) => number;
  transactions: ShowcaseTransaction[];
}) {
  const planRows: ShowcasePlanRow[] = [];
  const planLinks: ShowcasePlanLink[] = [];
  for (const month of input.months) {
    const offset = input.offsetOf(month);
    planTemplatesFor(offset, month).forEach((template, index) => {
      const createdAt = stamp(dayOf(month, 1), `00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`);
      const row: ShowcasePlanRow = {
        id: `showcase-plan-${month}-${template.key}`,
        month,
        personId: template.personId,
        ownershipType: template.personId ? "direct" : "shared",
        section: template.section,
        categoryId: categoryId(template.category),
        label: template.label,
        planDate: template.day ? dayOf(month, template.day) : null,
        accountId: template.accountId ?? null,
        plannedMinor: template.plannedMinor,
        notes: template.note ?? null,
        createdAt,
        planKey: template.section === "planned_items" ? template.key : null
      };
      planRows.push(row);
      if (!row.planKey) {
        return;
      }
      for (const entry of input.transactions.filter((item) => item.planKey === row.planKey && item.date.slice(0, 7) === month)) {
        planLinks.push({ id: `${row.id}-${entry.id}`, planRowId: row.id, transactionId: entry.id, createdAt });
      }
    });
  }
  return { planRows, planLinks };
}
