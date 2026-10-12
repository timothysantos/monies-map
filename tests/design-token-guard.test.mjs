import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Type size, corner radius and shadow come from the design tokens in :root
// of public/styles.css (design.md, "Design tokens"), so the redesign stays
// one system. Every stylesheet under src/client is checked except the legacy
// ones listed below, which predate the tokens; a new stylesheet is checked
// from its first line. In a checked file a raw font-size (or a size in the
// `font` shorthand), border-radius or box-shadow fails unless it is one of
// the pre-token one-offs frozen in KNOWN_LITERALS. Allowed raw: 0, none,
// inherit, keywords, unitless numbers, and 50% for a circle.

const root = path.resolve(import.meta.dirname, "..");
const clientDir = path.join(root, "src/client");
const clientFiles = readdirSync(clientDir, { recursive: true }).map((name) => String(name).split(path.sep).join("/"));

// Stylesheets written before the tokens. Move a file out of this list when
// it is converted; never add a new one.
const LEGACY_STYLESHEETS = new Set([
  "claude-credit-notice.css",
  "entries-route.css",
  "faq-panel.css",
  "import-bring-files.css",
  "import-review.css",
  "imports-route.css",
  "money-checkin.css",
  "month-mid-width.css",
  "month-plan-sheet.css",
  "month-route.css",
  "settings-route.css",
  "splits-panel.css",
  "splits-route.css",
  "statement-fix-suggestions.css",
  "summary-lead.css",
  "summary-month-sheet.css"
]);

// Pre-token values in the checked files that sit off the scale. Each one
// stays as it looks today; the redesign folds them into a token. The list
// only shrinks: a value not listed fails, and a listed value that is gone
// fails too, so its entry is removed with it.
const KNOWN_LITERALS = {
  "ui/lead-support-detail.css": [
    "font-size: 0.9rem",
    "font-size: 0.84rem",
    "box-shadow: inset 0 0 0 999px rgba(27, 24, 21, 0.06)"
  ],
  "ask-route.css": [
    // Head and context line.
    "font-size: 2rem",
    "font-size: 1.7rem",
    "font-size: 0.9rem",
    "font-size: 0.92rem",
    "border-radius: 10px",
    // The conversation: section marks, the brief card, messages, receipts.
    "font: 500 0.7rem/1.2 ui-monospace, \"SF Mono\", Menlo, monospace",
    "border-radius: 20px",
    "font-size: 1.02rem",
    "border-radius: 16px 16px 4px 16px",
    "font-size: 0.95rem",
    "font-size: 0.95rem",
    "border-radius: 8px",
    "box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15)",
    // Money answer wording and lines, the entry card's coax, saved and
    // Splits lines, the switch knob.
    "font-size: 0.98rem",
    "font-size: 0.9rem",
    "font-size: 0.78rem",
    "font-size: 0.92rem",
    "font-size: 0.88rem",
    "font-size: 0.92rem",
    "font-size: 0.8rem",
    "box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25)",
    // The bottom chips and the composer, its + menu and the mic ring.
    "border-radius: 12px",
    "font-size: 0.95rem",
    "border-radius: 22px",
    "box-shadow: inset 0 0 0 1px var(--line)",
    "box-shadow: inset 0 0 0 1px var(--line), 0 0 0 2px color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    "border-radius: 14px",
    "box-shadow: 0 18px 40px rgba(26, 28, 34, 0.14)",
    "border-radius: 10px",
    "box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-strong) 35%, transparent)",
    // The saved-entry picker popover, the mic pulse, the phone head.
    "border-radius: 14px",
    "box-shadow: 0 12px 30px rgba(27, 24, 21, 0.14)",
    "box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    "box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent-strong) 0%, transparent)",
    "font-size: 2.3rem",
    "font-size: 1.85rem",
    // The Back link above the title on a phone (10px corner) and the docked
    // or popup panel's heading and expand control (1.7rem, 12px corner).
    "border-radius: 10px",
    "font-size: 1.7rem",
    "border-radius: 12px"
  ],
  "sheet-swipe.css": [
    // The "Discard changes?" bar at a sheet's bottom: its own 20px top
    // corners, upward shadow and title, off the sheet token scale.
    "border-radius: 20px 20px 0 0",
    "box-shadow: 0 -12px 28px rgba(27, 24, 21, 0.14)",
    "font-size: 1.1rem"
  ]
};

const checkedStylesheets = clientFiles
  .filter((name) => name.endsWith(".css") && !LEGACY_STYLESHEETS.has(name))
  .sort();

