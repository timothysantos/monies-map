#!/usr/bin/env node
// Trip ledger import (docs/audits/trip-ledger-import.md): a one-off, owner-run
// tool that reads a trip ledger export (receipts photographed on a trip) and
// proposes, then applies, the matching changes through the app's existing
// commands. Holds no household data; every path comes from the command line.
//
//   node --import tsx scripts/trip-ledger-import.mjs preview \
//     --export <export.json> --out <dir> --trip-name "Hokkaido trip" \
//     [--answers <answers.json>] [--household household-1] [--trip-currency JPY]
//     [--d1 remote|local] [--persist-to <dir>] [--wrangler-config <file>]
//   node --import tsx scripts/trip-ledger-import.mjs apply \
//     --plan <dir>/preview.json --hash <sha256> [--apply] [--d1 remote|local] [--persist-to <dir>]
//   node --import tsx scripts/trip-ledger-import.mjs undo \
//     --import-key <key> [--apply] [--d1 remote|local] [--persist-to <dir>]
//
// preview only reads (SELECTs through `wrangler d1 execute`). apply and undo
// are dry runs unless --apply is given; apply also needs the hash preview
// printed, so only the reviewed preview.json can run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addDays, inferTripDayZero, readTripLedgerExport } from "../src/domain/trip-ledger-match.ts";
import { DEFAULT_TRIP_LEDGER_CONFIG, buildTripLedgerPlan, hashTripLedgerPlan, money } from "../src/domain/trip-ledger-plan.ts";
import { loadTripLedgerSnapshot } from "../src/domain/trip-ledger-snapshot.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function readArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      index += 1;
    }
  }
  return args;
}

async function readWranglerD1(configFile) {
  const { experimental_readRawConfig } = await import("wrangler");
  const configPath = path.resolve(root, configFile ?? "wrangler.jsonc");
  const { rawConfig } = experimental_readRawConfig({ config: configPath });
  const binding = rawConfig.d1_databases?.find((item) => item.binding === "DB");
  if (!binding) throw new Error("wrangler.jsonc has no DB binding.");
  return { configPath, databaseName: binding.database_name, databaseId: binding.database_id, compatibilityDate: rawConfig.compatibility_date };
}

