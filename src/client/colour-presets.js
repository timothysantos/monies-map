// Colour presets (design.md, "Colour presets"): whole colour schemes a
// person picks per device in Settings > Colours, each in a Light and a Dark
// mode, with Auto following the phone. The 70s Warm light default lives in
// :root of public/styles.css; every other preset and mode is one small
// stylesheet, public/palettes/<id>-<mode>.css, that overrides the same
// tokens under :root[data-palette="<id>"] and data-mode, and loads only
// when it is in use. A stored choice is applied before the first paint by
// the inline script in index.html, which keeps its own copy of the ids and
// also follows the phone in Auto (checked by tests/colour-presets.test.mjs).
//
// `swatches` are the four dots on the preset's chip in Settings, per mode:
// the page, the accent, money in and money out.
export const DEFAULT_PRESET_ID = "70s";
export const DEFAULT_MODE = "auto";
export const PALETTE_STORAGE_KEY = "monies-map:palette";
export const MODE_STORAGE_KEY = "monies-map:colour-mode";

/** The modes a person can choose, in the order Settings shows them. */
export const COLOUR_MODES = Object.freeze(["light", "dark", "auto"]);
/** The modes a page can be in once Auto is resolved. */
export const RESOLVED_MODES = Object.freeze(["light", "dark"]);

export const COLOUR_PRESETS = Object.freeze([
  {
    id: "70s",
    name: "70s Warm",
    swatches: { light: ["#e9e4da", "#b15e2f", "#4a5c22", "#933629"], dark: ["#1b1916", "#e8996a", "#bccb88", "#f09d9b"] }
  },
  {
    id: "60s",
    name: "60s Mod",
    swatches: { light: ["#dfece8", "#0f7d74", "#43590e", "#a8381a"], dark: ["#0e2321", "#5dd3c5", "#b8d070", "#ffa184"] }
  },
  {
    id: "80s",
    name: "80s Pop",
    swatches: { light: ["#eee7f9", "#c2108f", "#06684f", "#a3124e"], dark: ["#110c23", "#ff7ad8", "#5ff0c4", "#ff8fbf"] }
  },
  {
    id: "modern",
    name: "Modern",
    swatches: { light: ["#e6ebf2", "#4f46e5", "#065f46", "#be123c"], dark: ["#151b26", "#a9a5ff", "#5ed3a2", "#fb8b9c"] }
  },
  {
    id: "mono",
    name: "Black & White",
    swatches: { light: ["#e8e8e8", "#1a1a1a", "#000000", "#3b3b3b"], dark: ["#0a0a0a", "#f0f0f0", "#ffffff", "#d4d4d4"] }
  },
  {
    id: "code",
    name: "Code",
    swatches: { light: ["#eee8d5", "#1f6aa5", "#4d6800", "#a82c1b"], dark: ["#0f141b", "#56d4dd", "#56d364", "#ff7b72"] }
  },
  {
    id: "midnight",
    name: "Midnight Calm",
    swatches: { light: ["#cdd6e4", "#3a5f8f", "#2f5b3c", "#8e3a48"], dark: ["#0f1729", "#a6c4ea", "#a5d0b0", "#eaa9b6"] }
  },
  {
    id: "genz",
    name: "Gen Z 2026",
    swatches: { light: ["#eae1e8", "#7652e0", "#3b6a00", "#b0145e"], dark: ["#18121f", "#c4adff", "#b8f05a", "#ff8fc4"] }
  },
  {
    id: "future",
    name: "Futuristic",
    swatches: { light: ["#d4dfe0", "#00788f", "#0b6448", "#a3263a"], dark: ["#0b0f10", "#6ae0f7", "#5ee6b0", "#ff8f9f"] }
  }
]);

export function findColourPreset(id) {
  return COLOUR_PRESETS.find((preset) => preset.id === id) ?? COLOUR_PRESETS[0];
}

function readStored(key, storage) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The preset this device chose, or the default when storage is empty or blocked. */
export function readStoredPresetId(storage = globalThis.localStorage) {
  const stored = readStored(PALETTE_STORAGE_KEY, storage);
  return COLOUR_PRESETS.some((preset) => preset.id === stored) ? stored : DEFAULT_PRESET_ID;
}

/** The mode this device chose: light, dark, or auto when nothing (or nothing known) is stored. */
export function readStoredMode(storage = globalThis.localStorage) {
  const stored = readStored(MODE_STORAGE_KEY, storage);
  return COLOUR_MODES.includes(stored) ? stored : DEFAULT_MODE;
}

/** Whether the phone or computer is set to dark. */
export function systemPrefersDark(win = globalThis) {
  try {
    return Boolean(win.matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {
    return false;
  }
}

/** Light or dark: a chosen mode as it is, Auto (or anything unknown) as the phone is set. */
export function resolveMode(mode, prefersDark = systemPrefersDark()) {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark ? "dark" : "light";
}

/** The sheet a preset needs in a resolved mode: null for the 70s Warm light default. */
export function variantSheetId(presetId, resolvedMode) {
  const preset = findColourPreset(presetId);
  if (preset.id === DEFAULT_PRESET_ID && resolvedMode === "light") return null;
  return `${preset.id}-${resolvedMode === "dark" ? "dark" : "light"}`;
}

function store(key, value, isDefault, storage) {
  try {
    if (isDefault) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage blocked (private mode, a locked-down browser): the choice
    // still applies to this page, it just isn't remembered.
  }
}

function loadSheet(sheetId, doc) {
  const existing = doc.querySelector(`link[data-palette-sheet="${sheetId}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = `/palettes/${sheetId}.css`;
    link.dataset.paletteSheet = sheetId;
    // Switch only once the sheet is in, so the page never shows half a
    // scheme; a failed load leaves the attributes as they were.
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    doc.head.append(link);
  });
}

let latestRequest = 0;

/**
 * Applies a preset and mode to the page and remembers both on this device
 * (the defaults, 70s Warm and Auto, are stored as nothing). Resolves once
 * the scheme's stylesheet has loaded and the page shows it, with the
 * resolved mode.
 */
export async function applyColours(
  { presetId, mode },
  { doc = globalThis.document, storage = globalThis.localStorage, prefersDark = systemPrefersDark() } = {}
) {
  const preset = findColourPreset(presetId);
  const chosenMode = COLOUR_MODES.includes(mode) ? mode : DEFAULT_MODE;
  const resolved = resolveMode(chosenMode, prefersDark);
  const request = ++latestRequest;
  store(PALETTE_STORAGE_KEY, preset.id, preset.id === DEFAULT_PRESET_ID, storage);
  store(MODE_STORAGE_KEY, chosenMode, chosenMode === DEFAULT_MODE, storage);
  const sheetId = variantSheetId(preset.id, resolved);
  if (sheetId) await loadSheet(sheetId, doc);
  // A quicker later choice wins over a sheet that arrives late.
  if (request !== latestRequest) return resolved;
  const root = doc.documentElement;
  root.setAttribute("data-mode", resolved);
  if (preset.id === DEFAULT_PRESET_ID) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", preset.id);
  return resolved;
}
