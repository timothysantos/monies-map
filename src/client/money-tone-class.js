// Renders a money tone (src/domain/money-tone.ts) at one of three strengths
// (design.md, "Money colour"), one strength per element:
// - "text": the amount's text only, for lists and tables (the default)
// - "soft": a light tint with the tone's ink, for summary pills, strip items
//   and chips
// - "emphasis": the full pastel fill, for a rare attention banner
// "out" is rose text at every strength (never a fill); "neutral" keeps the
// surrounding ink and surface.
const COLOURED_TONES = new Set(["in", "short", "plan", "caution"]);

export function moneyToneClass(tone, strength = "text") {
  const toneClass = `money-${tone ?? "neutral"}`;
  return strength === "text" || !COLOURED_TONES.has(tone) ? toneClass : `${toneClass} money-${strength}`;
}

// A metric card tints only outcomes; an intention (plan) stays text-only so
// a row of cards does not read as a traffic light.
export function metricCardToneClass(tone) {
  return moneyToneClass(tone, tone === "plan" ? "text" : "soft");
}
