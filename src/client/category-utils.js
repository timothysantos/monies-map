import { COLOR_OPTIONS, FALLBACK_THEME } from "./ui-options";

export function getCategory(categories, item) {
  if (item.categoryId) {
    const byId = categories.find((category) => category.id === item.categoryId);
    if (byId) {
      return byId;
    }
  }

  if (item.categoryName) {
    const byName = categories.find((category) => category.name === item.categoryName);
    if (byName) {
      return byName;
    }
  }

  return categories.find((category) => category.name === item.label) ?? null;
}

export function getCategorySelectValue(categories, item) {
  const category = getCategory(categories, item);
  return category?.id ?? item.categoryId ?? item.categoryName ?? "";
}

export function getCategoryPatch(categories, value) {
  const category = categories.find((entry) => entry.id === value || entry.name === value);
  if (!category) {
    return {
      categoryId: null,
      categoryName: value
    };
  }

  return {
    categoryId: category.id,
    categoryName: category.name
  };
}

export function getCategoryTheme(categories, item, index) {
  const category = getCategory(categories, item);
  if (category) {
    return {
      color: category.colorHex,
      iconKey: category.iconKey,
      categoryId: category.id
    };
  }

  const fallback = COLOR_OPTIONS[index % COLOR_OPTIONS.length];
  return {
    color: fallback,
    iconKey: FALLBACK_THEME.iconKey,
    categoryId: `fallback-${index}`
  };
}

export function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
