// The Ask eval bank (tests/fixtures/ask-eval-utterances.json): realistic
// things a person types into Ask, each with the action and reply the app
// should end with, and (for the deterministic layer) the recorded answer a
// good model gives. One bank, two runs:
//
//   - tests/ask-eval-bank.test.mjs replays every recorded answer through the
//     real Worker route on a seeded household (no model, runs in CI): it
//     proves the server's completion, validation and repair logic.
//   - scripts/ask-turn-eval.mjs (npm run eval:ask) sends the same messages to
//     the real model and checks the same expectations (manual, cap-aware).
//
// An entry:
//   id, group      a stable name, and the action it mostly exercises
//   text           the message
//   setup          { focus: "none" | "saved" | "draft" | "list" | "group",
//                    month?: "YYYY-MM" (the month in view), history?: [{role, text}] }
//   model          the recorded model answer (the action JSON), for the unit layer
//   repair         the recorded answer to the repair turn, when the first is refused
//   expect         { actions: [ok action names], kinds: [ok reply kinds],
//                    fields?: { "reply.path": value | { $match: "regex" } | { $includes: x } | { $absent: true } } }
//   unit           unit-layer only: { repaired?: true|false, calls?: 1|2 }
//
// Placeholders in expected strings: {{today}} {{yesterday}} {{daysAgo:N}}
// {{month}} {{month-N}} {{monthLabel}} {{monthLabel-N}} {{entryId}}.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createEntry } from "./d1-workspace.mjs";

const BANK_PATH = fileURLToPath(new URL("../fixtures/ask-eval-utterances.json", import.meta.url));
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function loadBank() {
  return JSON.parse(readFileSync(BANK_PATH, "utf8"));
}

function shiftMonth(month, delta) {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

// The dates a bank run is relative to, from the app's own "today".
export function bankDates(today) {
  const month = today.slice(0, 7);
  return { today, month, shiftMonth, shiftDay };
}

export function fill(value, dates, extra = {}) {
  if (typeof value === "string") {
    return value.replace(/\{\{([^}]+)\}\}/g, (_, token) => {
      const [name, arg] = token.split(/[:]/);
      const offset = /^(month|monthLabel)(-\d+)$/.exec(name);
      if (offset) {
        const month = shiftMonth(dates.month, Number(offset[2]));
        return offset[1] === "month" ? month : `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
      }
      if (name === "named" || name === "namedLabel") {
        // The most recent month with that name that is not in the future.
        const index = MONTH_NAMES.findIndex((month) => month.toLowerCase().startsWith(arg.toLowerCase()));
        const year = Number(dates.month.slice(0, 4));
        let month = `${year}-${String(index + 1).padStart(2, "0")}`;
        if (month > dates.month) month = `${year - 1}-${month.slice(5)}`;
        return name === "named" ? month : `${MONTH_NAMES[index]} ${month.slice(0, 4)}`;
      }
      if (name === "today") return dates.today;
      if (name === "yesterday") return shiftDay(dates.today, -1);
      if (name === "daysAgo") return shiftDay(dates.today, -Number(arg));
      if (name === "month") return dates.month;
      if (name === "monthLabel") return `${MONTH_NAMES[Number(dates.month.slice(5)) - 1]} ${dates.month.slice(0, 4)}`;
      if (name in extra) return String(extra[name]);
      throw new Error(`Unknown placeholder {{${token}}}`);
    });
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, dates, extra));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner, dates, extra)]));
  }
  return value;
}

function at(object, path) {
  return path.split(".").reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), object);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// What is wrong with a route answer against one bank entry (empty when it is
// as expected). `payload` is the route's JSON.
export function checkExpectation(entry, payload, dates, extra = {}) {
  const problems = [];
  const { expect } = entry;
  if (payload.mode !== "ai") return [`mode ${payload.mode} (${payload.reason ?? ""})`];
  if (!expect.actions.includes(payload.action)) problems.push(`action ${payload.action}, wanted ${expect.actions.join(" or ")}`);
  const kind = payload.reply?.kind;
  if (!expect.kinds.includes(kind)) problems.push(`reply ${kind}, wanted ${expect.kinds.join(" or ")}`);
  for (const [path, wanted] of Object.entries(fill(expect.fields ?? {}, dates, extra))) {
    const got = at(payload, path);
    if (wanted && typeof wanted === "object" && "$match" in wanted) {
      if (!new RegExp(wanted.$match).test(String(got))) problems.push(`${path} ${JSON.stringify(got)} does not match /${wanted.$match}/`);
    } else if (wanted && typeof wanted === "object" && "$includes" in wanted) {
      const holds = Array.isArray(got) ? got.some((item) => same(item, wanted.$includes)) : String(got ?? "").includes(wanted.$includes);
      if (!holds) problems.push(`${path} ${JSON.stringify(got)} does not include ${JSON.stringify(wanted.$includes)}`);
    } else if (wanted && typeof wanted === "object" && "$absent" in wanted) {
      if (got !== undefined) problems.push(`${path} is ${JSON.stringify(got)}, wanted none`);
    } else if (!same(got, wanted)) {
      problems.push(`${path} is ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`);
    }
  }
  return problems;
}

// The household the bank runs against: the seeded demo, with a saved Apple
// Pay-style entry and a few Grab rides this month. Returns the focus for each
// setup the bank uses, by the ids the route reads.
export async function seedBankHousehold({ db, api, today }) {
  const entryId = await createEntry(api, { date: today, description: "STARBUCKS PAYNOW 91234567", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 4_250 });
  for (const [index, amountMinor] of [1_850, 2_240, 1_620].entries()) {
    await createEntry(api, { date: shiftDay(today, -index), description: "GRAB* RIDE", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor });
  }
  // Trips and events: one trip, and two holidays a bare "the holiday" cannot tell apart.
  for (const name of ["Seoul trip", "Bali holiday", "Penang holiday"]) {
    const saved = await api("/api/trip-events/save", { name });
    if (saved.status !== 200) throw new Error(`trip ${name}: ${JSON.stringify(saved.payload)}`);
  }
  const group = await db.prepare("SELECT id FROM split_groups ORDER BY sort_order, group_name LIMIT 1").first();
  return {
    entryId,
    groupId: group?.id ?? "",
    focus(name, month) {
      if (name === "saved") return { kind: "saved_entry", entryId };
      if (name === "draft") {
        return { kind: "draft", draft: { variant: "expense", description: "Koufu lunch", date: today, accountId: "", categoryName: "Food & Drinks", ownerName: "Tim", amountMinor: 1_250, shareOn: false, splitGroupId: "" } };
      }
      if (name === "list") return { kind: "entry_list", list: { month: month ?? today.slice(0, 7), search: "grab", categories: [] } };
      if (name === "group") return { kind: "split_group", groupId: group?.id ?? "" };
      return null;
    }
  };
}
