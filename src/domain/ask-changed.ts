// "What changed?" (Ask's `changed` question; owner-approved addition to
// "Is that more than usual?", 2026-11-10): a month's spending against the
// month before (or, when the person said "usual", against each category's
// usual month, the middle of the 6 before), by category and, inside each
// category, the shops behind its difference. The biggest increases first,
// then the biggest decreases, at most 5 of each. Pure: the loader reads the
// view's entries of the 7 months; the model only says the month as a word.
// It looks back only: nothing here predicts.
import { payeeKey, payeeName } from "./account-routines";
import { spendingMinor } from "./category-offset";
import { addMonths } from "./money-signals/format";
import { medianOf, usualHistoryMonths, type UsualEntry } from "./ask-usual";
import type { AskAnswerCardDto, AskAnswerLineDto, PersonScope } from "../types/dto";

export const CHANGED_MAX_ROWS = 5;
export const CHANGED_MAX_SHOPS = 2;

export interface ChangedRow {
  category: string;
  // This month's spending in the category, the figure its line shows (its
  // entries open with View entries: money-figures.ts "changed").
  amountMinor: number;
  ids: string[];
  baseMinor: number;
  diffMinor: number;
  shops: Array<{ name: string; diffMinor: number }>;
}

export interface ChangedFacts {
  kind: "changed";
  month: string;
  base: "previous" | "usual";
  baseLabel: string;
  viewId: string;
  scope: PersonScope;
  amountMinor: number;
  baseMinor: number;
  increases: ChangedRow[];
  decreases: ChangedRow[];
  entryCount: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWord = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
const spend = (entry: UsualEntry) => spendingMinor({ entryType: entry.entryType, categoryName: entry.categoryName, amountMinor: entry.amountMinor });

export function buildChangedFacts(input: {
  month: string;
  base: "previous" | "usual";
  viewId: string;
  scope: PersonScope;
  entries: UsualEntry[];
  trackedMonths: string[];
  // Today: the month in progress is compared up to this day of the month.
  today?: string;
}): ChangedFacts {
  const { month } = input;
  const previous = addMonths(month, -1);
  const soFar = input.today && input.today.slice(0, 7) === month ? Number(input.today.slice(8, 10)) : null;
  const history = usualHistoryMonths(month).filter((item) => input.trackedMonths.includes(item));
  const counted = input.entries.filter((entry) => spend(entry) !== 0
    && (soFar === null || Number(entry.date.slice(8, 10)) <= soFar || entry.date.slice(0, 7) === month && entry.date <= input.today!));
  const inMonth = (item: string) => counted.filter((entry) => entry.date.slice(0, 7) === item);
  const sum = (list: UsualEntry[]) => list.reduce((total, entry) => total + spend(entry), 0);
  const current = inMonth(month);
  // The base of one group of entries (a category, or a shop in it).
  const baseOf = (pick: (entry: UsualEntry) => boolean) => (input.base === "previous"
    ? sum(inMonth(previous).filter(pick))
    : Math.round(medianOf(history.map((item) => sum(inMonth(item).filter(pick))))));

  const categories = [...new Set([...current, ...inMonth(previous), ...(input.base === "usual" ? history.flatMap(inMonth) : [])].map((entry) => entry.categoryName))];
  const rows: ChangedRow[] = categories.map((category) => {
    const inCategory = (entry: UsualEntry) => entry.categoryName === category;
    const now = current.filter(inCategory);
    const amountMinor = sum(now);
    const baseMinor = baseOf(inCategory);
    const keys = [...new Set([...now, ...inMonth(previous).filter(inCategory)].map((entry) => payeeKey(entry.description)).filter(Boolean))];
    const shops = keys.map((key) => {
      const ofShop = (entry: UsualEntry) => inCategory(entry) && payeeKey(entry.description) === key;
      const sample = counted.find(ofShop);
      return { name: payeeName(sample?.description ?? key) || key, diffMinor: sum(now.filter(ofShop)) - baseOf(ofShop) };
    });
    const diffMinor = amountMinor - baseMinor;
    const behind = shops
      .filter((shop) => Math.sign(shop.diffMinor) === Math.sign(diffMinor) && shop.diffMinor !== 0)
      .sort((left, right) => Math.abs(right.diffMinor) - Math.abs(left.diffMinor) || left.name.localeCompare(right.name))
      .slice(0, CHANGED_MAX_SHOPS);
    return { category, amountMinor, ids: now.map((entry) => entry.id).sort(), baseMinor, diffMinor, shops: behind };
  });
  const byChange = (left: ChangedRow, right: ChangedRow) => Math.abs(right.diffMinor) - Math.abs(left.diffMinor) || left.category.localeCompare(right.category);
  return {
    kind: "changed",
    month,
    base: input.base,
    baseLabel: input.base === "previous" ? monthWord(previous) : "Usual",
    viewId: input.viewId,
    scope: input.scope,
    amountMinor: sum(current),
    baseMinor: input.base === "previous" ? sum(inMonth(previous)) : Math.round(medianOf(history.map((item) => sum(inMonth(item))))),
    increases: rows.filter((row) => row.diffMinor > 0).sort(byChange).slice(0, CHANGED_MAX_ROWS),
    decreases: rows.filter((row) => row.diffMinor < 0).sort(byChange).slice(0, CHANGED_MAX_ROWS),
    entryCount: current.length
  };
}

const signed = (money: (minor: number) => string, minor: number) => `${minor >= 0 ? "+" : "-"}${money(Math.abs(minor))}`;

function line(row: ChangedRow, facts: ChangedFacts, money: (minor: number) => string): AskAnswerLineDto {
  const shops = row.shops.map((shop) => `${shop.name} ${signed(money, shop.diffMinor)}`).join(", ");
  return {
    label: row.category,
    detail: `${row.diffMinor > 0 ? "up" : "down"} ${money(Math.abs(row.diffMinor))}${shops ? ` · ${shops}` : ""}`,
    amountMinor: row.amountMinor,
    currency: "SGD",
    tone: "out",
    secondary: { kind: "compare", label: facts.baseLabel, amountMinor: row.baseMinor },
    figure: { ids: row.ids, period: `${facts.month}:${facts.month}` }
  };
}

export function buildChangedCard(facts: ChangedFacts, money: (minor: number) => string): AskAnswerCardDto {
  return {
    title: `What changed in ${monthWord(facts.month)}`,
    lead: { label: `Spent in ${monthWord(facts.month)}`, amountMinor: facts.amountMinor, currency: "SGD", tone: "neutral" },
    support: [{ label: facts.baseLabel, amountMinor: facts.baseMinor, currency: "SGD" }],
    lines: [...facts.increases, ...facts.decreases].map((row) => line(row, facts, money)),
    links: [{
      kind: "entries",
      label: "Open in Entries",
      filter: { month: facts.month, viewId: facts.viewId, scope: facts.scope, search: "", categories: [], wallets: [], type: "expense", minAmountMinor: null, maxAmountMinor: null }
    }]
  };
}

export function buildChangedWording(facts: ChangedFacts, money: (minor: number) => string): string {
  const month = monthWord(facts.month);
  const against = facts.base === "previous" ? facts.baseLabel : "your usual month";
  const diff = facts.amountMinor - facts.baseMinor;
  const sentences = [diff === 0
    ? `${month} came to ${money(facts.amountMinor)}, the same as ${against}.`
    : `${month} came to ${money(facts.amountMinor)}, ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${against}.`];
  const name = (row: ChangedRow) => `${row.category} (${signed(money, row.diffMinor)}${row.shops[0] ? `, mostly ${row.shops[0].name}` : ""})`;
  const list = (rows: ChangedRow[]) => (rows.length > 1 ? `${rows.slice(0, -1).map(name).join(", ")} and ${name(rows.at(-1)!)}` : name(rows[0]));
  if (facts.increases.length) sentences.push(`The biggest rises were ${list(facts.increases.slice(0, 3))}.`);
  if (facts.decreases.length) sentences.push(`The biggest falls were ${list(facts.decreases.slice(0, 3))}.`);
  if (!facts.increases.length && !facts.decreases.length) sentences.push("No category moved.");
  return sentences.join(" ");
}

export function buildChangedPromptFacts(facts: ChangedFacts, money: (minor: number) => string): string[] {
  return [
    `Spent in ${monthWord(facts.month)}: ${money(facts.amountMinor)}`,
    `${facts.baseLabel}: ${money(facts.baseMinor)}; difference ${money(Math.abs(facts.amountMinor - facts.baseMinor))}`,
    ...[...facts.increases, ...facts.decreases].map((row) => `${row.category}: ${money(row.amountMinor)} against ${money(row.baseMinor)}, ${row.diffMinor > 0 ? "up" : "down"} ${money(Math.abs(row.diffMinor))}${row.shops.length ? `; ${row.shops.map((shop) => `${shop.name} ${money(Math.abs(shop.diffMinor))}`).join(", ")}` : ""}`)
  ];
}
