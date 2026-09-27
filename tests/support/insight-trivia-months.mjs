// Small hand-made months for the Just for fun tests: few enough entries
// that every expected line can be checked by hand. August 2026 starts on a
// Saturday.
import { formatCurrencyMinor } from "../../src/domain/split-currency.ts";

export const sgd = (minor) => formatCurrencyMinor(minor, "SGD");

let nextId = 0;
export function row(date, description, amountMinor, categoryName, { accountName = "OCBC 365 Card", entryType = "expense", ownershipType = "direct" } = {}) {
  nextId += 1;
  return { id: `t${nextId}`, date, description, amountMinor, categoryName, accountName, entryType, ownershipType };
}

// Entries' August: two places visited twice, a bus ride, a PayNow gift,
// a card fee and the salary.
export const ENTRIES_AUGUST = [
  row("2026-08-01", "NTUC FP-TAMPINES #01-23 SINGAPORE SG", 4_250, "Groceries", { ownershipType: "shared" }),
  row("2026-08-01", "KOPITIAM", 650, "Dining", { accountName: "UOB One Card" }),
  row("2026-08-03", "BUS/MRT 912263684 SINGAPORE SG", 128, "Public Transport"),
  row("2026-08-05", "KOPITIAM", 650, "Dining", { accountName: "UOB One Card" }),
  row("2026-08-05", "SHOPEE SG", 2_000, "Shopping", { accountName: "UOB One Card" }),
  row("2026-08-05", "TOAST BOX", 580, "Dining", { accountName: "UOB One Card" }),
  row("2026-08-12", "NTUC FP-TAMPINES #01-23 SINGAPORE SG", 6_310, "Groceries", { ownershipType: "shared" }),
  row("2026-08-15", "DIN TAI FUNG", 9_800, "Dining", { ownershipType: "shared" }),
  row("2026-08-20", "PAYNOW TRANSFER OTHR PIB2508120123456789 TO TAN AH KOW", 5_000, "Gifts", { accountName: "DBS Multiplier" }),
  row("2026-08-25", "SALARY ACME PTE LTD", 650_000, "Salary", { accountName: "DBS Multiplier", entryType: "income" }),
  row("2026-08-28", "CARD FEE", 50, "Bank fees")
];

// Month's August: a regular kopitiam, one big sofa, bills and a weekend
// film; nothing bought on any Thursday.
export const MONTH_AUGUST = [
  row("2026-08-01", "KOPITIAM", 650, "Food & Drinks"),
  row("2026-08-01", "NTUC FP-TAMPINES #01-23 SINGAPORE SG", 4_250, "Groceries"),
  row("2026-08-03", "SPOTIFY", 1_098, "Subscriptions"),
  row("2026-08-05", "KOPITIAM", 700, "Food & Drinks"),
  row("2026-08-07", "KOPITIAM", 680, "Food & Drinks"),
  row("2026-08-11", "COURTS MEGASTORE TAMPINES PTE LTD", 64_900, "Home"),
  row("2026-08-11", "IKEA TAMPINES", 3_500, "Home"),
  row("2026-08-14", "DIN TAI FUNG", 9_800, "Food & Drinks"),
  row("2026-08-16", "TOAST BOX", 580, "Food & Drinks"),
  row("2026-08-18", "SP GROUP", 11_450, "Utilities"),
  row("2026-08-22", "NTUC FP-TAMPINES", 6_310, "Groceries"),
  row("2026-08-29", "GOLDEN VILLAGE", 2_700, "Entertainment")
];

export const MONTH_PLAN = [
  {
    key: "planned_items",
    rows: [
      { id: "plan-spotify", label: "Spotify", categoryName: "Subscriptions", planDate: "2026-08-03", plannedMinor: 1_098, actualMinor: 1_098, linkedEntryIds: ["x"] },
      { id: "plan-sp", label: "SP Group", categoryName: "Utilities", planDate: "2026-08-18", plannedMinor: 12_000, actualMinor: 11_450, linkedEntryIds: ["y"] },
      { id: "plan-aia", label: "AIA insurance", categoryName: "Insurance", planDate: "2026-08-05", plannedMinor: 25_000, actualMinor: 25_000, linkedEntryIds: ["z"] }
    ]
  },
  {
    key: "budget_buckets",
    rows: [
      { id: "budget-food", label: "Food & Drinks", categoryName: "Food & Drinks", plannedMinor: 30_000, actualMinor: 12_410 },
      { id: "budget-groceries", label: "Groceries", categoryName: "Groceries", plannedMinor: 60_000, actualMinor: 10_560 }
    ]
  }
];
