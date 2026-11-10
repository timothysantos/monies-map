// The repeating charge engine (src/domain/repeating-charges.ts; DOMAIN.md
// "Repeating charge"): which payees come back every month or year, at what
// amount and on which day, and what changed. Pure rules over hand-built
// charges; today is fixed.
import assert from "node:assert/strict";
import test from "node:test";

import { findRepeatingCharges, repeatingWindowStart, upcomingCharges } from "../src/domain/repeating-charges.ts";
import { priceChangeReminders } from "../src/domain/reminders/price-change-reminders.ts";

const TODAY = "2026-11-10";
let counter = 0;
const row = (date, description, amountMinor, extra = {}) => ({
  ids: [extra.id ?? `e${(counter += 1)}`],
  date,
  description,
  amountMinor,
  accountId: "citi",
  categoryName: "Subscriptions MO",
  entryType: "expense",
  isForeign: false,
  ...extra
});
// One charge a month on `day`, from `firstMonth`, one per amount.
const monthly = (description, amounts, { firstMonth = "2025-11", day = 14, ...extra } = {}) => amounts.map((amount, index) => {
  const [year, month] = firstMonth.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1 + index, 1));
  const key = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  return row(`${key}-${String(day).padStart(2, "0")}`, description, amount, extra);
});
const reach = { citi: "2026-11-08", uob: "2026-11-08", ocbc: "2026-11-08" };
const find = (rows, extra = {}) => findRepeatingCharges({ today: TODAY, rows, accountLatestDate: reach, ...extra });
const names = (list) => list.map((series) => series.name);

test("Netflix that moved to another card stays one series, with its 12 months and October", () => {
  const rows = [
    ...monthly("NETFLIX.COM 866-579-7172", Array(6).fill(1998), { firstMonth: "2025-11", accountId: "uob" }),
    ...monthly("NETFLIX.COM 866-579-7172", Array(6).fill(1998), { firstMonth: "2026-05", accountId: "citi" })
  ];
  const { series, focusMonth, yearStartMonth } = find(rows);
  assert.equal(focusMonth, "2026-10");
  assert.equal(yearStartMonth, "2025-11");
  assert.equal(series.length, 1);
  const [netflix] = series;
  assert.equal(netflix.seriesKey, "NETFLIX COM|monthly");
  assert.equal(netflix.name, "Netflix");
  assert.equal(netflix.period, "monthly");
  assert.equal(netflix.amountKind, "fixed");
  assert.equal(netflix.status, "active");
  assert.equal(netflix.accountId, "citi");
  assert.equal(netflix.usualDay, 14);
  assert.equal(netflix.nextDate, "2026-11-14");
  assert.equal(netflix.runLength, 12);
  assert.equal(netflix.year.amountMinor, 12 * 1998);
  assert.equal(netflix.year.ids.length, 12);
  assert.deepEqual(netflix.focus, { amountMinor: 1998, ids: [rows[11].ids[0]] });
  assert.equal(netflix.wentUp, undefined);
});

test("a grocer twice a month is not a series, and neither is one visit", () => {
  const rows = [];
  for (const month of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
    rows.push(row(`${month}-03`, "NTUC FAIRPRICE TAMPINES", 8650), row(`${month}-18`, "NTUC FAIRPRICE TAMPINES", 8650));
  }
  rows.push(row("2026-10-05", "COLD STORAGE", 4500));
  const result = find(rows);
  assert.deepEqual(result.series, []);
  assert.deepEqual(result.mightRepeat, []);
});