const TOKEN_PROPERTIES = /(?:^|[;{\s])(box-shadow|border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius|font-size|font)\s*:\s*([^;{}]+)/g;
const LENGTH = /(?<![\w.#-])-?(?:\d*\.\d+|\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|dvh|ch|lh|pt)(?![\w-])/g;
const NESTED_FUNCTION = /\b(?:var|rgba?|hsla?|color-mix)\([^()]*\)/g;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// The raw (non-token) declarations among the guarded properties.
export function rawTokenLiterals(css) {
  const text = stripComments(css).replace(/:root\s*\{[^}]*\}/g, "");
  const found = [];
  for (const match of text.matchAll(TOKEN_PROPERTIES)) {
    const property = match[1];
    const value = match[2].replace(/\s+/g, " ").replace(/\s*!important\s*$/, "").trim();
    let bare = value;
    // Peel functions from the inside out: var(--x, 4px) and rgba() hold no
    // raw size of their own.
    for (let previous = ""; previous !== bare;) {
      previous = bare;
      bare = bare.replace(NESTED_FUNCTION, " ");
    }
    const lengths = [...bare.matchAll(LENGTH)]
      .map((item) => item[0])
      .filter((length) => !/^-?0*\.?0+[a-z%]+$/.test(length))
      .filter((length) => !(property.endsWith("radius") && length === "50%"));
    if (lengths.length) found.push(`${property}: ${value}`);
  }
  return found;
}

function multisetDifference(left, right) {
  const remaining = [...right];
  return left.filter((item) => {
    const index = remaining.indexOf(item);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

test("checked stylesheets size type, corners and shadows with the design tokens", () => {
  const problems = [];
  for (const name of checkedStylesheets) {
    const found = rawTokenLiterals(readFileSync(path.join(clientDir, name), "utf8"));
    const known = KNOWN_LITERALS[name] ?? [];
    for (const literal of multisetDifference(found, known)) {
      problems.push(`src/client/${name}: "${literal}" — use a token (--type-*, --radius-*, --elevation-*)`);
    }
    for (const literal of multisetDifference(known, found)) {
      problems.push(`src/client/${name}: "${literal}" is no longer used; remove it from KNOWN_LITERALS`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the guard checks the shared blocks, the Ask page and any new stylesheet", () => {
  assert.ok(checkedStylesheets.includes("ui/lead-support-detail.css"));
  assert.ok(checkedStylesheets.includes("ask-route.css"));
  assert.ok(checkedStylesheets.includes("sheet-swipe.css"));
  for (const name of LEGACY_STYLESHEETS) {
    assert.ok(clientFiles.includes(name), `${name} is gone; remove it from LEGACY_STYLESHEETS`);
  }
  for (const name of Object.keys(KNOWN_LITERALS)) {
    assert.ok(checkedStylesheets.includes(name), `${name} in KNOWN_LITERALS is not a checked stylesheet`);
  }
});

test("the shared blocks' components set no raw type, radius or shadow inline", () => {
  const offenders = clientFiles
    .filter((name) => name.startsWith("ui/") && /\.(jsx|js)$/.test(name))
    .filter((name) => /\b(?:fontSize|borderRadius|boxShadow)\s*:\s*(?!["'`]?var\()/.test(readFileSync(path.join(clientDir, name), "utf8")));
  assert.deepEqual(offenders, []);
});

test("every token a checked stylesheet uses is defined in :root", () => {
  const rootBlock = readFileSync(path.join(root, "public/styles.css"), "utf8").match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const defined = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const missing = new Set();
  for (const name of checkedStylesheets) {
    const css = stripComments(readFileSync(path.join(clientDir, name), "utf8"));
    for (const match of css.matchAll(/var\((--(?:type|space|radius|elevation|tap|sheet-handle)-[\w-]+)/g)) {
      if (!defined.has(match[1])) missing.add(`${name} ${match[1]}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("design.md documents every design token", () => {
  const rootBlock = readFileSync(path.join(root, "public/styles.css"), "utf8").match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const tokens = [...rootBlock.matchAll(/(--(?:type|space|radius|elevation|tap|sheet-handle)-[\w-]+)\s*:/g)].map((match) => match[1]);
  assert.ok(tokens.length >= 20, "the design tokens are in :root of public/styles.css");
  const design = readFileSync(path.join(root, "design.md"), "utf8");
  const table = design.slice(design.indexOf("## Design Tokens"));
  assert.deepEqual(tokens.filter((token) => !table.includes(`\`${token}\``)), []);
});

test("the guard is not blind", () => {
  assert.deepEqual(rawTokenLiterals(".a { font-size: 0.9rem; }"), ["font-size: 0.9rem"]);
  assert.deepEqual(rawTokenLiterals(".a { font: 500 0.7rem/1.2 ui-monospace, monospace; }"), ["font: 500 0.7rem/1.2 ui-monospace, monospace"]);
  assert.deepEqual(rawTokenLiterals(".a { border-radius: 12px; }"), ["border-radius: 12px"]);
  assert.deepEqual(rawTokenLiterals(".a { border-top-left-radius: 8px; }"), ["border-top-left-radius: 8px"]);
  assert.deepEqual(rawTokenLiterals(".a { box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15); }"), ["box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15)"]);
  assert.deepEqual(rawTokenLiterals(".a { font-size: max(16px, var(--type-lead-title)); }"), ["font-size: max(16px, var(--type-lead-title))"]);
  assert.deepEqual(rawTokenLiterals(".a { box-shadow: inset 0 0 0 1px var(--line); }"), ["box-shadow: inset 0 0 0 1px var(--line)"]);
  assert.deepEqual(rawTokenLiterals("@media (max-width: 760px) { .a { font-size: 2rem } }"), ["font-size: 2rem"]);
  assert.deepEqual(rawTokenLiterals([
    ".a { font-size: var(--type-body); border-radius: var(--radius-card); box-shadow: var(--elevation-lead); }",
    ".b { border-radius: 50%; border-radius: 0; box-shadow: none; font: inherit; font-size: inherit; }",
    ".c { font: 500 var(--type-eyebrow)/1.2 ui-monospace, \"SF Mono\", monospace; }",
    ".d { font-size: max(var(--type-input-min), var(--type-lead-title)); border-radius: var(--radius-bar, 6px); }",
    "/* font-size: 3rem */",
    ":root { --type-body: 0.94rem; --radius-card: 22px; }"
  ].join("\n")), []);
});
