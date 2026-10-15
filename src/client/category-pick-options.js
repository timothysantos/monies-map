// The options a category list is given, from the household's categories (or
// the `{ name, iconKey, colorHex }` rows a form already holds). The list draws
// each category's icon from `iconKey`. Kept apart from the list so a screen
// can build its options without loading it.

/**
 * @param {Array<{ name: string, iconKey?: string, colorHex?: string }>} categories
 * @param {{ without?: string[], valueKey?: "name" | "id" }} [settings]
 */
export function categoryPickOptions(categories, { without = [], valueKey = "name" } = {}) {
  return categories
    .filter((category) => !without.includes(category.name))
    .map((category) => ({ value: category[valueKey], label: category.name, iconKey: category.iconKey, colorHex: category.colorHex }));
}