test("a bill that changes each month counts only in Bills or Insurance, or once kept", () => {
  const amounts = [11860, 14285, 9800, 13110, 16420, 12050];
  const bills = find(monthly("SP DIGITAL PTE LTD", amounts, { firstMonth: "2026-05", day: 18, categoryName: "Bills" }));
  assert.equal(bills.series.length, 1);
  assert.equal(bills.series[0].amountKind, "varies");
  assert.deepEqual(bills.series[0].lastThree, { lowMinor: 12050, highMinor: 16420 });
  assert.equal(bills.series[0].latest.amountMinor, 12050);
  assert.equal(bills.series[0].wentUp, undefined);

  const food = find(monthly("SP DIGITAL PTE LTD", amounts, { firstMonth: "2026-05", day: 18, categoryName: "Food & Drinks" }));
  assert.deepEqual(food.series, []);
  const kept = find(monthly("SP DIGITAL PTE LTD", amounts, { firstMonth: "2026-05", day: 18, categoryName: "Food & Drinks" }), {
    choices: { "SP DIGITAL PTE LTD|monthly": { choice: "kept", displayName: null } }
  });
  assert.equal(kept.series.length, 1);
  assert.equal(kept.series[0].kept, true);
  // More than double the middle is never one bill.
  const wild = find(monthly("SP DIGITAL PTE LTD", [5000, 14285, 9800, 13110, 30000, 12050], { firstMonth: "2026-05", day: 18, categoryName: "Bills" }));
  assert.deepEqual(wild.series, []);
});

test("a yearly insurance is a yearly series, due a year after its last charge", () => {
  const rows = [
    row("2024-03-12", "NTUC INCOME INSURANCE", 124800, { categoryName: "Insurance" }),
    row("2025-03-11", "NTUC INCOME INSURANCE", 124800, { categoryName: "Insurance" }),
    row("2026-03-12", "NTUC INCOME INSURANCE", 124800, { categoryName: "Insurance" })
  ];
  const { series } = find(rows);
  assert.equal(series.length, 1);
  assert.equal(series[0].period, "yearly");
  assert.equal(series[0].seriesKey, "NTUC INCOME INSURANCE|yearly");
  assert.equal(series[0].nextDate, "2027-03-12");
  assert.equal(series[0].year.amountMinor, 124800);
  assert.equal(series[0].focus.amountMinor, 0);
  assert.equal(series[0].status, "active");
});

test("a charge in another currency is compared within 10%, a local one within $1 or 5%", () => {
  const foreignAmounts = [2210, 2290, 2150, 2240];
  const foreign = find(monthly("CHATGPT SUBSCRIPTION", foreignAmounts, { firstMonth: "2026-07", day: 3, isForeign: true }));
  assert.equal(foreign.series.length, 1);
  assert.equal(foreign.series[0].amountKind, "fixed");
  const local = find(monthly("CHATGPT SUBSCRIPTION", [2000, 2200, 2000, 2200], { firstMonth: "2026-07", day: 3 }));
  assert.deepEqual(local.series, [], "an amount that keeps jumping 10% is not one fixed charge");
});

test("two months in a row might repeat: listed apart and not counted until kept", () => {
  const rows = monthly("DISNEY PLUS", [1198, 1198], { firstMonth: "2026-09", day: 20 });
  const result = find(rows);
  assert.deepEqual(result.series, []);
  assert.deepEqual(names(result.mightRepeat), ["Disney Plus"]);
  assert.equal(result.mightRepeat[0].status, "might_repeat");
  const kept = find(rows, { choices: { "DISNEY PLUS|monthly": { choice: "kept", displayName: "Disney+" } } });
  assert.deepEqual(names(kept.series), ["Disney+"]);
  assert.equal(kept.series[0].renamed, true);
  assert.equal(kept.series[0].payeeName, "Disney Plus");
});

test("a missed month breaks the run", () => {
  const rows = [
    row("2026-05-14", "SPOTIFY P3A1B2", 1698),
    row("2026-06-14", "SPOTIFY P3A1B2", 1698),
    row("2026-07-14", "SPOTIFY P3A1B2", 1698),
    // August missed.
    row("2026-09-14", "SPOTIFY P3A1B2", 1698),
    row("2026-10-14", "SPOTIFY P3A1B2", 1698)
  ];
  const result = find(rows);
  assert.deepEqual(result.series, []);
  assert.equal(result.mightRepeat[0].runLength, 2);
});

