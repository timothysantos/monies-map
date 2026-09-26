// Persisted-state snapshot for behaviour-preserving persistence refactors
// (H15). Starts an isolated test Worker on a fresh local D1, runs a fixed
// scenario of real API writes (entries, transfers, month plans, month notes,
// imports with rollback, splits, categories), stops the Worker and dumps every
// table, plus the main page API responses. Random ids and wall-clock
// timestamps are normalized, so two runs of
// the same code produce identical output and any persisted-state difference
// between two revisions shows up as a diff.
//
//   node --experimental-sqlite --no-warnings scripts/persisted-state-snapshot.mjs <out.json> [port]
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const [outFile, portArg] = process.argv.slice(2);
if (!outFile) {
  throw new Error("Usage: node --experimental-sqlite scripts/persisted-state-snapshot.mjs <out.json> [port]");
}
const port = Number(portArg ?? 8941);
const root = process.cwd();
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const configPath = path.join(root, "wrangler.test.jsonc");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "monies-map-state-"));
const persist = path.join(tempRoot, "state");
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(tempRoot, "wrangler.log") };

function d1(file) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "monies-map-test", "--config", configPath, "--local", "--persist-to", persist, "--file", file], { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`D1 setup failed: ${result.stderr}`);
}

async function call(pathname, body, { method = "POST" } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok || payload?.ok === false) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return payload;
}

async function entriesFor(month, view = "household") {
  return (await call(`/api/entries-page?view=${view}&month=${month}`, undefined, { method: "GET" })).monthPage.entries;
}

