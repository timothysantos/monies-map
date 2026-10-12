// Colour presets (design.md, "Colour presets"): whole colour schemes a
// person picks per device in Settings > Colours. The 70s Warm default lives
// in :root of public/styles.css; every other preset is one small stylesheet,
// public/palettes/<id>.css, that overrides the same tokens under
// :root[data-palette="<id>"] and loads only when it is chosen. A stored
// choice is applied before the first paint by the inline script in
// index.html, which keeps its own copy of the ids (checked by
// tests/colour-presets.test.mjs).
//
// `swatches` are the four dots on the preset's chip in Settings: the page
// background, the accent, money in and money out.
export const DEFAULT_PRESET_ID = "70s";
export const PALETTE_STORAGE_KEY = "monies-map:palette";

export const COLOUR_PRESETS = Object.freeze([
  { id: "70s", name: "70s Warm", scheme: "light", swatches: ["#eee4cf", "#b15e2f", "#4c5e1a", "#973223"] },
  { id: "60s", name: "60s Mod", scheme: "light", swatches: ["#f2ebdc", "#127a74", "#485a10", "#a8321f"] },
  { id: "80s", name: "80s Pop", scheme: "light", swatches: ["#efecf6", "#b0198a", "#08684f", "#a3154f"] },
  { id: "modern", name: "Modern", scheme: "light", swatches: ["#f3f4f6", "#4f46e5", "#065f46", "#be123c"] },
  { id: "mono", name: "Black & White", scheme: "light", swatches: ["#f0f0f0", "#1a1a1a", "#000000", "#3b3b3b"] },
  { id: "code", name: "Code", scheme: "dark", swatches: ["#0d1117", "#56d4dd", "#56d364", "#ff7b72"] }
]);

export function findColourPreset(id) {
  return COLOUR_PRESETS.find((preset) => preset.id === id) ?? COLOUR_PRESETS[0];
}

/** The preset this device chose, or the default when storage is empty or blocked. */
export function readStoredPresetId(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(PALETTE_STORAGE_KEY);
    return COLOUR_PRESETS.some((preset) => preset.id === stored) ? stored : DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

function storePresetId(id, storage) {
  try {
    if (id === DEFAULT_PRESET_ID) storage?.removeItem(PALETTE_STORAGE_KEY);
    else storage?.setItem(PALETTE_STORAGE_KEY, id);
  } catch {
    // Storage blocked (private mode, a locked-down browser): the choice
    // still applies to this page, it just isn't remembered.
  }
}

function loadPresetSheet(id, doc) {
  const existing = doc.querySelector(`link[data-palette-sheet="${id}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = `/palettes/${id}.css`;
    link.dataset.paletteSheet = id;
    // Switch only once the sheet is in, so the page never shows half a
    // preset; a failed load leaves the attribute on the default tokens.
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    doc.head.append(link);
  });
}

/**
 * Applies a preset to the page and remembers it on this device. Resolves
 * once the preset's stylesheet has loaded and the page shows it.
 */
let latestRequest = 0;

export async function applyColourPreset(id, { doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  const preset = findColourPreset(id);
  const request = ++latestRequest;
  storePresetId(preset.id, storage);
  const root = doc.documentElement;
  if (preset.id !== DEFAULT_PRESET_ID) await loadPresetSheet(preset.id, doc);
  // A quicker later choice wins over a sheet that arrives late.
  if (request !== latestRequest) return preset.id;
  if (preset.id === DEFAULT_PRESET_ID) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", preset.id);
  return preset.id;
}
