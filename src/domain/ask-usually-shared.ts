// "Add the usual shared ones to Splits" in Ask (DOMAIN.md "Usually Shared";
// docs/flows/ask-flow.md "Usually shared"). The model reports only the
// intent, and a shop only when the person named one, as written. The server
// derives everything else: the list is the one Splits shows
// (pages/usually-shared.ts, the same rule that suggests the usual split for
// one entry), and the answer is a change card listing what would be added
// and how, saved only through POST /api/splits/expenses/add-usual with its
// Undo (remove-added). Over ten entries the card needs "Yes, add all N" and
// the command checks the count; over 200 the card is not made. Nothing is
// added by itself.
//
// readUsuallySharedRules is the offline backup: with AI off it reads the same
// message into the same action, checked the same way. Pure: no database, no
// clock, nothing written.

import { normalizeDescriptionForMatch } from "./app-repository-helpers";
import { editDistance } from "./ask-turn-names";
import { askBack, scrubName, wordsOf, type AskTurnAction, type AskTurnReply, type Ground } from "./ask-turn";
import type { AskChangeEntry, AskChangeRow, AskChangeStep } from "./ask-turn-actions";
import { NON_GROUP_SPLIT_ID } from "./split-suggestion";
import { USUALLY_SHARED_CONFIRM_ABOVE, USUALLY_SHARED_POLICY } from "./usually-shared";
import type { UsuallySharedGroupDto } from "../types/dto";

export interface AskUsuallySharedRequest {
  type: "usually_shared";
  // The one shop the person named ("" for all of them).
  shop: string;
}

const PREVIEW_ROWS = 8;
const SHOP_MAX = 40;

const COPY = {
  none: "Nothing that you usually share is waiting to be added to Splits.",
  noneAtShop: (shop: string) => `Nothing at ${shop} is waiting to be added to Splits.`,
  tooMany: (count: number, max: number) => `${count} entries are waiting, and Ask adds at most ${max} at a time. Name one shop, or open Splits and choose.`,
  whichShop: "Which shop do you mean?",
  notReady: "Ask can't look that up just now. Open Splits to see what is waiting.",
  sharedTitle: "Usually shared",
  notOnSplits: "Not on Splits",
  several: "Several",
  // "half each with Joyce in Baby River"
  usual: (group: UsuallySharedGroupDto) => {
    const percent = Math.round(group.basisPoints / 100);
    const share = percent === 50
      ? `half each with ${group.otherPersonName}`
      : `${group.ownerName} ${percent}% and ${group.otherPersonName} ${100 - percent}%`;
    return group.groupId === NON_GROUP_SPLIT_ID ? share : `${share} in ${group.groupName}`;
  }
};

// The prompt's line for this action.
export function describeUsuallySharedAction() {
  return "- add_usually_shared: put the past entries the household usually shares on Splits, each shop with its usual split (\"add the usual shared ones to Splits\"). usually_shared.shop only when they named one shop, as written.";
}

// Shop words the person wrote: "" when none were given, null when they are
// not the person's own words.
function groundedShop(value: unknown, ground: Ground): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().replace(/^(the|a|an|my|our)\s+/i, "").replace(/\s+(one|ones|entry|entries)$/i, "") : "";
  if (!text) return "";
  if (text.length > SHOP_MAX || !/\p{L}{2,}/u.test(text)) return null;
  return wordsOf(text).every((word) => ground.words.has(word)) ? scrubName(text) || null : null;
}

export function validateUsuallyShared(action: AskTurnAction, _context: unknown, ground: Ground): AskTurnReply {
  const shop = groundedShop(action.usually_shared?.shop, ground);
  if (shop === null) {
    return askBack({ code: "field_missing", field: "usually_shared.shop" }, COPY.whichShop, []);
  }
  return { kind: "resolve", request: { type: "usually_shared", shop } };
}

// The shop's words all appear among the group's shop-name words.
function matchesShop(group: UsuallySharedGroupDto, shop: string) {
  const have = normalizeDescriptionForMatch(group.shopName).split(/[^a-z0-9]+/).filter(Boolean);
  const want = normalizeDescriptionForMatch(shop).split(/[^a-z0-9]+/).filter(Boolean);
  return want.length > 0 && want.every((word) => have.some((token) => token === word || token.startsWith(word) || (word.length >= 5 && editDistance(token, word) <= 1)));
}

