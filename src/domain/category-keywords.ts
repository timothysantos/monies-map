// A small built-in word list for everyday spending words ("coffee", "grab",
// "groceries") so a short typed entry gets a sensible category when none of
// the household's own category rules match. It is the second choice, after
// the household's rules (matchCategoryRule), and before the model's
// suggestion and the "Other" default. A word only counts when the category
// it names exists for the household. Order matters: the first group whose
// word appears wins, so "grab food" is food, not a taxi.

const GROUPS: Array<{ category: string; words: string[] }> = [
  { category: "Food & Drinks", words: ["grab food", "grabfood", "coffee", "kopi", "teh", "latte", "cappuccino", "espresso", "tea", "boba", "bubble tea", "breakfast", "brunch", "lunch", "dinner", "supper", "snack", "snacks", "meal", "food", "drink", "drinks", "cafe", "restaurant", "hawker", "takeaway", "bakery", "beer", "wine", "foodpanda", "deliveroo"] },
  { category: "Groceries", words: ["groceries", "grocery", "supermarket", "ntuc", "vegetables", "fruit", "fruits", "milk", "eggs"] },
  { category: "Taxi", words: ["grab", "gojek", "taxi", "cab", "uber", "ride", "tada", "comfortdelgro"] },
  { category: "Public Transport", words: ["mrt", "bus", "ezlink", "ez-link", "train", "transit"] },
  { category: "Subscriptions MO", words: ["netflix", "spotify", "disney", "icloud", "chatgpt", "subscription"] },
  { category: "Entertainment", words: ["movie", "movies", "cinema", "concert", "karaoke"] },
  { category: "Healthcare", words: ["doctor", "clinic", "pharmacy", "medicine", "dentist", "hospital"] },
  { category: "Bills", words: ["electricity", "utilities", "wifi", "broadband"] },
  { category: "Travel", words: ["flight", "flights", "hotel", "airbnb", "airline"] },
  { category: "Beauty", words: ["haircut", "salon", "facial", "manicure"] },
  { category: "Sports & Hobbies", words: ["gym", "tennis", "badminton", "pilates", "yoga"] },
  { category: "Gifts", words: ["gift", "gifts", "present"] }
];

function wordSet(text: string) {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  return { lower: ` ${lower} `, words: new Set(lower.split(" ")) };
}

// The category an everyday word in the description points at, or undefined.
// `categoryNames` is the household's categories; an empty list means "not
// known" and allows any.
export function categoryFromEverydayWords(description: string, categoryNames: readonly string[]): string | undefined {
  const { lower, words } = wordSet(description);
  for (const group of GROUPS) {
    if (categoryNames.length && !categoryNames.includes(group.category)) continue;
    if (group.words.some((word) => (word.includes(" ") ? lower.includes(` ${word} `) : words.has(word)))) return group.category;
  }
  return undefined;
}
