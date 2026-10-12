// A category, person or split group colour as the active colour preset
// shows it (design.md, "Colour presets"). Every one of these colours comes
// from the category palette (src/domain/category-palette.ts), so a preset
// re-colours them all with one token per palette colour, --cat-<hex>, set in
// its stylesheet (public/palettes/<preset>.css). The 70s default sets none,
// so the token falls back to the colour itself; a custom colour no preset
// knows also stays as it is.
export function paletteColour(hex) {
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)
    ? `var(--cat-${hex.slice(1).toLowerCase()}, ${hex})`
    : hex;
}
