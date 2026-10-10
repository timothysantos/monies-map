// The one colour each person (or owner) has across the app: the Entries
// row edge, the Import inbox owner groups and any later per-person cue.
// Colours come from the category palette (src/domain/category-palette.ts):
// Tim green, Joyce coral, terracotta for rows linked to Splits, and a
// stable palette pick for any other owner such as Shared.
export function getPersonColour(ownerKey) {
  const normalized = String(ownerKey ?? "").trim().toLowerCase();

  if (normalized.includes("tim")) {
    return "#33A471";
  }

  if (normalized.includes("joyce")) {
    return "#DE726D";
  }

  if (normalized === "linked-splits") {
    return "#BF7D51";
  }

  const palette = ["#6A7A73", "#7C8791", "#7F9B43", "#BF7D51", "#48988A", "#9385D9"];
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
  const colour = getPersonColour(ownerKey);
  return {
    "--person-colour": colour,
    "--person-chip-bg": `color-mix(in srgb, ${colour} 16%, white)`,
    "--person-chip-border": `color-mix(in srgb, ${colour} 45%, white)`,
    "--person-ink": `color-mix(in srgb, ${colour} 55%, var(--text))`,
    "--person-band": `color-mix(in srgb, ${colour} 10%, white)`,
    "--person-wash": `color-mix(in srgb, ${colour} 6%, white)`
  };
}
