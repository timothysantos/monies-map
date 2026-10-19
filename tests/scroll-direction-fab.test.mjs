// The long-page "Go to top" / "Go to bottom" shortcut (scroll-direction-fab.js)
// draws its two directions as one icon pair from the app's icon family
// (lucide), at the size and stroke of the island's month arrows, never as
// text glyphs that each font draws differently.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { scrollFabIcon } from "../src/client/scroll-direction-fab.js";

const source = readFileSync(new URL("../src/client/scroll-direction-fab.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/client/App.jsx", import.meta.url), "utf8");

function lucidePath(name) {
  const icon = readFileSync(new URL(`../node_modules/lucide-react/dist/esm/icons/${name}.js`, import.meta.url), "utf8");
  return icon.match(/d: "([^"]+)"/)[1];
}

function svgAttributes(markup) {
  const open = markup.match(/^<svg([^>]*)>/)[1];
  return Object.fromEntries([...open.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

test("the shortcut's two directions are lucide's chevron-up and chevron-down", () => {
  assert.match(scrollFabIcon("top"), new RegExp(`<path d="${lucidePath("chevron-up")}"`));
  assert.match(scrollFabIcon("bottom"), new RegExp(`<path d="${lucidePath("chevron-down")}"`));
});

test("both directions share one size, stroke and drawing style", () => {
  const top = svgAttributes(scrollFabIcon("top"));
  const bottom = svgAttributes(scrollFabIcon("bottom"));
  assert.deepEqual(top, bottom);
  assert.equal(top.viewBox, "0 0 24 24");
  assert.equal(top.fill, "none");
  assert.equal(top.stroke, "currentColor");
  assert.equal(top["stroke-linecap"], "round");
  assert.equal(top["stroke-linejoin"], "round");
  assert.equal(top["aria-hidden"], "true");
});

test("the shortcut matches the island's month arrows (lucide, 19 px, stroke 2.2)", () => {
  const arrows = [...app.matchAll(/<Chevron(?:Left|Right) size=\{(\d+)\} strokeWidth=\{([\d.]+)\}/g)];
  assert.ok(arrows.length >= 2, "the island's month arrows are lucide chevrons");
  const { width, height, "stroke-width": strokeWidth } = svgAttributes(scrollFabIcon("top"));
  for (const [, size, stroke] of arrows) {
    assert.equal(width, size);
    assert.equal(height, size);
    assert.equal(strokeWidth, stroke);
  }
});

test("no text arrow glyph is drawn as the icon", () => {
  assert.doesNotMatch(source, /[←-⇿⌀-⏿▲-▿‹›]/u);
  assert.doesNotMatch(source, /textContent\s*=/);
});

test("an unknown direction is refused rather than drawn as the wrong arrow", () => {
  assert.throws(() => scrollFabIcon("sideways"), /direction/);
});
