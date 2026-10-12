// Newer ICU data (Node 22, current browsers) spells September "Sept" in
// en-SG's short form. The app writes "Sep", as every other short month is
// three letters, so every short month or date format passes its text here.
export function shortMonthText(text: string): string {
  return text.replace(/\bSept\b/g, "Sep");
}
