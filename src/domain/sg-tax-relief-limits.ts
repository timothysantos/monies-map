// Singapore income tax relief limits (DOMAIN.md "Tax Relief"): the one
// place the Tax reliefs card and its December reminder read them. A dated
// list, one entry per relief year (the calendar year the money lands in; it
// counts for the tax filed the year after).
//
// CHECK AGAINST IRAS EVERY YEAR, before 1 December: add the new year's entry
// (copy the last one and change what IRAS changed). A year with no entry
// falls back to the latest known year, and the card's footnote says so.
// No Settings screen: a change here is a code change, reviewed like any other.

export interface TaxReliefLimits {
  // The relief year these limits are for.
  year: number;
  // Supplementary Retirement Scheme cash top-ups, for a Singapore citizen or
  // permanent resident (a foreigner's cap is higher; the app assumes
  // citizen or PR).
  srsMinor: number;
  // CPF cash top-up to one's own CPF.
  cpfSelfMinor: number;
  // CPF cash top-up to family members' CPF (a separate cap).
  cpfFamilyMinor: number;
  // Gifts to approved charities are deducted at this many times the gift.
  charityTimes: number;
  // Where the figures come from.
  source: string;
}

// The figures the owner approved on 2026-11-10 with the card's design, as
// IRAS publishes them on its pages on the Supplementary Retirement Scheme,
// CPF Cash Top-up Relief and tax deductions for donations. Each new year's
// entry must be checked against those IRAS pages.
export const SG_TAX_RELIEF_LIMITS: readonly TaxReliefLimits[] = Object.freeze([
  {
    year: 2026,
    srsMinor: 1_530_000,
    cpfSelfMinor: 800_000,
    cpfFamilyMinor: 800_000,
    charityTimes: 2.5,
    source: "IRAS (SRS, CPF Cash Top-up Relief, donations); owner-approved 2026-11-10; check again for 2027"
  }
]);

/**
 * The limits for a relief year: its own entry, or the latest known year's
 * before it (`fallback` true) when the app has none for it yet. A year
 * before the first entry reads the first entry, also marked `fallback`.
 */
export function taxReliefLimitsFor(year: number, list: readonly TaxReliefLimits[] = SG_TAX_RELIEF_LIMITS): TaxReliefLimits & { fallback: boolean } {
  const sorted = [...list].sort((left, right) => left.year - right.year);
  const exact = sorted.find((entry) => entry.year === year);
  if (exact) {
    return { ...exact, fallback: false };
  }
  const before = sorted.filter((entry) => entry.year < year);
  return { ...(before[before.length - 1] ?? sorted[0]), fallback: true };
}
