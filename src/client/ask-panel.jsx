import { ArrowUp, Camera } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  addSavedEntryToSplits,
  requestEntryDraft,
  requestReceiptRead,
  saveCardEntry,
  undoSavedEntry,
  updateSavedEntryCategory
} from "./ask-api";
import {
  answerCardQuestion,
  applyEntryDraft,
  applyReceiptRead,
  buildCardCreateDraft,
  cardFromSavedEntry,
  createAskCard,
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
import { AskBriefCard } from "./ask-brief-card";
import { readCachedSplitGroups, useAskEntriesPage } from "./ask-data";
import { AskCardRows, AskEntryCard, partnerName } from "./ask-entry-card";
import { buildAskChips } from "./ask-chips";
import { prepareReceiptImage, readReceiptOnDevice } from "./ask-receipt-image";
import { askCopy, formatShortMonth } from "./copy/ask-copy";
import { messages } from "./copy/en-SG";
import { todayInAppTimeZone } from "./app-dates";
import { useRouteWorkReport } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";
import { ResponsiveSelect } from "./responsive-select";
// The Ask page's styles ship with its route, never with the first screen.
import "./ask-route.css";

// The Ask page (design.md "Ask page"; docs/flows/ask-flow.md). One page,
// three ways in:
// - the Ask tab: a "since you last looked" card from the Money insights
//   already loaded, then the conversation (chat mode);
// - the Entries + button (?mode=add&from=entries) and the Splits receipt
//   button (?mode=expense&from=splits): a new entry card (add mode);
// - the Apple Pay Shortcut (?saved_entry=<id>): that saved entry's card.
// A typed sentence or a receipt photo fills the card through the optional
// readers in ask-api.js; the card always works by hand. Saving goes through
// the Entries composer's create path.
export function AskPanel(props) {
  const [searchParams] = useSearchParams();
  const intent = readAskIntent(searchParams);
  // A new way in starts a new conversation.
  return <AskConversation key={`${intent.mode}|${intent.from}|${intent.savedEntryId}|${intent.splitGroupId}`} {...props} intent={intent} />;
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

let nextThreadId = 0;
function threadItem(kind, fields = {}) {
  nextThreadId += 1;
  return { id: `ask-${nextThreadId}`, kind, ...fields };
}

// A typed line that reads as a question rather than something to add.
function looksLikeQuestion(text) {
  return /\?\s*$/.test(text) || /^(how|what|when|where|why|which|who|did|do|does|is|are|can|show)\b/i.test(text.trim());
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function AskConversation({
  intent,
  view,
  selectedMonth,
  selectedScope,
  accounts,
  categories,
  people,
  shortcutSettings,
  fetchEntriesPage,
  onEntryMutation,
  onSplitMutation,
  runBackgroundRefresh
}) {
  const queryClient = useQueryClient();
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
  const [card, setCard] = useState(() => (isAddMode ? createAskCard(context, { mode: intent.mode, splitGroupId: intent.splitGroupId }) : null));
  const [thread, setThread] = useState(() => (isShortcut ? [threadItem("status", { text: askCopy.notes.shortcutLoading })] : []));
  // The conversation as of now, for handlers that append to it.
  const threadRef = useRef(thread);
  // Where the card sits in the conversation: after the messages that made
  // it, before what happened to it since (saved, undone).
  const [cardSlot, setCardSlot] = useState(0);
  const [composerText, setComposerText] = useState("");
  const [working, setWorking] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState("");
  const [savedPicker, setSavedPicker] = useState(false);
  const [splitGroupsFromCache, setSplitGroupsFromCache] = useState(() => readCachedSplitGroups(queryClient, view.id));
  const objectUrlsRef = useRef([]);
  const chipsRef = useRef(null);
  const threadEndRef = useRef(null);
  const descriptionRef = useRef(null);
  const amountRef = useRef(null);
  const noteRef = useRef(null);
  const composerRef = useRef(null);
  const cameraInputRef = useRef(null);
  const attachInputRef = useRef(null);

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

  useRouteWorkReport({
    ready: true,
    busy: Boolean(working) || card?.status === "saving" || Boolean(card?.touched && card.status === "draft")
  });

  // Photos live in memory only while the page shows them.
  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!splitGroupsFromCache && entriesPage.page?.splitGroups) {
      setSplitGroupsFromCache(entriesPage.page.splitGroups.map((group) => ({ id: group.id, name: group.name })));
    }
  }, [entriesPage.page, splitGroupsFromCache]);

  // The Shortcut's saved entry becomes a saved card once its month loads.
  const shortcutHandledRef = useRef(false);
  useEffect(() => {
    if (!isShortcut || shortcutHandledRef.current || entriesPage.status === "loading" || entriesPage.status === "idle") {
      return;
    }
    shortcutHandledRef.current = true;
    const entry = entriesPage.page?.monthPage?.entries?.find((item) => item.id === intent.savedEntryId);
    const next = [threadItem("note", { text: entry ? askCopy.notes.shortcutSaved : askCopy.notes.shortcutMissing })];
    threadRef.current = next;
    setThread(next);
    setCardSlot(1);
    if (entry) {
      const savedCard = cardFromSavedEntry(entry, context);
      const groupName = entry.linkedSplitGroupName ?? "";
      setCard({ ...savedCard, saved: { ...savedCard.saved, splitGroupName: groupName } });
    }
  }, [context, entriesPage.page, entriesPage.status, intent.savedEntryId, isShortcut]);

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
    const lastMine = [...newItems].reverse().find((item) => item.kind === "me");
    if (lastMine) {
      document.getElementById(lastMine.id)?.scrollIntoView?.({ block: "start", behavior });
      return;
    }
    threadEndRef.current?.scrollIntoView?.({ block: "end", behavior });
  }, [card?.status, thread]);

  const validation = useMemo(() => (card ? validateCard(card, { splitGroups }) : null), [card, splitGroups]);
  const commitThread = useCallback((next) => {
    threadRef.current = next;
    setThread(next);
  }, []);
  const appendThread = useCallback((...items) => commitThread([...threadRef.current.filter((item) => item.kind !== "status"), ...items]), [commitThread]);
  const setStatus = useCallback((text) => commitThread([...threadRef.current.filter((item) => item.kind !== "status"), ...(text ? [threadItem("status", { text })] : [])]), [commitThread]);

  const updateCard = useCallback((patch) => setCard((current) => (current ? setCardField(current, patch, context) : current)), [context]);
  const changeVariant = useCallback((variant) => setCard((current) => (current ? setCardVariant(current, variant, context) : current)), [context]);
  const changeShare = useCallback((share) => setCard((current) => (current ? setShare(current, share) : current)), []);

  // A new card for a new message once the last one is saved.
  // The card a message or receipt fills (a new one once the last is saved).
  // It moves below the message that filled it, as the newest thing said.
  function workingCard() {
    setCardSlot(threadRef.current.filter((item) => item.kind !== "status").length);
    if (!card || card.status === "saved") {
      return createAskCard(context, { mode: intent.mode === "expense" ? "expense" : "add", splitGroupId: intent.splitGroupId });
    }
    return card;
  }

  async function readSentence(text) {
    appendThread(threadItem("me", { text }));
    if (!card && looksLikeQuestion(text)) {
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
    appendThread(threadItem("me", { text: askCopy.you.photo }), threadItem("photo", { url }));
    setWorking("receipt");
    setStatus(askCopy.notes.readingReceipt);
    try {
      const result = await requestReceiptRead({ image: prepared.blob });
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
    if (!card || !validation?.canSave || working) {
      return;
    }
    const createDraft = buildCardCreateDraft(card, context, { splitGroups });
    setCard(markCardSaving(card));
    setWorking("save");
    try {
      const result = await saveCardEntry(createDraft);
      if (!result.ok) {
        setCard((current) => markCardSaveFailed(current, result.error));
        return;
      }
      const groupName = splitGroups.find((group) => group.id === createDraft.splitGroupId)?.name ?? "";
      setCard((current) => {
        const saved = markCardSaved(current, { ...result, splitGroupId: createDraft.splitGroupId });
        return { ...saved, saved: { ...saved.saved, splitGroupName: groupName } };
      });
      const month = createDraft.date.slice(0, 7);
      onEntryMutation?.({ month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      if (result.splitExpenseId) {
        onSplitMutation?.({ month: result.splitExpenseMonth ?? month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      }
      appendThread(threadItem("note", {
        text: result.splitAddError
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
      return;
    }
    setWorking("category");
    try {
      const result = await updateSavedEntryCategory({ entryId: card.saved.entryId, categoryName });
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return;
      }
      setCard((current) => ({ ...current, fields: { ...current.fields, categoryName } }));
      onEntryMutation?.({ month: card.fields.date.slice(0, 7), invalidateEntries: true, invalidateMonth: true, invalidateSummary: true });
      appendThread(threadItem("note", { text: askCopy.notes.categoryChanged(categoryName) }));
      void runBackgroundRefresh(entriesPage.refresh);
    } finally {
      setWorking("");
    }
  }

  async function shareSavedEntry(splitGroupId) {
    if (!card?.saved || working) {
      return;
    }
    setWorking("share");
    try {
      const result = await addSavedEntryToSplits({ entryId: card.saved.entryId, splitGroupId });
      if (!result.ok) {
        appendThread(threadItem("note", { text: result.error }));
        return;
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

  const actions = {
    scanReceipt: () => cameraInputRef.current?.click(),
    paste: () => void pasteFromClipboard(),
    addEntry: () => goTo("/ask", { mode: "add", from: "ask" }),
    addExpense: () => goTo("/ask", { mode: "expense", from: "ask" }),
    back: () => {
      if (intent.from === "splits") {
        goTo("/splits", { split_group: intent.splitGroupId });
      } else if (intent.from === "entries") {
        goTo("/entries");
      } else {
        goTo("/ask");
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
    shareSaved: (splitGroupId) => void shareSavedEntry(splitGroupId)
  };

  const chips = buildAskChips({
    intent,
    card,
    context,
    splitGroups,
    entries: entriesPage.page?.monthPage?.entries ?? [],
    today,
    partner: card ? partnerName(context, card.fields.ownerName) : "",
    actions
  });

  const showSave = Boolean(card && card.status !== "saved" && !composerText.trim());
  const canSave = Boolean(validation?.canSave) && !working;
  const title = !isAddMode
    ? askCopy.title
    : card?.status === "saved"
      ? askCopy.savedTitle
      : askCopy.newTitle[card?.variant ?? "expense"];
  const scopeLabel = view.id !== "household" && !isAddMode ? messages.views.scopeShortLabel[selectedScope] ?? "" : "";
  const contextLine = askCopy.contextLine([view.label, scopeLabel, formatShortMonth(isShortcut ? shortcutMonth : selectedMonth)]);
  const placeholder = !card
    ? askCopy.composer.chatPlaceholder
    : card.status === "saved"
      ? askCopy.composer.savedPlaceholder
      : card.origin || card.touched
        ? askCopy.composer.changePlaceholder
        : askCopy.composer.addPlaceholder;
  const pendingQuestion = card?.status === "draft" ? card.questions[0] ?? null : null;
  const chipSignature = chips.items.map((chip) => chip.key).join("|");
  const settledThread = thread.filter((item) => item.kind !== "status");
  const statusItems = thread.filter((item) => item.kind === "status");
  const questionPrompt = chips.prompt;

  // A new set of chips starts scrolled to its first chip (focus stays put).
  useLayoutEffect(() => {
    if (chipsRef.current) {
      chipsRef.current.scrollLeft = 0;
    }
  }, [chipSignature]);

  function submitComposer(event) {
    event.preventDefault();
    const text = composerText.trim();
    if (!text) {
      void saveCard();
      return;
    }
    if (working) {
      return;
    }
    setComposerText("");
    void readSentence(text);
  }

  return (
    <article
      className={`panel ask-page${isAddMode ? " is-add-mode" : ""}`}
      aria-labelledby="ask-page-title"
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleDrop}
    >
      <header className={`ask-head${isAddMode ? " is-inline" : ""}`}>
        <h2 id="ask-page-title">{title}</h2>
        <span className="ask-context">{contextLine}</span>
      </header>

      <div className="ask-thread" role="log" aria-live="polite" aria-relevant="additions text" aria-label={askCopy.threadLabel}>
        {!isAddMode && !isShortcut ? (
          <AskBriefCard queryClient={queryClient} view={view} scope={selectedScope} month={selectedMonth} accounts={accounts} params={params} />
        ) : null}
        {!isAddMode && !isShortcut && !card && !thread.length ? <p className="ask-note">{askCopy.greeting}</p> : null}
        {settledThread.slice(0, card ? cardSlot : settledThread.length).map((item) => <ThreadItem key={item.id} item={item} />)}
        {card ? (
          <AskEntryCard
            card={card}
            context={context}
            today={today}
            descriptionRef={descriptionRef}
            amountRef={amountRef}
            onChange={updateCard}
          />
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
        {card ? settledThread.slice(cardSlot).map((item) => <ThreadItem key={item.id} item={item} />) : null}
        {statusItems.map((item) => <ThreadItem key={item.id} item={item} />)}
        {card?.saveError ? <p className="ask-note is-error" role="alert">{card.saveError}</p> : null}
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
        <form className="ask-composer" onSubmit={submitComposer}>
          <button type="button" className="ask-icon-button" aria-label={askCopy.composer.attach} title={askCopy.composer.attach} disabled={Boolean(working)} onClick={() => attachInputRef.current?.click()}>
            <Camera size={20} aria-hidden="true" />
          </button>
          <input ref={cameraInputRef} className="ask-file-input" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { void readReceipt(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={attachInputRef} className="ask-file-input" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(event) => { void readReceipt(event.target.files?.[0]); event.target.value = ""; }} />
          <textarea
            ref={composerRef}
            className="ask-input"
            rows={1}
            aria-label={askCopy.composer.label}
            placeholder={placeholder}
            value={composerText}
            enterKeyHint="send"
            onChange={(event) => setComposerText(event.target.value)}
            onPaste={handleComposerPaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                submitComposer(event);
              }
            }}
          />
          {showSave ? (
            <button type="submit" className="ask-save" disabled={!canSave} aria-describedby={canSave ? undefined : "ask-save-hint"}>
              {card?.status === "saving" ? askCopy.composer.saving : askCopy.composer.save}
            </button>
          ) : (
            <button type="submit" className="ask-send" aria-label={askCopy.composer.send} disabled={Boolean(working)}>
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

function ThreadItem({ item }) {
  if (item.kind === "me") {
    return <p className="ask-me" id={item.id}>{item.text}</p>;
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
  return <p className={`ask-note${item.tone === "calm" ? " is-calm" : ""}`}>{item.text}</p>;
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