// The fixed write scenario. Every step checks its response; descriptions are
// constant so the dump is deterministic.
async function runScenario() {
  await call("/api/demo/reseed");

  // Entries: create, edit every way, delete.
  const direct = await call("/api/entries/create", { date: "2026-05-10", description: "State groceries", accountName: "UOB One", categoryName: "Groceries", amountMinor: 4_210, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  const shared = await call("/api/entries/create", { date: "2026-05-11", description: "State shared dinner", accountName: "Household Float", categoryName: "Food & Drinks", amountMinor: 9_001, entryType: "expense", ownershipType: "shared", ownerName: "Tim", splitBasisPoints: 5_000 });
  const doomed = await call("/api/entries/create", { date: "2026-05-12", description: "State doomed", accountName: "UOB One", categoryName: "Shopping", amountMinor: 1_500, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  await call("/api/entries/update", { entryId: direct.entryId, date: "2026-05-10", description: "State groceries edited", accountName: "UOB One", categoryName: "Groceries", amountMinor: 4_321, entryType: "expense", ownershipType: "direct", ownerName: "Tim", offsetsCategory: false, note: "edited" });
  await call("/api/entries/update-note", { entryId: shared.entryId, note: "shared note" });
  await call("/api/entries/update-category", { entryId: direct.entryId, categoryName: "Food & Drinks" });
  await call("/api/entries/update-post-date", { entryId: direct.entryId, postDate: "2026-05-13" });
  await call("/api/entries/update-classification", { entryId: doomed.entryId, entryType: "expense", categoryName: "Home" });
  await call("/api/entries/delete", { entryId: doomed.entryId });
  // A split-linked entry's amount edit, saved the way the Entries editor
  // sends it (every loaded entry is direct).
  await call("/api/entries/update", { entryId: shared.entryId, date: "2026-05-11", description: "State shared dinner", accountName: "Household Float", categoryName: "Food & Drinks", amountMinor: 8_051, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "shared note" });

  // Transfers: two halves, linked.
  const out = await call("/api/entries/create", { date: "2026-05-14", description: "State transfer out", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim" });
  const into = await call("/api/entries/create", { date: "2026-05-14", description: "State transfer in", accountName: "UOB One", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "in", ownershipType: "direct", ownerName: "Tim" });
  await call("/api/transfers/link", { fromEntryId: out.entryId, toEntryId: into.entryId });

  // Month plan: add a row, link an entry, delete a row, note, duplicate/reset/delete a month.
  const monthPage = await call("/api/month-page?view=household&month=2026-05&scope=direct_plus_shared", undefined, { method: "GET" });
  const existingRow = monthPage.monthPage.planSections.flatMap((section) => section.rows)[0];
  await call("/api/month-plan/save", { rowId: "state-row-1", month: "2026-05", sectionKey: "planned_items", categoryName: "Groceries", label: "State groceries item", planDate: "2026-05-10", accountName: "UOB One", plannedMinor: 50_000, ownershipType: "direct", ownerName: "Tim" });
  await call("/api/month-plan/links", { rowId: "state-row-1", month: "2026-05", transactionIds: [direct.entryId] });
  if (existingRow) {
    await call("/api/month-plan/delete", { rowId: existingRow.id, month: "2026-05" });
  }
  await call("/api/month-note/update", { month: "2026-05", personScope: "household", note: "State month note" });
  await call("/api/months/duplicate?source=2026-05");
  await call("/api/months/reset?month=2026-06");
  await call("/api/months/duplicate?source=2025-10");
  await call("/api/months/delete?month=2025-11");

  // Imports: commit two, roll one back.
  const csv = (description, amount) => ["date,description,amount,account,category,note", `2026-05-18,${description},${amount},UOB One,Groceries,state import`].join("\n");
  for (const [label, description, amount, rollback] of [["State import kept", "STATE IMPORT KEPT", "-12.34", false], ["State import rolled back", "STATE IMPORT ROLLED BACK", "-56.78", true]]) {
    const preview = await call("/api/imports/preview", { sourceLabel: label, sourceType: "csv", csv: csv(description, amount), ownershipType: "direct", ownerName: "Tim" });
    const commit = await call("/api/imports/commit", { sourceLabel: label, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
    if (rollback) {
      await call("/api/imports/rollback", { importId: commit.importId });
    }
  }

  // Import promotion: a CSV row promotes a manual entry, the entry is
  // annotated, then the import is rolled back.
  const promoted = await call("/api/entries/create", { date: "2026-05-21", description: "FAIRPRICE FINEST", accountName: "UOB One", categoryName: "Groceries", amountMinor: 4_329, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  const promotionCsv = ["date,description,amount,account,category,note", "2026-05-22,FAIRPRICE FINEST SINGAPORE,-43.29,UOB One,Groceries,"].join("\n");
  const promotionPreview = await call("/api/imports/preview", { sourceLabel: "State import promotion", sourceType: "csv", csv: promotionCsv, ownershipType: "direct", ownerName: "Tim" });
  if (promotionPreview.preview.previewRows[0].reconciliationTargetTransactionId !== promoted.entryId) {
    throw new Error("The promotion CSV row did not target the manual entry.");
  }
  const promotionCommit = await call("/api/imports/commit", { sourceLabel: "State import promotion", sourceType: "csv", parserKey: "generic_csv", rows: promotionPreview.preview.previewRows });
  await call("/api/entries/update-note", { entryId: promoted.entryId, note: "promoted note" });
  await call("/api/imports/rollback", { importId: promotionCommit.importId });

  // Splits: an expense and a settlement.
  await call("/api/splits/expenses/create", { date: "2026-05-19", description: "State split taxi", categoryName: "Taxi", payerPersonName: "Tim", amountMinor: 3_000, groupId: null, note: "state split" });
  await call("/api/splits/settlements/create", { groupId: null, date: "2026-05-20", fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 1_000, paymentMethod: "bank", paymentStatus: "recorded", note: "state settle" });

  // Linked splits: an entry added to splits, then renamed, redated and given
  // to the other payer in Entries; a second one added to splits and its split
  // deleted; a third added to splits as the last write to its month.
  const linkedEntry = (description, date, amountMinor) => call("/api/entries/create", { date, description, accountName: "UOB One", categoryName: "Food & Drinks", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  const lunch = await linkedEntry("State linked lunch", "2026-05-23", 6_400);
  await call("/api/splits/expenses/from-entry", { entryId: lunch.entryId, splitGroupId: null });
  await call("/api/entries/update", { entryId: lunch.entryId, date: "2026-05-24", description: "State linked lunch renamed", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 6_400, entryType: "expense", ownershipType: "direct", ownerName: "Joyce", note: "" });
  const snack = await linkedEntry("State unlinked snack", "2026-05-25", 2_000);
  const snackSplit = await call("/api/splits/expenses/from-entry", { entryId: snack.entryId, splitGroupId: null });
  await call("/api/splits/expenses/delete", { splitExpenseId: snackSplit.splitExpenseId });
  const coffee = await linkedEntry("State linked coffee", "2026-05-26", 1_202);
  await call("/api/splits/expenses/from-entry", { entryId: coffee.entryId, splitGroupId: null });

  // June: a manual entry added to splits, promoted by a CSV row, corrected
  // to 35.00 in Entries and then rolled back (the entry and its split go
  // back to 32.10); then a Splits share edit of another linked entry, the
  // last write to June, so its stored month totals show whether the edit
  // refreshed them.
  const cold = await linkedEntry("COLD STORAGE", "2026-06-03", 3_210);
  await call("/api/splits/expenses/from-entry", { entryId: cold.entryId, splitGroupId: null });
  const coldCsv = ["date,description,amount,account,category,note", "2026-06-04,COLD STORAGE SINGAPORE,-32.10,UOB One,Food & Drinks,"].join("\n");
  const coldPreview = await call("/api/imports/preview", { sourceLabel: "State linked promotion", sourceType: "csv", csv: coldCsv, ownershipType: "direct", ownerName: "Tim" });
  if (coldPreview.preview.previewRows[0].reconciliationTargetTransactionId !== cold.entryId) {
    throw new Error("The linked promotion CSV row did not target the manual entry.");
  }
  const coldCommit = await call("/api/imports/commit", { sourceLabel: "State linked promotion", sourceType: "csv", parserKey: "generic_csv", rows: coldPreview.preview.previewRows });
  await call("/api/entries/update", { entryId: cold.entryId, date: "2026-06-03", description: "COLD STORAGE SINGAPORE", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 3_500, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "" });
  await call("/api/imports/rollback", { importId: coldCommit.importId });
  const share = await linkedEntry("State linked share", "2026-06-05", 5_000);
  const shareSplit = await call("/api/splits/expenses/from-entry", { entryId: share.entryId, splitGroupId: null });
  await call("/api/splits/expenses/update", { splitExpenseId: shareSplit.splitExpenseId, groupId: null, date: "2026-06-05", description: "State linked share", categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 5_000, splitBasisPoints: 7_000, homeAmountMinor: 5_000, paymentMethod: "bank", paymentStatus: "certified" });

  // July: a JPY 10,000 travel split matched to its SGD 90.00 card row, then
  // a Shared owner save of that entry at 93.00 (the split keeps its JPY
  // total; only its home amount and FX rate follow). Then a card row added
  // to splits, superseded by a PDF statement (which unlinks the split), the
  // split corrected to 50.00 while unlinked, and the statement rolled back:
  // the split goes back on the re-created 43.21 entry, at 43.21.
  const importRows = async (label, lines) => {
    const preview = await call("/api/imports/preview", { sourceLabel: label, sourceType: "csv", csv: ["date,description,amount,account,category,note", ...lines].join("\n"), ownershipType: "direct", ownerName: "Tim" });
    return call("/api/imports/commit", { sourceLabel: label, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
  };
  const julyEntry = async (description) => (await entriesFor("2026-07")).find((entry) => entry.description === description);
  await importRows("State travel card", ["2026-07-02,STATE TOKYO DINNER CARD,-90.00,UOB One,Food & Drinks,"]);
  const tokyoEntry = await julyEntry("STATE TOKYO DINNER CARD");
  const tokyoSplit = await call("/api/splits/expenses/create", { groupId: null, date: "2026-07-02", description: "State Tokyo dinner", categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 10_000, currency: "JPY", splitBasisPoints: 5_000, paymentMethod: "card", paymentStatus: "awaiting_statement" });
  await call("/api/splits/matches/link-expense", { splitExpenseId: tokyoSplit.splitExpenseId, transactionId: tokyoEntry.id });
  await call("/api/entries/update", { entryId: tokyoEntry.id, date: "2026-07-02", description: "STATE TOKYO DINNER CARD", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 9_300, entryType: "expense", ownershipType: "shared", splitBasisPoints: 5_000, note: "" });
  const stateCard = await call("/api/accounts/create", { name: "State Card", institution: "Synthetic Test Bank", kind: "credit_card", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false });
  await importRows("State card activity", ["2026-07-08,STATE CARD GROCER,-43.21,State Card,Groceries,", "2026-07-09,STATE CARD SECOND,-9.99,State Card,Groceries,"]);
  const grocer = await julyEntry("STATE CARD GROCER");
  const grocerSplit = await call("/api/splits/expenses/from-entry", { entryId: grocer.id, splitGroupId: null });
  const statementCheckpoints = [{ accountId: stateCard.accountId, accountName: "State Card", detectedAccountName: "State Card", checkpointMonth: "2026-08", statementStartDate: "2026-07-02", statementEndDate: "2026-08-01", statementBalanceMinor: 500, note: "State statement" }];
  const statementPreview = await call("/api/imports/preview", { sourceLabel: "State card statement", sourceType: "pdf", rows: [{ date: "2026-07-15", description: "STATE STATEMENT ONLY ROW", expense: "5.00", accountId: stateCard.accountId, account: "State Card", category: "Groceries" }], defaultAccountName: "State Card", ownershipType: "direct", ownerName: "Tim", statementCheckpoints });
  const statementCommit = await call("/api/imports/commit", { sourceLabel: "State card statement", sourceType: "pdf", parserKey: "uob_credit_card_pdf", rows: statementPreview.preview.previewRows.filter((row) => row.commitStatus === "included"), statementCheckpoints, statementControlRows: statementPreview.preview.previewRows, statementReconciliations: statementPreview.preview.statementReconciliations });
  if (await julyEntry("STATE CARD GROCER")) {
    throw new Error("The state statement did not supersede the card row.");
  }
  await call("/api/splits/expenses/update", { splitExpenseId: grocerSplit.splitExpenseId, groupId: null, date: "2026-07-08", description: "STATE CARD GROCER", categoryName: "Groceries", payerPersonName: "Tim", amountMinor: 5_000, splitBasisPoints: 5_000, paymentMethod: "card", paymentStatus: "certified" });
  await call("/api/imports/rollback", { importId: statementCommit.importId });

  // Categories and rules.
  await call("/api/categories/create", { name: "State category", slug: "state-category", iconKey: "tag", colorHex: "#445566" });
  await call("/api/category-match-rules/save", { pattern: "STATE IMPORT", categoryId: "cat-groceries", priority: 50, isActive: true });

  // Read-backs so read paths that repair state also run.
  await entriesFor("2026-05");
  await entriesFor("2026-05", "person-tim");
  await call("/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared", undefined, { method: "GET" });
}

// Page DTOs after the scenario, so projection refactors are checked too.
const PAGE_DTOS = [
  "/api/app-shell?view=household&month=2026-05&scope=direct_plus_shared",
  "/api/reference-data",
  "/api/entries-page?view=household&month=2026-05",
  "/api/entries-page?view=person-tim&month=2026-05",
  "/api/month-page?view=household&month=2026-05&scope=direct_plus_shared",
  "/api/month-page?view=person-tim&month=2026-05&scope=direct",
  "/api/month-page?view=person-joyce&month=2025-10&scope=shared",
  "/api/summary-page?view=household&month=2026-05&scope=direct_plus_shared",
  "/api/summary-page?view=person-tim&month=2026-05&scope=direct_plus_shared&summary_start=2025-08&summary_end=2026-05",
  "/api/summary-account-pills?view=household",
  "/api/splits-page?view=person-tim&month=2026-05",
  "/api/splits-page?view=household&month=2025-10",
  "/api/entries-page?view=person-tim&month=2026-07",
  "/api/splits-page?view=person-tim&month=2026-07",
  "/api/imports-page",
  "/api/settings-page?view=household"
];
async function readPageDtos() {
  const dtos = {};
  for (const pathname of PAGE_DTOS) {
    dtos[pathname] = await call(pathname, undefined, { method: "GET" });
  }
  return dtos;
}

async function findSqlite(dir) {
  const found = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) found.push(...await findSqlite(full));
    else if (name.endsWith(".sqlite") && !name.includes("metadata")) found.push(full);
  }
  return found;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Split workspace ids are "<prefix>-<epoch>-<uuid>" (newSplitRecordId); the
// random UUID tail is dropped before any other rule, so they normalize like
// the older "<prefix>-<epoch>" ids and runs stay comparable with them.
const SPLIT_RECORD_UUID_TAIL = /(split-[a-z0-9-]*?-1[6-9]\d{11})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Short random suffixes such as "cat-name-3ea6fa27" (at least one letter,
// so plain numbers and dates are untouched).
const SHORT_ID_SUFFIX = /-(?=[0-9a-f]{0,7}[a-f])([0-9a-f]{8})\b/g;
// Millisecond epoch values embedded in ids ("split-expense-1790296211654"),
// keyed with their id prefix, so two kinds of id made in the same
// millisecond stay distinct however fast a run is.
const EPOCH_MS = /\b([a-z][a-z-]*-)?(1[6-9]\d{11})\b/g;
// Random tails after an id's epoch in ids made before newSplitRecordId:
// split batches ("-629") and split activity history ("-khfze6").
const SPLIT_BATCH_TAIL = /(split-batch-[a-z0-9-]*<epoch-\d+>)-\d{1,3}\b/g;
const SPLIT_HISTORY_TAIL = /(split-history-<epoch-\d+>)-[0-9a-z]{6}\b/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/;

function dump(file, dtos) {
  const db = new DatabaseSync(file, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name").all().map((row) => row.name);
  const ids = new Map();
  const normalize = (value) => {
    if (typeof value !== "string") return value;
    if (TIMESTAMP.test(value)) return "<timestamp>";
    // Import ids can embed a commit time; keep the shape, drop the digits.
    return value
      .replace(SPLIT_RECORD_UUID_TAIL, "$1")
      .replace(UUID, (match) => {
        if (!ids.has(match)) ids.set(match, `<uuid-${ids.size + 1}>`);
        return ids.get(match);
      })
      .replace(SHORT_ID_SUFFIX, (match, suffix) => {
        if (!ids.has(suffix)) ids.set(suffix, `<id-${ids.size + 1}>`);
        return `-${ids.get(suffix)}`;
      })
      .replace(EPOCH_MS, (match, prefix = "") => {
        if (!ids.has(match)) ids.set(match, `<epoch-${ids.size + 1}>`);
        return `${prefix}${ids.get(match)}`;
      })
      .replace(SPLIT_BATCH_TAIL, "$1")
      .replace(SPLIT_HISTORY_TAIL, "$1")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<timestamp>");
  };
  const out = {};
  for (const table of tables) {
    const hasRowid = !db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table).sql.includes("WITHOUT ROWID");
    const rows = db.prepare(`SELECT * FROM "${table}"${hasRowid ? " ORDER BY rowid" : ""}`).all();
    out[table] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalize(value)])));
  }
  db.close();
  // Normalize DTOs with the same id map, so ids line up with the tables.
  // Lists ordered by a second-resolution createdAt or importedAt can tie;
  // the app's own order is not deterministic there, so compare them sorted.
  const normalizeDeep = (value) => Array.isArray(value)
    ? (value.length && value.every((item) => item && typeof item === "object" && ("createdAt" in item || "importedAt" in item))
      ? value.map(normalizeDeep).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : value.map(normalizeDeep))
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDeep(item)]))
      : normalize(value);
  const pages = normalizeDeep(dtos);
  // The latest-12 audit list cuts through events that share a second, so
  // which ones it shows varies run to run; audit_events itself is compared
  // in full above.
  for (const page of Object.values(pages)) {
    if (page?.settingsPage?.recentAuditEvents) page.settingsPage.recentAuditEvents = "<excluded: capped list with timestamp ties>";
  }
  out.__pageDtos = pages;
  return out;
}

let server = null;
let pageDtos = {};
try {
  d1(path.join(root, "schema.sql"));
  server = spawn(process.execPath, [wrangler, "dev", "--config", configPath, "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1000), "--persist-to", persist, "--log-level", "error", "--show-interactive-dev-session=false"], { cwd: root, env, stdio: "ignore", detached: true });
  const deadline = Date.now() + 90_000;
  let healthy = false;
  while (!healthy && Date.now() < deadline) {
    try { healthy = (await fetch(`${baseUrl}/api/health`)).ok; } catch {}
    if (!healthy) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!healthy) throw new Error("Worker did not become healthy");
  await runScenario();
  pageDtos = await readPageDtos();
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
}

const files = await findSqlite(persist);
if (files.length !== 1) throw new Error(`Expected one D1 sqlite file, found ${files.length}`);
const snapshot = dump(files[0], pageDtos);
await writeFile(outFile, `${JSON.stringify(snapshot, null, 1)}\n`);
await rm(tempRoot, { recursive: true, force: true });
const counts = Object.fromEntries(Object.entries(snapshot).filter(([table, rows]) => table !== "__pageDtos" && rows.length).map(([table, rows]) => [table, rows.length]));
console.log(`STATE_SNAPSHOT ${outFile} ${JSON.stringify(counts)}`);
