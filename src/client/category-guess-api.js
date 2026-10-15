// The best-guess category for a description (POST /api/entries/category-
// guess, DOMAIN.md "Category Guess"). Read only and fails soft: any error,
// refusal or unreadable answer is no guess. Loaded with the category list.

export const CATEGORY_GUESS_ENDPOINT = "/api/entries/category-guess";

/** The guessed category name, or null. */
export async function requestCategoryGuess(description, { signal = undefined, fetchImpl = fetch } = {}) {
  const text = String(description ?? "").trim();
  if (!text || text.length > 240) {
    return null;
  }
  try {
    const response = await fetchImpl(CATEGORY_GUESS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: text }),
      signal
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    const name = body?.ok === true ? body.guess?.categoryName : null;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}