// One SELECT per call: `wrangler d1 execute --command` returns rows only for
// a single statement.
function wranglerQuery({ configPath, databaseName, target, persistTo }) {
  return async (sql) => {
    const trimmed = sql.trim();
    if (!/^select\b/i.test(trimmed) || trimmed.replace(/;\s*$/, "").includes(";")) throw new Error("Preview reads with single SELECT statements only.");
    const output = execFileSync(process.execPath, [
      wranglerBin, "d1", "execute", databaseName, "--config", configPath, target === "local" ? "--local" : "--remote",
      ...(persistTo ? ["--persist-to", persistTo] : []), "--json", "--command", trimmed.replace(/\s+/g, " ")
    ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(output.slice(output.indexOf("[")));
    return parsed[0]?.results ?? [];
  };
}

// The D1 binding for apply and undo: the owner's own wrangler login reaches
// the remote database (a remote binding), or a local copy to rehearse on.
async function openDatabase({ target, persistTo, configFile }) {
  const { getPlatformProxy } = await import("wrangler");
  const d1 = await readWranglerD1(configFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "trip-ledger-import-"));
  const configPath = path.join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "trip-ledger-import",
    compatibility_date: d1.compatibilityDate,
    d1_databases: [{ binding: "DB", database_name: d1.databaseName, database_id: d1.databaseId, ...(target === "remote" ? { remote: true } : {}) }]
  }));
  const proxy = await getPlatformProxy({ configPath, persist: target === "local" && persistTo ? { path: path.join(persistTo, "v3") } : false, envFiles: [] });
  return {
    db: proxy.env.DB,
    close: async () => {
      await proxy.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function preview(args) {
  for (const required of ["export", "out", "trip-name"]) if (!args[required]) throw new Error(`--${required} is needed.`);
  const exportText = await readFile(args.export, "utf8");
  const raw = JSON.parse(exportText);
  const dayReading = inferTripDayZero(raw);
  if (!dayReading.dayZero) throw new Error("Could not place the trip's days on calendar dates: no purchase names its own date.");
  const lines = readTripLedgerExport(raw, dayReading.dayZero);
  const answers = args.answers ? JSON.parse(await readFile(args.answers, "utf8")) : {};
  const dates = lines.map((line) => line.date).filter(Boolean).sort();
  const d1 = await readWranglerD1(args["wrangler-config"]);
  const query = wranglerQuery({ configPath: d1.configPath, databaseName: d1.databaseName, target: args.d1 === "local" ? "local" : "remote", persistTo: args["persist-to"] });
  // The trip's days, a margin for posting, and 60 days before for bookings.
  const snapshot = await loadTripLedgerSnapshot(query, {
    householdId: args.household ?? "household-1",
    from: addDays(dates[0], -60),
    to: addDays(dates[dates.length - 1], 7)
  });
  const plan = buildTripLedgerPlan({
    lines,
    snapshot,
    config: { ...DEFAULT_TRIP_LEDGER_CONFIG, tripName: args["trip-name"], ...(args["trip-currency"] ? { tripCurrency: args["trip-currency"] } : {}) },
    answers,
    dayZero: dayReading.dayZero,
    exportSha256: createHash("sha256").update(exportText).digest("hex")
  });
  const hash = await hashTripLedgerPlan(plan);
  await mkdir(args.out, { recursive: true });
  await writeFile(path.join(args.out, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  await writeFile(path.join(args.out, "preview.json"), JSON.stringify(plan, null, 2));
  await writeFile(path.join(args.out, "preview.md"), renderPreviewMarkdown(plan, hash, dayReading, snapshot));
  console.log(JSON.stringify({ preview: path.join(args.out, "preview.json"), hash, importKey: plan.importKey, steps: plan.steps.length, questions: plan.questions.length }, null, 2));
}

async function apply(args) {
  if (!args.plan) throw new Error("--plan is needed.");
  if (!args.hash || args.hash === true) throw new Error("--hash is needed: the hash preview printed for this preview.json.");
  const plan = JSON.parse(await readFile(args.plan, "utf8"));
  const { applyTripLedgerPlan } = await import("../src/domain/trip-ledger-apply.ts");
  const { db, close } = await openDatabase({ target: args.d1 === "local" ? "local" : "remote", persistTo: args["persist-to"], configFile: args["wrangler-config"] });
  try {
    const result = await applyTripLedgerPlan(db, plan, { expectedHash: args.hash, apply: args.apply === true });
    console.log(JSON.stringify(result, null, 2));
    if (!result.applied) console.log("Dry run: nothing was written. Add --apply to write.");
  } finally {
    await close();
  }
}

async function undo(args) {
  if (!args["import-key"]) throw new Error("--import-key is needed.");
  const { undoTripLedgerImport } = await import("../src/domain/trip-ledger-apply.ts");
  const { db, close } = await openDatabase({ target: args.d1 === "local" ? "local" : "remote", persistTo: args["persist-to"], configFile: args["wrangler-config"] });
  try {
    const result = await undoTripLedgerImport(db, args["import-key"], { apply: args.apply === true });
    console.log(JSON.stringify(result, null, 2));
    if (args.apply !== true) console.log("Dry run: nothing was written. Add --apply to write.");
  } finally {
    await close();
  }
}

const OUTCOME_WORDS = { matched: "matched", new: "new", "splits-only": "Splits only", nothing: "nothing to record", held: "held", skipped: "left out" };
const STEP_WORDS = {
  create_split_group: "Splits group made",
  create_trip: "trip made",
  create_entry: "entries made",
  set_category: "categories set",
  set_note: "notes set",
  add_entry_to_splits: "entries added to Splits",
  create_split_expense: "Splits expenses made",
  put_on_trip: "trip changes"
};

export function renderPreviewMarkdown(plan, hash, dayReading, snapshot) {
  const out = [];
  const entryName = (id) => {
    const entry = snapshot.entries.find((item) => item.id === id);
    return entry ? `${entry.description} ${money(entry.amountMinor)}${entry.statementCertified ? " (statement certified)" : ""}` : id;
  };
  out.push(`# ${plan.trip.name}: trip ledger import preview`, "");
  out.push(`Preview only: nothing has been written. Import key \`${plan.importKey}\`, plan hash \`${hash}\`.`, "");
  out.push(`Day 0 is ${plan.dayZero}: ${dayReading.agreeing} purchases name a date that agrees${dayReading.anchors.length ? `, and a note says "${dayReading.anchors.join(", ")} = Day 0"` : ""}${dayReading.conflicting.length ? `; ${dayReading.conflicting.length} disagree: ${dayReading.conflicting.map((item) => item.id).join(", ")}` : ", none disagree"}.`, "");
  const counts = {};
  for (const line of plan.lines) counts[line.confidence] = (counts[line.confidence] ?? 0) + 1;
  const outcomes = {};
  for (const line of plan.lines) outcomes[line.outcome] = (outcomes[line.outcome] ?? 0) + 1;
  out.push(`${plan.lines.length} purchases. Match: ${["certain", "likely", "ambiguous", "none"].map((key) => `${counts[key] ?? 0} ${key}`).join(", ")}. Outcome: ${Object.entries(outcomes).map(([key, value]) => `${value} ${OUTCOME_WORDS[key]}`).join(", ")}.`, "");

  if (plan.questions.length) {
    out.push("## Questions", "");
    for (const question of plan.questions) {
      out.push(`- ${question.blocking ? "**Waiting on you.** " : ""}${question.text}${question.options.length ? ` Options: ${question.options.join("; ")}.` : ""}${question.chosen ? ` Until you say otherwise: ${question.chosen}.` : ""}`);
    }
    out.push("");
  }

  const days = [...new Set(plan.lines.map((line) => line.date ?? "no date"))].sort();
  for (const day of days) {
    const dayLines = plan.lines.filter((line) => (line.date ?? "no date") === day);
    out.push(`## ${day}${dayLines[0].day !== null ? ` (day ${dayLines[0].day})` : ""}`, "");
    out.push("| Ledger purchase | Paid by | Amount | In Monies Map | Confidence | What would change |", "| --- | --- | --- | --- | --- | --- |");
    for (const line of dayLines) {
      const amount = [line.homeMinor !== null ? money(line.homeMinor) : "no amount", line.foreignMinor !== null ? `${plan.foreignCurrency ?? ""} ${(line.foreignMinor / 100).toLocaleString("en-SG")}`.trim() : ""].filter(Boolean).join(" / ");
      const target = line.entryId ? entryName(line.entryId) : OUTCOME_WORDS[line.outcome];
      const changes = [...line.changes, ...line.holdReasons.map((reason) => `Held: ${reason}`)].join(" ");
      out.push(`| ${cell(`${line.time ? `${line.time} ` : ""}${line.merchant}`)} | ${cell(line.payerName)} | ${amount} | ${cell(target)} | ${line.confidence} | ${cell(changes)} |`);
    }
    out.push("");
  }

  const { totals } = plan;
  out.push("## Totals (SGD)", "");
  const owedWords = (value) => (value >= 0 ? `${totals.firstPersonName} owes ${totals.secondPersonName} ${money(value)}` : `${totals.secondPersonName} owes ${totals.firstPersonName} ${money(-value)}`);
  out.push(`- The ledger's own figure: ${owedWords(totals.owed.ledger)}.`);
  out.push(`- What Splits would add after the import: ${owedWords(totals.owed.afterImport)}.`);
  if (totals.owed.differences.length) {
    out.push("", "Why they differ:", "");
    for (const item of totals.owed.differences) out.push(`- ${item.merchant}: ledger ${owedWords(item.ledger)}, import ${owedWords(item.afterImport)}. ${item.why}`);
  }
  out.push("", "| Person | Ledger: paid | Ledger: their share | Import: paid, in Entries | Import: paid, Splits only | Import: their share |", "| --- | --- | --- | --- | --- | --- |");
  for (const row of totals.spending) {
    out.push(`| ${row.personName} | ${money(row.ledgerPaid)} | ${money(row.ledgerShare)} | ${money(row.importPaidInEntries)} | ${money(row.importPaidSplitsOnly)} | ${money(row.importShare)} |`);
  }
  if (totals.spendingDifferences.length) {
    out.push("", "Why spending differs, line by line:", "");
    for (const item of totals.spendingDifferences) out.push(`- ${item.merchant} (${item.payerName}): ledger ${money(item.ledgerPaid)}, import ${money(item.importPaid)}. ${item.why}`);
  }
  out.push("");
  if (plan.entriesWithoutLine.length) {
    out.push("## Entries in the trip's days with no ledger line", "");
    for (const entry of plan.entriesWithoutLine) out.push(`- ${entry.date} ${entry.description} ${money(entry.amountMinor)}`);
    out.push("");
  }
  if (plan.possibleBookings.length) {
    out.push("## Booked before you went?", "", "Not changed by this import; put them on the trip by hand if they belong:", "");
    for (const entry of plan.possibleBookings) out.push(`- ${entry.date} ${entry.description} ${money(entry.amountMinor)}`);
    out.push("");
  }
  const stepCounts = {};
  for (const step of plan.steps) stepCounts[step.kind] = (stepCounts[step.kind] ?? 0) + (step.kind === "put_on_trip" ? step.entries.length : 1);
  out.push("## What apply would run", "");
  for (const [kind, count] of Object.entries(stepCounts)) out.push(`- ${count} ${STEP_WORDS[kind]}${kind === "put_on_trip" ? " (entries put on the trip in one change)" : ""}`);
  out.push("", `Run: \`node --import tsx scripts/trip-ledger-import.mjs apply --plan <this folder>/preview.json --hash ${hash}\` (a dry run; add \`--apply\` to write).`, "");
  return out.join("\n");
}

const cell = (value) => String(value ?? "").replace(/\|/g, "/").replace(/\n/g, " ");

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = readArgs(process.argv.slice(2));
  const run = { preview, apply, undo }[args.command];
  if (!run) {
    console.error("Usage: trip-ledger-import.mjs preview|apply|undo [options] (see the header of this file)");
    process.exit(2);
  }
  run(args).catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
