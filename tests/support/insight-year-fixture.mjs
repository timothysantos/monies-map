// Realistic months for the Money insights year-rotation tests: a household
// that shops, eats out, rides the MRT, pays the same bills and gets paid
// every month, with raw bank descriptions (reference numbers, "SINGAPORE
// SG", a PayNow reference) as the ledger stores them. Every month is
// generated from its own seed, so the data varies month to month like a
// real ledger; `flat: true` gives every month the same entries (only the
// dates move), so a repeated sentence could only come from the wording.
import { addMonths, daysInMonth } from "../../src/domain/money-signals/format.ts";
import { formatCurrencyMinor } from "../../src/domain/split-currency.ts";

export const sgd = (minor) => formatCurrencyMinor(minor, "SGD");
export const jpy = (minor) => formatCurrencyMinor(minor, "JPY");

export function consecutiveMonths(first, count) {
  return Array.from({ length: count }, (_, index) => addMonths(first, index));
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const PLACES = [
  ["NTUC FP-TAMPINES #01-23 SINGAPORE SG", "Groceries", "OCBC 365 Card", 1_500, 12_000, 6, "shared"],
  ["COLD STORAGE JEWEL", "Groceries", "OCBC 365 Card", 2_000, 9_000, 2, "shared"],
  ["SHENG SIONG BEDOK", "Groceries", "UOB One Card", 1_200, 6_000, 2, "shared"],
  ["KOPITIAM", "Dining", "UOB One Card", 450, 1_400, 5, "direct"],
  ["GRAB *FOOD 1234", "Dining", "OCBC 365 Card", 1_500, 4_500, 3, "direct"],
  ["TOAST BOX", "Dining", "UOB One Card", 520, 900, 2, "direct"],
  ["DIN TAI FUNG", "Dining", "OCBC 365 Card", 4_500, 12_000, 1, "shared"],
  ["BUS/MRT 912263684 SINGAPORE SG", "Public Transport", "OCBC 365 Card", 128, 380, 6, "direct"],
  ["GRAB *RIDES 5678", "Public Transport", "OCBC 365 Card", 900, 2_800, 2, "direct"],
  ["SHOPEE SG", "Shopping", "UOB One Card", 800, 6_000, 2, "direct"],
  ["UNIQLO ION ORCHARD", "Shopping", "UOB One Card", 2_990, 9_900, 1, "direct"],
  ["WATSONS", "Personal care", "UOB One Card", 500, 3_500, 1, "direct"],
  ["GOLDEN VILLAGE", "Entertainment", "OCBC 365 Card", 1_350, 2_700, 1, "shared"]
];

const WEIGHTED = PLACES.flatMap((place) => Array.from({ length: place[5] }, () => place));

// The bills every month: [description, category, account, amount, day].
const BILLS = [
  ["SPOTIFY", "Subscriptions", "OCBC 365 Card", 1_098, 3],
  ["AIA SINGAPORE", "Insurance", "DBS Multiplier", 25_000, 5],
  ["NETFLIX.COM", "Subscriptions", "OCBC 365 Card", 1_998, 12],
  ["SP GROUP", "Utilities", "DBS Multiplier", 11_450, 18]
];

function seedOf(month, flat) {
  return flat ? 2026_08 : Number(month.replace("-", ""));
}

// One month's ledger for the household view, dated only up to `today`
// when the month is in progress.
export function monthEntries(month, { today = "2099-01-01", flat = false } = {}) {
  const rand = random(seedOf(month, flat));
  const days = daysInMonth(month);
  const lastDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : days;
  // A few days each month with nothing bought.
  const quiet = new Set(Array.from({ length: 7 }, () => 1 + Math.floor(rand() * days)));
  const entries = [];
  const add = (day, description, categoryName, accountName, amountMinor, entryType = "expense", ownershipType = "direct") => {
    if (day > lastDay) {
      return;
    }
    const date = `${month}-${String(day).padStart(2, "0")}`;
    entries.push({ id: `${month}-e${entries.length + 1}`, date, description, categoryName, accountName, amountMinor, entryType, ownershipType });
  };
  for (const [description, category, account, amount, day] of BILLS) {
    add(day, description, category, account, amount, "expense", "shared");
  }
  const count = 34 + Math.floor(rand() * 10);
  for (let index = 0; index < count; index += 1) {
    let day = 1 + Math.floor(rand() * days);
    while (quiet.has(day)) {
      day = 1 + (day % days);
    }
    const [description, category, account, low, high, , ownership] = WEIGHTED[Math.floor(rand() * WEIGHTED.length)];
    const amount = low + Math.floor(rand() * (high - low));
    // Now and then a round amount, as a hawker or a market would charge.
    add(day, description, category, account, rand() < 0.15 ? Math.round(amount / 100) * 100 : amount, "expense", ownership);
  }
  if (rand() < 0.6) {
    add(8, "PAYNOW TRANSFER OTHR PIB2508120123456789 TO TAN AH KOW", "Gifts", "DBS Multiplier", 5_000);
  }
  add(25, "SALARY ACME PTE LTD", "Salary", "DBS Multiplier", 650_000, "income");
  return entries.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

const BUDGETS = [["Groceries", 60_000], ["Dining", 30_000], ["Public Transport", 12_000], ["Shopping", 15_000]];

// What Month loads beside the entries: the plan, income rows, the month's
// totals and the view's wallets (one card is $42.80 off its statement
// every month, so the statement gap recurs month after month; with
// `reconciled: true` every wallet matches, so the other signals lead).
export function monthPage(month, options = {}) {
  const entries = monthEntries(month, options);
  const expenses = entries.filter((entry) => entry.entryType === "expense");
  const spentIn = (category) => expenses.filter((entry) => entry.categoryName === category).reduce((total, entry) => total + entry.amountMinor, 0);
  const plannedItems = BILLS.map(([description, category, , amount, day]) => {
    const linked = expenses.find((entry) => entry.description === description);
    return {
      id: `${month}-plan-${description}`,
      label: description === "SP GROUP" ? "SP Group" : description === "AIA SINGAPORE" ? "AIA insurance" : description[0] + description.slice(1).toLowerCase(),
      categoryName: category,
      planDate: `${month}-${String(day).padStart(2, "0")}`,
      plannedMinor: amount,
      actualMinor: linked ? linked.amountMinor : 0,
      linkedEntryIds: linked ? [linked.id] : []
    };
  });
  const budgets = BUDGETS.map(([category, planned]) => ({ id: `${month}-budget-${category}`, label: category, categoryName: category, plannedMinor: planned, actualMinor: spentIn(category) }));
  const realExpensesMinor = expenses.reduce((total, entry) => total + entry.amountMinor, 0);
  const estimatedExpensesMinor = [...plannedItems, ...budgets].reduce((total, row) => total + row.plannedMinor, 0) + 60_000;
  const incomeMinor = entries.filter((entry) => entry.entryType === "income").reduce((total, entry) => total + entry.amountMinor, 0);
  return {
    entries,
    planSections: [{ key: "planned_items", rows: plannedItems }, { key: "budget_buckets", rows: budgets }],
    incomeRows: [{ plannedMinor: 650_000, actualMinor: incomeMinor }],
    summary: { estimatedExpensesMinor, realExpensesMinor, plannedIncomeMinor: 650_000, actualIncomeMinor: incomeMinor },
    accountPills: accountPills(month, options)
  };
}

export function accountPills(month, { reconciled = false } = {}) {
  return [
    reconciled
      ? { accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "matched", latestCheckpointMonth: addMonths(month, -1), latestCheckpointDeltaMinor: 0 }
      : { accountId: "acct-ocbc-365", accountName: "OCBC 365 Card", ownerLabel: "Serene", reconciliationStatus: "mismatch", latestCheckpointMonth: addMonths(month, -1), latestCheckpointDeltaMinor: -4_280 },
    { accountId: "acct-dbs", accountName: "DBS Multiplier", ownerLabel: "Joint", balanceMinor: 2_450_000, reconciliationStatus: "matched" }
  ];
}

export function monthInput(month, { today = "2099-01-01", flat = false, reconciled = false, audience = "household", viewLabel = "Household" } = {}) {
  const page = monthPage(month, { today, flat, reconciled });
  return { audience, viewLabel, month, today, ...page, formatMoney: sgd };
}

export function entriesInput(month, { today = "2099-01-01", flat = false, audience = "household" } = {}) {
  return { audience, month, today, entries: monthEntries(month, { today, flat }), formatMoney: sgd };
}

// Summary over the twelve months ending `end`, viewed in the month after
// it (so the whole range is complete), from the same ledger.
export function summaryInput(end, { flat = false, reconciled = false, today = `${addMonths(end, 1)}-15`, availableFrom = "2024-01" } = {}) {
  const range = consecutiveMonths(addMonths(end, -11), 12);
  const months = range.map((month) => {
    const page = monthPage(month, { flat });
    return { month, plannedIncomeMinor: page.summary.plannedIncomeMinor, actualIncomeMinor: page.summary.actualIncomeMinor, estimatedExpensesMinor: page.summary.estimatedExpensesMinor, realExpensesMinor: page.summary.realExpensesMinor };
  });
  const categoryShareByMonth = range.map((month) => {
    const byCategory = new Map();
    for (const entry of monthEntries(month, { flat }).filter((item) => item.entryType === "expense")) {
      const current = byCategory.get(entry.categoryName) ?? { label: entry.categoryName, valueMinor: 0, entryCount: 0 };
      current.valueMinor += entry.amountMinor;
      current.entryCount += 1;
      byCategory.set(entry.categoryName, current);
    }
    return { month, data: [...byCategory.values()] };
  });
  return {
    audience: "household",
    viewLabel: "Household",
    today,
    focusMonth: "",
    months,
    categoryShareByMonth,
    accountPills: accountPills(end, { reconciled }),
    accountKinds: { "acct-ocbc-365": "credit_card", "acct-dbs": "bank" },
    availableMonths: consecutiveMonths(availableFrom, Math.max(1, (Number(end.slice(0, 4)) - Number(availableFrom.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(availableFrom.slice(5, 7)) + 1)),
    formatMoney: sgd
  };
}

export const PEOPLE = [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }];

// A finished Japan trip: the same group activity whatever month it is
// looked at in, which is what makes Splits' rotation the hardest case.
export const JAPAN_TRIP = { id: "split-group-japan-trip", name: "Japan trip", balanceMinor: 2_673_000, currency: "JPY" };
export const JAPAN_ACTIVITY = [
  ["2026-04-04", "Narita Express", 612_000, "Ethan", "Transport", "card"],
  ["2026-04-04", "Tokyo hotel", 16_800_000, "Ethan", "Travel", "card"],
  ["2026-04-05", "Sushi dinner", 1_450_000, "Serene", "Dining", "card"],
  ["2026-04-06", "Suica top-up", 400_000, "Serene", "Transport", "cash"],
  ["2026-04-06", "Ramen", 320_000, "Ethan", "Dining", "cash"],
  ["2026-04-07", "Shinkansen", 5_600_000, "Serene", "Transport", "card"],
  ["2026-04-08", "Ryokan", 7_600_000, "Ethan", "Travel", "card"],
  ["2026-04-08", "Onsen towels", 120_000, "Serene", "Shopping", "cash"],
  ["2026-04-09", "Ramen", 320_000, "Serene", "Dining", "cash"],
  ["2026-04-10", "Kyoto bus pass", 140_000, "Ethan", "Transport", "cash"],
  ["2026-04-11", "Duty free", 2_380_000, "Serene", "Shopping", "card"]
].map(([date, description, totalAmountMinor, paidByPersonName, categoryName, paymentMethod], index) => ({
  id: `trip-${index + 1}`, kind: "expense", date, description, totalAmountMinor, paidByPersonName, categoryName, paymentMethod, currency: "JPY"
})).concat([
  { id: "trip-settle-1", kind: "settlement", date: "2026-04-20", description: "Settle-up", totalAmountMinor: 1_000_000, currency: "JPY", paymentMethod: "bank" },
  { id: "trip-settle-2", kind: "settlement", date: "2026-05-02", description: "Settle-up", totalAmountMinor: 500_000, currency: "JPY", paymentMethod: "bank" }
]);

export function splitsInput(today, { audience = "person", viewId = "person-ethan", viewLabel = "Ethan", group = JAPAN_TRIP, activity = JAPAN_ACTIVITY } = {}) {
  return { audience, viewId, viewLabel, people: PEOPLE, group, activity, pendingMatchCount: 0, today, formatMoney: jpy };
}
