// Quick payments that need a few words (DOMAIN.md "Quick Entry"): payments
// typed on the quick pad with only their amount and never described (the
// pad's own name, still in Other, no note), from the last QUICK_WORDS_DAYS
// days. One reminder per person, gathering them all: "3 payments from today
// need a few words". Its key carries the newest one, so a new quick payment
// brings a reminder put away with Later back; a payment that gets its words
// (or leaves the window) leaves the count. Deterministic: no AI, no write.
import type { QuickWordsReminderDto } from "../../types/dto";
import type { ReminderInputs } from "./facts";

export function quickWordsReminders(input: Pick<ReminderInputs, "quickWords" | "viewId" | "people" | "today">): QuickWordsReminderDto[] {
  const byPerson = new Map<string, NonNullable<ReminderInputs["quickWords"]>>();
  for (const entry of input.quickWords ?? []) {
    if (!entry.personId || (input.viewId !== "household" && entry.personId !== input.viewId)) continue;
    byPerson.set(entry.personId, [...(byPerson.get(entry.personId) ?? []), entry]);
  }
  return [...byPerson.entries()].map(([personId, entries]) => {
    // Newest first, as the loader reads them.
    const newest = [...entries].sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time))[0];
    return {
      key: `quick_words:${personId}:${newest.entryId}`,
      kind: "quick_words",
      personId,
      personName: input.people.find((person) => person.id === personId)?.name ?? "",
      count: entries.length,
      allToday: entries.every((entry) => entry.date === input.today),
      newestDate: newest.date
    };
  });
}
