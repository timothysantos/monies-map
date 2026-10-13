// The category palette (design.md, "Category palette"): 31 faded 1970s
// colours (harvest gold, mustard, avocado, olive, rust, burnt orange, tan,
// brown, dusty teal and mauve), one per former colour, each at least 3:1
// against the cream panel so a donut segment or icon reads there. A category's
// surface is a faded tint of its colour, and its ink (an icon's glyph, a
// label's text) mixes the colour with the chocolate text ink (70% / 62%) to
// stay legible on that tint. Categories keep the colour they were saved with;
// the category DTO shows a former or pastel-era colour as its 70s counterpart,
// so every page and the picker agree without rewriting stored rows.
export const CATEGORY_COLOURS_BY_FORMER: Readonly<Record<string, string>> = Object.freeze({
  "#1F7A63": "#566432", // Income: avocado
  "#C97B47": "#AA6647", // Transfer: rust
  "#7C8791": "#6E858A", // Savings: dusty teal (grey)
  "#8FAE4B": "#918E54", // Investments: olive
  "#22B573": "#758C4D", // Salary: avocado
  "#D5A24B": "#B48639", // Extra Income: harvest gold
  "#B8875D": "#A98466", // Other - Income: tan
  "#E96A7A": "#B97680", // Subscriptions MO: mauve (dusty rose)
  "#F08FA0": "#9F667B", // Subscriptions YR: mauve
  "#F7A21B": "#C67D3F", // Food & Drinks: burnt orange
  "#D4B35D": "#A58F45", // Healthcare: mustard
  "#4F8FD6": "#46788E", // Family & Personal: dusty teal (denim)
  "#7EBDC2": "#699696", // Baby & Kids: dusty teal
  "#F85A53": "#C36351", // Home: rust
  "#F062A6": "#A77899", // Church: mauve
  "#CC63D8": "#7A587D", // Tax: mauve (plum)
  "#F08B43": "#B16739", // Groceries: burnt orange
  "#567CC9": "#2C627C", // Travel: dusty teal (denim)
  "#A06C5B": "#7E584A", // Loans: brown
  "#66D2CF": "#619989", // Sports & Hobbies: dusty teal (sea green)
  "#62C7B2": "#53806F", // Bills: dusty teal (sea green)
  "#7D86F2": "#7C7998", // Education: mauve (lilac)
  "#5EA89B": "#376966", // Insurance: dusty teal
  "#8B78E6": "#625A7A", // Fees: mauve (plum)
  "#D56BDD": "#816C93", // Beauty: mauve (orchid)
  "#FFA51A": "#986C29", // Entertainment: harvest gold
  "#D86B73": "#92535F", // Shopping: mauve (dusty rose)
  "#C98A5A": "#8E6849", // Gifts: tan
  "#717379": "#7D7369", // Other: brown (warm grey)
  "#56A4C9": "#568C99", // Public Transport: dusty teal
  "#BDD93C": "#7E7541", // Taxi: olive
  "#6A7A73": "#8B897A" // fallback: olive (warm grey)
});

// The calm pastel colours the picker offered before the 1970s palette
// (2026-10). A category saved with one shows as the 70s colour of the former
// colour it replaced. Three greys were kept unchanged then, so their former
// entry above already covers them.
const CATEGORY_COLOURS_BY_PASTEL: Readonly<Record<string, string>> = Object.freeze({
  "#27725F": "#566432",
  "#BF7D51": "#AA6647",
  "#7F9B43": "#918E54",
  "#33A471": "#758C4D",
  "#B88A3D": "#B48639",
  "#B9875C": "#A98466",
  "#D77481": "#B97680",
  "#D46377": "#9F667B",
  "#C0862A": "#C67D3F",
  "#AE8E3D": "#A58F45",
  "#5C90C9": "#46788E",
  "#499DA4": "#699696",
  "#DE726D": "#C36351",
  "#DA6DA1": "#A77899",
  "#C36ECD": "#7A587D",
  "#D07E43": "#B16739",
  "#5D7EC2": "#2C627C",
  "#A96852": "#7E584A",
  "#3BA19E": "#619989",
  "#40A18D": "#53806F",
  "#838BDF": "#7C7998",
  "#48988A": "#376966",
  "#9385D9": "#625A7A",
  "#C360CA": "#816C93",
  "#A87321": "#986C29",
  "#C9656D": "#92535F",
  "#A66C3F": "#8E6849",
  "#519ABD": "#568C99",
  "#879930": "#7E7541"
});

const FORMER_FALLBACK = "#6A7A73";

/** The colours a category can take, in the picker's order. */
export const CATEGORY_COLOURS: readonly string[] = Object.freeze(
  Object.entries(CATEGORY_COLOURS_BY_FORMER)
    .filter(([former]) => former !== FORMER_FALLBACK)
    .map(([, colour]) => colour)
);

export const FALLBACK_CATEGORY_COLOUR = CATEGORY_COLOURS_BY_FORMER[FORMER_FALLBACK];

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
// The cream panel (--panel over --bg in public/styles.css) and the
// chocolate text ink (--text).
const PANEL_LUMINANCE = luminance([254, 251, 245]);
const contrastOnPanel = (colour: number[]) => (PANEL_LUMINANCE + 0.05) / (luminance(colour) + 0.05);
const TEXT_INK = [59, 42, 31];

/**
 * A stored category colour as the app shows it: a former or pastel-era colour
 * maps to its 70s one; any other colour is kept, darkened toward the text ink
 * only as far as it needs to read 3:1 on the cream panel.
 */
export function categoryDisplayColour(storedHex: string | null | undefined): string {
  if (!storedHex || !/^#[0-9a-f]{6}$/i.test(storedHex)) return FALLBACK_CATEGORY_COLOUR;
  const key = storedHex.toUpperCase();
  const mapped = CATEGORY_COLOURS_BY_FORMER[key] ?? CATEGORY_COLOURS_BY_PASTEL[key];
  if (mapped) return mapped;
  const original = [1, 3, 5].map((index) => parseInt(storedHex.slice(index, index + 2), 16));
  let colour = original;
  for (let step = 1; contrastOnPanel(colour) < 3 && step <= 10; step += 1) {
    colour = original.map((value, index) => value * (1 - step / 20) + TEXT_INK[index] * (step / 20));
  }
  return colour === original
    ? storedHex
    : `#${colour.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
