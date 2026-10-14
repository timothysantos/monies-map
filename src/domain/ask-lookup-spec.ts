// The names and caps of Ask's read-only lookups, with no imports, so the turn
// schema (ask-turn.ts) can list them without pulling in the readers
// (ask-lookup-tools.ts).

export const ASK_LOOKUP_LIMITS = Object.freeze({
  // Model calls in one turn, the first included (a repair turn counts too).
  maxModelCalls: 4,
  maxRows: 8,
  maxResultChars: 1_200,
  maxNoteChars: 80,
  // Tokens one turn may spend across all its model calls (estimated).
  maxTurnTokens: 6_000
});

export const ASK_LOOKUP_TOOL_NAMES = ["find_entries", "get_entry", "get_split_balances", "list_recent_entries", "get_category_history"] as const;
export type AskLookupToolName = typeof ASK_LOOKUP_TOOL_NAMES[number];
