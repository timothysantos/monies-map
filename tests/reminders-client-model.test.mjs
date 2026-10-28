// What the reminder cards show and what this device remembers
// (src/client/reminders-model.js, reminders-device-state.js,
// reminders-actions.js, reminders-api.js): how many cards, "N more", the
// words and money on each, hidden money, Later and its dates, what is
// remembered across a reload and with storage blocked, what the Ask tab's dot
// counts. All of it pure over given facts and a given day.
import assert from "node:assert/strict";
import test from "node:test";

import { readReminders, remindersEndpoint } from "../src/client/reminders-api.js";
import {
  hideReminder,
  laterUntil,
  markChecklistDoneShown,
  markChecklistOpen,
  markRemindersSeen,
  pruneReminderItems,
  showReminderAgain
} from "../src/client/reminders-actions.js";
import {
  EMPTY_REMINDER_STATE,
  REMINDERS_STORAGE_KEY,
  isReminderHidden,
  reminderDeviceState,
  unseenReminders
} from "../src/client/reminders-device-state.js";
import { PHONE_CARD_LIMIT, DOCK_CARD_LIMIT, buildReminderList, cardLimitFor, laterChoices, nextMondayAfter, reminderTarget } from "../src/client/reminders-model.js";

const TODAY = "2026-10-12"; // a Monday

const format = (minor, currency) => `$${(minor / 100).toFixed(2)}${currency === "SGD" ? "" : ` ${currency}`}`;

const cardBill = (extra = {}) => ({
  key: "card_bill:uob:2026-09", kind: "card_bill", accountId: "uob", accountName: "UOB PRVI Miles", statementMonth: "2026-09",
  dueDate: "2026-10-18", daysUntilDue: 6, leftMinor: 52773, paidMinor: 0, currency: "SGD", ...extra
});
const statement = (extra = {}) => ({
  key: "statement:ocbc:2026-09", kind: "statement_missing", accountId: "ocbc", accountName: "OCBC 365 Card", statementMonth: "2026-09",
  expectedOn: "2026-09-30", daysSinceExpected: 12, ...extra
});
const settleUp = (extra = {}) => ({
  key: "splits:settle_up:cp-1", kind: "splits_waiting", variant: "settle_up", fromName: "Serene", toName: "Ethan", direction: "you_owe",
  amountMinor: 104724, currency: "SGD", sinceDate: "2026-09-06", weeks: 5, ...extra
});
const price = (extra = {}) => ({
  key: "price:monthly|SPOTIFY:2026-10-07", kind: "price_change", payeeName: "Spotify", period: "monthly", fromMinor: 1598, toMinor: 1798,
  firstNewChargeDate: "2026-10-07", priorChargeCount: 11, currency: "SGD", ...extra
});
const monthClose = (extra = {}) => ({
  key: "month_close:2026-09", kind: "month_close", month: "2026-09", allDone: false,
  checks: [
    { id: "statements", done: true, count: 6 },
    { id: "other", done: true, count: 0 },
    { id: "splits", done: false, count: 1, amountMinor: 104724, currency: "SGD", withName: "Ethan" },
    { id: "note", done: true, count: 1 }
  ],
  ...extra
});

function list(reminders, overrides = {}) {
  return buildReminderList({ reminders, state: EMPTY_REMINDER_STATE, today: TODAY, hidden: false, formatMoney: format, limit: PHONE_CARD_LIMIT, ...overrides });
}

