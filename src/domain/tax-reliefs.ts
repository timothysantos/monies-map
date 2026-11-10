// Tax reliefs this year (DOMAIN.md "Tax Relief"; design.md "Tax reliefs"):
// for each person, what they put into the reliefs that lower next year's
// Singapore income tax, against each yearly limit (sg-tax-relief-limits.ts),
// and the room left before 31 December. It never says how much tax that
// saves (the app does not know anyone's income) and never advises.
//
// How an entry counts (owner decision D2, 2026-11-10): three categories,
// `SRS top-up`, `CPF top-up` and `Charity gift`, mark it, through
// - an expense's category, or
// - a transfer out's purpose (`transfer_purpose_category_id`), or its own
//   category when it has no purpose.
// It counts for its owner, at its whole amount, in the year of its date. A
// CPF top-up is "for family" when the transfer's purpose person
// (`transfer_purpose_person_id`) is someone other than the owner, else "for
// yourself". Money in (a refund) and entries with no owner are never
// counted. Pure: the loader (pages/tax-reliefs.ts) reads the rows.

import { taxReliefLimitsFor } from "./sg-tax-relief-limits";

export type TaxReliefKey = "srs" | "cpf_self" | "cpf_family";
export const TAX_RELIEF_KEYS: readonly TaxReliefKey[] = ["srs", "cpf_self", "cpf_family"];

type CategoryKind = "srs" | "cpf" | "charity";

// The three categories, as the seed names them (demo-data.ts), matched on
// their name without case, spaces or hyphens so "SRS Top Up" is the same.
export const TAX_RELIEF_CATEGORY_NAMES = { srs: "SRS top-up", cpf: "CPF top-up", charity: "Charity gift" } as const;
const KIND_BY_KEY: Record<string, CategoryKind> = { srstopup: "srs", cpftopup: "cpf", charitygift: "charity" };
export const TAX_RELIEF_CATEGORY_KEYS = Object.keys(KIND_BY_KEY);

export function taxReliefCategoryKind(name?: string | null): CategoryKind | null {
  return KIND_BY_KEY[String(name ?? "").toLowerCase().replace(/[\s-]+/g, "")] ?? null;
}

export interface TaxReliefRow {
  id: string;
  date: string;
  entryType: string;
  transferDirection?: string | null;
  amountMinor: number;
  ownerPersonId?: string | null;
  categoryName?: string | null;
  purposeCategoryName?: string | null;
  purposePersonId?: string | null;
}

export interface TaxReliefFigure {
  amountMinor: number;
  ids: string[];
}

export interface TaxReliefLine extends TaxReliefFigure {
  key: TaxReliefKey;
  limitMinor: number;
  roomMinor: number;
}

export interface TaxReliefPerson {
  personId: string;
  name: string;
  reliefs: TaxReliefLine[];
  charity: TaxReliefFigure & { deductionMinor: number };
}

export interface TaxReliefsYear {
  year: string;
  daysLeft: number;
  limitsYear: string;
  limitsFallback: boolean;
  charityTimes: number;
  people: TaxReliefPerson[];
}

/** The relief an entry counts for, and whose it is; null when it counts for none. */
export function classifyTaxReliefRow(row: TaxReliefRow): { personId: string; kind: TaxReliefKey | "charity" } | null {
  const isOut = row.entryType === "expense" || (row.entryType === "transfer" && row.transferDirection === "out");
  if (!isOut || !(row.amountMinor > 0) || !row.ownerPersonId) {
    return null;
  }
  const purposeKind = row.entryType === "transfer" ? taxReliefCategoryKind(row.purposeCategoryName) : null;
  const kind = purposeKind ?? taxReliefCategoryKind(row.categoryName);
  if (!kind) {
    return null;
  }
  if (kind === "cpf") {
    const forFamily = Boolean(purposeKind && row.purposePersonId && row.purposePersonId !== row.ownerPersonId);
    return { personId: row.ownerPersonId, kind: forFamily ? "cpf_family" : "cpf_self" };
  }
  return { personId: row.ownerPersonId, kind };
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Days from today to 31 December, 0 on the day itself. */
export function taxReliefDaysLeft(today: string) {
  return Math.max(0, daysBetween(today, `${today.slice(0, 4)}-12-31`));
}

/**
 * Each person's reliefs this year (today's year), in the order `people`
 * gives. `rows` are the year's candidate entries (the loader narrows them
 * to the three categories).
 */
export function buildTaxReliefsYear({ today, people, rows }: { today: string; people: Array<{ id: string; name: string }>; rows: TaxReliefRow[] }): TaxReliefsYear {
  const year = today.slice(0, 4);
  const limits = taxReliefLimitsFor(Number(year));
  const limitOf: Record<TaxReliefKey, number> = { srs: limits.srsMinor, cpf_self: limits.cpfSelfMinor, cpf_family: limits.cpfFamilyMinor };
  const figures = new Map<string, Record<TaxReliefKey | "charity", TaxReliefFigure>>();
  const empty = () => ({ srs: { amountMinor: 0, ids: [] }, cpf_self: { amountMinor: 0, ids: [] }, cpf_family: { amountMinor: 0, ids: [] }, charity: { amountMinor: 0, ids: [] } });
  for (const person of people) {
    figures.set(person.id, empty());
  }
  for (const row of rows) {
    if (!row.date.startsWith(year)) continue;
    const counted = classifyTaxReliefRow(row);
    const own = counted ? figures.get(counted.personId) : undefined;
    if (!counted || !own) continue;
    own[counted.kind].amountMinor += row.amountMinor;
    own[counted.kind].ids.push(row.id);
  }
  return {
    year,
    daysLeft: taxReliefDaysLeft(today),
    limitsYear: String(limits.year),
    limitsFallback: limits.fallback,
    charityTimes: limits.charityTimes,
    people: people.map((person) => {
      const own = figures.get(person.id) ?? empty();
      return {
        personId: person.id,
        name: person.name,
        reliefs: TAX_RELIEF_KEYS.map((key) => ({
          key,
          amountMinor: own[key].amountMinor,
          ids: [...own[key].ids].sort(),
          limitMinor: limitOf[key],
          roomMinor: Math.max(0, limitOf[key] - own[key].amountMinor)
        })),
        charity: {
          amountMinor: own.charity.amountMinor,
          ids: [...own.charity.ids].sort(),
          deductionMinor: Math.round(own.charity.amountMinor * limits.charityTimes)
        }
      };
    })
  };
}

/** Whether anyone put anything into a relief this year (else the card shows nothing). */
export function hasTaxReliefs(year: TaxReliefsYear) {
  return year.people.some((person) => person.charity.amountMinor > 0 || person.reliefs.some((relief) => relief.amountMinor > 0));
}

/**
 * The December reminder's facts (DOMAIN.md "Tax Relief", owner decision
 * 2026-11-10): from 1 to 31 December, each relief a person has started this
 * year (more than $0) and not filled. Never a relief nobody used: the app
 * shows room, it does not suggest starting one. Empty outside December.
 */
export function taxReliefRoomLeft(year: TaxReliefsYear, today: string) {
  if (today.slice(0, 4) !== year.year || today.slice(5, 7) !== "12") {
    return [];
  }
  return year.people.flatMap((person) => person.reliefs
    .filter((relief) => relief.amountMinor > 0 && relief.roomMinor > 0)
    .map((relief) => ({ personId: person.personId, name: person.name, key: relief.key, roomMinor: relief.roomMinor })));
}
