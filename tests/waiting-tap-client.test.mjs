// The waiting tap's words and reminder card on the client (DOMAIN.md
// "Waiting Tap"; src/client/copy/waiting-tap-copy.js, reminders-model.js,
// waiting-tap-api.js): the one line the Entries card shows, the Ask reminder
// and where it opens, the typed amount it sends, and plain words throughout.
import assert from "node:assert/strict";
import test from "node:test";

import { tapDayWord, waitingTapCopy } from "../src/client/copy/waiting-tap-copy.js";
import { remindersCopy } from "../src/client/copy/reminders-copy.js";
import { buildReminderList, laterChoices, PHONE_CARD_LIMIT, reminderTarget } from "../src/client/reminders-model.js";
import { EMPTY_REMINDER_STATE } from "../src/client/reminders-device-state.js";
import { readReminders } from "../src/client/reminders-api.js";
import { readTypedAmount } from "../src/client/waiting-tap-api.js";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { findRetiredNames } from "../src/domain/retired-names.ts";

const reminder = { key: "waiting_tap:tap-1", kind: "waiting_tap", tapId: "tap-1", merchant: "Periplus Bali", date: "2026-11-17", time: "14:02", accountName: "UOB One" };

test("the card's line: merchant, day and time, card, and what went wrong", () => {
  assert.equal(
    waitingTapCopy.line({ merchant: "Periplus Bali", dayWord: tapDayWord("2026-11-17", "2026-11-17"), time: "14:02", accountName: "UOB One" }),
    "Periplus Bali, today 14:02, UOB One. The amount didn't come through."
  );
  assert.equal(tapDayWord("2026-11-16", "2026-11-17"), "yesterday");
  assert.equal(tapDayWord("2026-11-15", "2026-11-17"), "Sun 15 Nov");
  assert.equal(waitingTapCopy.line({ merchant: "Grab", dayWord: "Sun 15 Nov", time: "", accountName: "" }), "Grab, Sun 15 Nov. The amount didn't come through.");
});

test("the typed amount is sent as typed, only when it is a figure above zero", () => {
  assert.equal(readTypedAmount(" 22.94 "), "22.94");
  assert.equal(readTypedAmount("150.000"), "150.000");
  assert.equal(readTypedAmount("1,250"), "1,250");
  for (const bad of ["", "0", "0.00", "-5", "12,34.5", "abc", "1.2345"]) {
    assert.equal(readTypedAmount(bad), "", bad);
  }
});

test("Ask's reminder: first in the list, plain words, opens the tap on Entries, only Later", () => {
  assert.equal(readReminders({ today: "2026-11-17", reminders: [reminder] }).reminders.length, 1);
  const { entries } = buildReminderList({ reminders: [reminder], state: EMPTY_REMINDER_STATE, today: "2026-11-17", hidden: true, formatMoney: () => "", limit: PHONE_CARD_LIMIT });
  const [card] = entries;
  assert.deepEqual([card.title, card.sentence, card.primaryLabel, card.amountText], [
    "Periplus Bali: the amount didn't come through",
    "Paid today 14:02 on UOB One. Add the amount, or say it wasn't a payment.",
    "Add the amount",
    ""
  ]);
  assert.deepEqual(reminderTarget(reminder), { pathname: "/entries", extra: { waiting_tap: "tap-1" } });
  const later = laterChoices(reminder, "2026-11-17");
  assert.deepEqual([later.days.length, later.skips.length], [3, 0]);
  const older = buildReminderList({ reminders: [{ ...reminder, date: "2026-11-15" }], state: EMPTY_REMINDER_STATE, today: "2026-11-17", hidden: false, formatMoney: () => "", limit: 2 }).entries[0];
  assert.equal(older.sentence, "Paid Sun 15 Nov 14:02 on UOB One. Add the amount, or say it wasn't a payment.");
});

test("every waiting tap string is plain: no app jargon, no retired names, no engine words", () => {
  const strings = [
    ...Object.values(waitingTapCopy).map((value) => (typeof value === "function" ? value("Periplus Bali") : value)),
    waitingTapCopy.line({ merchant: "Periplus Bali", dayWord: "today", time: "14:02", accountName: "UOB One" }),
    remindersCopy.waitingTap.title("Periplus Bali"),
    remindersCopy.waitingTap.sentence({ dayText: "today", time: "14:02", accountName: "UOB One" }),
    remindersCopy.waitingTap.open,
    remindersCopy.waitingTap.laterTitle("Periplus Bali"),
    remindersCopy.waitingTap.laterNote
  ];
  for (const text of strings) {
    assert.deepEqual(findAppJargon(text), [], text);
    assert.deepEqual(findRetiredNames(text), [], text);
    assert.doesNotMatch(text, /\b(tap|held|request|status|DTO|API|AI|shortcut)\b/i, text);
  }
});
