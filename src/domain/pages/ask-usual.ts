import { payeeKey, payeeName } from "../account-routines";
import { loadEntriesForDateRange } from "../app-repository-entries";
import { addMonths } from "../money-signals/format";
import { adjustEntriesForView } from "../month-projection";
import { effectiveScopeForView, filterEntriesForView } from "../person-view-scope";
import { buildUsualFacts, USUAL_MONTHS, type UsualEntry, type UsualFacts, type UsualSubject } from "../ask-usual";
import type { PersonScope } from "../../types/dto";

// The read side of Ask's "is that more than usual?" (ask-usual.ts): what
// was asked about, as the person wrote it, resolved on the server (a
// category or a person's name first, then a shop among this view's entries
// of the last 7 months, then the whole month's spending), and the view's
// entries of that month and the 6 before, in one range read (two parallel
// statements, bounded by the 7 months). Never one page build per month.

const SPENDING_WORDS = new Set(["", "spending", "spend", "spent", "it", "that", "this", "money", "expenses", "everything", "we", "i", "our", "my"]);

const words = (text: string) => String(text ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export interface UsualRequest {
  subject: string | null;
  month: string;
  viewId: string;
  scope: PersonScope;
  categories: string[];
  people: Array<{ id: string; name: string }>;
  trackedMonths: string[];
}

export type UsualRead = { ok: true; facts: UsualFacts } | { ok: false; reason: "unknown_subject" | "untracked"; subject: string };

export async function readUsual(db: D1Database, request: UsualRequest): Promise<UsualRead> {
  const raw = String(request.subject ?? "").replace(/'s\b/gi, "").replace(/\s+/g, " ").trim();
  const lower = raw.toLowerCase();
  if (!request.trackedMonths.includes(request.month)) {
    return { ok: false, reason: "untracked", subject: raw };
  }
  const category = request.categories.find((name) => name.toLowerCase() === lower)
    ?? (lower.length >= 4 ? request.categories.find((name) => name.toLowerCase().startsWith(lower)) : undefined);
  const person = category ? undefined : request.people.find((candidate) => candidate.name.toLowerCase() === lower);
  // A person's spending is read in their own view; anything else in the
  // view the question was asked in.
  const viewId = person ? person.id : request.viewId;
  const scope = effectiveScopeForView(viewId, person ? "direct_plus_shared" : request.scope);
  const start = `${addMonths(request.month, -USUAL_MONTHS)}-01`;
  const end = `${addMonths(request.month, 1)}-01`;
  const loaded = await loadEntriesForDateRange(db, start, end);
  const entries: UsualEntry[] = filterEntriesForView(adjustEntriesForView(loaded, viewId), viewId, scope)
    .filter((entry) => entry.entryType === "expense" || entry.entryType === "income")
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      description: entry.description ?? "",
      categoryName: entry.categoryName ?? "Other",
      entryType: entry.entryType,
      amountMinor: entry.amountMinor
    }));

  let subject: UsualSubject;
  let label: string;
  if (category) {
    subject = { kind: "category", name: category };
    label = category;
  } else if (person) {
    subject = { kind: "person", name: person.name };
    label = `${person.name}'s spending`;
  } else if (SPENDING_WORDS.has(lower)) {
    subject = { kind: "spending" };
    label = "Spending";
  } else {
    // A shop: the payee whose words hold what was written, with the most
    // money over the 7 months. A second match is named as the assumption.
    const wanted = words(raw);
    const byPayee = new Map<string, { name: string; minor: number }>();
    for (const entry of entries) {
      const key = payeeKey(entry.description);
      if (!wanted || !key || !` ${key} `.includes(` ${wanted}`)) continue;
      const current = byPayee.get(key) ?? { name: payeeName(entry.description) || key, minor: 0 };
      current.minor += entry.entryType === "expense" ? entry.amountMinor : 0;
      byPayee.set(key, current);
    }
    const ranked = [...byPayee.entries()].filter(([, value]) => value.minor > 0).sort((left, right) => right[1].minor - left[1].minor);
    if (!ranked.length) {
      return { ok: false, reason: "unknown_subject", subject: raw };
    }
    const [[key, best], second] = ranked;
    subject = { kind: "shop", key, name: best.name, ...(second ? { also: second[1].name } : {}) };
    label = best.name;
  }
  return {
    ok: true,
    facts: buildUsualFacts({ subject, label, month: request.month, viewId, scope, entries, trackedMonths: request.trackedMonths })
  };
}
