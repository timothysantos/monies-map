// Every request Ask's habits make (src/server/ask-habits-routes.ts). No AI
// anywhere: these read and write structured habits and the "Done for you"
// log. Readers fail soft: any error or unreadable answer is no suggestion,
// an empty list, or { ok: false, error } for a person-run action.

const JSON_HEADERS = { "Content-Type": "application/json" };

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function postJson(path, body, fallbackError, fetchImpl) {
  try {
    const response = await fetchImpl(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const data = await readJson(response);
    return response.ok ? { ok: true, ...(data ?? {}) } : { ok: false, error: data?.error ?? fallbackError };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

/**
 * @typedef {{ id: string, kind: "category" | "split" | "note", entryId: string, entryDescription: string, summary: string, habitId: string, from: string | null, to: string | null, splitExpenseId: string | null, at: string, undone: boolean }} DoneItem
 * @typedef {{ entryId: string, text: string, category: { habitId: string, categoryName: string } | null, split: { habitId: string, groupId: string | null, firstPersonBasisPoints: number } | null }} HabitSuggestion
 */

/** @returns {DoneItem | null} */
function readDoneItem(item) {
  if (!isObject(item) || typeof item.id !== "string" || !["category", "split", "note"].includes(item.kind)) {
    return null;
  }
  if ([item.entryId, item.entryDescription, item.summary, item.at].some((value) => typeof value !== "string")) {
    return null;
  }
  return {
    id: item.id,
    kind: item.kind,
    entryId: item.entryId,
    entryDescription: item.entryDescription,
    summary: item.summary,
    habitId: typeof item.habitId === "string" ? item.habitId : "",
    from: typeof item.from === "string" ? item.from : null,
    to: typeof item.to === "string" ? item.to : null,
    splitExpenseId: typeof item.splitExpenseId === "string" ? item.splitExpenseId : null,
    at: item.at,
    undone: item.undone === true
  };
}

/** @returns {DoneItem[]} */
export function readDoneItems(body) {
  return body?.ok === true && Array.isArray(body.items) ? body.items.map(readDoneItem).filter((item) => item !== null) : [];
}

/** @returns {HabitSuggestion | null} */
export function readHabitSuggestion(value) {
  if (!isObject(value) || typeof value.entryId !== "string" || typeof value.text !== "string" || !value.text) {
    return null;
  }
  const category = isObject(value.category) && typeof value.category.categoryName === "string" && typeof value.category.habitId === "string"
    ? { habitId: value.category.habitId, categoryName: value.category.categoryName }
    : null;
  const split = isObject(value.split) && typeof value.split.habitId === "string" && Number.isInteger(value.split.firstPersonBasisPoints)
    ? { habitId: value.split.habitId, groupId: typeof value.split.groupId === "string" ? value.split.groupId : null, firstPersonBasisPoints: value.split.firstPersonBasisPoints }
    : null;
  return category || split ? { entryId: value.entryId, text: value.text, category, split } : null;
}

// Ask opened on a saved entry: Ask handles what the safe set allows (the
// server decides) and returns what it did and the one suggestion left.
export async function requestEntryHabits(entryId, { signal = undefined, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl("/api/ask/entry-habits", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId }), signal });
    const body = response.ok ? await readJson(response) : null;
    return body?.ok === true ? { done: readDoneItems({ ok: true, items: body.done }), suggestion: readHabitSuggestion(body.suggestion) } : null;
  } catch {
    return null;
  }
}

export async function requestDoneForYou({ signal = undefined, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl("/api/ask/done", { cache: "no-store", signal });
    return response.ok ? readDoneItems(await readJson(response)) : [];
  } catch {
    return [];
  }
}

export function undoDoneForYou(id, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/done/undo", { id }, "That could not be undone.", fetchImpl);
}

// The suggestion's cross, and "Stop doing this": best effort for the cross.
export function declineHabit(habitId, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/decline", { id: habitId }, "That could not be saved.", fetchImpl);
}

export function stopHabit(habitId, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/delete", { id: habitId }, "That could not be stopped.", fetchImpl);
}

// Settings' "What Ask remembers".
export async function requestHabitsOverview({ signal = undefined, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl("/api/ask/habits", { cache: "no-store", signal });
    const body = response.ok ? await readJson(response) : null;
    if (body?.ok !== true || !Array.isArray(body.habits)) {
      return null;
    }
    return {
      available: body.available === true,
      enabled: body.enabled !== false,
      habits: body.habits.filter((habit) => isObject(habit) && typeof habit.id === "string" && typeof habit.label === "string" && typeof habit.text === "string"),
      people: Array.isArray(body.people) ? body.people.filter((person) => isObject(person) && typeof person.id === "string" && typeof person.name === "string") : []
    };
  } catch {
    return null;
  }
}

export function saveHandlesSafeThings(enabled, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/setting", { enabled }, "That could not be saved.", fetchImpl);
}

export function updateHabit(body, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/update", body, "That could not be saved.", fetchImpl);
}

export function forgetEverything({ fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/forget-all", {}, "That could not be forgotten.", fetchImpl);
}

// A nickname the person confirmed (Ask's question "who is J?").
export function rememberAlias(alias, personId, { fetchImpl = fetch } = {}) {
  return postJson("/api/ask/habits/alias", { alias, personId }, "That could not be saved.", fetchImpl);
}
