// The Ask eval bank, replayed without a model (tests/fixtures/ask-eval-
// utterances.json, tests/support/ask-eval-bank.mjs). Each entry is a
// realistic message with the answer a good model records for it; the real
// Worker route runs it on a seeded household with that recorded answer in
// place of the model, and the result must be the action and reply the entry
// expects. This proves the server's side of "the model states intent, the
// server completes": names, days, months, amounts and shares are read from
// what the person said, a refused answer is repaired once, and what cannot
// be repaired comes back as a question with chips. The same bank runs
// against the real model with `npm run eval:ask` (docs/flows/ask-flow.md,
// "Eval bank"); that run is manual and not in CI.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { ASK_TURN_ACTIONS, ASK_TURN_SCHEMA, parseAskTurnAction } from "../src/domain/ask-turn.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { bankDates, checkExpectation, loadBank, seedBankHousehold } from "./support/ask-eval-bank.mjs";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const bank = loadBank();

// A stand-in for the model that answers each call from the entry's recording.
function recorded(...answers) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push(input.messages.at(-1).content);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }] };
    }
  };
}

// Whether a recorded answer is shaped as the schema the model is given asks
// (a model off-schema is exercised on purpose by `legacySchema` entries).
function conforms(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((option) => conforms(value, option));
  const types = [].concat(schema.type ?? []);
  if (value === null) return types.includes("null");
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Array.isArray(value)) return types.includes("array") && value.every((item) => conforms(item, schema.items ?? {}));
  if (typeof value === "object") {
    if (!types.includes("object")) return false;
    const properties = schema.properties ?? {};
    return Object.keys(value).every((key) => key in properties && conforms(value[key], properties[key]))
      && (schema.required ?? []).every((key) => key in value);
  }
  if (typeof value === "string") return types.includes("string");
  if (typeof value === "number") return types.includes("number");
  if (typeof value === "boolean") return types.includes("boolean");
  return false;
}

test("the bank is big, varied and covers every Ask action and the owner's own messages", () => {
  assert.ok(bank.length >= 80, `${bank.length} entries`);
  assert.equal(new Set(bank.map((entry) => entry.id)).size, bank.length, "ids are unique");
  assert.equal(new Set(bank.map((entry) => entry.text)).size > bank.length * 0.8, true, "messages are varied");
  const covered = new Set(bank.flatMap((entry) => [entry.model.action, ...(entry.repair ? [entry.repair.action] : [])]));
  for (const action of ASK_TURN_ACTIONS) assert.ok(covered.has(action), `no entry records ${action}`);
  const texts = bank.map((entry) => entry.text.toLowerCase());
  for (const owner of [
    "add to splits, all joyce",
    "i meant all splits share is joyce, i'm the owner",
    "add to splits, joyce's share 1.6",
    "make all grab rides transport",
    "this is a transfer to uob one",
    "how did september go?",
    "settle up with joyce",
    "move $50 from shopping to groceries"
  ]) {
    assert.ok(texts.includes(owner), `missing the owner's message: ${owner}`);
  }
  // Typos, shorthand, partial information and unit ambiguities are in there on purpose.
  for (const kind of [/lunh|chnage|spnd|okeri/, /\bsept\b|\byest|k on citi/, /\b1\.6\b/, /\bfifty\b|4,50|\$1\.6/]) {
    assert.ok(texts.some((text) => kind.test(text)), `no entry for ${kind}`);
  }
});

test("every recorded answer is an action the model could give: it parses, and fits the schema it is given", () => {
  for (const entry of bank) {
    for (const [label, answer] of [["model", entry.model], ["repair", entry.repair]]) {
      if (!answer) continue;
      const parsed = parseAskTurnAction(answer);
      assert.ok(parsed, `${entry.id}: ${label} does not parse`);
      assert.equal(parsed.action, answer.action);
      if (!entry.legacySchema) assert.ok(conforms(answer, ASK_TURN_SCHEMA), `${entry.id}: ${label} does not fit ASK_TURN_SCHEMA: ${JSON.stringify(answer)}`);
    }
    assert.ok(entry.expect.actions.length && entry.expect.kinds.length, `${entry.id}: expects an action and a reply`);
  }
  // The model-facing schema carries nothing computed: a share is a person and what was said.
  const share = ASK_TURN_SCHEMA.properties.split.anyOf[0].properties.shares.items;
  assert.deepEqual(Object.keys(share.properties).sort(), ["all", "person", "value"]);
});

test("the bank replayed through the Worker: each recorded answer ends as the entry expects", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const seed = await seedBankHousehold({ db, api, today: TODAY });
  const dates = bankDates(TODAY);
  const failures = [];
  const firstPrompts = [];
  let repairsAttempted = 0;
  let repairsFixed = 0;

  for (const entry of bank) {
    const month = entry.setup?.month ?? dates.month;
    const answers = [entry.model, ...(entry.repair ? [entry.repair] : [])];
    const ai = recorded(...answers);
    await db.prepare("DELETE FROM ai_assist_daily_usage").run();
    const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: entry.text,
        history: entry.setup?.history ?? [],
        viewId: "person-tim",
        scope: "direct_plus_shared",
        month,
        page: "ask",
        focus: seed.focus(entry.setup?.focus ?? "none", month)
      })
    }), { DB: db, ...template.config.vars, AI: ai, AI_ASSIST_ENABLED: "true" });
    const payload = await response.json();
    firstPrompts.push(ai.calls[0] ?? "");

    const wanted = { ...entry, expect: { ...entry.expect, fields: { ...(entry.expect.fields ?? {}), ...(entry.unit?.fields ?? {}) } } };
    const problems = checkExpectation(wanted, payload, dates, { entryId: seed.entryId });
    if (entry.unit?.calls !== undefined && ai.calls.length !== entry.unit.calls) problems.push(`${ai.calls.length} model calls, wanted ${entry.unit.calls}`);
    if (entry.unit?.repaired !== undefined && payload.repaired !== entry.unit.repaired) problems.push(`repaired ${payload.repaired}, wanted ${entry.unit.repaired}`);
    if (entry.unit?.repaired === undefined && payload.repaired !== undefined) problems.push(`unexpectedly repaired: ${payload.repaired}`);
    if (payload.repaired !== undefined) {
      repairsAttempted += 1;
      repairsFixed += payload.repaired ? 1 : 0;
    }
    // The page never sees why a question is asked.
    if (payload.reply?.kind === "clarify" && "error" in payload.reply) problems.push("the reply leaks the validator error");
    if (problems.length) failures.push(`${entry.id}  "${entry.text}"\n    - ${problems.join("\n    - ")}`);
  }

  assert.deepEqual(failures, [], `${failures.length} of ${bank.length} entries differ:\n${failures.join("\n")}`);
  // Measure: a prompt stays about 2k tokens (4 characters a token), and no phone, card or amount from the household's records goes in it.
  const average = firstPrompts.reduce((sum, prompt) => sum + prompt.length, 0) / firstPrompts.length;
  assert.ok(average < 8_000, `average prompt ${Math.round(average)} characters`);
  for (const prompt of firstPrompts) assert.doesNotMatch(prompt, /91234567|42\.50|4250|4,250/);
  assert.ok(repairsAttempted >= 4 && repairsFixed >= 2, `repairs attempted ${repairsAttempted}, fixed ${repairsFixed}`);
});
