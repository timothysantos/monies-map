// A real-model eval for Ask's turn: manual, not in CI, cap-aware.
//
//   npm run eval:ask                      a spread sample of 30 messages
//   npm run eval:ask -- --limit 12        the first 12 of the spread
//   npm run eval:ask -- --group add_entry_to_splits
//   npm run eval:ask -- --ids splits-all-joyce,splits-joyce-share-1-6
//   npm run eval:ask -- --all --yes       the whole bank (about 115 turns)
//   npm run eval:ask -- --dry             list what would run, send nothing
//
// It runs the bank (tests/fixtures/ask-eval-utterances.json, shared with the
// deterministic replay in tests/ask-eval-bank.test.mjs) through the real
// Worker route on a local D1 seeded with the demo household, with the real
// AI provider, and prints PASS or FAIL per message with the action the model
// chose, the checked reply's kind and, when the checks refused the first
// answer, whether the one repair turn fixed it. It ends with the pass rate
// and the repair rate.
//
// It needs the provider settings in the environment, the same names the
// Worker reads: AI_GATEWAY_URL (or AI_GATEWAY_ACCOUNT_ID + AI_GATEWAY_ID),
// AI_GATEWAY_TOKEN and/or ANTHROPIC_API_KEY, and optionally
// AI_GATEWAY_BYOK_ALIAS and AI_CLAUDE_MODEL. Without them it only prints the
// prompt sizes. Never run it against production data: it uses the local demo
// seed and its own throwaway database.
//
// Cap-aware: a turn is one allowance unit and a repair a second, about
// US$0.001 each on Claude Haiku. The default sample is 30 messages (well under
// US$0.10); the whole bank needs --all and --yes. The local allowance counter
// is reset between messages, so the deployed allowance and the gateway's
// monthly spend limit are what bound a run; it stops at --max-turns (default
// 140 units) and prints the units it spent.
import process from "node:process";

import worker from "../src/index.ts";
import { buildAskTurnPrompt } from "../src/domain/ask-turn.ts";
import { loadAskTurnContext } from "../src/domain/ask-turn-context.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { bankDates, checkExpectation, loadBank, seedBankHousehold } from "../tests/support/ask-eval-bank.mjs";
import { createSeededTemplate, openSeededDatabase } from "../tests/support/d1-workspace.mjs";

const TODAY = todayInAppTimeZone();
const DEFAULT_SAMPLE = 30;
const DEFAULT_MAX_TURNS = 140;

