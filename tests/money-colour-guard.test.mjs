import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Money colour comes only from the money tones (src/domain/money-tone.ts and
// the .money-<tone> classes, design.md "Money colour"). This guard fails when
// a stylesheet colours something with the old raw greens and reds, or a
// component picks a colour class by hand, outside that rule.

const root = path.resolve(import.meta.dirname, "..");
const stylesheets = [
  "public/styles.css",
  ...readdirSync(path.join(root, "src/client")).filter((name) => name.endsWith(".css")).map((name) => `src/client/${name}`)
];

// The old ad-hoc money colours: the --positive / --negative tokens and the raw
// greens and reds that were used next to them.
const RAW_MONEY_COLOUR = /var\(--(?:positive|negative)\)|#(?:1f7a63|1d7a57|b23a2e|b85e4b|9b6a2f)\b|rgba\(\s*(?:31,\s*122,\s*99|29,\s*122,\s*87|26,\s*127,\s*79|178,\s*58,\s*46|180,\s*35,\s*24|181,\s*83,\s*67|170,\s*54,\s*41)\s*,/i;

// Status surfaces that still use them. None of them colours money by its
// direction; they are the pastel follow-up list in design.md ("Not yet
// pastel"). Shrink this list as they move to the pastel tokens; never grow it.
const NOT_YET_PASTEL = new Set([
  "body",
  ".import-upload-status.is-error",
  ".duplicate-row-detail-panel",
  ".import-status.is-warning",
  ".tab-badge",
  ".pill.warning",
  ".pill.success",
  ".month-plan-stack-hint.is-readonly",
  ".month-plan-section table tbody tr.is-editing",
  ".month-actions-item-danger",
  ".subtle-action.subtle-danger",
  ".subtle-remove",
  ".month-inline-delete-button",
  ".split-odd-cent-actions button.is-selected",
  ".dialog-danger",
  ".split-delete-action",
  ".split-match-confidence",
  ".panel-splits .split-card-actions .split-delete-action, .panel-splits .split-inline-actions .split-delete-action",
  ".settings-statement-compare.is-success",
  ".settings-statement-compare.is-error",
  ".settlement-lock-undone, .panel-splits .settlement-lock-undone",
  ".import-inbox-section.is-current",
  ".import-inbox-metric-icon",
  ".import-inbox-guidance.is-current",
  ".import-inbox-current-list span",
  ".import-intake-summary",
  ".import-intake-empty",
  ".import-intake-row.is-matched",
  ".import-stage-label.is-complete",
  ".import-dropzone",
  ".import-dropzone:hover, .import-dropzone.is-active",
  ".import-upload-status.is-success",
  ".import-warning-action",
  ".import-warning-reconciled",
  ".statement-reconciliation-delete-all-button",
  ".statement-reconciliation-delete-button",
  ".import-summary-item.is-warning",
  ".import-summary-item.is-success",
  ".entry-chip-bank-state.is-statement-certified",
  ".entry-chip-exception.is-blocking",
  ".import-history-refreshing.is-success",
  ".import-history-refreshing.is-error"
]);

function rulesWithRawMoneyColour(file) {
  const css = readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  // Innermost rules only: a selector followed by a block without nested braces.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // :root defines the tokens themselves.
    if (RAW_MONEY_COLOUR.test(match[2]) && !match[1].trim().endsWith(":root")) {
      found.push(match[1].trim().replace(/\s+/g, " "));
    }
  }
  return found;
}

test("no stylesheet colours money with the old raw greens and reds", () => {
  const offenders = stylesheets.flatMap((file) => rulesWithRawMoneyColour(file)
    .filter((selector) => !NOT_YET_PASTEL.has(selector))
    .map((selector) => `${file}: ${selector}`));
  assert.deepEqual(offenders, [], "use the money tones (.money-in, .money-short, ...) or the pastel tokens instead");
});

test("the guard still sees the status surfaces it allows", () => {
  const seen = new Set(stylesheets.flatMap(rulesWithRawMoneyColour));
  const stale = [...NOT_YET_PASTEL].filter((selector) => !seen.has(selector));
  assert.deepEqual(stale, [], "a surface moved to the pastel tokens: remove it from NOT_YET_PASTEL");
  // And the guard is not blind: a new money rule with a raw red is caught.
  assert.ok(RAW_MONEY_COLOUR.test("color: var(--negative);"));
  assert.ok(RAW_MONEY_COLOUR.test("background: rgba(31, 122, 99, 0.06);"));
  assert.ok(!RAW_MONEY_COLOUR.test("color: var(--pastel-rose-ink);"));
});

test("components choose money colour through the money tones", () => {
  const sources = readdirSync(path.join(root, "src/client"))
    .filter((name) => /\.(jsx|js)$/.test(name))
    .map((name) => [name, readFileSync(path.join(root, "src/client", name), "utf8")]);
  const legacy = /\b(?:tone-positive|tone-negative|metric-positive|metric-negative|entry-edit-tone-(?:positive|negative|transfer)|getAmountToneClass)\b|className=\{?\s*[^}\n]*\?\s*"(?:positive|negative)"/;
  const offenders = sources.filter(([, source]) => legacy.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, []);
});
