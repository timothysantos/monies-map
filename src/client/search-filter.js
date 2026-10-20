// The matching rules live in the domain (search-text.ts) so the Worker's
// Splits search inside settled sections finds a record the same way.
import { normalizeSearchQuery } from "../domain/search-text";

export { moneySearchText, normalizeSearchQuery, searchTokens, textMatchesSearch } from "../domain/search-text";

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
