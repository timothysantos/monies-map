const MONEY_FORMATTER = new Intl.NumberFormat("en-SG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function normalizeSearchQuery(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function searchTokens(value) {
  return normalizeSearchQuery(value)
    .split(" ")
    .filter(Boolean);
}

export function textMatchesSearch(value, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) {
    return true;
  }
  const haystack = ` ${normalizeSearchQuery(value)} `;
  return tokens.every((token) => haystack.includes(token));
}

export function moneySearchText(...amountsMinor) {
  return amountsMinor
    .filter((value) => Number.isFinite(value))
    .map((value) => {
      const absMinor = Math.abs(value);
      const decimal = MONEY_FORMATTER.format(absMinor / 100);
      return `${decimal} ${decimal.replace(/,/g, "")}`;
    })
    .join(" ");
}

export function uniqueSearchSuggestions(values, query = "", limit = 6) {
  const normalizedQuery = normalizeSearchQuery(query);
  const seen = new Set();
  const suggestions = [];

  for (const value of values) {
    const label = String(value ?? "").trim();
    if (!label) {
      continue;
    }
    const key = normalizeSearchQuery(label);
    if (!key || seen.has(key)) {
      continue;
    }
    if (normalizedQuery && !key.includes(normalizedQuery)) {
      continue;
    }
    seen.add(key);
    suggestions.push(label);
    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}
