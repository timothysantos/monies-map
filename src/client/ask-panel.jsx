import * as Popover from "@radix-ui/react-popover";
import { ArrowUp, Camera, ClipboardPaste, Image, Maximize2, Mic, Plus, SquarePen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  addSavedEntryToSplits,
  applyPlanChanges,
  requestEntryDraft,
  requestInsightExplanation,
  requestMoneyAnswer,
  requestPlanDraft,
  linkSavedTransfer,
  requestReceiptRead,
  resolveSkewCandidate,
  saveCardEntry,
  undoSavedEntry,
  updateSavedEntryCategory
} from "./ask-api";
import {
  acceptSplitSuggestion,
  answerCardQuestion,
  applyEntryDraft,
  applyReceiptRead,
  buildCardCreateDraft,
  cardFromSavedEntry,
  chooseTransferMatch,
  createAskCard,
  declineSplitSuggestion,
  markCardSaved,
  markCardSaveFailed,
  markCardSaving,
  markCardUndone,
  setCardField,
  setCardVariant,
  setShare,
  swapTransferDirection,
  validateCard
} from "./ask-card-model";
import { AskAnswerCard } from "./ask-answer-card";
import { buildTurnFocus, buildTurnHistory, effectiveChange, linkTurnMatch, removeSplitExpense, requestAskTurn, runChangeSteps, saveChangeRule, saveSettlementDraft, saveSplitProposal, selectedChoiceId } from "./ask-turn-api";
import { AskChangeCard, AskMatchesCard, AskSettlementDraftCard, AskSplitProposalCard, openPageOf } from "./ask-turn-cards";
import { AskMoneyAnswerCard, AskSkewCheckCard } from "./ask-money-answer-card";
import { AskInsightAnswerCard } from "./ask-insight-answer-card";
import { buildInsightAnswer, insightExplainBody, readInsightHandoff } from "./ask-insight-answer";
import { skewCheckLabels } from "./ask-skew-check";
import { readAnswerIntent } from "../domain/ask-answer-intent";
import { mentionsPlanOrMonth, readPlanRequest } from "../domain/plan-draft-reader";
import { AskPlanDraftCard } from "./ask-plan-draft-card";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyWithCurrency } from "./formatters";
import { AskBriefCard } from "./ask-brief-card";
import { AskClaudeCreditNotice } from "./claude-credit-notice";
import { getAskConversationStore } from "./ask-conversation-store";
import { getAskDockStore } from "./ask-dock-state";
import { planAskBack, readAskOrigin, rememberAskOrigin } from "./ask-origin";
import { applyFilterOption, readFilterRequest } from "./ask-filter-reader";
import { buildEntriesFilterSearch } from "./entry-filter-params";
import { formatFilterView } from "./copy/entry-filter-copy";
import { readCachedSplitGroups, useAskEntriesPage } from "./ask-data";
import { AskCardRows, AskEntryCard, partnerName } from "./ask-entry-card";
import { buildChipRow, findActiveItem } from "./ask-chips";
import { prepareReceiptImage, readReceiptOnDevice } from "./ask-receipt-image";
import { LimitHint } from "./limit-hint";
import { ASK_MESSAGE_MAX, askMessageLength, limitState, receiptSizePlan } from "./input-limits";
import { limitsCopy } from "./copy/limits-copy";
import { createPressGesture, createVoiceController, joinSpokenText } from "./ask-voice";
import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { askPlanCopy, formatMonthYear } from "./copy/ask-plan-copy";
import { EmptyState } from "./ui-states";
import { messages } from "./copy/en-SG";
import { todayInAppTimeZone } from "./app-dates";
import { useRouteWorkReport } from "./use-route-work-status";
import { useAskSplitSuggestion } from "./use-ask-split-suggestion";
import { useAskHabits } from "./use-ask-habits";
import { AskDoneForYou, AskDoneInline, AskSuggestionRow } from "./ask-habits-ui";
import { patchCardAfterAuto, patchCardAfterUndo } from "./ask-habits-card";
import { useAskTransferMatch } from "./use-ask-transfer-match";
import { AskTransferMatchRows } from "./ask-transfer-choices";
import { NO_OTHER_SIDE, transferLinkBody } from "./ask-transfer-match";
import { useIsMobileLayout } from "./use-viewport";
import { ResponsiveSelect } from "./responsive-select";
// The Ask page's styles ship with its route, never with the first screen.
import "./ask-route.css";

// The desktop dock around this conversation loads in this chunk (ask-dock.jsx).
export { default as AskDockPanel } from "./ask-dock-panel";

// The Ask page (design.md "Ask page"; docs/flows/ask-flow.md). One page,
// three ways in:
// - the Ask tab: a "since you last looked" card from the Money insights
//   already loaded, then the conversation (chat mode);
// - the Entries + button (?mode=add&from=entries) and the Splits receipt
//   button (?mode=expense&from=splits): a new entry card (add mode);
// - the Apple Pay Shortcut (?saved_entry=<id>): that saved entry's card.
// A typed sentence or a receipt photo fills the card through the optional
// readers in ask-api.js; the card always works by hand. The composer's mic
// (ask-voice.js) only fills the message box: the person checks and sends. Saving goes through
// the Entries composer's create path.
// On a desktop the same page also renders beside another page, in the Ask
// dock (ask-dock.jsx): `placement` "docked" or "popup", with the way in
// (`intent`) held by the dock instead of the URL, so a chip that would open
// /ask changes the dock's conversation and the page beside it stays.
export function AskPanel(props) {
  const [searchParams] = useSearchParams();
  const intent = props.intent ?? readAskIntent(searchParams);
  const conversationKey = askConversationKey(intent);
  // New chat remounts the conversation over a cleared store entry.
  const [chatRound, setChatRound] = useState(0);
  const startNewChat = useCallback(() => {
    getAskConversationStore().clear(conversationKey);
    setChatRound((round) => round + 1);
  }, [conversationKey]);
  // Each way in has its own conversation, kept in the Ask conversation
  // store (ask-conversation-store.js), so leaving Ask and coming back, or
  // reloading the tab, picks it up where it was.
  return <AskConversation key={`${conversationKey}|${chatRound}`} {...props} intent={intent} conversationKey={conversationKey} onNewChat={startNewChat} />;
}

export function askConversationKey(intent) {
  return `${intent.mode}|${intent.from}|${intent.savedEntryId}|${intent.splitGroupId}`;
}

export function readAskIntent(searchParams) {
  const mode = searchParams.get("mode");
  return {
    mode: mode === "add" || mode === "expense" ? mode : "chat",
    from: ["entries", "splits", "ask", "shortcut"].includes(searchParams.get("from")) ? searchParams.get("from") : "",
    savedEntryId: searchParams.get("saved_entry") ?? "",
    splitGroupId: searchParams.get("split_group") ?? ""
  };
}

// Ids stay unique across reloads: a conversation restored from the tab's
// sessionStorage keeps the ids it had.
const THREAD_ID_PREFIX = Math.random().toString(36).slice(2, 8);
let nextThreadId = 0;
function threadItem(kind, fields = {}) {
  nextThreadId += 1;
  return { id: `ask-${THREAD_ID_PREFIX}-${nextThreadId}`, kind, ...fields };
}

// The page's conversation, read from and written to the Ask conversation
// store. `restored` says the store already had it (the person came back);
// one this page itself just made is not "restored", even when React runs
// the initializer twice (StrictMode).
const conversationsMadeHere = new WeakSet();
function useAskConversation(store, key, create) {
  const [initial] = useState(() => {
    const before = store.read(key);
    const conversation = store.begin(key, create);
    if (conversation !== before) {
      conversationsMadeHere.add(conversation);
    }
    return { conversation, restored: conversation === before && !conversationsMadeHere.has(conversation) };
  });
  const read = useCallback(() => store.read(key) ?? initial.conversation, [initial, key, store]);
  const conversation = useSyncExternalStore(store.subscribe, read, read);
  return { conversation, restored: initial.restored };
}

// Insight questions already asked from history state (a phone's "Ask about
// this"): StrictMode runs the effect twice before the state is replaced.
// The same for a lead's question (askQuestion in history state).
const askedInsightHandoffs = new WeakSet();

// A typed line that reads as a question rather than something to add.
function looksLikeQuestion(text) {
  return /\?\s*$/.test(text) || /^(how|what|when|where|why|which|who|did|do|does|is|are|can|show)\b/i.test(text.trim());
}

