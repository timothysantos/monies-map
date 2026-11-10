// Why "If this keeps up" is not showing, in plain words (DOMAIN.md "Pace";
// owner decision, 2026-11-10). One place for the reasons, so Summary's note
// under the chart and Ask's answer say the same thing: calm, no alarm words,
// no amounts (so hidden money hides nothing), and always a way forward.
import type { PaceBehindAccount } from "./pace";
import { monthName } from "./money-signals/format";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${SHORT[Number(date.slice(5, 7)) - 1] ?? ""}`;

// At most two accounts are named; the rest are counted.
const NAMED = 2;

/** "Citi Rewards has nothing after 15 Oct and UOB One has nothing after 14 Oct, and 1 more account is behind too". */
export function paceBehindClause(behind: PaceBehindAccount[]): string {
  const named = behind.slice(0, NAMED).map((account) => `${account.name} has nothing ${account.lastDate ? `after ${dayMonth(account.lastDate)}` : "recorded"}`);
  const rest = behind.length - named.length;
  const joined = named.join(" and ");
  return rest > 0 ? `${joined}, and ${rest} more ${rest === 1 ? "account is" : "accounts are"} behind too` : joined;
}

export interface PaceQuietParts {
  before: string;
  // The part that is a link (Summary opens Imports from it); "" for none.
  // `before` then ends with its space.
  action: string;
  after: string;
}

/**
 * Summary's note under the chart, in up to three parts so the page can make
 * the middle one a link. "past" is never shown (the pace is only ever today's
 * month), so it has no words here.
 */
export function paceQuietNote(reason: string, input: { month: string; behind?: PaceBehindAccount[] }): PaceQuietParts | null {
  if (reason === "early") return { before: `No pace yet: it's too early in ${monthName(input.month)}.`, action: "", after: "" };
  if (reason === "history") return { before: "No pace yet: it needs 3 complete months of entries.", action: "", after: "" };
  if (reason === "imports") {
    const behind = input.behind ?? [];
    if (!behind.length) return { before: "No pace yet: the latest statements aren't in. ", action: "Import them", after: " to see it." };
    const one = behind.length === 1;
    return { before: `No pace yet: ${paceBehindClause(behind)}. `, action: one ? "Import its statement" : "Import their statements", after: " to see it." };
  }
  return null;
}

/** Ask's answer for the same reasons (a sentence; Ask has no link here). */
export function paceQuietAnswer(reason: string, input: { month: string; behind?: PaceBehindAccount[] }): string {
  const month = monthName(input.month);
  if (reason === "early") return `It's too early in ${month} to say where it ends. Ask again after the 5th.`;
  if (reason === "past") return `${month} has already ended, so there is nothing still to come.`;
  if (reason === "imports") {
    const behind = input.behind ?? [];
    if (!behind.length) return "The latest statements aren't in yet, so there's no pace until they're imported.";
    return `${paceBehindClause(behind)}, so there's no pace until ${behind.length === 1 ? "its statement is" : "their statements are"} imported.`;
  }
  return "There isn't enough history yet. This needs 3 complete months of entries.";
}
