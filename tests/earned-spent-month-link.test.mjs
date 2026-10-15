import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The month name in Summary's "Earned vs spent by month" ships with the
// Simple view chunk, where summary-intent-outcome.css is not loaded. Its flat
// row-link style must therefore live in simple-view.css, or the browser
// paints a native grey button.
const css = readFileSync(new URL("../src/client/simple-view.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector) {
  const block = css.split("}").find((part) => part.split("{")[0].split(",").map((s) => s.trim()).includes(selector));
  assert.ok(block, `simple-view.css must style ${selector}`);
  return block.slice(block.indexOf("{") + 1);
}

test("earned-spent month link resets the native button look", () => {
  const body = rule(".earned-spent-row .summary-month-link");
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /border:\s*0/);
  assert.match(body, /appearance:\s*none/);
  assert.match(body, /min-height:\s*44px/);
  assert.match(body, /color:\s*var\(--text\)/);
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, "no raw hex");
});

test("earned-spent month link fills the left column with its label at the start", () => {
  const body = rule(".earned-spent-row .summary-month-link");
  assert.match(body, /justify-content:\s*flex-start/);
});