function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function AskConversation({
  intent,
  conversationKey,
  onNewChat,
  view,
  selectedMonth,
  selectedScope,
  accounts,
  categories,
  people,
  trackedMonths = undefined,
  shortcutSettings,
  fetchEntriesPage,
  onEntryMutation,
  onSplitMutation,
  onSettingsMutation = undefined,
  runBackgroundRefresh,
  fetchRequiredQuery,
  routeUsable = false,
  placement = "page",
  canExpand = false
}) {
  const queryClient = useQueryClient();
  const { areTotalsVisible } = useMoneyPrivacy();
  // Beside another page (the desktop dock) rather than at /ask.
  const inDock = placement !== "page";
  const location = useLocation();
  // The Claude credit status is read once Ask is first usable, never while
  // it loads; later busy moments (a card being edited) do not hide it.
  const [creditStatusEnabled, setCreditStatusEnabled] = useState(routeUsable);
  if (routeUsable && !creditStatusEnabled) {
    setCreditStatusEnabled(true);
  }
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobileLayout();
  const [today] = useState(() => todayInAppTimeZone());
  const context = useMemo(() => ({
    accounts,
    categories,
    people,
    viewId: view.id,
    today,
    defaultAccountPriorityIds: shortcutSettings?.defaultAccountPriorityIds ?? []
  }), [accounts, categories, people, shortcutSettings, today, view.id]);
  const isShortcut = Boolean(intent.savedEntryId);
  const isAddMode = intent.mode !== "chat";
  // The conversation lives in the store, so a reader result or a save that
  // lands after the person has left still lands in it.
  const store = getAskConversationStore();
  const { conversation, restored } = useAskConversation(store, conversationKey, () => ({
    intent,
    thread: isShortcut ? [threadItem("status", { text: askCopy.notes.shortcutLoading })] : [],
    card: isAddMode ? createAskCard(context, { mode: intent.mode, splitGroupId: intent.splitGroupId }) : null,
    cardSlot: 0,
    composerText: "",
    pending: null,
    scrollFromBottom: 0
  }));
  const { card, thread, composerText } = conversation;
  // Where the card sits in the conversation: after the messages that made
  // it, before what happened to it since (saved, undone).
  const cardSlot = conversation.cardSlot;
  const pending = conversation.pending;
  const updateConversation = useCallback((updater) => store.update(conversationKey, updater), [conversationKey, store]);
  const setCard = useCallback((value) => updateConversation((current) => ({
    ...current,
    card: typeof value === "function" ? value(current.card) : value
  })), [updateConversation]);
  const setCardSlot = useCallback((value) => updateConversation((current) => ({ ...current, cardSlot: value })), [updateConversation]);
  const setComposerText = useCallback((value) => updateConversation((current) => ({ ...current, composerText: value })), [updateConversation]);
  const setPending = useCallback((value) => updateConversation((current) => ({ ...current, pending: value })), [updateConversation]);
  const [working, setWorking] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState("");
  const [savedPicker, setSavedPicker] = useState(false);
  const [splitGroupsFromCache, setSplitGroupsFromCache] = useState(() => readCachedSplitGroups(queryClient, view.id));
  const objectUrlsRef = useRef([]);
  const chipsRef = useRef(null);
  const threadBoxRef = useRef(null);
  const threadEndRef = useRef(null);
  const descriptionRef = useRef(null);
  const amountRef = useRef(null);
  const noteRef = useRef(null);
  const composerRef = useRef(null);
  const cameraInputRef = useRef(null);
  const attachInputRef = useRef(null);

  // Voice input: the controller is created once and reports through refs,
  // so its callbacks always reach this render's handlers.
  /** @type {import("react").MutableRefObject<{ onChange?: (state: any) => void, onTranscript?: (text: string, meta: { final: boolean }) => void, onNote?: (key: string) => void }>} */
  const voiceHandlersRef = useRef({});
  const voiceBaseRef = useRef("");
  const micPointerRef = useRef(false);
  const micRetryRef = useRef(false);
  const [voice] = useState(() => createVoiceController({
    onChange: (next) => voiceHandlersRef.current.onChange?.(next),
    onTranscript: (text, meta) => voiceHandlersRef.current.onTranscript?.(text, meta),
    onNote: (key) => voiceHandlersRef.current.onNote?.(key)
  }));
  const [micGesture] = useState(() => createPressGesture());
  const [voiceState, setVoiceState] = useState(() => voice.getState());
  const [voiceAnnouncement, setVoiceAnnouncement] = useState("");
  const voiceActive = ["starting", "listening", "transcribing"].includes(voiceState.status);

  // The month the card's entry lands in: the Entries page DTO of that month
  // holds the split groups and, after a save, the saved row.
  const cardMonth = (card?.fields.date || today).slice(0, 7);
  // The Shortcut's entry month as the link gave it: the shell may later
  // move the URL to a month it tracks, but the entry stays in its own.
  const [shortcutMonth] = useState(() => searchParams.get("month") ?? selectedMonth);
  const entriesMonth = isShortcut ? shortcutMonth : cardMonth;
  const needsEntriesPage = isShortcut || (card?.variant === "expense" && card.status === "draft" && !splitGroupsFromCache);
  const entriesPage = useAskEntriesPage({ queryClient, fetchEntriesPage, viewId: view.id, month: entriesMonth, enabled: needsEntriesPage });
  const splitGroups = useMemo(
    () => entriesPage.page?.splitGroups?.map((group) => ({ id: group.id, name: group.name })) ?? splitGroupsFromCache ?? [],
    [entriesPage.page, splitGroupsFromCache]
  );
  // "You usually split this with …": from the household's own split
  // history, read-only (DOMAIN.md "Split Suggestion").
  const historySplitSuggestion = useAskSplitSuggestion({ card, context, splitGroups });
  // Ask's habits for the saved card: the one quiet suggestion row, and what
  // Ask did by itself with its Undo (docs/flows/ask-flow.md "Hands-off").
  const habits = useAskHabits({
    entryId: card?.status === "saved" ? card.saved?.entryId ?? "" : "",
    applyCategory: (categoryName) => changeSavedCategory(categoryName),
    applyShare: (splitGroupId, splitBasisPoints) => shareSavedEntry(splitGroupId, splitBasisPoints),
    onChanged: () => {
      const month = (card?.fields.date ?? today).slice(0, 7);
      onEntryMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      onSplitMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      void runBackgroundRefresh(entriesPage.refresh);
    },
    onApplied: (applied) => setCard((current) => applied.reduce(patchCardAfterAuto, current)),
    onUndone: (item) => setCard((current) => patchCardAfterUndo(current, item))
  });
  // One suggestion about splitting: the habit's, when there is one.
  const splitSuggestion = habits.suggestion?.split ? null : historySplitSuggestion;
  // The other side of a draft transfer, from the Entries transfer dialog's
  // own search (docs/flows/ask-flow.md "Transfers: the other side").
  const transferMatch = useAskTransferMatch({ card });

  useRouteWorkReport({
    ready: true,
    busy: Boolean(working) || voiceActive || card?.status === "saving" || Boolean(card?.touched && card.status === "draft")
  });

  // The place the + kept rides on this history entry; it is also kept for
  // the tab's session, for a way back after the entry has lost it (the Ask
  // tab reopening the card).
  useEffect(() => {
    if (!inDock) {
      rememberAskOrigin(sessionStore(), location.state?.askOrigin);
    }
  }, [inDock, location.state]);

  // Leaving the page keeps the conversation in the store, with how far up
  // the person had scrolled. Photos live in memory only while the page
  // shows them: their thumbnails leave the conversation with the page.
  useEffect(() => () => {
    const box = threadBoxRef.current;
    const scrollFromBottom = box && box.scrollHeight > box.clientHeight ? box.scrollHeight - box.scrollTop - box.clientHeight : 0;
    store.leave(conversationKey, { scrollFromBottom });
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, [conversationKey, store]);

  // Coming back: the conversation opens where it was, near the bottom. The
  // "since you last looked" card can arrive a moment later and push the
  // bottom down, so the place is kept for a second unless the person
  // scrolls first.
  const [restoredScroll] = useState(() => (restored ? conversation.scrollFromBottom ?? 0 : null));
  // What was already there when the person came back shows at once, with
  // no arrival motion; only what is new arrives.
  const [settledIds] = useState(() => new Set(restored ? thread.map((item) => item.id) : []));
  const [cardWasSettled] = useState(() => restored && Boolean(card));
  useLayoutEffect(() => {
    const box = threadBoxRef.current;
    if (restoredScroll === null || !box) {
      return undefined;
    }
    const place = () => {
      if (box.scrollHeight > box.clientHeight + 1) {
        box.scrollTop = box.scrollHeight - box.clientHeight - restoredScroll;
      } else {
        threadEndRef.current?.scrollIntoView?.({ block: "end" });
      }
    };
    place();
    let stopped = false;
    let frames = 0;
    let lastHeight = box.scrollHeight;
    let frame = 0;
    const stop = () => { stopped = true; };
    const follow = () => {
      if (stopped || frames > 60) return;
      frames += 1;
      if (box.scrollHeight !== lastHeight) {
        lastHeight = box.scrollHeight;
        place();
      }
      frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    box.addEventListener("wheel", stop, { passive: true });
    box.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      window.cancelAnimationFrame(frame);
      box.removeEventListener("wheel", stop);
      box.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [restoredScroll]);

  useEffect(() => {
    if (!splitGroupsFromCache && entriesPage.page?.splitGroups) {
      setSplitGroupsFromCache(entriesPage.page.splitGroups.map((group) => ({ id: group.id, name: group.name })));
    }
  }, [entriesPage.page, splitGroupsFromCache]);

  // The Shortcut's saved entry becomes a saved card once its month loads
  // (once: a restored conversation already has it).
  const shortcutHandledRef = useRef(restored && thread.some((item) => item.kind !== "status"));
  useEffect(() => {
    if (!isShortcut || shortcutHandledRef.current || entriesPage.status === "loading" || entriesPage.status === "idle") {
      return;
    }
    shortcutHandledRef.current = true;
    const entry = entriesPage.page?.monthPage?.entries?.find((item) => item.id === intent.savedEntryId);
    const next = [threadItem("note", { text: entry ? askCopy.notes.shortcutSaved : askCopy.notes.shortcutMissing })];
    const savedCard = entry ? cardFromSavedEntry(entry, context) : null;
    updateConversation((current) => ({
      ...current,
      thread: next,
      cardSlot: 1,
      card: savedCard ? { ...savedCard, saved: { ...savedCard.saved, splitGroupName: entry.linkedSplitGroupName ?? "" } } : current.card
    }));
  }, [context, entriesPage.page, entriesPage.status, intent.savedEntryId, isShortcut, updateConversation]);

  // The page opens at the top. Later, the person's newest message scrolls
  // to the top of the conversation (so the card it filled sits under it),
  // and any other news to the bottom; motion only when the person allows it.
  // A status line ("Reading your receipt…") coming or going moves nothing.
  const settledLength = thread.filter((item) => item.kind !== "status").length;
  const scrolledThreadRef = useRef({ length: settledLength, status: card?.status ?? "" });
  useEffect(() => {
    const previous = scrolledThreadRef.current;
    const settled = thread.filter((item) => item.kind !== "status");
    scrolledThreadRef.current = { length: settled.length, status: card?.status ?? "" };
    const justSaved = card?.status === "saved" && previous.status !== "saved";
    if (settled.length <= previous.length && !justSaved) {
      return;
    }
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const newItems = settled.slice(previous.length);
    // A money answer or the check before it arrives after its question, and
    // is often taller than the screen: the question right above it (else
    // the card itself, after a check) goes to the top, so its lead shows.
    // A plan draft too: the question, its intro note, then the card.
    const money = [...newItems].reverse().find((item) => item.kind === "money-answer" || item.kind === "money-check" || item.kind === "insight-answer" || (item.kind === "plan-draft" && item.status === "draft"));
    if (money) {
      const index = settled.indexOf(money);
      const asked = settled.slice(Math.max(0, index - 2), index).reverse().find((item) => item.kind === "me");
      document.getElementById(asked ? asked.id : money.id)?.scrollIntoView?.({ block: "start", behavior });
      return;
    }
    const lastMine = [...newItems].reverse().find((item) => item.kind === "me");
    if (lastMine) {
      document.getElementById(lastMine.id)?.scrollIntoView?.({ block: "start", behavior });
      return;
    }
    threadEndRef.current?.scrollIntoView?.({ block: "end", behavior });
  }, [card?.status, thread]);

  const validation = useMemo(() => (card ? validateCard(card, { splitGroups }) : null), [card, splitGroups]);
  const appendThread = useCallback((...items) => updateConversation((current) => ({
    ...current,
    thread: [...current.thread.filter((item) => item.kind !== "status"), ...items]
  })), [updateConversation]);
  const setStatus = useCallback((text) => updateConversation((current) => ({
    ...current,
    thread: [...current.thread.filter((item) => item.kind !== "status"), ...(text ? [threadItem("status", { text })] : [])]
  })), [updateConversation]);

  useEffect(() => {
    voiceHandlersRef.current = {
      onChange: (next) => {
        setVoiceState(next);
        setVoiceAnnouncement((current) => {
          if (next.status === "listening") return askCopy.voice.listening;
          if (next.status === "transcribing") return askCopy.voice.transcribing;
          return current === askCopy.voice.done ? current : "";
        });
      },
      // The words go in the message box after what was typed; never sent.
      onTranscript: (text, { final }) => {
        setComposerText(joinSpokenText(voiceBaseRef.current, text));
        if (final) {
          setVoiceAnnouncement(askCopy.voice.done);
        }
      },
      onNote: (key) => appendThread(threadItem("note", { text: askCopy.voice.notes[key] ?? askCopy.voice.notes.failed, tone: "calm" }))
    };
  }, [appendThread, setComposerText]);
  // Leaving the page stops listening and drops a clip in progress.
  useEffect(() => () => voice.dispose(), [voice]);

  const updateCard = useCallback((patch) => setCard((current) => (current ? setCardField(current, patch, context) : current)), [context, setCard]);
  const changeVariant = useCallback((variant) => setCard((current) => (current ? setCardVariant(current, variant, context) : current)), [context, setCard]);
  const changeShare = useCallback((share) => setCard((current) => (current ? setShare(current, share) : current)), [setCard]);

  // A new card for a new message once the last one is saved.
  // The card a message or receipt fills (a new one once the last is saved).
  // It moves below the message that filled it, as the newest thing said.
  function workingCard() {
    const current = store.read(conversationKey) ?? conversation;
    setCardSlot(current.thread.filter((item) => item.kind !== "status").length);
    if (!current.card || current.card.status === "saved") {
      return createAskCard(context, { mode: intent.mode === "expense" ? "expense" : "add", splitGroupId: intent.splitGroupId });
    }
    return current.card;
  }

  // What the filter reader knows: the people, wallets and categories on
  // screen, and the view, scope and month Ask is looking at.
  const filterContext = useMemo(() => ({
    today,
    month: selectedMonth,
    viewId: view.id,
    scope: view.id === "household" ? "direct_plus_shared" : selectedScope,
    people,
    accounts,
    categories
  }), [accounts, categories, people, selectedMonth, selectedScope, today, view.id]);

  // What the money-question reader knows (ask-answer-intent.ts, shared with
  // the answer route): today, the month in view, the people, and the
  // category and wallet names a filter request would name.
  const answerContext = useMemo(() => ({
    today,
    month: selectedMonth,
    people,
    vocabulary: [...categories.map((category) => category.name), ...accounts.map((account) => account.name)]
  }), [accounts, categories, people, selectedMonth, today]);

  function isTrackedMonth(month) {
    return !trackedMonths?.length || trackedMonths.includes(month);
  }

  function viewLabel(viewId, scope) {
    return formatFilterView({ viewId, scope }, people) || view.label;
  }

  // A search or filter request: an answer card, a follow-up question, a
  // view change waiting for its chip, or a note. Never a guess.
  function answerFilterRequest(reading) {
    if (reading.kind === "filter") {
      appendThread(threadItem("answer", { filter: reading.filter }));
    } else if (reading.kind === "question") {
      setPending({ kind: "question", filter: reading.filter, questions: reading.questions });
    } else if (reading.kind === "view") {
      if (reading.viewId === view.id && reading.scope === filterContext.scope) {
        appendThread(threadItem("note", { text: askCopy.filter.alreadyShowing(viewLabel(reading.viewId, reading.scope)) }));
      } else {
        setPending({ kind: "view", viewId: reading.viewId, scope: reading.scope });
      }
    } else if (reading.kind === "unknown") {
      appendThread(threadItem("note", { text: askCopy.filter.unknownCategory(reading.word) }));
    }
  }

  function chooseFilterOption(option) {
    if (pending?.kind !== "question") {
      return;
    }
    const filter = applyFilterOption(pending.filter, option);
    const questions = pending.questions.slice(1);
    if (questions.length) {
      setPending({ ...pending, filter, questions });
      return;
    }
    setPending(null);
    appendThread(threadItem("answer", { filter }));
  }

  // The same change the View and scope bar makes: the route's view and
  // scope, which every page then follows.
  function switchView() {
    if (pending?.kind !== "view") {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("view", pending.viewId);
    next.set("scope", pending.viewId === "household" ? "direct_plus_shared" : pending.scope);
    setPending(null);
    appendThread(threadItem("note", { text: askCopy.filter.nowShowing(viewLabel(pending.viewId, pending.scope)) }));
    // In the dock, the page beside it changes view, as the header pills do.
    navigate({ pathname: inDock ? location.pathname : "/ask", search: `?${next.toString()}` });
  }

  // Every message (typed, spoken, a chip's question, the money jobs menu,
  // the Splits and Entries ways in): AI understands, the app validates,
  // rules are the offline backup (docs/flows/ask-flow.md "AI first"). The
  // turn route reads it with the conversation and what is in focus (the
  // saved entry, the card being filled, the split group). AI off, over its
  // allowance or failing: the rules read it as before, with a one-line note
  // once per conversation.
  async function readSentence(text) {
    const before = store.read(conversationKey) ?? conversation;
    appendThread(threadItem("me", { text }));
    if (pending) {
      setPending(null);
    }
    setWorking("turn");
    setStatus(askCopy.notes.readingSentence);
    let turn;
    try {
      turn = await requestAskTurn({
        text,
        history: buildTurnHistory(before.thread),
        viewId: view.id,
        scope: filterContext.scope,
        month: selectedMonth,
        page: inDock ? pageOf(location.pathname) : "ask",
        // A follow-up to "Ask about this" on a Money insights line names
        // that insight's kind (never its figures).
        // A message right after an Entries answer ("make these Transport")
        // is about that list.
        focus: buildTurnFocus({
          card: before.card,
          intent,
          insightTopic: before.thread.filter((item) => item.kind !== "status").at(-1)?.kind === "insight-answer"
            ? String(before.thread.filter((item) => item.kind !== "status").at(-1).answer?.kind ?? "")
            : "",
          list: before.thread.filter((item) => item.kind !== "status").at(-1)?.kind === "answer"
            ? before.thread.filter((item) => item.kind !== "status").at(-1).filter
            : null
        })
      });
    } finally {
      setStatus("");
      setWorking("");
    }
    if (turn.ok && turn.mode === "ai") {
      await applyTurnReply(text, turn.reply);
      return;
    }
    if (!before.rulesNoted) {
      updateConversation((current) => ({ ...current, rulesNoted: true }));
      appendThread(threadItem("note", { text: turn.ok && turn.mode === "rules" && turn.notice === "demo_allowance" ? askCopy.turn.demoAllowanceNote : askCopy.turn.rulesNote, tone: "calm" }));
    }
    // A share on the saved entry ("Joyce's share 1.6") the server's rules
    // already read and checked: shown like the model's draft.
    if (turn.ok && turn.mode === "rules" && turn.reply) {
      await applyTurnReply(text, turn.reply);
      return;
    }
    await readSentenceByRules(text);
  }

  // What the turn route sent back, shown with the cards the page already
  // has. Nothing here writes: every draft waits for its Save.
  async function applyTurnReply(text, reply) {
    await showTurnReply(text, reply);
    showAssumptions(reply.assumptions, reply.kind);
  }

  // What the app assumed while drafting, in plain words, with the other
  // readings as chips that send them as the next message (docs/flows/
  // ask-flow.md, "Three principles"). The draft is already on screen, and
  // Save is not behind these chips. A page that has gone elsewhere says
  // nothing.
  function showAssumptions(assumptions, kind) {
    if (!assumptions?.length || kind === "open_page" || kind === "clarify") {
      return;
    }
    const lines = assumptions.map((line) => line.text).join(" ");
    const chips = [...new Set(assumptions.flatMap((line) => line.chips))].slice(0, 4);
    if (chips.length) {
      setPending({ kind: "turn-question", question: lines, options: chips });
    } else {
      appendThread(threadItem("note", { text: lines, tone: "calm" }));
    }
  }

  async function showTurnReply(text, reply) {
    if (reply.kind === "entry_draft") {
      let next = applyEntryDraft(workingCard(), reply.draft, context);
      if (reply.share?.on) {
        next = setShare(next, { on: true, splitGroupId: reply.share.groupId });
      }
      setCard(next);
    } else if (reply.kind === "draft_patch") {
      let next = workingCard();
      const { variant, ...fields } = reply.patch;
      if (variant) {
        next = setCardVariant(next, variant, context);
      }
      if (Object.keys(fields).length) {
        next = setCardField(next, fields, context);
      }
      if (reply.share?.on) {
        next = setShare(next, { on: true, splitGroupId: reply.share.groupId });
      }
      setCard(next);
    } else if (reply.kind === "split_proposal") {
      appendThread(threadItem("split-proposal", { proposal: reply.proposal, status: "draft" }));
    } else if (reply.kind === "settlement_draft") {
      appendThread(threadItem("settlement-draft", { settlement: reply.settlement, status: "draft" }));
    } else if (reply.kind === "plan") {
      showPlanReading(reply.text, reply.request, reply.reading);
    } else if (reply.kind === "question") {
      await askMoneyQuestion(reply.text, reply.request);
    } else if (reply.kind === "search") {
      answerFilterRequest({ kind: "filter", filter: reply.filter });
    } else if (reply.kind === "change") {
      appendThread(threadItem("change-draft", { change: reply.change, status: "draft", confirmed: false }));
    } else if (reply.kind === "matches") {
      appendThread(threadItem("matches", { month: reply.month, matches: reply.matches, handled: {} }));
    } else if (reply.kind === "open_page") {
      // Never from Ask (a delete, an import, accounts): why, then the page.
      if (reply.why) {
        appendThread(threadItem("note", { text: reply.why }));
      }
      appendThread(threadItem("note", { text: askCopy.turn.opened(askCopy.turn.pages[reply.page]) }));
      goTo(reply.page === "help" ? "/faq" : `/${reply.page}`, {}, new URLSearchParams(reply.params));
    } else if (reply.kind === "clarify") {
      if (reply.options.length) {
        setPending({ kind: "turn-question", question: reply.question, options: reply.options });
      } else {
        appendThread(threadItem("note", { text: reply.question }));
      }
    } else {
      appendThread(threadItem("note", { text: reply.text }));
      // Ask added a note by itself: Done for you has a new line.
      if (reply.autoDone) habits.reload();
    }
  }

  function answerTurnQuestion(option) {
    if (pending?.kind !== "turn-question" || working) {
      return;
    }
    void readSentence(option);
  }

  function turnItem(itemId, kind) {
    return (store.read(conversationKey) ?? conversation).thread.find((item) => item.id === itemId && item.kind === kind) ?? null;
  }

  // Add to Splits: the existing command with the proposal's share. The saved
  // card for that entry (the Apple Pay card) shows it is on Splits too.
  async function saveTurnSplit(itemId) {
    const item = turnItem(itemId, "split-proposal");
    if (!item || item.status !== "draft" || working) {
      return;
    }
    updateThreadItem(itemId, { status: "saving" });
    setWorking("split-save");
    try {
      const result = await saveSplitProposal(item.proposal);
      if (!result.ok) {
        updateThreadItem(itemId, { status: "draft" });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      const { proposal } = item;
      updateThreadItem(itemId, { status: "saved", splitExpenseId: result.splitExpenseId ?? null, splitExpenseMonth: result.splitExpenseMonth ?? proposal.date.slice(0, 7) });
      setCard((current) => (current?.saved?.entryId === proposal.entryId
        ? {
          ...current,
          share: { on: true, splitGroupId: proposal.groupId ?? "" },
          saved: { ...current.saved, splitExpenseId: result.splitExpenseId ?? null, splitExpenseMonth: result.splitExpenseMonth ?? null, splitGroupId: proposal.groupId ?? "", splitGroupName: proposal.groupName }
        }
        : current));
      const month = result.splitExpenseMonth ?? proposal.date.slice(0, 7);
      onSplitMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.turn.split.saved(proposal.groupName) }));
      void runBackgroundRefresh(entriesPage.refresh);
    } finally {
      setWorking("");
    }
  }

  async function undoTurnSplit(itemId) {
    const item = turnItem(itemId, "split-proposal");
    if (!item || item.status !== "saved" || !item.splitExpenseId || working) {
      return;
    }
    updateThreadItem(itemId, { status: "undoing" });
    setWorking("split-undo");
    try {
      const result = await removeSplitExpense(item.splitExpenseId);
      if (!result.ok) {
        updateThreadItem(itemId, { status: "saved" });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { status: "draft", splitExpenseId: null });
      setCard((current) => (current?.saved?.entryId === item.proposal.entryId
        ? { ...current, share: { on: false, splitGroupId: "" }, saved: { ...current.saved, splitExpenseId: null, splitGroupId: "", splitGroupName: "" } }
        : current));
      onSplitMutation?.({ month: item.splitExpenseMonth ?? item.proposal.date.slice(0, 7), invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.turn.split.undone }));
      void runBackgroundRefresh(entriesPage.refresh);
    } finally {
      setWorking("");
    }
  }

  function openTurnSplit(itemId) {
    const item = turnItem(itemId, "split-proposal");
    if (item) {
      goTo("/splits", {
        month: item.splitExpenseMonth ?? item.proposal.date.slice(0, 7),
        split_group: item.proposal.groupId || undefined,
        editing_split_expense: item.splitExpenseId || undefined
      });
    }
  }

  function discardTurnItem(itemId, kind, note) {
    const item = turnItem(itemId, kind);
    if (!item || item.status !== "draft" || working) {
      return;
    }
    updateThreadItem(itemId, { status: "discarded" });
    appendThread(threadItem("note", { text: note }));
  }

  // "Is that a percentage instead?": the bare number was read as dollars.
  // The draft is replaced by one for the same message read as a percentage;
  // nothing is saved either way.
  function splitAsPercent(itemId) {
    const item = turnItem(itemId, "split-proposal");
    const retry = item?.proposal?.percentGuess?.retryText;
    if (!item || item.status !== "draft" || working || typeof retry !== "string" || !retry) {
      return;
    }
    updateThreadItem(itemId, { status: "discarded" });
    void readSentence(retry);
  }

  // Record payment: the existing settlement command.
  async function saveTurnSettlement(itemId) {
    const item = turnItem(itemId, "settlement-draft");
    if (!item || item.status !== "draft" || working) {
      return;
    }
    updateThreadItem(itemId, { status: "saving" });
    setWorking("settlement-save");
    try {
      const result = await saveSettlementDraft(item.settlement);
      if (!result.ok) {
        updateThreadItem(itemId, { status: "draft" });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { status: "saved" });
      onSplitMutation?.({ month: item.settlement.date.slice(0, 7), invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.turn.settlement.saved }));
    } finally {
      setWorking("");
    }
  }

  function openTurnSettlement(itemId) {
    const item = turnItem(itemId, "settlement-draft");
    if (item) {
      goTo("/splits", { month: item.settlement.date.slice(0, 7), split_group: item.settlement.groupId || undefined });
    }
  }

  // A saved change: the pages it touched refresh through their owners, and
  // the saved card in focus shows the change too.
  function afterChange(change, direction) {
    const refresh = new Set(change.refresh);
    const month = change.month;
    if (refresh.has("splits")) {
      onSplitMutation?.({ month, invalidateEntries: refresh.has("entries"), invalidateMonth: refresh.has("month"), invalidateSummary: refresh.has("summary") });
    } else if (refresh.has("entries") || refresh.has("month") || refresh.has("summary")) {
      onEntryMutation?.({ month, invalidateEntries: refresh.has("entries"), invalidateMonth: refresh.has("month"), invalidateSummary: refresh.has("summary") });
    }
    if (refresh.has("settings")) {
      onSettingsMutation?.({ refreshReferenceData: true, invalidateEntries: refresh.has("entries"), invalidateMonth: refresh.has("month"), invalidateSummary: refresh.has("summary") });
    }
    const steps = direction === "undo" ? change.undo ?? [] : change.save;
    const body = steps.find((step) => step.path === "/api/entries/update")?.body;
    const category = change.type === "recategorise" ? change.rows.find((row) => row.field === "category") : null;
    const note = change.type === "entry_note" ? change.rows.find((row) => row.field === "note") : null;
    setCard((current) => {
      if (!current?.saved?.entryId || current.saved.entryId !== change.entries[0]?.entryId) return current;
      if (body) {
        return { ...current, fields: { ...current.fields, date: body.date, description: body.description, accountId: body.accountId, categoryName: body.categoryName, amountMinor: body.amountMinor, ownerName: body.ownerName ?? current.fields.ownerName, note: body.note } };
      }
      if (category) return { ...current, fields: { ...current.fields, categoryName: direction === "undo" ? category.before : category.after } };
      if (note) return { ...current, fields: { ...current.fields, note: direction === "undo" ? note.before : note.after } };
      return current;
    });
    void runBackgroundRefresh(entriesPage.refresh);
  }

  // Save: the card's own steps through their existing commands. A change
  // over ten entries carries the count the person confirmed.
  async function saveTurnChange(itemId) {
    const item = turnItem(itemId, "change-draft");
    if (!item || item.status !== "draft" || working || (item.change.confirmCount && !item.confirmed)) {
      return;
    }
    // A transfer change saves the choice the person made.
    const change = effectiveChange(item.change, item.choiceId);
    const unmatched = selectedChoiceId(item.change, item.choiceId) === NO_OTHER_SIDE;
    updateThreadItem(itemId, { status: "saving" });
    setWorking("change-save");
    try {
      const { ok, error, result } = await runChangeSteps(change.save, { confirmedCount: change.confirmCount && item.confirmed ? change.confirmCount : undefined });
      if (!ok) {
        updateThreadItem(itemId, { status: "draft" });
        appendThread(threadItem("note", { text: error }));
        return;
      }
      updateThreadItem(itemId, { status: "saved", result, choiceId: selectedChoiceId(item.change, item.choiceId) });
      afterChange(change, "save");
      const saved = unmatched ? askCopy.turn.change.savedTransferNone : askCopy.turn.change.saved[change.type];
      const category = change.rows.find((row) => row.field === "category")?.after ?? "";
      appendThread(threadItem("note", { text: typeof saved === "function" ? saved(change.count, category) : saved ?? askCopy.turn.change.savedDefault }));
    } finally {
      setWorking("");
    }
  }

  async function undoTurnChange(itemId) {
    const item = turnItem(itemId, "change-draft");
    const change = item ? effectiveChange(item.change, item.choiceId) : null;
    if (!item || !change || item.status !== "saved" || !change.undo || working) {
      return;
    }
    updateThreadItem(itemId, { status: "undoing" });
    setWorking("change-undo");
    try {
      const { ok, error } = await runChangeSteps(change.undo, { result: item.result ?? null });
      if (!ok) {
        updateThreadItem(itemId, { status: "saved" });
        appendThread(threadItem("note", { text: error }));
        return;
      }
      updateThreadItem(itemId, { status: "undone" });
      afterChange(change, "undo");
      appendThread(threadItem("note", { text: askCopy.turn.change.undone }));
    } finally {
      setWorking("");
    }
  }

  function confirmTurnChange(itemId) {
    const item = turnItem(itemId, "change-draft");
    if (item?.status === "draft" && !working) {
      updateThreadItem(itemId, { confirmed: !item.confirmed });
    }
  }

  // After a bulk recategorise: the optional rule for new entries, through
  // the existing category rule command.
  async function saveTurnRule(itemId) {
    const item = turnItem(itemId, "change-draft");
    if (!item || item.status !== "saved" || !item.change.rule || item.ruleSaved || working) {
      return;
    }
    updateThreadItem(itemId, { ruleSaving: true });
    setWorking("change-rule");
    try {
      const result = await saveChangeRule(item.change.rule);
      if (!result.ok) {
        updateThreadItem(itemId, { ruleSaving: false });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { ruleSaving: false, ruleSaved: true });
      onSettingsMutation?.({ refreshReferenceData: false });
      appendThread(threadItem("note", { text: askCopy.turn.change.ruleSaved(item.change.rule.categoryName) }));
    } finally {
      setWorking("");
    }
  }

  function openTurnChange(itemId) {
    const item = turnItem(itemId, "change-draft");
    if (!item) return;
    const page = openPageOf(item.change);
    if (page === "settings") {
      goTo("/settings");
    } else {
      goTo(`/${page}`, { month: item.change.month });
    }
  }

  async function linkTurnMatchItem(itemId, matchId) {
    const item = turnItem(itemId, "matches");
    const match = item?.matches.find((candidate) => candidate.id === matchId);
    if (!match || item.handled?.[matchId] || working) {
      return;
    }
    setWorking("match-link");
    try {
      const result = await linkTurnMatch(match);
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { handled: { ...item.handled, [matchId]: "linked" } });
      onSplitMutation?.({ month: item.month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.turn.matches.saved }));
    } finally {
      setWorking("");
    }
  }

  function skipTurnMatch(itemId, matchId) {
    const item = turnItem(itemId, "matches");
    if (item && !item.handled?.[matchId] && !working) {
      updateThreadItem(itemId, { handled: { ...item.handled, [matchId]: "skipped" } });
    }
  }

  // The rules' reading (the offline backup): plan request, money question,
  // filter, then an entry draft, exactly as Ask read every message before.
  async function readSentenceByRules(text) {
    // A search or filter request. While a card is being filled, a plain
    // sentence is a change to it; a question, or a request naming a month,
    // someone's ("Serene's") or an amount limit, is still a search.
    const cardOpen = Boolean(card && card.status !== "saved");
    // A change to a month's plan ("move $50 from Shopping to Groceries in
    // October") goes to the plan-draft route first. While an entry card is
    // open only one that names the plan or a month does ("set the amount
    // to 12" changes the card). The route may say it is not a plan request
    // after all; the readers below then take it as before.
    const planReading = readPlanRequest(text, { today, walletNames: accounts.map((account) => account.name) });
    const planFirst = planReading.kind !== "none" && (!cardOpen || (planReading.kind === "request" && mentionsPlanOrMonth(text)));
    if (planFirst && await askPlanDraft(text, { viewId: view.id, month: selectedMonth })) {
      return;
    }
    // A money question ("why was August so expensive?") goes to the answer
    // route before the filter reader could read it as a search.
    if (readAnswerIntent(text, answerContext)) {
      await askMoneyQuestion(text, { viewId: view.id, scope: filterContext.scope, month: selectedMonth });
      return;
    }
    const reading = readFilterRequest(text, filterContext, { cardOpen });
    if (reading.kind !== "none") {
      answerFilterRequest(reading);
      return;
    }
    if (!cardOpen && looksLikeQuestion(text)) {
      appendThread(threadItem("note", { text: askCopy.notes.askNotReady }));
      return;
    }
    setWorking("sentence");
    setStatus(askCopy.notes.readingSentence);
    try {
      const result = await requestEntryDraft({ text, viewId: view.id });
      const base = workingCard();
      if (result.ok) {
        // The card's "Filled in from your message" tag says what happened.
        setCard(applyEntryDraft(base, result.draft, context));
      } else {
        setCard(base);
        appendThread(threadItem("note", { text: askCopy.notes.sentenceUnavailable, tone: "calm" }));
      }
    } finally {
      setStatus("");
      setWorking("");
    }
  }

  // The answer route: an answer card, the check before one (a skew
  // candidate that would change the figures), or the "not answered" note.
  // `request` is the view, scope and month the question was asked in, kept
  // with the check so asking again after it uses the same ones.
  async function askMoneyQuestion(text, request, keepCandidateIds = []) {
    setWorking("answer");
    setStatus(askCopy.money.reading);
    try {
      const result = await requestMoneyAnswer({ text, ...request, keepCandidateIds });
      if (!result.ok) {
        appendThread(threadItem("note", { text: askCopy.money.failed, tone: "calm" }));
      } else if (!result.answer.supported) {
        appendThread(threadItem("note", { text: askCopy.notes.askNotReady }));
      } else if (result.answer.needsConfirmation) {
        appendThread(threadItem("money-check", { text, request, keepCandidateIds, candidate: result.answer.candidates[0], status: "open" }));
      } else {
        appendThread(threadItem("money-answer", { text, intent: result.answer.intent, answer: result.answer.answer, wording: result.answer.wording }));
      }
    } finally {
      setStatus("");
      setWorking("");
    }
  }

  // "Ask about this" on a Money insights line (ask-insight-answer.js): the
  // question and the card built from the insight's own facts show at once,
  // with no request. Then, only with AI on, the server may add a short
  // explanation checked against those facts; a failure changes nothing.
  async function askAboutInsight(value) {
    const insight = readInsightHandoff(value);
    if (!insight) {
      return;
    }
    const answer = buildInsightAnswer(insight, { today });
    const item = threadItem("insight-answer", { answer, explanation: null });
    if ((store.read(conversationKey) ?? conversation).pending) {
      setPending(null);
    }
    appendThread(threadItem("me", { text: answer.question, hiddenText: askCopy.insight.hiddenQuestion }), item);
    setWorking("insight");
    setStatus(askCopy.money.reading);
    try {
      const result = await requestInsightExplanation(insightExplainBody(insight));
      if (result.ok && result.explanation) {
        updateConversation((current) => ({
          ...current,
          thread: current.thread.map((entry) => (entry.id === item.id ? { ...entry, explanation: result.explanation } : entry))
        }));
      }
    } finally {
      setStatus("");
      setWorking("");
    }
  }

  // Planning by chat (docs/flows/ask-flow.md "Planning by chat"): the
  // plan-draft route answers with a draft card, a question (chips), a note,
  // or "not a plan request" (false: the caller reads the text as before).
  // `request` is the view and month it was asked in, kept with a question so
  // its answer drafts against the same ones.
  async function askPlanDraft(text, request, answers = {}) {
    setWorking("plan");
    setStatus(askPlanCopy.reading);
    try {
      const result = await requestPlanDraft({ text, viewId: request.viewId, month: request.month, answers });
      if (!result.ok) {
        appendThread(threadItem("note", { text: askPlanCopy.notes.failed, tone: "calm" }));
        return true;
      }
      if (!result.reading.supported) {
        return false;
      }
      showPlanReading(text, request, result.reading, answers);
      return true;
    } finally {
      setStatus("");
      setWorking("");
    }
  }

  // A plan reading (from the plan-draft route or a turn): its question as
  // chips, its note, or the draft card.
  function showPlanReading(text, request, reading, answers = {}) {
    if (reading.question) {
      setPending({ kind: "plan-question", text, request, answers, question: reading.question });
    } else if (reading.note) {
      appendThread(threadItem("note", { text: describePlanNote(reading.note, areTotalsVisible) }));
    } else if (reading.draft) {
      appendThread(
        threadItem("note", { text: askPlanCopy.intro }),
        threadItem("plan-draft", { text, request, draft: reading.draft, source: reading.source, status: "draft" })
      );
    }
  }

  // A follow-up chip that is a money question Ask already answers: asked
  // as if typed, through the answer route and its check before any figure.
  async function askFollowUpQuestion(link) {
    appendThread(threadItem("me", { text: link.text }));
    await askMoneyQuestion(link.text, link.request);
  }

  function answerPlanQuestion(option) {
    if (pending?.kind !== "plan-question" || working) {
      return;
    }
    const { question, answers = {}, text, request } = pending;
    const next = question.field === "month"
      ? { ...answers, month: option }
      : question.field === "line"
        ? { ...answers, lines: { ...(answers.lines ?? {}), [question.name]: option.rowId } }
        : { ...answers, owner: option.key };
    setPending(null);
    void askPlanDraft(text, request, next);
  }

  function updateThreadItem(itemId, patch) {
    updateConversation((current) => ({
      ...current,
      thread: current.thread.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    }));
  }

  function planItem(itemId) {
    return (store.read(conversationKey) ?? conversation).thread.find((item) => item.id === itemId && item.kind === "plan-draft") ?? null;
  }

  // Save plan: the draft's own changes, all its lines in one batch. A plan
  // changed since the draft is refused whole, with the server's words.
  async function savePlanDraft(itemId) {
    const item = planItem(itemId);
    if (!item || item.status !== "draft" || working) {
      return;
    }
    updateThreadItem(itemId, { status: "saving" });
    setWorking("plan-save");
    try {
      const result = await applyPlanChanges({ month: item.draft.month, changes: item.draft.apply }, { fallbackError: askPlanCopy.notes.saveFailed });
      if (!result.ok) {
        updateThreadItem(itemId, { status: "draft" });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { status: "saved", undo: result.undo });
      onEntryMutation?.({ month: item.draft.month, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askPlanCopy.notes.saved(formatMonthYear(item.draft.month)) }));
    } finally {
      setWorking("");
    }
  }

  function discardPlanDraft(itemId) {
    const item = planItem(itemId);
    if (!item || item.status !== "draft" || working) {
      return;
    }
    updateThreadItem(itemId, { status: "discarded" });
    appendThread(threadItem("note", { text: askPlanCopy.notes.discarded }));
  }

  // Undo this change: the save's own undo list, the same way; the card is
  // a draft again, which Save plan can save once more.
  async function undoPlanDraft(itemId) {
    const item = planItem(itemId);
    if (!item || item.status !== "saved" || !item.undo?.length || working) {
      return;
    }
    updateThreadItem(itemId, { status: "undoing" });
    setWorking("plan-undo");
    try {
      const result = await applyPlanChanges({ month: item.draft.month, changes: item.undo }, { fallbackError: askPlanCopy.notes.undoFailed });
      if (!result.ok) {
        updateThreadItem(itemId, { status: "saved" });
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      updateThreadItem(itemId, { status: "draft", undo: [] });
      onEntryMutation?.({ month: item.draft.month, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askPlanCopy.notes.undone }));
    } finally {
      setWorking("");
    }
  }

  function openPlanMonth(itemId) {
    const item = planItem(itemId);
    if (item) {
      goTo("/month", {}, buildContextParams(new URLSearchParams(), item.draft.viewId, item.draft.month, selectedScope));
    }
  }

  function setCheckStatus(itemId, status) {
    updateConversation((current) => ({
      ...current,
      thread: current.thread.map((item) => (item.id === itemId ? { ...item, status } : item))
    }));
  }

  function openCheckItem() {
    const current = store.read(conversationKey) ?? conversation;
    return active?.kind === "money-check" ? current.thread.find((item) => item.id === active.itemId && item.status === "open") ?? null : null;
  }

  // Mark as settlement / Link as transfer: the candidate's suggested
  // actions through the existing routes, then the same question again.
  async function resolveMoneyCheck() {
    const item = openCheckItem();
    if (!item || working) {
      return;
    }
    setWorking("resolve");
    let resolved = false;
    try {
      const result = await resolveSkewCandidate(item.candidate);
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      resolved = true;
      setCheckStatus(item.id, "resolved");
      const months = [...new Set([item.candidate.outflowEntry?.date, item.candidate.inflowEntry?.date].filter(Boolean).map((date) => date.slice(0, 7)))];
      for (const month of months) {
        onEntryMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
        if (item.candidate.kind === "settlement") {
          onSplitMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
        }
      }
      appendThread(threadItem("note", { text: skewCheckLabels(item.candidate).resolved }));
    } finally {
      setWorking("");
    }
    if (resolved) {
      await askMoneyQuestion(item.text, item.request, item.keepCandidateIds ?? []);
    }
  }

  // It's real spending: nothing is changed; the question is asked again
  // without this candidate (kept in the conversation only).
  async function keepMoneyCheck() {
    const item = openCheckItem();
    if (!item || working) {
      return;
    }
    setCheckStatus(item.id, "kept");
    appendThread(threadItem("note", { text: skewCheckLabels(item.candidate).kept }));
    await askMoneyQuestion(item.text, item.request, [...(item.keepCandidateIds ?? []), item.candidate.id]);
  }

  // An answer's links to the screens, with the view, month and scope they name.
  function openAnswerLink(link) {
    if (link.kind === "entries") {
      navigate({ pathname: "/entries", search: `?${buildEntriesFilterSearch(link.filter).toString()}` });
    } else if (link.kind === "month") {
      goTo("/month", {}, buildContextParams(new URLSearchParams(), link.viewId, link.month, link.scope));
    } else if (link.kind === "splits") {
      goTo("/splits", { split_group: link.groupId && link.groupId !== "split-group-none" ? link.groupId : undefined }, buildContextParams(new URLSearchParams(), link.viewId, link.month, selectedScope));
    } else if (link.kind === "imports") {
      goTo("/imports");
    } else if (link.kind === "compose" && link.text) {
      // Change my plan: the month in the message box, the caret before it.
      setComposerText(link.text);
      window.requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange?.(0, 0);
      });
    } else if (link.kind === "question" && link.text && link.request && !working) {
      void askFollowUpQuestion(link);
    }
  }

  async function readReceipt(file) {
    if (!file) {
      return;
    }
    let prepared = null;
    try {
      prepared = await prepareReceiptImage(file);
    } catch {
      appendThread(threadItem("note", { text: askCopy.notes.photoFailed }));
      return;
    }
    const url = URL.createObjectURL(prepared.blob);
    objectUrlsRef.current.push(url);
    // A large photo is always made smaller here; one still past the
    // reader's cap is not sent, and is read on this device instead.
    const size = receiptSizePlan(file.size ?? 0, prepared.blob.size);
    const sizeNote = size.tooBig ? limitsCopy.photoTooBig : size.large ? limitsCopy.photoLarge : "";
    appendThread(
      threadItem("me", { text: askCopy.you.photo }),
      threadItem("photo", { url }),
      ...(sizeNote ? [threadItem("note", { text: sizeNote })] : [])
    );
    setWorking("receipt");
    setStatus(askCopy.notes.readingReceipt);
    try {
      const result = size.tooBig ? { ok: false } : await requestReceiptRead({ image: prepared.blob });
      let receipt = result.ok ? result.receipt : null;
      // A receipt the reader read needs no note: the card's tag says so.
      let note = "";
      if (!receipt) {
        receipt = await readReceiptOnDevice(prepared.blob, { today }).catch(() => null);
        const readSomething = Boolean(receipt && (receipt.merchant.value || receipt.total.amountMinor || receipt.date.value));
        note = readSomething ? askCopy.notes.receiptOnDevice : askCopy.notes.receiptUnavailable;
        if (!readSomething) {
          receipt = null;
        }
      }
      const base = workingCard();
      setCard(receipt ? applyReceiptRead(base, receipt, context) : base);
      if (note) {
        appendThread(threadItem("note", { text: note }));
      }
    } finally {
      // The photo itself is not kept: only the thumbnail URL above, which
      // is revoked when the page goes.
      prepared = null;
      setStatus("");
      setWorking("");
    }
  }

  async function saveCard() {
    // Save belongs to the card only while it is the newest thing in the
    // conversation (findActiveItem).
    if (!card || !cardActive || !validation?.canSave || working) {
      return;
    }
    // The draft carries the card's client id (given here to a card kept
    // from before ids), so a save repeated after a reload cannot add the
    // entry twice.
    const sending = markCardSaving(card);
    const createDraft = buildCardCreateDraft(sending, context, { splitGroups });
    setCard(sending);
    setWorking("save");
    try {
      const result = await saveCardEntry(createDraft);
      if (!result.ok) {
        setCard((current) => markCardSaveFailed(current, result.error));
        return;
      }
      const groupName = splitGroups.find((group) => group.id === createDraft.splitGroupId)?.name ?? "";
      // A transfer saved with an other side chosen: the existing pair
      // command, so Entries shows one matched transfer.
      const otherSideId = sending.variant === "transfer" && transferMatch && transferMatch.selectedId !== NO_OTHER_SIDE ? transferMatch.selectedId : "";
      const link = otherSideId ? await linkSavedTransfer(transferLinkBody(sending, result.entryId, otherSideId)) : null;
      setCard((current) => {
        const saved = markCardSaved(current, { ...result, splitGroupId: createDraft.splitGroupId });
        return { ...saved, saved: { ...saved.saved, splitGroupName: groupName, ...(link?.ok ? { transferLinkedEntryId: otherSideId } : {}) } };
      });
      const month = createDraft.date.slice(0, 7);
      onEntryMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      if (result.splitExpenseId) {
        onSplitMutation?.({ month: result.splitExpenseMonth ?? month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      }
      appendThread(threadItem("note", {
        text: link && !link.ok
          ? askCopy.notes.transferLinkFailed(link.error)
          : link?.ok
            ? askCopy.notes.savedAndLinked
            : result.splitAddError
              ? askCopy.notes.splitAddFailed(result.splitAddError)
              : result.splitExpenseId ? askCopy.notes.savedOnSplits : askCopy.notes.saved
      }));
      // Bring that month's Entries page up to date, so Back to Entries and
      // Open this entry show the saved row; a failure raises the notice.
      void runBackgroundRefresh(entriesPage.refresh);
    } finally {
      setWorking("");
    }
  }

  async function undoSave() {
    if (!card?.saved || working) {
      return;
    }
    setWorking("undo");
    try {
      const result = await undoSavedEntry(card.saved);
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      const month = card.fields.date.slice(0, 7);
      const hadSplit = Boolean(card.saved.splitExpenseId);
      setCard(markCardUndone(card));
      onEntryMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      if (hadSplit) {
        onSplitMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      }
      appendThread(threadItem("note", { text: askCopy.notes.undone }));
      void runBackgroundRefresh(entriesPage.refresh);
    } finally {
      setWorking("");
    }
  }

  async function changeSavedCategory(categoryName) {
    if (!card?.saved || working || !categoryName) {
      return false;
    }
    setWorking("category");
    try {
      const result = await updateSavedEntryCategory({ entryId: card.saved.entryId, categoryName });
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return false;
      }
      setCard((current) => ({ ...current, fields: { ...current.fields, categoryName } }));
      onEntryMutation?.({ month: card.fields.date.slice(0, 7), invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.notes.categoryChanged(categoryName) }));
      void runBackgroundRefresh(entriesPage.refresh);
      return true;
    } finally {
      setWorking("");
    }
  }

  async function shareSavedEntry(splitGroupId, splitBasisPoints = undefined) {
    if (!card?.saved || working) {
      return false;
    }
    setWorking("share");
    try {
      const result = await addSavedEntryToSplits({ entryId: card.saved.entryId, splitGroupId, splitBasisPoints });
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return false;
      }
      const groupName = splitGroups.find((group) => group.id === splitGroupId)?.name ?? "";
      setCard((current) => ({
        ...current,
        share: { on: true, splitGroupId },
        saved: { ...current.saved, splitExpenseId: result.splitExpenseId ?? null, splitExpenseMonth: result.splitExpenseMonth ?? null, splitGroupId, splitGroupName: groupName }
      }));
      onSplitMutation?.({ month: result.splitExpenseMonth ?? card.fields.date.slice(0, 7), invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.notes.addedToSplits(groupName) }));
      void runBackgroundRefresh(entriesPage.refresh);
      return true;
    } finally {
      setWorking("");
    }
  }

  async function pasteFromClipboard() {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((itemType) => itemType.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            await readReceipt(new File([blob], "pasted-receipt", { type }));
            return;
          }
        }
      }
      const text = navigator.clipboard?.readText ? (await navigator.clipboard.readText()).trim() : "";
      if (text) {
        await readSentence(text);
        return;
      }
      appendThread(threadItem("note", { text: askCopy.notes.pasteEmpty }));
    } catch {
      appendThread(threadItem("note", { text: askCopy.notes.pasteBlocked }));
      composerRef.current?.focus();
    }
  }

  function handleComposerPaste(event) {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void readReceipt(file);
    }
  }

  function handleDrop(event) {
    const file = [...(event.dataTransfer?.files ?? [])].find((item) => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void readReceipt(file);
    }
  }

  const params = useMemo(() => buildContextParams(searchParams, view.id, selectedMonth, selectedScope), [searchParams, selectedMonth, selectedScope, view.id]);

  function goTo(pathname, extra = {}, base = params) {
    const next = new URLSearchParams(base);
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    navigate({ pathname, search: `?${next.toString()}` });
  }

  // Back to the page the + or the receipt button opened Ask from, exactly
  // as it was (ask-origin.js): history.back when that page is right behind
  // Ask, the same as the phone's back gesture; else the kept place; else the
  // plain page for this view and month. A started card stays in the
  // conversation store, so nothing is lost and nothing needs confirming.
  // In the desktop panel the page beside it never left: the chip opens the
  // plain page there, as before.
  const backPlan = useMemo(() => {
    if (intent.from !== "entries" && intent.from !== "splits") {
      return null;
    }
    const next = new URLSearchParams(params);
    if (intent.from === "splits" && intent.splitGroupId) next.set("split_group", intent.splitGroupId);
    const fallback = { pathname: `/${intent.from}`, search: `?${next.toString()}` };
    return inDock
      ? { kind: /** @type {const} */ ("navigate"), to: fallback, state: undefined }
      : planAskBack({ from: intent.from, state: location.state, storage: sessionStore(), fallback });
  }, [inDock, intent.from, intent.splitGroupId, location.state, params]);
  const backHref = backPlan?.kind === "navigate"
    ? `${backPlan.to.pathname}${backPlan.to.search}`
    : readAskOrigin(location.state?.askOrigin)?.path ?? "";

  function goBackToOrigin() {
    if (backPlan?.kind === "history") {
      navigate(-1);
    } else if (backPlan) {
      navigate(backPlan.to, { state: backPlan.state });
    }
  }

  // Another way into Ask: the /ask route, or in the dock the dock's own
  // conversation (the page beside it stays).
  function openAsk(extra = {}) {
    if (!inDock) {
      goTo("/ask", extra);
      return;
    }
    getAskDockStore().setIntent(readAskIntent(new URLSearchParams(Object.entries(extra).filter(([, value]) => value))));
  }

  const actions = {
    scanReceipt: () => cameraInputRef.current?.click(),
    paste: () => void pasteFromClipboard(),
    addEntry: () => openAsk({ mode: "add", from: "ask" }),
    addExpense: () => openAsk({ mode: "expense", from: "ask" }),
    back: () => {
      if (backPlan) {
        goBackToOrigin();
      } else {
        openAsk();
      }
    },
    variant: (variant) => changeVariant(variant),
    swap: () => setCard((current) => swapTransferDirection(current)),
    addNote: () => {
      setMoreOpen(true);
      window.requestAnimationFrame(() => noteRef.current?.focus());
    },
    differentWallet: () => setOpenPicker(card?.variant === "transfer" ? "from" : "wallet"),
    shareOn: () => changeShare({ on: true }),
    shareOff: () => changeShare({ on: false }),
    answer: (question, option) => setCard((current) => answerCardQuestion(current, question, option, context)),
    focusField: (field) => {
      if (field === "amountMinor") amountRef.current?.focus();
      if (field === "description") descriptionRef.current?.focus();
      if (field === "accountId") setOpenPicker("wallet");
      if (field === "date") setOpenPicker("date");
    },
    editInForm: () => {
      if (intent.mode === "expense" && intent.from === "splits") {
        goTo("/splits", { split_group: intent.splitGroupId, split_action: "add-expense" });
        return;
      }
      const fields = card?.fields;
      goTo("/entries", {
        action: "add-expense",
        source: "ask",
        amount: fields?.amountMinor ? (fields.amountMinor / 100).toFixed(2) : "",
        merchant: fields?.description,
        date: fields?.date,
        account_id: fields?.accountId,
        category: card?.variant === "expense" ? fields?.categoryName : "",
        note: fields?.note
      }, buildContextParams(new URLSearchParams(), view.id, fields?.date?.slice(0, 7) || selectedMonth, selectedScope));
    },
    backToEntries: () => goTo("/entries", { month: card?.fields.date.slice(0, 7) }),
    backToSplits: () => goTo("/splits", { split_group: card?.saved?.splitGroupId || intent.splitGroupId, month: card?.saved?.splitExpenseMonth || undefined }),
    openEntry: () => goTo("/entries", { month: card?.fields.date.slice(0, 7), editing_entry: card?.saved?.entryId }),
    openOnSplits: () => goTo("/splits", {
      view: view.id === "household" ? undefined : view.id,
      month: card?.saved?.splitExpenseMonth || card?.fields.date.slice(0, 7),
      split_group: card?.saved?.splitGroupId && card.saved.splitGroupId !== "split-group-none" ? card.saved.splitGroupId : undefined,
      editing_split_expense: card?.saved?.splitExpenseId
    }),
    undo: () => void undoSave(),
    category: (categoryName) => void changeSavedCategory(categoryName),
    chooseCategory: () => setSavedPicker(true),
    shareSaved: (splitGroupId) => void shareSavedEntry(splitGroupId),
    // The split suggestion: on a draft it turns Splits on with the group
    // (saved with the card); on the Apple Pay card it is Add to Splits.
    acceptSplitSuggestion: () => {
      if (!splitSuggestion) return;
      if (card?.status === "saved") {
        setCard((current) => ({ ...current, splitSuggestionAnswer: "accepted" }));
        void shareSavedEntry(splitSuggestion.groupId);
        return;
      }
      setCard((current) => acceptSplitSuggestion(current, splitSuggestion));
    },
    declineSplitSuggestion: () => setCard((current) => declineSplitSuggestion(current)),
    chooseFilterOption,
    answerPlanQuestion,
    answerTurnQuestion,
    switchView,
    resolveCheck: () => void resolveMoneyCheck(),
    keepCheck: () => void keepMoneyCheck(),
    openAnswerLink,
    openInEntries: () => {
      if (active?.kind === "answer" && isTrackedMonth(active.filter.month)) {
        navigate({ pathname: "/entries", search: `?${buildEntriesFilterSearch(active.filter).toString()}` });
      }
    },
    // The unsaved card further up becomes the newest item again: it moves
    // below what was said since, and its chips and Save come back.
    backToCard: () => {
      const current = store.read(conversationKey) ?? conversation;
      setCardSlot(current.thread.filter((item) => item.kind !== "status").length);
      window.requestAnimationFrame(() => threadEndRef.current?.scrollIntoView?.({ block: "end", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
    }
  };

  // The newest thing in the conversation owns the chips and the composer's
  // primary button: an open follow-up or view change, an answer, or the
  // card (findActiveItem in ask-chips.js).
  const active = findActiveItem({ thread, card, cardSlot, pending });
  const cardActive = active?.kind === "card";
  // The header's back link: the phone's Ask page after the + or the receipt
  // button opened it (in the desktop panel the page beside it never left).
  const showHeaderBack = !inDock && isAddMode && Boolean(backPlan);
  const chips = buildChipRow({
    active,
    intent,
    card,
    context,
    splitGroups,
    entries: entriesPage.page?.monthPage?.entries ?? [],
    today,
    partner: card ? partnerName(context, card.fields.ownerName) : "",
    viewLabel: active?.kind === "view" ? viewLabel(active.viewId, active.scope) : "",
    // A month with no entries at all has no Entries page to open (Entries
    // would show the nearest month instead).
    canOpenAnswer: active?.kind !== "answer" || isTrackedMonth(active.filter.month),
    moneyLabels: active?.kind === "money-check" ? skewCheckLabels(active.candidate) : null,
    splitSuggestion,
    headerBack: showHeaderBack,
    actions
  });

  const showSave = Boolean(cardActive && card.status !== "saved" && !composerText.trim());
  const canSave = Boolean(validation?.canSave) && !working;
  const title = !isAddMode
    ? askCopy.title
    : card?.status === "saved"
      ? askCopy.savedTitle
      : askCopy.newTitle[card?.variant ?? "expense"];
  const scopeLabel = view.id !== "household" && !isAddMode ? messages.views.scopeShortLabel[selectedScope] ?? "" : "";
  const contextLine = askCopy.contextLine([view.label, scopeLabel, formatShortMonth(isShortcut ? shortcutMonth : selectedMonth)]);
  const cardPlaceholder = !card
    ? askCopy.composer.chatPlaceholder
    : card.status === "saved"
      ? askCopy.composer.savedPlaceholder
      : card.origin || card.touched
        ? askCopy.composer.changePlaceholder
        : askCopy.composer.addPlaceholder;
  const placeholder = voiceState.status === "listening"
    ? askCopy.voice.listening
    : voiceState.status === "transcribing" ? askCopy.voice.transcribing : cardPlaceholder;
  const pendingQuestion = cardActive && card.status === "draft" ? card.questions[0] ?? null : null;
  const chipSignature = chips.items.map((chip) => chip.key).join("|");
  const settledThread = thread.filter((item) => item.kind !== "status");
  const statusItems = thread.filter((item) => item.kind === "status");
  const questionPrompt = chips.prompt;
  // New chat: in chat mode, once there is something to start over from.
  const showNewChat = !isAddMode && !isShortcut && Boolean(settledThread.length || card || composerText.trim() || pending);
  const answerProps = {
    queryClient,
    fetchEntriesPage,
    accounts,
    categories,
    people,
    trackedMonths,
    today,
    turn: {
      busy: Boolean(working),
      onSaveSplit: (itemId) => void saveTurnSplit(itemId),
      onDiscardSplit: (itemId) => discardTurnItem(itemId, "split-proposal", askCopy.turn.split.discarded),
      onSplitAsPercent: (itemId) => splitAsPercent(itemId),
      onUndoSplit: (itemId) => void undoTurnSplit(itemId),
      onOpenSplit: openTurnSplit,
      onSaveSettlement: (itemId) => void saveTurnSettlement(itemId),
      onDiscardSettlement: (itemId) => discardTurnItem(itemId, "settlement-draft", askCopy.turn.settlement.discarded),
      onOpenSettlement: openTurnSettlement,
      onSaveChange: (itemId) => void saveTurnChange(itemId),
      onDiscardChange: (itemId) => discardTurnItem(itemId, "change-draft", askCopy.turn.change.discarded),
      onUndoChange: (itemId) => void undoTurnChange(itemId),
      onConfirmChange: confirmTurnChange,
      onChooseTransfer: (itemId, choiceId) => {
        const item = turnItem(itemId, "change-draft");
        if (item?.status === "draft" && !working) updateThreadItem(itemId, { choiceId });
      },
      onRuleChange: (itemId) => void saveTurnRule(itemId),
      onOpenChange: openTurnChange,
      onLinkMatch: (itemId, matchId) => void linkTurnMatchItem(itemId, matchId),
      onSkipMatch: skipTurnMatch,
      onOpenMatches: (itemId) => {
        const item = turnItem(itemId, "matches");
        goTo("/splits", { month: item?.month });
      }
    },
    plan: {
      busy: Boolean(working),
      onSave: (itemId) => void savePlanDraft(itemId),
      onDiscard: discardPlanDraft,
      onUndo: (itemId) => void undoPlanDraft(itemId),
      onOpenMonth: openPlanMonth
    }
  };

  // In the dock: the field hides once this conversation is here, the words
  // typed into it (and a photo dropped on it) carry over once, and a
  // person's open (or "/") puts focus in the message box.
  useEffect(() => {
    if (!inDock) return undefined;
    const dock = getAskDockStore();
    dock.setReady(true);
    const takeText = (text) => {
      // As typed, trailing space included: the person may still be typing.
      const before = store.read(conversationKey)?.composerText ?? "";
      setComposerText(before && !/\s$/.test(before) ? `${before} ${text}` : `${before}${text}`);
    };
    const handoff = dock.takeHandoff();
    if (handoff.insight) {
      void askAboutInsight(handoff.insight);
    }
    if (handoff.question) {
      void readSentence(handoff.question);
    }
    if (handoff.text) {
      takeText(handoff.text);
    }
    if (handoff.file) {
      void readReceipt(handoff.file);
    }
    // While this conversation is open, the field's words go into the
    // message box, and an insight or a lead's "Ask about this" question is
    // asked at once (openAskDockNow's `text`, `insight` and `question`).
    const onDockChange = () => {
      // Only the conversation the dock now shows takes it (opening with a
      // new way in tells this one first, before it gives way).
      const snapshot = dock.getSnapshot();
      if ((snapshot.draftText || dock.hasQuestionHandoff()) && askConversationKey(snapshot.intent) === conversationKey) {
        const next = dock.takeHandoff();
        if (next.text) takeText(next.text);
        if (next.file) void readReceipt(next.file);
        if (next.insight) void askAboutInsight(next.insight);
        if (next.question) void readSentence(next.question);
      }
      if (dock.takeFocusRequest()) composerRef.current?.focus();
    };
    onDockChange();
    const unsubscribe = dock.subscribe(onDockChange);
    return () => {
      unsubscribe();
      dock.setReady(false);
    };
    // Once per conversation shown in the dock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inDock, conversationKey]);

  // On a phone, "Ask about this" opens /ask with the insight in history
  // state (App.jsx): asked once, then dropped from the entry, so a reload
  // or going back and forward does not ask it again.
  const stateInsight = inDock ? null : location.state?.askInsight ?? null;
  useEffect(() => {
    if (!stateInsight || typeof stateInsight !== "object" || askedInsightHandoffs.has(stateInsight)) {
      return;
    }
    askedInsightHandoffs.add(stateInsight);
    const { askInsight: _asked, ...restState } = location.state ?? {};
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: Object.keys(restState).length ? restState : null });
    void askAboutInsight(stateInsight);
    // Once per insight handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateInsight]);

  // On a phone, a lead's "Ask about this" (ui/money-actions.jsx) opens /ask
  // with its question in history state (App.jsx): sent once as if typed,
  // then dropped from the entry, so a reload or going back and forward does
  // not ask it again.
  const stateQuestion = inDock || isAddMode ? null : location.state?.askQuestion ?? null;
  useEffect(() => {
    if (!stateQuestion || typeof stateQuestion !== "object" || typeof stateQuestion.text !== "string" || askedInsightHandoffs.has(stateQuestion)) {
      return;
    }
    askedInsightHandoffs.add(stateQuestion);
    const { askQuestion: _asked, ...restState } = location.state ?? {};
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: Object.keys(restState).length ? restState : null });
    void readSentence(stateQuestion.text);
    // Once per question handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateQuestion]);

  // Escape closes the popup, unless something inside already handled it
  // (a menu or picker) or the person is typing in a field on the page
  // beside it; the docked panel, a fixture beside the page, closes only
  // when focus is inside it. Focus then goes back to the Ask field.
  const articleRef = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    if (!inDock) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      const inside = Boolean(active && articleRef.current?.closest(".ask-dock")?.contains(active));
      const typingOnPage = !inside && active instanceof HTMLElement && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName));
      if (inside || (placement === "popup" && !typingOnPage)) {
        event.preventDefault();
        getAskDockStore().close({ returnFocus: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inDock, placement]);

  // A new set of chips starts scrolled to its first chip (focus stays put).
  useLayoutEffect(() => {
    if (chipsRef.current) {
      chipsRef.current.scrollLeft = 0;
    }
  }, [chipSignature]);

  // The + menu closes first, then does what was chosen (a file picker or
  // the paste reader) inside the same tap.
  function chooseFromAddMenu(action) {
    setAddMenuOpen(false);
    action();
  }

  function startVoice() {
    voiceBaseRef.current = composerText;
    setVoiceAnnouncement("");
    return voice.start();
  }

  // Hold to talk, or tap to start and tap to stop (createPressGesture).
  function handleMicPointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    // Keeps focus (and the phone's keyboard) where it is, and stops a long
    // press from selecting text.
    event.preventDefault();
    // The release reaches the mic even if it moves under the finger (Save
    // turns into the narrower Send arrow once words arrive).
    event.currentTarget.setPointerCapture?.(event.pointerId);
    micPointerRef.current = true;
    if (micGesture.down(voice.getState().status !== "idle") === "start") {
      micRetryRef.current = !startVoice();
    }
  }

  function handleMicPointerUp() {
    if (micGesture.up(voice.getState().status === "listening") === "stop") {
      voice.stop();
    }
  }

  function handleMicPointerCancel() {
    if (micGesture.cancel(voice.getState().status === "listening") === "stop") {
      voice.stop();
    }
  }

  function handleMicClick() {
    if (micPointerRef.current) {
      micPointerRef.current = false;
      // A browser that wanted a tap before listening gets it now.
      if (micRetryRef.current) {
        micRetryRef.current = false;
        startVoice();
      }
      return;
    }
    // A keyboard or screen reader press: a plain toggle.
    if (voice.getState().status === "idle") {
      startVoice();
    } else {
      voice.stop();
    }
  }

  function submitComposer(event) {
    event.preventDefault();
    // Sending is always the person's tap; it ends any listening first.
    if (voiceActive) {
      voice.cancel();
    }
    const text = composerText.trim();
    if (!text) {
      void saveCard();
      return;
    }
    // Past the Ask routes' cap the message stays in the box with the hint
    // under it saying so; nothing is sent.
    if (working || messageTooLong) {
      return;
    }
    setComposerText("");
    void readSentence(text);
  }

  const messageLength = askMessageLength(composerText);
  const messageTooLong = limitState(messageLength, ASK_MESSAGE_MAX).over;

  const newChatButton = showNewChat ? (
    <button type="button" className="ask-new-chat" onClick={onNewChat} disabled={Boolean(working)}>
      <SquarePen size={16} aria-hidden="true" />
      {askCopy.newChat}
    </button>
  ) : null;

  return (
    <article
      ref={articleRef}
      className={`panel ask-page${isAddMode ? " is-add-mode" : ""}${inDock ? ` is-in-dock is-${placement}` : ""}`}
      aria-labelledby="ask-page-title"
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleDrop}
    >
      <header className={`ask-head${isAddMode ? " is-inline" : ""}${showNewChat ? " has-new-chat" : ""}${inDock ? " has-actions" : ""}${showHeaderBack ? " has-back" : ""}`}>
        {showHeaderBack ? (
          <a
            className="ask-back"
            href={backHref}
            aria-label={askCopy.chips.backTo(askCopy.backLabels[intent.from])}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
              }
              event.preventDefault();
              goBackToOrigin();
            }}
          >
            {askCopy.chips.back(askCopy.backLabels[intent.from])}
          </a>
        ) : null}
        <h2 id="ask-page-title">{title}</h2>
        <span className="ask-context">{contextLine}</span>
        {inDock ? (
          <span className="ask-head-actions">
            {newChatButton}
            {canExpand ? (
              <button type="button" className="ask-dock-expand" aria-label={messages.askDock.expand} title={messages.askDock.expand} onClick={() => getAskDockStore().expand()}>
                <Maximize2 size={18} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="ask-dock-close" aria-label={messages.askDock.closeLabel} onClick={() => getAskDockStore().close({ returnFocus: true })}>
              {messages.askDock.close}
            </button>
          </span>
        ) : newChatButton}
      </header>

      <div ref={threadBoxRef} className="ask-thread" role="log" aria-live="polite" aria-relevant="additions text" aria-label={askCopy.threadLabel}>
        <AskClaudeCreditNotice queryClient={queryClient} enabled={creditStatusEnabled} fetchRequiredQuery={fetchRequiredQuery} />
        {!isAddMode && !isShortcut ? (
          <AskBriefCard queryClient={queryClient} view={view} scope={selectedScope} month={selectedMonth} accounts={accounts} params={params} />
        ) : null}
        {!isAddMode && !isShortcut && !card && !thread.length ? <EmptyState compact title={askCopy.greeting}>{askCopy.greetingHint}</EmptyState> : null}
        {settledThread.slice(0, card ? cardSlot : settledThread.length).map((item) => <ThreadItem key={item.id} item={item} settled={settledIds.has(item.id)} answerProps={answerProps} />)}
        {card ? (
          <AskEntryCard
            settled={cardWasSettled}
            card={card}
            context={context}
            today={today}
            descriptionRef={descriptionRef}
            amountRef={amountRef}
            onChange={updateCard}
            onOpenField={(key) => {
              // A chip opens its row's picker; the owner row folds into More
              // details. On a wide screen the row is a native select, so it
              // takes focus (and opens, where a browser allows it).
              if (key === "owner") setMoreOpen(true);
              setOpenPicker(key);
              window.requestAnimationFrame(() => {
                const select = document.querySelector(`[data-ask-row="${key}"] select`);
                if (select instanceof HTMLSelectElement) {
                  select.focus();
                  try {
                    select.showPicker?.();
                  } catch {
                    // Focus alone is enough where a select cannot open from script.
                  }
                }
              });
            }}
          />
        ) : null}
        {card?.status === "saved" ? (
          <>
            <AskDoneInline items={habits.items.filter((item) => item.entryId === card.saved?.entryId)} busy={habits.busy} error={habits.suggestion ? "" : habits.error} onUndo={habits.undo} />
            <AskSuggestionRow suggestion={habits.suggestion} busy={habits.busy} error={habits.error} onApply={() => void habits.apply()} onDismiss={habits.dismiss} />
          </>
        ) : null}
        {card && card.status !== "saved" ? (
          <AskCardRows
            card={card}
            context={context}
            today={today}
            splitGroups={splitGroups}
            moreOpen={moreOpen}
            onToggleMore={() => setMoreOpen((open) => !open)}
            openPicker={openPicker}
            onOpenPickerChange={setOpenPicker}
            noteRef={noteRef}
            onChange={updateCard}
            onVariantChange={changeVariant}
            onShareChange={changeShare}
          />
        ) : null}
        {card && card.status === "draft" && card.variant === "transfer" && transferMatch ? (
          <AskTransferMatchRows
            match={transferMatch}
            currency={context.accounts?.find((account) => account.id === card.fields.accountId)?.currency ?? "SGD"}
            disabled={Boolean(working)}
            onChoose={(id) => setCard((current) => chooseTransferMatch(current, id))}
          />
        ) : null}
        {card ? settledThread.slice(cardSlot).map((item) => <ThreadItem key={item.id} item={item} settled={settledIds.has(item.id)} answerProps={answerProps} />) : null}
        {statusItems.map((item) => <ThreadItem key={item.id} item={item} answerProps={answerProps} />)}
        {card?.saveError ? <p className="ask-note is-error" role="alert">{card.saveError}</p> : null}
        <AskDoneForYou items={habits.items} busy={habits.busy} error={card?.status === "saved" ? "" : habits.error} onUndo={habits.undo} onStop={habits.stop} />
        {questionPrompt ? <p className="ask-note ask-question" data-question-field={pendingQuestion?.field ?? ""}>{questionPrompt}</p> : null}
        <div ref={threadEndRef} />
      </div>

      <div className="ask-bottom">
        {chips.items.length ? (
          <div ref={chipsRef} className="ask-chips" role="group" aria-label={askCopy.chipsLabel}>
            {chips.items.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`ask-chip${chip.primary ? " is-primary" : ""}${chip.back ? " is-back" : ""}`}
                disabled={Boolean(working) || chip.disabled}
                onClick={chip.onClick}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
        <LimitHint
          className="ask-limit-hint"
          size={messageLength}
          max={ASK_MESSAGE_MAX}
          near={limitsCopy.messageLong}
          over={limitsCopy.messageTooLong}
        />
        <form className="ask-composer" onSubmit={submitComposer}>
          <span className="ask-sr-only" role="status" aria-live="polite">{voiceAnnouncement}</span>
          <input ref={cameraInputRef} className="ask-file-input" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { void readReceipt(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={attachInputRef} className="ask-file-input" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => { void readReceipt(event.target.files?.[0]); event.target.value = ""; }} />
          {/* One rounded field: the + glyph, the message box, the mic glyph.
              Send (or Save) outside it is the only filled button. */}
          <div className="ask-field">
            <Popover.Root open={addMenuOpen} onOpenChange={setAddMenuOpen}>
              <Popover.Trigger asChild>
                <button type="button" className="ask-glyph ask-plus" aria-label={askCopy.composer.add} title={askCopy.composer.add} disabled={Boolean(working)}>
                  <Plus size={20} aria-hidden="true" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="ask-add-menu"
                  side="top"
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  tabIndex={-1}
                  // Focus the menu itself, not its first option, so a tap
                  // does not show "Take a photo" as chosen; Tab reaches the
                  // options and Escape closes it.
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
                  }}
                >
                  <div className="ask-add-menu-list" role="group" aria-label={askCopy.composer.add}>
                    <button type="button" onClick={() => chooseFromAddMenu(() => cameraInputRef.current?.click())}>
                      <Camera size={18} aria-hidden="true" />
                      {askCopy.composer.menu.takePhoto}
                    </button>
                    <button type="button" onClick={() => chooseFromAddMenu(() => attachInputRef.current?.click())}>
                      <Image size={18} aria-hidden="true" />
                      {askCopy.composer.menu.choosePhoto}
                    </button>
                    <button type="button" onClick={() => chooseFromAddMenu(() => void pasteFromClipboard())}>
                      <ClipboardPaste size={18} aria-hidden="true" />
                      {askCopy.composer.menu.paste}
                    </button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <textarea
              ref={composerRef}
              className="ask-input"
              rows={1}
              aria-label={askCopy.composer.label}
              placeholder={placeholder}
              value={composerText}
              readOnly={voiceState.status === "listening" || voiceState.status === "transcribing"}
              enterKeyHint="send"
              onChange={(event) => setComposerText(event.target.value)}
              onPaste={handleComposerPaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  submitComposer(event);
                }
              }}
            />
            {voiceState.status === "hidden" ? null : (
              <button
                type="button"
                className={`ask-glyph ask-mic${voiceState.status === "listening" ? " is-listening" : ""}`}
                aria-label={voiceActive ? askCopy.voice.stop : askCopy.voice.start}
                title={voiceActive ? askCopy.voice.stop : askCopy.voice.start}
                disabled={Boolean(working) || voiceState.status === "transcribing"}
                onPointerDown={handleMicPointerDown}
                onPointerUp={handleMicPointerUp}
                onPointerCancel={handleMicPointerCancel}
                onClick={handleMicClick}
                onContextMenu={(event) => event.preventDefault()}
              >
                <Mic size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          {showSave ? (
            <button type="submit" className="ask-save" disabled={!canSave} aria-describedby={canSave ? undefined : "ask-save-hint"}>
              {card?.status === "saving" ? askCopy.composer.saving : askCopy.composer.save}
            </button>
          ) : (
            <button type="submit" className="ask-send" aria-label={askCopy.composer.send} disabled={Boolean(working) || messageTooLong}>
              <ArrowUp size={20} aria-hidden="true" />
            </button>
          )}
          {showSave && !canSave ? <span id="ask-save-hint" className="ask-sr-only">{askCopy.composer.saveHint}</span> : null}
        </form>
      </div>
      {card?.status === "saved" ? (
        <SavedCategoryPicker
          isMobile={isMobile}
          open={savedPicker}
          onOpenChange={setSavedPicker}
          value={card.fields.categoryName}
          categories={categories}
          onValueChange={(categoryName) => {
            setSavedPicker(false);
            actions.category(categoryName);
          }}
        />
      ) : null}
    </article>
  );
}

// The category picker behind the saved card's "Choose category" chip: the
// mobile picker sheet on a phone, a native select dialog on a desktop.
function SavedCategoryPicker({ isMobile, open, onOpenChange, value, categories, onValueChange }) {
  const options = categories
    .filter((category) => category.name !== "Transfer")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((category) => ({ value: category.name, label: category.name }));
  if (!open) {
    return null;
  }
  if (isMobile) {
    return <ResponsiveSelect hideMobileTrigger title={askCopy.card.rows.category} value={value} options={options} open={open} onOpenChange={onOpenChange} onValueChange={onValueChange} />;
  }
  return (
    <div className="ask-saved-picker">
      <label>
        <span>{askCopy.card.rows.category}</span>
        <select autoFocus value={value} onChange={(event) => onValueChange(event.target.value)} onBlur={() => onOpenChange(false)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function ThreadItem({ item, settled = false, answerProps }) {
  const settledClass = settled ? " is-settled" : "";
  if (item.kind === "answer") {
    const { today: _today, plan: _plan, ...filterAnswerProps } = answerProps;
    return <AskAnswerCard filter={item.filter} settled={settled} {...filterAnswerProps} />;
  }
  if (item.kind === "plan-draft") {
    // A discarded draft leaves only its note ("Discarded. The plan is unchanged.").
    if (item.status === "discarded") {
      return null;
    }
    const { plan } = answerProps;
    return (
      <AskPlanDraftCard
        item={item}
        categories={answerProps.categories}
        people={answerProps.people}
        busy={plan.busy}
        settled={settled}
        onSave={() => plan.onSave(item.id)}
        onDiscard={() => plan.onDiscard(item.id)}
        onUndo={() => plan.onUndo(item.id)}
        onOpenMonth={() => plan.onOpenMonth(item.id)}
      />
    );
  }
  if (item.kind === "split-proposal") {
    if (item.status === "discarded") {
      return null;
    }
    const { turn } = answerProps;
    return (
      <AskSplitProposalCard
        item={item}
        busy={turn.busy}
        settled={settled}
        onSave={() => turn.onSaveSplit(item.id)}
        onDiscard={() => turn.onDiscardSplit(item.id)}
        onUndo={() => turn.onUndoSplit(item.id)}
        onGuess={() => turn.onSplitAsPercent(item.id)}
        onOpen={() => turn.onOpenSplit(item.id)}
      />
    );
  }
  if (item.kind === "settlement-draft") {
    if (item.status === "discarded") {
      return null;
    }
    const { turn } = answerProps;
    return (
      <AskSettlementDraftCard
        item={item}
        busy={turn.busy}
        settled={settled}
        onSave={() => turn.onSaveSettlement(item.id)}
        onDiscard={() => turn.onDiscardSettlement(item.id)}
        onOpen={() => turn.onOpenSettlement(item.id)}
      />
    );
  }
  if (item.kind === "change-draft") {
    if (item.status === "discarded") {
      return null;
    }
    const { turn } = answerProps;
    return (
      <AskChangeCard
        item={item}
        busy={turn.busy}
        settled={settled}
        onSave={() => turn.onSaveChange(item.id)}
        onDiscard={() => turn.onDiscardChange(item.id)}
        onUndo={() => turn.onUndoChange(item.id)}
        onConfirm={() => turn.onConfirmChange(item.id)}
        onChooseTransfer={(choiceId) => turn.onChooseTransfer(item.id, choiceId)}
        onRule={() => turn.onRuleChange(item.id)}
        onOpen={() => turn.onOpenChange(item.id)}
      />
    );
  }
  if (item.kind === "matches") {
    const { turn } = answerProps;
    return (
      <AskMatchesCard
        item={item}
        busy={turn.busy}
        settled={settled}
        onLink={(matchId) => turn.onLinkMatch(item.id, matchId)}
        onSkip={(matchId) => turn.onSkipMatch(item.id, matchId)}
        onOpen={() => turn.onOpenMatches(item.id)}
      />
    );
  }
  if (item.kind === "money-answer") {
    return <AskMoneyAnswerCard id={item.id} answer={item.answer} wording={item.wording} intent={item.intent} settled={settled} />;
  }
  if (item.kind === "money-check") {
    return <AskSkewCheckCard id={item.id} candidate={item.candidate} status={item.status} today={answerProps.today} settled={settled} />;
  }
  if (item.kind === "insight-answer") {
    return (
      <AskInsightAnswerCard
        id={item.id}
        answer={item.answer}
        explanation={item.explanation}
        settled={settled}
        queryClient={answerProps.queryClient}
        fetchEntriesPage={answerProps.fetchEntriesPage}
        trackedMonths={answerProps.trackedMonths}
        today={answerProps.today}
      />
    );
  }
  if (item.kind === "me") {
    return item.hiddenText ? <MoneyMessage item={item} settledClass={settledClass} /> : <p className={`ask-me${settledClass}`} id={item.id}>{item.text}</p>;
  }
  if (item.kind === "photo") {
    return (
      <figure className="ask-receipt-thumb">
        <img src={item.url} alt={askCopy.card.receiptThumb} />
      </figure>
    );
  }
  if (item.kind === "status") {
    return <p className="ask-note is-status" aria-busy="true">{item.text}</p>;
  }
  return <p className={`ask-note${item.tone === "calm" ? " is-calm" : ""}${settledClass}`}>{item.text}</p>;
}

// A message that carries amounts (an insight question): with money hidden it
// reads as its hidden words instead, so no figure or sign shows.
function MoneyMessage({ item, settledClass }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return <p className={`ask-me${settledClass}`} id={item.id}>{areTotalsVisible ? item.text : item.hiddenText}</p>;
}

// Why a plan request drew no draft, in plain words. A line that is short
// keeps its amount out of sight while money is hidden.
function describePlanNote(note, totalsVisible) {
  const notes = askPlanCopy.notes;
  const month = (key) => formatMonthYear(key);
  if (note.reason === "no_plan_to_copy") return notes.noPlanToCopy(month(note.month));
  if (note.reason === "same_month") return notes.sameMonth(month(note.month));
  if (note.reason === "unknown_line") return notes.unknownLine(note.name, month(note.month));
  if (note.reason === "nothing_changes") return notes.nothingChanges(month(note.month));
  if (note.reason === "not_enough") return totalsVisible ? notes.notEnough(note.label, moneyWithCurrency(note.plannedMinor)) : notes.notEnoughHidden(note.label);
  return notes.moveMixed;
}

// The page beside the desktop panel, for the turn's context.
function pageOf(pathname) {
  const page = String(pathname ?? "").split("/")[1] ?? "";
  return ["summary", "month", "entries", "splits", "imports", "settings", "faq"].includes(page) ? page : "ask";
}

// The view, month and scope the person is looking at, carried to whichever
// page a chip opens.
function buildContextParams(searchParams, viewId, month, scope) {
  const next = new URLSearchParams();
  const view = searchParams.get("view") ?? viewId;
  if (view) next.set("view", view);
  if (month) next.set("month", month);
  if (scope) next.set("scope", scope);
  return next;
}