// The card for the list the server read. Every entry, figure and share is
// the app's own; the model chose only whether a shop narrows it.
export function buildUsuallySharedChange(request: AskUsuallySharedRequest, groups: UsuallySharedGroupDto[] | null): AskTurnReply {
  if (!groups) return { kind: "note", text: COPY.notReady };
  const chosen = request.shop ? groups.filter((group) => matchesShop(group, request.shop)) : groups;
  if (!chosen.length) return { kind: "note", text: request.shop ? COPY.noneAtShop(request.shop) : COPY.none };
  const all = chosen
    .flatMap((group) => group.entries.map((entry) => ({ entry, group })))
    .sort((left, right) => right.entry.date.localeCompare(left.entry.date) || left.entry.id.localeCompare(right.entry.id));
  if (all.length > USUALLY_SHARED_POLICY.maxEntriesPerAdd) {
    return { kind: "note", text: COPY.tooMany(all.length, USUALLY_SHARED_POLICY.maxEntriesPerAdd) };
  }

  const one = chosen.length === 1 ? chosen[0] : null;
  const rows: AskChangeRow[] = [{ field: "group", before: COPY.notOnSplits, after: one ? COPY.usual(one) : COPY.several }];
  const entries: AskChangeEntry[] = all.slice(0, PREVIEW_ROWS).map(({ entry, group }) => ({
    entryId: entry.id,
    date: entry.date,
    description: entry.description,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    categoryName: "",
    detail: COPY.usual(group)
  }));
  const body = {
    groups: chosen.map((group) => ({
      splitGroupId: group.groupId === NON_GROUP_SPLIT_ID ? null : group.groupId,
      payerShareBasisPoints: group.basisPoints,
      entryIds: group.entries.map((entry) => entry.id)
    }))
  };
  const undo: AskChangeStep[] = [{ path: "/api/splits/expenses/remove-added", body: {}, fromResult: { key: "undoSplitExpenseIds", as: "splitExpenseIds" } }];
  return {
    kind: "change",
    change: {
      type: "usually_shared",
      title: one ? one.shopName : COPY.sharedTitle,
      rows,
      entries,
      count: all.length,
      confirmCount: all.length > USUALLY_SHARED_CONFIRM_ABOVE ? all.length : null,
      rule: null,
      save: [{ path: "/api/splits/expenses/add-usual", body }],
      undo,
      month: all[0].entry.date.slice(0, 7),
      refresh: ["entries", "month", "summary", "splits"]
    }
  };
}

// ---------------------------------------------------------------------------
// The offline backup

const SHARE_WORDS = ["shared", "share", "split", "splits", "splitting"];
const USUAL_WORDS = ["usually", "usual", "habitual"];
const ADD_WORDS = new Set(["add", "put", "move", "sweep", "file", "apply", "handle", "list", "show", "review"]);

// A word that is, or is a typo of, one of the words (two letters off at most
// for a longer word; short words must match).
function isWord(word: string, targets: string[]) {
  return targets.some((target) => word === target || (word.length >= 5 && target.length >= 5 && editDistance(word, target) <= 2));
}

// "add the usual shared ones to Splits", "put the usually shared on splits",
// "usualy shered" and so on, as the same action the model would send. A
// message has to say both "usual(ly)" and "shared/split"; with a verb it is
// an instruction, without one only the bare two words "usually shared" count.
export function readUsuallySharedRules(text: string): AskTurnAction | null {
  const words = wordsOf(text);
  if (!words.length || words.length > 14) return null;
  const usual = words.some((word) => isWord(word, USUAL_WORDS));
  const shared = words.some((word) => isWord(word, SHARE_WORDS));
  if (!usual || !shared) return null;
  const instruction = words.some((word) => ADD_WORDS.has(word));
  const bare = words.length <= 3;
  if (!instruction && !bare) return null;
  return {
    action: "add_usually_shared",
    entry: null, split: null, settlement: null, plan: null, question: null, search: null, page: null, clarify: null, note: null,
    usually_shared: { shop: null }
  };
}