test("not seen since: only once the account's later entries are in; two missed months is stopped", () => {
  const rows = monthly("DISNEY PLUS", [1198, 1198, 1198, 1198, 1198], { firstMonth: "2026-04", day: 20 });
  // Last charge 20 Aug: September's was due 20 Sep, October's 20 Oct.
  const late = find(rows, { today: "2026-10-05", accountLatestDate: { citi: "2026-10-04" } });
  assert.equal(late.series[0].status, "late");
  assert.equal(late.series[0].lastSeenMonth, "2026-08");
  const stopped = find(rows, { accountLatestDate: { citi: "2026-11-08" } });
  assert.equal(stopped.series[0].status, "stopped");
  // The statement is not in yet: nothing is said.
  const notIn = find(rows, { accountLatestDate: { citi: "2026-08-25" } });
  assert.equal(notIn.series[0].status, "active");
  assert.equal(notIn.series[0].lastSeenMonth, undefined);
  // A kept one never stops; it says when it was last seen.
  const kept = find(rows, { choices: { "DISNEY PLUS|monthly": { choice: "kept", displayName: null } } });
  assert.equal(kept.series[0].status, "late");
});

test("transfers, Investments and Savings are never read", () => {
  const rows = [
    ...monthly("ENDOWUS MONTHLY", [50000, 50000, 50000, 50000], { firstMonth: "2026-07", categoryName: "Investments" }),
    ...monthly("OCBC 360 TOP UP", [100000, 100000, 100000, 100000], { firstMonth: "2026-07", categoryName: "Savings" }),
    ...monthly("GIRO TO JOYCE", [80000, 80000, 80000, 80000], { firstMonth: "2026-07", entryType: "transfer" }),
    ...monthly("PAYNOW REFUND", [2000, 2000, 2000, 2000], { firstMonth: "2026-07", entryType: "income" })
  ];
  assert.deepEqual(find(rows).series, []);
  assert.ok(repeatingWindowStart(TODAY) === "2024-09-01");
});

test("a series taken off the list is listed apart and never counted", () => {
  const rows = monthly("CHURCH TITHE", [20000, 20000, 20000, 20000], { firstMonth: "2026-07", day: 1, categoryName: "Gifts" });
  const result = find(rows, { choices: { "CHURCH TITHE|monthly": { choice: "not_repeating", displayName: null } } });
  assert.deepEqual(result.series, []);
  assert.deepEqual(names(result.takenOff), ["Church Tithe"]);
  assert.equal(result.takenOff[0].status, "taken_off");
});

test("the row's went up is the price change reminder's, on the same charges", () => {
  const amounts = [3890, 3890, 3890, 3890, 3890, 3890, 3890, 3890, 3890, 3890, 3890, 4290];
  const rows = monthly("SINGTEL MOBILE 8123", amounts, { firstMonth: "2025-11", day: 22, categoryName: "Bills" });
  const account = { id: "citi", name: "Citi", kind: "credit_card", currency: "SGD", isActive: true, isJoint: false, checkpoints: [] };
  const charges = rows.map((charge) => ({ accountId: charge.accountId, date: charge.date, description: charge.description, amountMinor: charge.amountMinor, currency: "SGD", period: "monthly", isForeign: false }));
  const reminderOn = (today) => priceChangeReminders({ today, viewId: "household", accounts: [account], charges });
  const [singtel] = find(rows, { today: "2026-11-10" }).series;
  assert.deepEqual(singtel.wentUp, {
    fromMinor: 3890,
    toMinor: 4290,
    firstNewDate: "2026-10-22",
    lastOldDate: "2026-09-22",
    fromIds: [rows[10].ids[0]],
    toIds: [rows[11].ids[0]]
  });
  const [reminder] = reminderOn(TODAY);
  assert.equal(reminder.fromMinor, singtel.wentUp.fromMinor);
  assert.equal(reminder.toMinor, singtel.wentUp.toMinor);
  assert.equal(reminder.firstNewChargeDate, singtel.wentUp.firstNewDate);
  // The row keeps showing it for 90 days; the reminder stops after 45.
  const later = "2026-12-10";
  assert.ok(findRepeatingCharges({ today: later, rows, accountLatestDate: { citi: later } }).series[0].wentUp);
  assert.deepEqual(reminderOn(later), []);
  assert.equal(findRepeatingCharges({ today: "2027-01-21", rows, accountLatestDate: { citi: "2026-12-01" } }).series[0].wentUp, undefined);
});

