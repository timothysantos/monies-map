// Naming rule (AGENTS.md, "Every visible name must be understandable to a
// non-technical person"): the reminder cards' own words use none of the
// engine's terms ("rule", "snooze", "occurrence", "key") and pass the
// app-jargon and retired-name lists. Walks every string in the copy module
// (calling each function with sample figures), and the Ask tab's cue labels
// in the first-screen copy.
import assert from "node:assert/strict";
import test from "node:test";

import { remindersCopy } from "../src/client/copy/reminders-copy.js";
import { messages } from "../src/client/copy/en-SG.js";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";
import { findRetiredNames } from "../src/domain/retired-names.ts";

const BANNED = [
  [/\bengine\b/i, "engine"],
  [/\brules?\b/i, "rule"],
  [/\bsnooz\w*\b/i, "snooze"],
  [/\boccurrences?\b/i, "occurrence"],
  [/\bkeys?\b/i, "key"],
  [/\bDTOs?\b/, "DTO"],
  [/\bAPI\b/, "API"],
  [/\bdismiss\w*\b/i, "dismiss"],
  [/\bnotifications?\b/i, "notification"],
  [/\bAI\b/, "AI"]
];

const SAMPLES = [
  [3], [1], [0], [-2], ["UOB PRVI Miles", 6], ["OCBC 365 Card", "September"], ["Sep 30", 12, "September"],
  [{ direction: "you_owe", otherName: "Ethan", fromName: "Serene", toName: "Ethan", weeks: 5, dateText: "6 Sep", groupName: "Bali trip", hidden: false }],
  [{ direction: "between", otherName: "Ethan", fromName: "Serene", toName: "Ethan", weeks: 1, dateText: "6 Sep", groupName: "Bali trip", hidden: true }],
  [{ dueText: "Sun 18 Oct", overdue: true, paidText: "$20.00", hasPaid: true }],
  [{ payeeName: "Spotify", newText: "$17.98", period: "monthly", hidden: false }],
  [{ oldText: "$15.98", higher: true, priorCount: 11, period: "yearly", dateText: "7 Oct", hidden: false }],
  ["September", true], ["Alex"], ["October"]
];

function visibleStrings(value, path = "remindersCopy", out = []) {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (typeof value === "function") {
    for (const args of SAMPLES) {
      try {
        const result = value(...args);
        if (typeof result === "string" || (result && typeof result === "object")) {
          visibleStrings(result, `${path}(${JSON.stringify(args).slice(0, 40)})`, out);
        }
      } catch {
        // not this sample
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visibleStrings(item, `${path}.${key}`, out);
  }
  return out;
}

const strings = [
  ...visibleStrings(remindersCopy),
  ...visibleStrings({ askReminders: messages.tabs.askReminders, askInProgressAndReminders: messages.tabs.askInProgressAndReminders }, "messages.tabs")
];

test("the walk reaches the copy: titles, sentences, the Later choices, checklist rows and the tab's labels", () => {
  const text = strings.map(([, value]) => value).join("\n");
  for (const expected of ["Remind me later", "Tomorrow", "In 3 days", "Next week", "Not for this bill", "Paid from another account", "Not for this statement",
    "Statements imported", "Left in Other (no category)", "Splits to settle", "Month note", "Got it", "Back on", "bill due in 6 days", "waiting 5 weeks",
    "is ready to close", "Ask, 3 reminders", "Ask, 1 reminder", "conversation in progress and 3 reminders"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(strings.length > 90, `walked ${strings.length} strings`);
});

test("no string uses an engine term, app jargon or a retired name", () => {
  const offences = [];
  for (const [path, text] of strings) {
    for (const [pattern, name] of BANNED) {
      if (pattern.test(text)) offences.push(`${path}: "${text}" (${name})`);
    }
    for (const problem of findAppJargon(text)) offences.push(`${path}: "${text}" (${problem})`);
    for (const problem of findRetiredNames(text)) offences.push(`${path}: "${text}" (${problem})`);
  }
  assert.deepEqual(offences, []);
});

test("hidden money: the settle-up and balance sentences name no direction and no amount", () => {
  const sentences = [
    remindersCopy.splits.settleUpSentence({ direction: "you_owe", otherName: "Ethan", fromName: "Serene", toName: "Ethan", dateText: "6 Sep", hidden: true }),
    remindersCopy.splits.balanceSentence({ direction: "owed_to_you", otherName: "Ethan", fromName: "Ethan", toName: "Serene", groupName: "Bali trip", dateText: "6 Sep", hidden: true }),
    remindersCopy.price.sentence({ oldText: "••••", higher: true, priorCount: 3, period: "monthly", dateText: "7 Oct", hidden: true }),
    remindersCopy.price.title({ payeeName: "Spotify", newText: "••••", period: "monthly", hidden: true })
  ];
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, /\b(owes?|owed|agreed to pay|pay you|pay him|pay her|up from|down from|now costs)\b/i, sentence);
    assert.doesNotMatch(sentence, /\$/);
  }
});

test("a retired name is rejected by the same check (the lint can fail)", () => {
  assert.notDeepEqual(findRetiredNames("Overplanned this month"), []);
  assert.ok(/\brules?\b/i.test("a rule fired"));
});
