// The category palette (design.md, "Category palette"): 31 calm colours, one
// per former colour and in the same hue family, each at least 3:1 against
// white so a donut segment or icon reads on the panel. An icon's glyph and a
// label's text mix the colour with the text ink (70% / 62%) to stay legible
// on its own tint. Categories keep the colour they were saved with; the
// category DTO shows a former colour as its calm counterpart, so every page
// and the picker agree without rewriting stored rows.
export const CATEGORY_COLOURS_BY_FORMER: Readonly<Record<string, string>> = Object.freeze({
  "#1F7A63": "#27725F",
  "#C97B47": "#BF7D51",
  "#7C8791": "#7C8791",
  "#8FAE4B": "#7F9B43",
  "#22B573": "#33A471",
  "#D5A24B": "#B88A3D",
  "#B8875D": "#B9875C",
  "#E96A7A": "#D77481",
  "#F08FA0": "#D46377",
  "#F7A21B": "#C0862A",
  "#D4B35D": "#AE8E3D",
  "#4F8FD6": "#5C90C9",
  "#7EBDC2": "#499DA4",
  "#F85A53": "#DE726D",
  "#F062A6": "#DA6DA1",
  "#CC63D8": "#C36ECD",
  "#F08B43": "#D07E43",
  "#567CC9": "#5D7EC2",
  "#A06C5B": "#A96852",
  "#66D2CF": "#3BA19E",
  "#62C7B2": "#40A18D",
  "#7D86F2": "#838BDF",
  "#5EA89B": "#48988A",
  "#8B78E6": "#9385D9",
  "#D56BDD": "#C360CA",
  "#FFA51A": "#A87321",
  "#D86B73": "#C9656D",
  "#C98A5A": "#A66C3F",
  "#717379": "#717379",
  "#56A4C9": "#519ABD",
  "#BDD93C": "#879930",
  "#6A7A73": "#6A7A73"
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
const contrastOnWhite = ([r, g, b]: number[]) => 1.05 / (0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) + 0.05);
const TEXT_INK = [38, 35, 31];

/**
 * A stored category colour as the app shows it: a former colour maps to its
 * calm one; any other colour is kept, darkened toward the text ink only as
 * far as it needs to read 3:1 on white.
 */
export function categoryDisplayColour(storedHex: string | null | undefined): string {
  if (!storedHex || !/^#[0-9a-f]{6}$/i.test(storedHex)) return FALLBACK_CATEGORY_COLOUR;
  const mapped = CATEGORY_COLOURS_BY_FORMER[storedHex.toUpperCase()];
  if (mapped) return mapped;
  const original = [1, 3, 5].map((index) => parseInt(storedHex.slice(index, index + 2), 16));
  let colour = original;
  for (let step = 1; contrastOnWhite(colour) < 3 && step <= 10; step += 1) {
    colour = original.map((value, index) => value * (1 - step / 20) + TEXT_INK[index] * (step / 20));
  }
  return colour === original
    ? storedHex
    : `#${colour.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