// A browser's localStorage, in memory, or one that throws.
function installStorage(kind = "memory") {
  const data = new Map();
  const storage = kind === "blocked"
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
    : { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  Object.defineProperty(globalThis, "window", { value: { localStorage: storage, addEventListener() {}, removeEventListener() {} }, configurable: true, writable: true });
  reminderDeviceState.reset();
  return data;
}
test.afterEach(() => {
  delete globalThis.window;
  reminderDeviceState.reset();
});

test("a phone shows 2 cards and '1 more reminder', the docked panel 3; 'N more' opens the rest in place", () => {
  const all = [cardBill(), statement(), settleUp(), price()];
  assert.equal(cardLimitFor("page"), PHONE_CARD_LIMIT);
  assert.equal(cardLimitFor("popup"), PHONE_CARD_LIMIT);
  assert.equal(cardLimitFor("docked"), DOCK_CARD_LIMIT);
  const phone = list(all);
  assert.deepEqual(phone.entries.map((entry) => entry.key), ["card_bill:uob:2026-09", "statement:ocbc:2026-09"]);
  assert.deepEqual([phone.total, phone.more], [4, 2]);
  const dock = list(all, { limit: DOCK_CARD_LIMIT });
  assert.deepEqual([dock.entries.length, dock.more], [3, 1]);
  const open = list(all, { expanded: true });
  assert.deepEqual([open.entries.length, open.more], [4, 0]);
  // Three on a phone is "1 more".
  assert.equal(list(all.slice(0, 3)).more, 1);
  assert.equal(list(all.slice(0, 2)).more, 0);
});

test("no reminders, or only ones put away, shows nothing", () => {
  assert.deepEqual(list([]), { entries: [], total: 0, more: 0 });
  const state = { v: 1, items: { "card_bill:uob:2026-09": { skip: true, at: TODAY }, "statement:ocbc:2026-09": { until: "2026-10-13", at: TODAY } } };
  assert.equal(list([cardBill(), statement()], { state }).total, 0);
  // A Later that has come due shows again.
  const due = { v: 1, items: { "statement:ocbc:2026-09": { until: "2026-10-12", at: "2026-10-09" } } };
  assert.equal(list([statement()], { state: due }).total, 1);
});

test("the card bill says what is due, what is left and keeps plain ink until it is late", () => {
  const [card] = list([cardBill()]).entries;
  assert.deepEqual(
    [card.title, card.sentence, card.amountText, card.amountTone, card.primaryLabel, card.quiet],
    ["UOB PRVI Miles bill due in 6 days", "Due Sun 18 Oct. Nothing paid to it since the statement.", "$527.73", "neutral", "Open card", "later"]
  );
  const [part] = list([cardBill({ paidMinor: 20000, leftMinor: 32773 })]).entries;
  assert.equal(part.sentence, "Due Sun 18 Oct. $200.00 paid since the statement.");
  const [late] = list([cardBill({ daysUntilDue: -7, dueDate: "2026-10-05" })]).entries;
  assert.deepEqual([late.title, late.sentence, late.amountTone], ["UOB PRVI Miles bill was due 7 days ago", "Was due Mon 5 Oct. Nothing paid to it since the statement.", "short"]);
  assert.equal(list([cardBill({ daysUntilDue: 1 })]).entries[0].title, "UOB PRVI Miles bill due tomorrow");
  assert.equal(list([cardBill({ daysUntilDue: 0 })]).entries[0].title, "UOB PRVI Miles bill due today");
  assert.equal(list([cardBill({ daysUntilDue: -1 })]).entries[0].title, "UOB PRVI Miles bill was due yesterday");
});

test("with money hidden no amount shows, no tone, and no sentence says who owes whom", () => {
  const entries = list([cardBill({ paidMinor: 1000, leftMinor: 51773, daysUntilDue: -3, dueDate: "2026-10-09" }), settleUp(), price(), monthClose()], { hidden: true, expanded: true }).entries;
  const text = JSON.stringify(entries);
  assert.doesNotMatch(text, /\$\d/);
  assert.doesNotMatch(text, /527|1,047|1047|17\.98|15\.98|104724/);
  const [bill, splits, priceCard, close] = entries;
  assert.equal(bill.amountText, "••••");
  assert.equal(bill.amountTone, "neutral");
  assert.equal(bill.sentence, "Was due Fri 9 Oct. Part of it paid since the statement.");
  assert.equal(splits.amountText, "••••");
  assert.equal(splits.amountTone, "neutral");
  // "Agreed on 6 Sep to even out your shared costs", never "you agreed to pay him".
  assert.equal(splits.sentence, "Agreed on 6 Sep to even out your shared costs.");
  assert.doesNotMatch(splits.sentence, /you agreed|pay him|pay her|owe/i);
  assert.equal(priceCard.title, "Spotify's price changed");
  assert.equal(priceCard.amountText, "••••");
  assert.deepEqual(close.rows.find((row) => row.id === "splits").amountText, "••••");
  assert.equal(close.rows.find((row) => row.id === "splits").amountTone, "neutral");
});

test("a Splits card names the other person from the viewer's side, with the money tone of a debt or a credit", () => {
  const [owe] = list([settleUp()]).entries;
  assert.deepEqual(
    [owe.title, owe.sentence, owe.amountText, owe.amountTone, owe.personName],
    ["Settle-up with Ethan waiting 5 weeks", "On 6 Sep you agreed to pay Ethan this to even out your shared costs.", "$1047.24", "short", "Ethan"]
  );
  const [owed] = list([settleUp({ direction: "owed_to_you", fromName: "Ethan", toName: "Serene" })]).entries;
  assert.deepEqual([owed.title, owed.sentence, owed.amountTone], ["Settle-up with Ethan waiting 5 weeks", "On 6 Sep Ethan agreed to pay you this to even out your shared costs.", "in"]);
  const [between] = list([settleUp({ direction: "between", fromName: "Serene", toName: "Ethan" })]).entries;
  assert.deepEqual([between.title, between.sentence, between.amountTone, between.personName], [
    "Settle-up between Serene and Ethan waiting 5 weeks", "On 6 Sep Serene agreed to pay Ethan this to even out their shared costs.", "neutral", ""
  ]);
  const [group] = list([settleUp({ variant: "group_balance", groupName: "Bali trip", sinceDate: "2026-09-10", weeks: 4 })]).entries;
  assert.deepEqual([group.title, group.sentence], ["Shared costs with Ethan waiting 4 weeks", "In Bali trip, you owe Ethan for costs open since 10 Sep."]);
});

test("the statement and price cards say what is expected and what changed", () => {
  const [missing] = list([statement()]).entries;
  assert.deepEqual([missing.title, missing.sentence, missing.primaryLabel], [
    "OCBC 365 Card's September statement should be out",
    "It usually closes around 30 Sep, about 12 days ago. Importing it checks September's spending.",
    "Import statement"
  ]);
  const [change] = list([price()]).entries;
  assert.deepEqual([change.title, change.sentence, change.amountText, change.quiet, change.later], [
    "Spotify now costs $17.98 a month",
    "Up from $15.98, its price for the 11 months before. First new charge on 7 Oct.",
    "+$2.00",
    "got-it",
    null
  ]);
  const [yearly] = list([price({ period: "yearly", fromMinor: 12000, toMinor: 10000, priorChargeCount: 2 })]).entries;
  assert.deepEqual([yearly.title, yearly.sentence, yearly.amountText], [
    "Spotify now costs $100.00 a year", "Down from $120.00, its price for the 2 yearly charges before. First new charge on 7 Oct.", "-$20.00"
  ]);
});

test("the month checklist lists its four checks, what is left, and where each open row goes", () => {
  const [card] = list([monthClose()]).entries;
  assert.deepEqual([card.title, card.sentence, card.primaryLabel], ["September is ready to close", "Every statement is in. 3 of 4 checks done.", "Open September"]);
  assert.deepEqual(card.progress, { done: [true, true, false, true], label: "3 of 4 checks done" });
  assert.deepEqual(card.rows.map((row) => [row.id, row.done, row.label, row.value, row.amountText, Boolean(row.target)]), [
    ["statements", true, "Statements imported", "All 6", "", false],
    ["other", true, "Left in Other (no category)", "None", "", false],
    ["splits", false, "Splits to settle", "with Ethan", "$1047.24", true],
    ["note", true, "Month note", "Written", "", false]
  ]);
  assert.deepEqual(card.rows[2].target, { pathname: "/splits", extra: {} });
  const open = monthClose({ checks: [
    { id: "statements", done: true, count: 1 },
    { id: "other", done: false, count: 3 },
    { id: "splits", done: false, count: 2 },
    { id: "note", done: false, count: 0 }
  ] });
  const [many] = list([open]).entries;
  assert.deepEqual(many.rows.map((row) => [row.value, row.target?.pathname]), [["The only one", undefined], ["3 entries", "/entries"], ["2 to settle", "/splits"], ["Not written yet", "/month"]]);
  assert.deepEqual(many.rows[1].target.extra, { month: "2026-09", entry_category: "Other" });
  assert.equal(many.sentence, "Every statement is in. 1 of 4 checks done.");
});

test("a finished checklist shows one 'all in' line, only if this device showed it open, and once", () => {
  const done = monthClose({ allDone: true });
  assert.equal(list([done]).total, 0);
  const shownOpen = { v: 1, items: { [done.key]: { open: true, at: "2026-10-05" } } };
  const [line] = list([done], { state: shownOpen }).entries;
  assert.deepEqual([line.kind, line.title], ["month_all_in", "September is all in"]);
  const afterwards = { v: 1, items: { [done.key]: { open: true, doneShown: true, at: TODAY } } };
  assert.equal(list([done], { state: afterwards }).total, 0);
  // The visit that showed it keeps the line after it is marked as shown.
  assert.equal(list([done], { state: afterwards, allInKeys: new Set([done.key]) }).entries[0].kind, "month_all_in");
});

test("Later offers Tomorrow, In 3 days and Next week with their dates, then one 'not for this one'", () => {
  const choices = laterChoices(cardBill(), TODAY);
  assert.deepEqual(choices.days.map((day) => [day.label, day.date, day.dateText]), [
    ["Tomorrow", "2026-10-13", "Tue 13 Oct"],
    ["In 3 days", "2026-10-15", "Thu 15 Oct"],
    ["Next week", "2026-10-19", "Mon 19 Oct"]
  ]);
  assert.deepEqual(choices.skips.map((skip) => skip.label), ["Not for this bill", "Paid from another account"]);
  assert.deepEqual(laterChoices(statement(), TODAY).skips, [{ label: "Not for this statement", hint: "back for October's" }]);
  assert.deepEqual(laterChoices(settleUp(), TODAY).skips.map((skip) => skip.label), ["Not for this balance"]);
  assert.deepEqual(laterChoices(monthClose(), TODAY).skips.map((skip) => skip.label), ["Not for this month"]);
  assert.equal(laterChoices(price(), TODAY), null);
  // The coming Monday is never today, and counts from any weekday.
  assert.equal(nextMondayAfter("2026-10-12"), "2026-10-19");
  assert.equal(nextMondayAfter("2026-10-18"), "2026-10-19");
  assert.equal(nextMondayAfter("2026-10-16"), "2026-10-19");
});

test("each card opens the page that settles it, and a checklist row its own", () => {
  assert.deepEqual(reminderTarget(cardBill()), { pathname: "/entries", extra: { entry_wallet: "uob" } });
  assert.deepEqual(reminderTarget(statement()), { pathname: "/imports", extra: {} });
  assert.deepEqual(reminderTarget(settleUp()), { pathname: "/splits", extra: {} });
  assert.deepEqual(reminderTarget(price()), { pathname: "/entries", extra: { entry_search: "Spotify" } });
  assert.deepEqual(reminderTarget(monthClose()), { pathname: "/month", extra: { month: "2026-09" } });
});

test("a choice folds the card into one line for the visit, and Undo brings it back", () => {
  const folded = { "card_bill:uob:2026-09": { until: "2026-10-15" }, "price:monthly|SPOTIFY:2026-10-07": { gotIt: true }, "statement:ocbc:2026-09": { skipped: true } };
  const state = { v: 1, items: { "card_bill:uob:2026-09": { until: "2026-10-15", at: TODAY } } };
  const result = list([cardBill(), statement(), price()], { folded, state, expanded: true });
  assert.deepEqual(result.entries.map((entry) => [entry.kind, entry.text]), [
    ["folded", "Back on Thu 15 Oct"],
    ["folded", "Hidden on this device"],
    ["folded", "Got it"]
  ]);
});

test("the device remembers Later, hiding and what Ask showed, across a reload, and prunes after 90 days", () => {
  const data = installStorage();
  laterUntil("statement:ocbc:2026-09", "2026-10-15", TODAY);
  hideReminder("card_bill:uob:2026-09", TODAY);
  markRemindersSeen(["splits:settle_up:cp-1"], TODAY);
  const stored = JSON.parse(data.get(REMINDERS_STORAGE_KEY));
  assert.deepEqual(stored, {
    v: 1,
    items: {
      "statement:ocbc:2026-09": { until: "2026-10-15", seen: false, at: TODAY },
      "card_bill:uob:2026-09": { skip: true, at: TODAY },
      "splits:settle_up:cp-1": { seen: true, at: TODAY }
    }
  });
  // A reload reads the same.
  reminderDeviceState.reset();
  assert.deepEqual(reminderDeviceState.getSnapshot(), stored);
  assert.equal(isReminderHidden(stored.items["statement:ocbc:2026-09"], TODAY), true);
  assert.equal(isReminderHidden(stored.items["statement:ocbc:2026-09"], "2026-10-15"), false);
  assert.equal(isReminderHidden(stored.items["card_bill:uob:2026-09"], "2027-01-01"), true);

  showReminderAgain("card_bill:uob:2026-09", TODAY);
  assert.deepEqual(reminderDeviceState.getSnapshot().items["card_bill:uob:2026-09"], { seen: false, at: TODAY });

  // Entries untouched for 90 days go; younger ones stay.
  const items = { old: { skip: true, at: "2026-07-01" }, edge: { skip: true, at: "2026-07-14" }, fresh: { skip: true, at: "2026-10-01" }, broken: null };
  assert.deepEqual(Object.keys(pruneReminderItems(items, TODAY)), ["edge", "fresh"]);
});

test("with storage blocked every reminder shows, choices still hold for the page, and nothing throws", () => {
  installStorage("blocked");
  assert.deepEqual(reminderDeviceState.getSnapshot(), EMPTY_REMINDER_STATE);
  assert.equal(list([cardBill(), statement()]).total, 2);
  assert.doesNotThrow(() => laterUntil("statement:ocbc:2026-09", "2026-10-15", TODAY));
  assert.equal(reminderDeviceState.getSnapshot().items["statement:ocbc:2026-09"].until, "2026-10-15");
  assert.equal(list([cardBill(), statement()], { state: reminderDeviceState.getSnapshot() }).total, 1);
  // Unreadable stored text is as good as none.
  const data = installStorage();
  data.set(REMINDERS_STORAGE_KEY, "{not json");
  reminderDeviceState.reset();
  assert.deepEqual(reminderDeviceState.getSnapshot(), EMPTY_REMINDER_STATE);
  data.set(REMINDERS_STORAGE_KEY, JSON.stringify({ v: 2, items: {} }));
  reminderDeviceState.reset();
  assert.deepEqual(reminderDeviceState.getSnapshot(), EMPTY_REMINDER_STATE);
});

test("the dot counts only reminders this device has not seen: a new one, or one back from Later", () => {
  const reminders = [cardBill(), statement(), monthClose({ allDone: true })];
  assert.deepEqual(unseenReminders(reminders, EMPTY_REMINDER_STATE, TODAY).map((reminder) => reminder.kind), ["card_bill", "statement_missing"]);
  // Seen in Ask: quiet.
  const seen = { v: 1, items: { "card_bill:uob:2026-09": { seen: true, at: TODAY }, "statement:ocbc:2026-09": { seen: true, at: TODAY } } };
  assert.deepEqual(unseenReminders(reminders, seen, TODAY), []);
  // Later: no dot while it waits, and a dot when it returns.
  const later = { v: 1, items: { ...seen.items, "statement:ocbc:2026-09": { until: "2026-10-15", seen: false, at: TODAY } } };
  assert.deepEqual(unseenReminders(reminders, later, TODAY), []);
  assert.deepEqual(unseenReminders(reminders, later, "2026-10-15").map((reminder) => reminder.key), ["statement:ocbc:2026-09"]);
  // Hidden for good: never a dot.
  assert.deepEqual(unseenReminders([statement()], { v: 1, items: { "statement:ocbc:2026-09": { skip: true, at: TODAY } } }, TODAY), []);
  // A finished checklist counts only until its line was shown.
  const closeKey = "month_close:2026-09";
  assert.deepEqual(unseenReminders([monthClose({ allDone: true })], { v: 1, items: { [closeKey]: { open: true, at: TODAY } } }, TODAY).length, 1);
  assert.deepEqual(unseenReminders([monthClose({ allDone: true })], { v: 1, items: { [closeKey]: { open: true, doneShown: true, at: TODAY } } }, TODAY), []);
});

test("checklist memory: open once shown with something to do, then its finished line is marked shown", () => {
  installStorage();
  markChecklistOpen("month_close:2026-09", "2026-10-05");
  assert.equal(reminderDeviceState.getSnapshot().items["month_close:2026-09"].open, true);
  markChecklistDoneShown("month_close:2026-09", TODAY);
  assert.deepEqual(reminderDeviceState.getSnapshot().items["month_close:2026-09"], { open: true, doneShown: true, at: TODAY });
});

test("the answer reader keeps what it understands and refuses what it does not", () => {
  assert.equal(remindersEndpoint("person-tim"), "/api/reminders?view=person-tim");
  assert.equal(remindersEndpoint(""), "/api/reminders?view=household");
  assert.equal(readReminders(null), null);
  assert.equal(readReminders({ today: TODAY }), null);
  assert.equal(readReminders({ reminders: [] }), null);
  const answer = readReminders({ viewId: "household", today: TODAY, reminders: [cardBill(), { key: "x", kind: "something_new" }, null, { kind: "card_bill" }] });
  assert.deepEqual(answer.reminders.map((reminder) => reminder.key), ["card_bill:uob:2026-09"]);
});
