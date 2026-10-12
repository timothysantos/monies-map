import { paletteColour } from "./palette-colour";

// The one colour each person (or owner) has across the app: the Entries
// row edge, the Import inbox owner groups and any later per-person cue.
// Colours come from the 1970s category palette
// (src/domain/category-palette.ts): Tim dusty teal, Joyce mauve, the Splits
// terracotta for rows linked to Splits, and a stable palette pick (olive,
// warm grey, teal, plum) for any other owner such as Shared. These are the
// 70s colours; getPersonColourVars hands them to the page as palette tokens,
// so a colour preset re-colours each person (palette-colour.js).
export function getPersonColour(ownerKey) {
  const normalized = String(ownerKey ?? "").trim().toLowerCase();

  if (normalized.includes("tim")) {
    return "#46788E";
  }

  if (normalized.includes("joyce")) {
    return "#B97680";
  }

  if (normalized === "linked-splits") {
    return "#BF7D51";
  }

  const palette = ["#8B897A", "#6E858A", "#918E54", "#BF7D51", "#376966", "#625A7A"];
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

// A person's colour at the pastel strengths: a solid edge, a chip (tint
// with a darker ink, as the Splits group chips), a soft band and a faint
// wash for alternate lines.
export function getPersonColourVars(ownerKey) {
  const colour = paletteColour(getPersonColour(ownerKey));
  return {
    "--person-colour": colour,
    "--person-chip-bg": `color-mix(in srgb, ${colour} 16%, var(--paper))`,
    "--person-chip-border": `color-mix(in srgb, ${colour} 45%, var(--paper))`,
    "--person-ink": `color-mix(in srgb, ${colour} 55%, var(--text))`,
    "--person-band": `color-mix(in srgb, ${colour} 10%, var(--paper))`,
    "--person-wash": `color-mix(in srgb, ${colour} 6%, var(--paper))`
  };
}
