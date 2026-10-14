// Ask's habits, suggestions and "Done for you" (DOMAIN.md "Ask Habit";
// docs/flows/ask-flow.md "Hands-off"). No AI call anywhere here: habits are
// counted from commands the person ran, and a suggestion or an auto action
// is decided by deterministic rules (ask-habits.ts, ask-habit-plan.ts).
//
// - GET  /api/ask/habits               Settings' "What Ask remembers"
// - POST /api/ask/habits/setting       { enabled }  Let Ask handle safe things
// - POST /api/ask/habits/update        { id, categoryName | payerSharePercent | personId }
// - POST /api/ask/habits/delete        { id }       also "Stop doing this"
// - POST /api/ask/habits/forget-all
// - POST /api/ask/habits/decline       { id }       the suggestion's cross
// - POST /api/ask/habits/alias         { alias, personId }  a confirmed nickname
// - POST /api/ask/entry-habits         { entryId }  Ask opened on an entry: applies
//                                      what the safe set allows, then returns the
//                                      one suggestion row left for it
// - GET  /api/ask/done                 Done for you, the last 30 days
// - POST /api/ask/done/undo            { id }
//
// A cross-site write never reaches here (cross-site-guard.ts).

import {
  deleteAskHabit,
  forgetAllAskHabits,
  learnAliasHabit,
  loadAskHabits,
  loadAskHandlesSafeThings,
  recordHabitOverride,
  saveAskHandlesSafeThings,
  updateAskHabit
} from "../domain/app-repository-ask-habits";
import { DEFAULT_HOUSEHOLD_ID } from "../domain/app-repository-constants";
import { habitConfidence, type AskAliasHabitValue, type AskCategoryHabitValue, type AskHabit, type AskSplitHabitValue } from "../domain/ask-habits";
import { shareLabel, suggestionLine } from "../domain/ask-habit-plan";
import { loadSharePeople } from "../domain/pages/split-suggestion";
import { todayInAppTimeZone } from "../lib/app-calendar";
import { applyHabitsToNewEntry, loadDoneForYou, loadEntryHabitPlan, undoDoneForYou, UndoRefused } from "./ask-auto-apply";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export interface HabitDto {
  id: string;
  kind: "category" | "split" | "alias";
  // "Starbucks" / "J": what the habit is about, in plain words.
  label: string;
  // What Ask remembers about it: "Food & Drinks", "Add to splits 50/50 with Joyce".
  text: string;
  // Whether Ask may apply it by itself (3 or more confirmations in a row).
  sure: boolean;
  edit:
    | { kind: "category"; categoryName: string }
    | { kind: "split"; payerSharePercent: number }
    | { kind: "alias"; personId: string };
}

function titleCase(text: string) {
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function buildHabitDtos(db: D1Database, habits: AskHabit[]): Promise<{ habits: HabitDto[]; people: Array<{ id: string; name: string }> }> {
  const [peopleRows, groups, sharePeople] = await Promise.all([
    db.prepare("SELECT id, display_name FROM people WHERE household_id = ? ORDER BY created_at, id").bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; display_name: string }>(),
    db.prepare("SELECT id, group_name FROM split_groups WHERE household_id = ?").bind(DEFAULT_HOUSEHOLD_ID).all<{ id: string; group_name: string }>(),
    loadSharePeople(db)
  ]);
  const people = peopleRows.results.map((person) => ({ id: person.id, name: person.display_name }));
  const today = todayInAppTimeZone();
  const dtos: HabitDto[] = [];
  for (const habit of habits) {
    const sure = habitConfidence(habit, today) === "high";
    if (habit.kind === "category") {
      const value = habit.value as AskCategoryHabitValue;
      dtos.push({ id: habit.id, kind: "category", label: titleCase(habit.key), text: value.categoryName, sure, edit: { kind: "category", categoryName: value.categoryName } });
    } else if (habit.kind === "split") {
      const value = habit.value as AskSplitHabitValue;
      const other = sharePeople.find((person) => person.id !== value.payerPersonId);
      const group = value.groupId ? groups.results.find((candidate) => candidate.id === value.groupId) : null;
      if (!other || (value.groupId && !group)) continue;
      dtos.push({
        id: habit.id,
        kind: "split",
        label: titleCase(habit.key),
        text: `Add to splits ${shareLabel(value.payerShareBasisPoints)} with ${other.name}${group ? ` in ${group.group_name}` : ""}`,
        sure,
        edit: { kind: "split", payerSharePercent: Math.round(value.payerShareBasisPoints / 100) }
      });
    } else {
      const value = habit.value as AskAliasHabitValue;
      const person = people.find((candidate) => candidate.id === value.personId);
      if (!person) continue;
      dtos.push({ id: habit.id, kind: "alias", label: habit.key.toUpperCase() === habit.key ? habit.key : titleCase(habit.key), text: `Means ${person.name}`, sure, edit: { kind: "alias", personId: person.id } });
    }
  }
  return { habits: dtos, people };
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
}

