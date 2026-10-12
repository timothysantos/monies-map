// Reads the colour tokens of the 70s default (:root of public/styles.css)
// and of every colour preset (public/palettes/<id>.css over the default),
// plus the colour maths the contrast tests share.
import { readFileSync } from "node:fs";
import path from "node:path";

import { COLOUR_PRESETS, DEFAULT_PRESET_ID } from "../../src/client/colour-presets.js";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const WHITE = [255, 255, 255];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensOf = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

export function readRootTokens() {
  const css = stripComments(readFileSync(path.join(ROOT, "public/styles.css"), "utf8"));
  return tokensOf(css.match(/:root\s*\{([^}]*)\}/)[1]);
}

export function readPresetSheet(id) {
  return readFileSync(path.join(ROOT, "public/palettes", `${id}.css`), "utf8");
}

/** The tokens a preset's sheet sets under :root[data-palette="<id>"]. */
export function readPresetTokens(id) {
  const css = stripComments(readPresetSheet(id));
  const block = css.match(new RegExp(`:root\\[data-palette="${id}"\\]\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`public/palettes/${id}.css has no :root[data-palette="${id}"] block`);
  return tokensOf(block[1]);
}

export function parse(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: hexRgb(value), alpha: 1 };
  const rgba = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (rgba) return { rgb: rgba.slice(1, 4).map(Number), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  // A channel token: "177 94 47".
  const channels = value.match(/^(\d+) (\d+) (\d+)$/);
  if (channels) return { rgb: channels.slice(1, 4).map(Number), alpha: 1 };
  throw new Error(`not a plain colour: ${value}`);
}
export const hexRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (colour) => { const [r, g, b] = colour.map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const mix = (colour, share, base) => colour.map((value, index) => value * share + base[index] * (1 - share));
export function lab(colour) {
  const [r, g, b] = colour.map(channel);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => { const p = lab(a); const q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// How colourful a light preset's fills may be: faded print for most, the
// neon pastels of 80s Pop a little brighter, none at all for Black & White.
const FILL_CHROMA_MAX = { "80s": 44, mono: 2 };

/**
 * Every preset as the contrast tests see it: `tokens` (the preset's over the
 * default's), `rgb(name)` (a token as an opaque colour, a translucent one
 * over --bg) and `cat(hex)` (the colour a 70s palette colour shows as).
 */
export function loadPresets() {
  const rootTokens = readRootTokens();
  return COLOUR_PRESETS.map((preset) => {
    const own = preset.id === DEFAULT_PRESET_ID ? {} : readPresetTokens(preset.id);
    const tokens = { ...rootTokens, ...own };
    const bg = parse(tokens["--bg"]).rgb;
    const rgb = (name) => {
      if (!tokens[name]) throw new Error(`${preset.id} has no ${name}`);
      const { rgb: colour, alpha } = parse(tokens[name]);
      return alpha === 1 ? colour : mix(colour, alpha, bg);
    };
    return {
      id: preset.id,
      name: preset.name,
      own,
      tokens,
      rgb,
      isDark: preset.scheme === "dark",
      fillChromaMax: FILL_CHROMA_MAX[preset.id] ?? 26,
      cat: (hex) => own[`--cat-${hex.slice(1).toLowerCase()}`] ?? hex
    };
  });
}
