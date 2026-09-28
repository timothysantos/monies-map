import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR } from "../src/domain/category-palette.ts";

// Colour comes from the tokens (design.md, "Pastel palette" and "Money
// colour"). The pastel fills and inks live in :root of public/styles.css and
// the category colours in src/domain/category-palette.ts. Anywhere else a
// raw colour may only be a neutral (a grey, white, black, a warm off-white or
// a near-grey tint) or the terracotta accent the Splits theme is built on.
// Any other raw green, red, blue, amber or purple fails here: use a token.

const root = path.resolve(import.meta.dirname, "..");
const clientDir = path.join(root, "src/client");
const stylesheets = [
  "public/styles.css",
  ...readdirSync(clientDir).filter((name) => name.endsWith(".css")).map((name) => `src/client/${name}`)
];
const scripts = readdirSync(clientDir).filter((name) => /\.(jsx|js)$/.test(name)).map((name) => `src/client/${name}`);
const PALETTE = new Set([...CATEGORY_COLOURS, FALLBACK_CATEGORY_COLOUR].map((colour) => colour.toLowerCase()));

function channels(literal) {
  if (literal.startsWith("#")) {
    const hex = literal.length === 4 ? [...literal.slice(1)].map((c) => c + c).join("") : literal.slice(1);
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  }
  const numbers = literal.match(/[\d.]+/g) ?? [];
  return numbers.length >= 3 ? numbers.slice(0, 3).map(Number) : null;
}

// Neutral: the channels sit within 40 of each other. Accent: the terracotta
// hue family (14-36 degrees) of --accent and the Splits panel.
export function isAllowedRawColour(literal) {
  const colour = channels(literal);
  if (!colour) return true;
  const max = Math.max(...colour);
  const min = Math.min(...colour);
  const chroma = max - min;
  if (chroma < 40) return true;
  const [r, g, b] = colour;
  const hue = ((max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60 + 360) % 360;
  return hue >= 14 && hue <= 36;
}

const COLOUR_LITERAL = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;

function rawColours(file, { stripRoot }) {
  let text = readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  if (stripRoot) text = text.replace(/:root\s*\{[^}]*\}/g, "");
  return text.split("\n").flatMap((line, index) => [...line.matchAll(COLOUR_LITERAL)].map((match) => ({ file, line: index + 1, literal: match[0] })));
}

test("stylesheets use raw colours only for neutrals and the accent", () => {
  const offenders = stylesheets
    .flatMap((file) => rawColours(file, { stripRoot: true }))
    .filter(({ literal }) => !isAllowedRawColour(literal))
    .map(({ file, line, literal }) => `${file}:${line} ${literal}`);
  assert.deepEqual(offenders, [], "use a pastel token (--pastel-*, --positive, --negative) instead");
});

test("components take colours from the category palette", () => {
  const offenders = scripts
    .flatMap((file) => rawColours(file, { stripRoot: false }))
    .filter(({ literal }) => !PALETTE.has(literal.toLowerCase()) && !isAllowedRawColour(literal))
    .map(({ file, line, literal }) => `${file}:${line} ${literal}`);
  assert.deepEqual(offenders, []);
});

test("the guard is not blind", () => {
  for (const literal of ["#1f7a63", "#b23a2e", "rgba(31, 122, 99, 0.06)", "rgba(180, 35, 24, 0.1)", "#1f66d1", "#265c8c", "rgba(204, 154, 47, 0.3)"]) {
    assert.equal(isAllowedRawColour(literal), false, literal);
  }
  for (const literal of ["#ffffff", "rgba(38, 35, 31, 0.12)", "#f6f4ef", "#b15e2f", "rgba(177, 94, 47, 0.16)", "rgba(91, 107, 125, 0.14)"]) {
    assert.equal(isAllowedRawColour(literal), true, literal);
  }
});

test("components choose money colour through the money tones", () => {
  const legacy = /\b(?:tone-positive|tone-negative|metric-positive|metric-negative|entry-edit-tone-(?:positive|negative|transfer)|getAmountToneClass)\b|className=\{?\s*[^}\n]*\?\s*"(?:positive|negative)"/;
  const offenders = scripts.filter((file) => legacy.test(readFileSync(path.join(root, file), "utf8")));
  assert.deepEqual(offenders, []);
});
