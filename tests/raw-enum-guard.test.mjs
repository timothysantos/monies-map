// Guard for U9 (UI audit): no screen renders a stored code where a label map
// exists. Reads the client sources and fails on a code field placed straight
// into visible text (a JSX text child or a triplet line) instead of going
// through src/client/enum-labels.js, and on any short month format that does
// not spell September "Sep".
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CLIENT = new URL("../src/client/", import.meta.url).pathname;
const SRC = new URL("../src/", import.meta.url).pathname;

function sourceFiles(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, pattern);
    return pattern.test(entry.name) ? [full] : [];
  });
}

// Fields that hold a code with a label map (or that are only ever an id for
// a colour or icon): showing one in text is the bug.
const CODE_FIELDS = "kind|entryType|accountKind|paymentMethod|slug|iconKey|colorHex";
const FIELD = String.raw`[\w$?.]*\.(?:${CODE_FIELDS})`;

// Places where a bare `.kind` is a discriminator, not display text.
const DISPLAY_PATTERNS = [
  // <p>{account.kind}</p>
  { name: "JSX text child", regex: new RegExp(String.raw`>\s*\{\s*${FIELD}\s*\}\s*<`, "g") },
  // messages.common.triplet(account.institution, account.kind, ...)
  { name: "triplet part", regex: new RegExp(String.raw`triplet\(([^()]|\([^()]*\))*?(?<![\[\w$?.])${FIELD}(?![\w$\]])`, "g") }
];

test("no client source puts a raw code field into visible text", () => {
  const offences = [];
  for (const file of sourceFiles(CLIENT, /\.(jsx|js)$/)) {
    const text = readFileSync(file, "utf8");
    for (const { name, regex } of DISPLAY_PATTERNS) {
      for (const match of text.matchAll(regex)) {
        const line = text.slice(0, match.index).split("\n").length;
        offences.push(`${path.relative(CLIENT, file)}:${line} (${name}) ${match[0].replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(offences, []);
});

test("the guard catches the offences the audit found", () => {
  const found = (text) => DISPLAY_PATTERNS.some(({ regex }) => new RegExp(regex.source, "g").test(text));
  assert.equal(found("<p>{messages.common.triplet(account.institution, account.kind, account.ownerLabel)}</p>"), true);
  assert.equal(found("<p>{messages.common.triplet(category.slug, category.iconKey, category.colorHex)}</p>"), true);
  assert.equal(found("<strong>{candidate.entryType}</strong>"), true);
  assert.equal(found("<p>{messages.common.triplet(accountKindLabel(account.kind), account.ownerLabel)}</p>"), false);
  assert.equal(found("<strong>{entryTypeLabel(candidate.entryType)}</strong>"), false);
  assert.equal(found("const isCard = account.kind === \"credit_card\";"), false);
});

test("a split history row names its action through the label map", () => {
  const text = readFileSync(path.join(CLIENT, "splits-history-dialog.jsx"), "utf8");
  assert.doesNotMatch(text, /\{item\.action\}/);
  assert.match(text, /splitHistoryActionLabel\(item\.action\)/);
});

test("every short month or date format passes through shortMonthText", () => {
  const offences = [];
  for (const file of sourceFiles(SRC, /\.(jsx|js|ts|tsx)$/)) {
    if (file.endsWith(path.join("lib", "short-month.ts"))) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/Intl\.DateTimeFormat\(([^;]*?)\)(?=[.;,\s)])/gs)) {
      const options = match[1];
      const makesShortMonth = /month:\s*["']short["']|dateStyle:\s*["'](medium|short)["']/.test(options);
      if (!makesShortMonth) continue;
      const line = text.slice(0, match.index).split("\n").length;
      // The formatter itself, or its result, must reach shortMonthText: the
      // call sits on the same statement or on the helper that wraps it.
      const statementStart = text.lastIndexOf("\n\n", match.index);
      const statement = text.slice(Math.max(0, statementStart), match.index + match[0].length + 160);
      if (!/shortMonthText\(/.test(statement)) {
        offences.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
  }
  assert.deepEqual(offences, []);
});
