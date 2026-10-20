// How a search box matches text, shared by the page (Entries and Splits
// search) and the Worker (the Splits search inside settled sections,
// pages/splits-settled.ts), so a record is found the same way wherever it
// is searched. Every word of the query must appear in the record's text,
// ignoring case, accents and punctuation; amounts match with or without
// their thousands commas.

const MONEY_FORMATTER = new Intl.NumberFormat("en-SG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function normalizeSearchQuery(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function searchTokens(value: unknown) {
  return normalizeSearchQuery(value)
    .split(" ")
    .filter(Boolean);
}

export function textMatchesSearch(value: unknown, query: unknown) {
  const tokens = searchTokens(query);
  if (!tokens.length) {
    return true;
  }
  const haystack = ` ${normalizeSearchQuery(value)} `;
  return tokens.every((token) => haystack.includes(token));
}

export function moneySearchText(...amountsMinor: Array<number | undefined | null>) {
  return amountsMinor
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => {
      const absMinor = Math.abs(value);
      const decimal = MONEY_FORMATTER.format(absMinor / 100);
      return `${decimal} ${decimal.replace(/,/g, "")}`;
    })
    .join(" ");
}

// The words a split row's search text carries for how it was recorded (the
// row shows them as its chip: messages.splits.linked / .manual).
export const SPLIT_SEARCH_WORDS = { linked: "Linked", manual: "Manual split" };

export interface SplitActivitySearchItem {
  kind?: string;
  date?: string;
  description?: string;
  note?: string;
  categoryName?: string;
  groupName?: string;
  paidByPersonName?: string;
  fromPersonName?: string;
  toPersonName?: string;
  viewerDirectionLabel?: string;
  linkedTransactionDescription?: string;
  linkedTransactionNote?: string;
  linkedTransactionCategoryName?: string;
  matched?: boolean;
  totalAmountMinor?: number;
  amountMinor?: number;
  viewerAmountMinor?: number;
  shares?: Array<{ personName?: string; amountMinor?: number }>;
}

// Everything a split row can be found by.
export function splitActivitySearchText(item: SplitActivitySearchItem) {
  return [
    item.kind,
    item.date,
    item.description,
    item.note,
    item.categoryName,
    item.groupName,
    item.paidByPersonName,
    item.fromPersonName,
    item.toPersonName,
    item.viewerDirectionLabel,
    item.linkedTransactionDescription,
    item.linkedTransactionNote,
    item.linkedTransactionCategoryName,
    item.matched ? SPLIT_SEARCH_WORDS.linked : SPLIT_SEARCH_WORDS.manual,
    moneySearchText(item.totalAmountMinor, item.amountMinor, item.viewerAmountMinor),
    ...(item.shares ?? []).flatMap((share) => [
      share.personName,
      moneySearchText(share.amountMinor)
    ])
  ].filter(Boolean).join(" ");
}

export function splitActivityMatchesSearch(item: SplitActivitySearchItem, query: unknown) {
  return textMatchesSearch(splitActivitySearchText(item), query);
}