const text = (value: unknown, max = 200) => (typeof value === "string" && value.length <= max ? value : "");

function failure(error: unknown, fallback: string) {
  return json({ ok: false, error: error instanceof Error ? error.message : fallback }, 400);
}

export async function handleAskHabitsRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/ask/habits") && !path.startsWith("/api/ask/done") && path !== "/api/ask/entry-habits") {
    return null;
  }
  const { DB: db } = env;

  if (request.method === "GET") {
    if (path === "/api/ask/habits") {
      const [{ available, habits }, enabled] = await Promise.all([loadAskHabits(db), loadAskHandlesSafeThings(db)]);
      const built = await buildHabitDtos(db, habits);
      return json({ ok: true, available, enabled, habits: built.habits, people: built.people });
    }
    if (path === "/api/ask/done") {
      return json({ ok: true, items: await loadDoneForYou(db) });
    }
    return json({ ok: false, error: "That route does not answer GET." }, 405, { Allow: "POST" });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  }

  const body = await readBody(request);
  if (body instanceof Response) return body;

  try {
    switch (path) {
      case "/api/ask/habits/setting": {
        if (typeof body.enabled !== "boolean") return json({ ok: false, error: "Choose on or off." }, 400);
        return json({ ok: true, ...(await saveAskHandlesSafeThings(db, { enabled: body.enabled })) });
      }
      case "/api/ask/habits/update": {
        const share = typeof body.payerSharePercent === "number" ? Math.round(body.payerSharePercent * 100) : undefined;
        return json({ ok: true, ...(await updateAskHabit(db, { id: text(body.id), categoryName: text(body.categoryName), payerShareBasisPoints: share, personId: text(body.personId) })) });
      }
      case "/api/ask/habits/delete":
        return json({ ok: true, ...(await deleteAskHabit(db, { id: text(body.id) })) });
      case "/api/ask/habits/forget-all":
        return json({ ok: true, ...(await forgetAllAskHabits(db)) });
      case "/api/ask/habits/decline": {
        const id = text(body.id);
        const separator = id.indexOf(":");
        const kind = id.slice(0, separator);
        if (separator < 1 || !["category", "split", "alias"].includes(kind)) return json({ ok: false, error: "That habit was not found." }, 400);
        await recordHabitOverride(db, kind as "category" | "split" | "alias", id.slice(separator + 1));
        return json({ ok: true });
      }
      case "/api/ask/habits/alias":
        await learnAliasHabit(db, { alias: text(body.alias, 40), personId: text(body.personId) });
        return json({ ok: true });
      case "/api/ask/entry-habits": {
        const entryId = text(body.entryId);
        if (!entryId) return json({ ok: false, error: "Missing entry id" }, 400);
        const done = await applyHabitsToNewEntry(db, entryId);
        const loaded = await loadEntryHabitPlan(db, entryId);
        if (!loaded) return json({ ok: false, error: "Entry not found." }, 404);
        const { plan } = loaded;
        const line = suggestionLine(plan);
        return json({
          ok: true,
          done,
          suggestion: line
            ? {
              entryId,
              text: line,
              category: plan.category ? { habitId: plan.category.habitId, categoryName: plan.category.to } : null,
              split: plan.split ? { habitId: plan.split.habitId, groupId: plan.split.groupId, firstPersonBasisPoints: plan.split.firstPersonBasisPoints } : null
            }
            : null
        });
      }
      case "/api/ask/done/undo":
        return json({ ok: true, ...(await undoDoneForYou(db, text(body.id))) });
      default:
        return json({ ok: false, error: "Not found." }, 404);
    }
  } catch (error) {
    if (error instanceof UndoRefused) {
      return json({ ok: false, error: error.message }, 409);
    }
    return failure(error, "That could not be saved.");
  }
}