test("the list is sorted by cost over 12 months, stopped ones last", () => {
  const rows = [
    ...monthly("NETFLIX", Array(6).fill(1998), { firstMonth: "2026-05" }),
    ...monthly("GREAT EASTERN LIFE", Array(6).fill(18630), { firstMonth: "2026-05", day: 1, categoryName: "Insurance" }),
    ...monthly("DISNEY PLUS", Array(5).fill(10000), { firstMonth: "2026-03", day: 20 })
  ];
  assert.deepEqual(names(find(rows).series), ["Great Eastern", "Netflix", "Disney Plus"]);
});

// Coming up: the next 30 days of charges on their usual days, dates and
// recorded amounts only.
test("coming up: each series on its usual day within 30 days, once a month, never one already charged or not seen lately", () => {
  const rows = [
    ...monthly("NETFLIX.COM", Array(6).fill(1998), { firstMonth: "2026-05", day: 14 }),
    ...monthly("SP SERVICES", [11860, 14285, 9800, 13110, 16420, 12050], { firstMonth: "2026-05", day: 18, categoryName: "Bills" }),
    // Charged on 3 Nov already: next one is 3 Dec.
    ...monthly("APPLE.COM/BILL", Array(6).fill(448), { firstMonth: "2026-06", day: 3 }),
    // Not seen since August: not coming as usual.
    ...monthly("DISNEY PLUS", Array(4).fill(1198), { firstMonth: "2026-05", day: 20 }),
    row("2025-11-28", "NTUC INCOME INSURANCE", 124800, { categoryName: "Insurance" }),
    row("2024-11-27", "NTUC INCOME INSURANCE", 124800, { categoryName: "Insurance" })
  ];
  const { series } = find(rows);
  const asSource = (item) => ({ ...item, key: item.seriesKey, kind: item.amountKind, lowMinor: item.lastThree.lowMinor, highMinor: item.lastThree.highMinor });
  assert.deepEqual(upcomingCharges(series.map(asSource), TODAY), [
    { key: "NETFLIX COM|monthly", date: "2026-11-14", lowMinor: 1998, highMinor: 1998 },
    { key: "SP SERVICES|monthly", date: "2026-11-18", lowMinor: 12050, highMinor: 16420 },
    { key: "NTUC INCOME INSURANCE|yearly", date: "2026-11-28", lowMinor: 124800, highMinor: 124800 },
    { key: "APPLE COM BILL|monthly", date: "2026-12-03", lowMinor: 448, highMinor: 448 }
  ]);
  // A shorter window ends sooner; a later today moves Netflix to December.
  assert.deepEqual(upcomingCharges(series.map(asSource), TODAY, 5).map((item) => item.key), ["NETFLIX COM|monthly"]);
  assert.deepEqual(upcomingCharges(series.map(asSource), "2026-11-20", 30).map((item) => [item.key, item.date]), [
    ["NTUC INCOME INSURANCE|yearly", "2026-11-28"],
    ["APPLE COM BILL|monthly", "2026-12-03"],
    ["NETFLIX COM|monthly", "2026-12-14"],
    ["SP SERVICES|monthly", "2026-12-18"]
  ]);
});
