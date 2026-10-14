// A small built-in word list for everyday spending words ("coffee", "grab",
// "groceries") so a short typed entry gets a sensible category when none of
// the household's own category rules match. It is the second choice, after
// the household's rules (matchCategoryRule), and before the model's
// suggestion and the "Other" default. A word only counts when a category it
// names exists for the household: each group lists the names households
// commonly use, in order of preference, and the first one the household has
// is used. Order matters: the first group whose word appears wins, so "grab
// food" is food, not a taxi.

import { matchCategoryRule } from "./app-repository-category-match-rules";

type Rules = Parameters<typeof matchCategoryRule>[1];

const GROUPS: Array<{ categories: string[]; words: string[] }> = [
  { categories: ["Food & Drinks", "Food and Drinks", "Food & Drink", "Food & Beverage", "Dining", "Eating Out", "Food"], words: ["grab food", "grabfood", "coffee", "kopi", "teh", "latte", "cappuccino", "espresso", "tea", "boba", "bubble tea", "breakfast", "brunch", "lunch", "dinner", "supper", "snack", "snacks", "meal", "food", "drink", "drinks", "cafe", "restaurant", "hawker", "takeaway", "bakery", "beer", "wine", "foodpanda", "deliveroo"] },
  { categories: ["Groceries", "Grocery", "Supermarket"], words: ["groceries", "grocery", "supermarket", "ntuc", "vegetables", "fruit", "fruits", "milk", "eggs"] },
  { categories: ["Taxi", "Transport", "Transportation", "Ride Hailing"], words: ["grab", "gojek", "taxi", "cab", "uber", "ride", "tada", "comfortdelgro"] },
  { categories: ["Public Transport", "Transport", "Transportation"], words: ["mrt", "bus", "ezlink", "ez-link", "train", "transit"] },
  { categories: ["Subscriptions MO", "Subscriptions", "Subscription"], words: ["netflix", "spotify", "disney", "icloud", "chatgpt", "subscription"] },
  { categories: ["Entertainment"], words: ["movie", "movies", "cinema", "concert", "karaoke"] },
  { categories: ["Healthcare", "Health", "Medical"], words: ["doctor", "clinic", "pharmacy", "medicine", "dentist", "hospital"] },
  { categories: ["Bills", "Utilities"], words: ["electricity", "utilities", "wifi", "broadband"] },
  { categories: ["Travel"], words: ["flight", "flights", "hotel", "airbnb", "airline"] },
  { categories: ["Beauty", "Personal Care"], words: ["haircut", "salon", "facial", "manicure"] },
  { categories: ["Sports & Hobbies", "Sports", "Hobbies"], words: ["gym", "tennis", "badminton", "pilates", "yoga"] },
  { categories: ["Gifts", "Gift"], words: ["gift", "gifts", "present"] }
];

function wordSet(text: string) {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  return { lower: ` ${lower} `, words: new Set(lower.split(" ")) };
}

// "Food and Drinks" and "Food & Drinks" are the same name.
const tidy = (name: string) => name.toLowerCase().replace(/\band\b/g, "&").replace(/\s+/g, " ").trim();

// The household's own name for a group's category, or undefined. An empty
// list means "not known" and allows the first (canonical) name.
function householdName(categories: readonly string[], categoryNames: readonly string[]) {
  if (!categoryNames.length) return categories[0];
  for (const name of categories) {
    const found = categoryNames.find((candidate) => tidy(candidate) === tidy(name));
    if (found) return found;
  }
  return undefined;
}

// The category an everyday word in the description points at, or undefined.
// `categoryNames` is the household's categories; an empty list means "not
// known" and allows any.
export function categoryFromEverydayWords(description: string, categoryNames: readonly string[]): string | undefined {
  const { lower, words } = wordSet(description);
  for (const group of GROUPS) {
    const name = householdName(group.categories, categoryNames);
    if (!name) continue;
    if (group.words.some((word) => (word.includes(" ") ? lower.includes(` ${word} `) : words.has(word)))) return name;
  }
  return undefined;
}

// The category a description points at for this household: its own rules
// first, then the everyday words; undefined when nothing fits.
export function categoryFromDescription(description: string, categoryNames: readonly string[], rules: Rules): string | undefined {
  const ruled = description ? matchCategoryRule(description, rules) : undefined;
  if (ruled && ruled !== "Transfer" && (!categoryNames.length || categoryNames.includes(ruled))) return ruled;
  return categoryFromEverydayWords(description, categoryNames);
}
