// Velocity rule audit (docs/audits/velocity-rule.md): today's "under $5"
// test against a "does the same charge repeat nearby" test, over every
// real-structure bank file in tests/fixtures. Read only; changes nothing.
//   npx tsx scripts/audit-velocity-rule.mjs
import { readFileSync, readdirSync } from "node:fs";
import { parseCitibankActivityCsv, parseOcbcActivityCsv, parseStatementText } from "../src/lib/statement-import.ts";
import { parseCurrentTransactionSpreadsheet } from "../src/lib/statement-import/xls.ts";
import { normalizeImportRow, extractTransactionDateHint } from "../src/domain/app-repository-helpers.ts";
import { compareDescriptionSimilarity } from "../src/domain/app-repository-helpers.ts";
import { getDuplicateCandidateDayDistance, getDuplicateMatchKind, getTokenSimilarity } from "../src/domain/statement-row-matching.ts";
const fx = (p) => new URL(`../tests/fixtures/${p}`, import.meta.url);
const text = (p) => readFileSync(fx(p), "utf8");
const buf = (p) => { const b = readFileSync(fx(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

function loadSources() {
  const sources = [];
  for (const name of readdirSync(fx("pdf-statement-text")).filter((item) => item.endsWith(".pdf-text.txt"))) {
    try { sources.push({ name, kind: "statement", parsed: parseStatementText(text(`pdf-statement-text/${name}`), name.replace("-sanitized.pdf-text.txt", ".pdf")) }); } catch (e) { console.error("skip", name, e.message); }
  }
  for (const name of readdirSync(fx("uob-current-transactions"))) sources.push({ name, kind: "activity", parsed: parseCurrentTransactionSpreadsheet(buf(`uob-current-transactions/${name}`), name) });
  sources.push({ name: "ocbc-360-activity.csv", kind: "activity", parsed: parseOcbcActivityCsv(text("ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv"), "TransactionHistory_20260628140517.csv") });
  sources.push({ name: "citi-activity.csv", kind: "activity", parsed: parseCitibankActivityCsv(text("citibank-activity/ACCT_349_06_07_2026-sanitized.csv"), "ACCT_349_06_07_2026.csv", { accountName: "Citi Rewards", accountKind: "credit_card", institution: "Citibank" }) });
  for (const name of readdirSync(fx("hsbc-ocr/browser-2026"))) {
    const month = name.match(/-(\w{3})-2026/)[1];
    try { sources.push({ name, kind: "statement", parsed: parseStatementText(`__OCR_TSV__\n${text(`hsbc-ocr/browser-2026/${name}`)}`, `4835-8500-2086-8155-${month}_2026.pdf`) }); } catch (e) { console.error("skip", name, e.message); }
  }
  return sources.map((source) => ({
    ...source,
    rows: source.parsed.rows.flatMap((raw, index) => {
      const n = normalizeImportRow(raw);
      if (n.errors.length || !n.amountMinor) return [];
      const event = extractTransactionDateHint(n.note) ?? raw["transaction date"] ?? undefined;
      const signed = n.entryType === "income" || n.transferDirection === "in" ? n.amountMinor : -n.amountMinor;
      return [{ id: `${source.name}#${index + 1}`, source: source.name, account: n.accountName ?? raw.account ?? source.parsed.checkpoints?.[0]?.accountName ?? "?", posted: n.date, event: event && event !== n.date ? event : undefined, description: n.description ?? "", amountMinor: n.amountMinor, signed }];
    })
  }));
}

const ctx = (r) => ({ postedDate: r.posted, eventDate: r.event ?? r.posted, hasEventDateHint: Boolean(r.event) });
const dist = (a, b) => getDuplicateCandidateDayDistance({ previewRow: ctx(a), candidate: ctx(b) });
// Same amount and wording close enough for some match kind at that distance.
const lookalike = (a, b, d) => a.signed === b.signed && a.account === b.account && Boolean(getDuplicateMatchKind({ dayDistance: d, descriptionSimilarity: compareDescriptionSimilarity(a.description, b.description), tokenSimilarity: getTokenSimilarity(a.description, b.description) }));
const merchant = (r) => r.description.replace(/\d{4,}/g, "#").replace(/\s+(SINGAPORE|Singapore)?\s*(SG|US|IE)$/,"").slice(0, 34);

const sources = loadSources().filter((s) => s.rows.length);
const all = [];
const fp = { A: [], B: [] };
for (const s of sources) {
  for (const r of s.rows) {
    r.repeats = s.rows.some((o) => o !== r && dist(r, o) <= 7 && lookalike(r, o, dist(r, o)));
    r.small = r.amountMinor < 500;
    r.windowA = r.small ? 2 : 7;
    r.windowB = r.repeats ? 2 : 7;
    all.push(r);
  }
  // Distinct real purchases in one file that a rule would allow to be "the same purchase".
  for (let i = 0; i < s.rows.length; i += 1) for (let j = i + 1; j < s.rows.length; j += 1) {
    const a = s.rows[i], b = s.rows[j], d = dist(a, b);
    if (!lookalike(a, b, d)) continue;
    if (d <= (a.small ? 2 : 7)) fp.A.push([a, b, d]);
    if (d <= 2) fp.B.push([a, b, d]); // both rows repeat by definition here
  }
}

const count = (f) => all.filter(f).length;
console.log(`rows: ${all.length} in ${sources.length} files`);
console.log("\n## Rows by type (window A = today, B = repetition)");
for (const [label, f] of [["under $5, repeats", (r) => r.small && r.repeats], ["under $5, one-off", (r) => r.small && !r.repeats], ["$5+, repeats", (r) => !r.small && r.repeats], ["$5+, one-off", (r) => !r.small && !r.repeats]]) {
  const rows = all.filter(f);
  const merchants = [...new Map(rows.map((r) => [merchant(r), 0])).keys()].slice(0, 8).join("; ");
  console.log(`${label.padEnd(20)} ${String(rows.length).padStart(4)}  A=${rows[0]?.windowA ?? "-"}d B=${rows[0]?.windowB ?? "-"}d  e.g. ${merchants}`);
}
console.log(`\nwindow changes: ${count((r) => r.windowA !== r.windowB)} of ${all.length} rows (tighter: ${count((r) => r.windowB < r.windowA)}, looser: ${count((r) => r.windowB > r.windowA)})`);

console.log("\n## Distinct purchases in one file that each rule lets count as one purchase");
const byMerchant = (list) => [...list.reduce((m, [a, , d]) => m.set(merchant(a), [...(m.get(merchant(a)) ?? []), d]), new Map())].map(([k, ds]) => `${k} x${ds.length} (days ${Math.min(...ds)}-${Math.max(...ds)})`).join("\n   ");
console.log(`A (today): ${fp.A.length}\n   ${byMerchant(fp.A)}`);
console.log(`B (repetition): ${fp.B.length}\n   ${byMerchant(fp.B)}`);
const onlyA = fp.A.filter(([a, b, d]) => d > 2);
console.log(`A allows but B refuses (3-7 days apart): ${onlyA.length}`);

console.log("\n## Posting delay (rows with both dates) and rows without a purchase date");
for (const [label, f] of [["under $5, repeats", (r) => r.small && r.repeats], ["under $5, one-off", (r) => r.small && !r.repeats], ["$5+, repeats", (r) => !r.small && r.repeats], ["$5+, one-off", (r) => !r.small && !r.repeats]]) {
  const rows = all.filter(f);
  const delays = rows.filter((r) => r.event).map((r) => Math.round((Date.parse(r.posted) - Date.parse(r.event)) / 864e5)).sort((x, y) => x - y);
  const over2 = delays.filter((x) => x > 2).length;
  console.log(`${label.padEnd(20)} with purchase date ${String(delays.length).padStart(3)}: median ${delays[Math.floor(delays.length / 2)] ?? "-"}d, max ${delays.at(-1) ?? "-"}d, over 2 days ${over2} | no purchase date ${rows.filter((r) => !r.event).length}`);
}
const noEventOver2Risk = all.filter((r) => !r.event && !r.small && r.repeats);
console.log(`\n$5+ repeating rows with no purchase date (where B could miss a late-posted true match): ${noEventOver2Risk.length}: ${[...new Set(noEventOver2Risk.map(merchant))].join("; ")}`);
const smallOneOffNoEvent = all.filter((r) => !r.event && r.small && !r.repeats);
console.log(`under-$5 one-off rows with no purchase date (where A could miss a late-posted true match): ${smallOneOffNoEvent.length}: ${[...new Set(smallOneOffNoEvent.map(merchant))].join("; ")}`);