function readArgs(argv) {
  const args = { all: false, yes: false, dry: false, limit: null, ids: null, group: null, maxTurns: DEFAULT_MAX_TURNS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") args.all = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--dry") args.dry = true;
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--ids") args.ids = String(argv[++index] ?? "").split(",").filter(Boolean);
    else if (arg === "--group") args.group = String(argv[++index] ?? "");
    else if (arg === "--max-turns") args.maxTurns = Number(argv[++index]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

// An even spread across the bank's groups, so a small run still touches every action.
function spread(entries, count) {
  if (count >= entries.length) return entries;
  const picked = [];
  const byGroup = new Map();
  for (const entry of entries) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
  const queues = [...byGroup.values()];
  for (let round = 0; picked.length < count && queues.some((queue) => queue.length > round); round += 1) {
    for (const queue of queues) {
      if (queue[round] && picked.length < count) picked.push(queue[round]);
    }
  }
  return picked;
}

function providerEnv() {
  const keys = ["AI_GATEWAY_URL", "AI_GATEWAY_ACCOUNT_ID", "AI_GATEWAY_ID", "AI_GATEWAY_TOKEN", "AI_GATEWAY_BYOK_ALIAS", "ANTHROPIC_API_KEY", "AI_CLAUDE_MODEL"];
  return Object.fromEntries(keys.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}

const args = readArgs(process.argv.slice(2));
const bank = loadBank();
let chosen = bank;
if (args.ids) chosen = bank.filter((entry) => args.ids.includes(entry.id));
else if (args.group) chosen = bank.filter((entry) => entry.group === args.group);
else if (!args.all) chosen = spread(bank, args.limit ?? DEFAULT_SAMPLE);
if (args.limit && (args.ids || args.group || args.all)) chosen = chosen.slice(0, args.limit);
if (!chosen.length) {
  console.log("No message matches.");
  process.exit(1);
}
if (chosen.length > DEFAULT_SAMPLE && !args.yes && !args.dry) {
  console.log(`That is ${chosen.length} messages (up to ${chosen.length * 2} model turns, about US$${(chosen.length * 0.002).toFixed(2)}). Add --yes to run it, or --limit ${DEFAULT_SAMPLE} for a smaller spread.`);
  process.exit(1);
}

const cleanups = [];
const template = await createSeededTemplate();
try {
  const { db, api } = await openSeededDatabase({ after: (fn) => cleanups.push(fn) }, template);
  const seed = await seedBankHousehold({ db, api, today: TODAY });
  const dates = bankDates(TODAY);

  // Prompt size: about 4 characters a token.
  const sizes = [];
  for (const entry of chosen) {
    const month = entry.setup?.month ?? dates.month;
    const context = await loadAskTurnContext(db, { text: entry.text, history: entry.setup?.history ?? [], viewId: "person-tim", scope: "direct_plus_shared", month, page: "ask", focus: seed.focus(entry.setup?.focus ?? "none", month) }, TODAY);
    sizes.push(buildAskTurnPrompt(context).length);
  }
  const average = Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length);
  console.log(`Bank: ${bank.length} messages; running ${chosen.length}. Prompt: ${average} characters on average (about ${Math.round(average / 4)} tokens), largest ${Math.max(...sizes)}.`);

  const env = providerEnv();
  if (args.dry) {
    for (const entry of chosen) console.log(`  ${entry.id}  "${entry.text}"`);
  } else if (!env.AI_GATEWAY_TOKEN && !env.ANTHROPIC_API_KEY) {
    console.log("Skipped the model run: no AI_GATEWAY_TOKEN or ANTHROPIC_API_KEY in the environment.");
  } else {
    let passed = 0;
    let repairs = 0;
    let repairsFixed = 0;
    let units = 0;
    const failed = [];
    for (const entry of chosen) {
      if (units >= args.maxTurns) {
        console.log(`Stopped at --max-turns ${args.maxTurns} (${units} units spent).`);
        break;
      }
      const month = entry.setup?.month ?? dates.month;
      await db.prepare("DELETE FROM ai_assist_daily_usage").run();
      const started = Date.now();
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
      }), { DB: db, ...template.config.vars, APP_ENVIRONMENT: "local", AI_ASSIST_ENABLED: "true", AI_ASSIST_DAILY_LIMIT: "100", ...env });
      const payload = await response.json();
      const used = Number((await db.prepare("SELECT SUM(used_units) AS used FROM ai_assist_daily_usage").first())?.used ?? 0);
      units += used;
      const problems = checkExpectation(entry, payload, dates, { entryId: seed.entryId });
      if (payload.repaired !== undefined) {
        repairs += 1;
        repairsFixed += payload.repaired ? 1 : 0;
      }
      const ok = problems.length === 0;
      passed += ok ? 1 : 0;
      if (!ok) failed.push(entry.id);
      const seen = `${payload.mode} ${payload.action ?? payload.reason ?? ""} ${payload.reply?.kind ?? ""}${payload.repaired === undefined ? "" : payload.repaired ? " (repaired)" : " (repair failed)"}`;
      console.log(`${ok ? "PASS" : "FAIL"}  ${entry.id}  "${entry.text}"  ->  ${seen}  ${Date.now() - started} ms`);
      for (const problem of problems) console.log(`        ${problem}`);
    }
    const ran = passed + failed.length;
    console.log(`${passed}/${ran} as expected (${ran ? Math.round((passed / ran) * 100) : 0}%). Repairs: ${repairs} of ${ran} turns (${repairsFixed} fixed). Allowance spent: ${units} units.`);
    if (failed.length) console.log(`Failed: ${failed.join(", ")}`);
  }
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await template.dispose();
}
