import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CASH_DEFAULT_DESCRIPTION,
  addDays,
  formatCashAmount,
  groupCashPadText,
  isPadDefaultDescription,
  isZeroDecimalCurrency,
  pressCashPadKey
} from "../domain/cash-entry";
import {
  deviceStorage,
  flushCashQueue,
  keepWaitingCash,
  newCashRequestId,
  readCashQueue,
  rememberCashDefaults,
  rememberedCashDefaults,
  removeWaitingCash,
  requestCashDefaults,
  sendCashEntry,
  subscribeCashQueue
} from "./cash-queue";
import { DETAILS_CLOSED, againChipLabel, buildCashBody, cashCategoryChips, describeCashLine, nextCashDetails, payWayChoices, quickRowLabel, savedWhat, tapButtonLabel } from "./cash-pad-model";
import { cashPadCopy as copy } from "./copy/cash-pad-copy";
import { addSavedEntryToSplits, requestSplitSuggestion, undoSavedEntry, updateSavedEntryCategory } from "./ask-api";
import { CategoryPickerHost } from "./category-picker-host";
import { useMoneyPrivacy } from "./money-privacy";
import { todayInAppTimeZone } from "./app-dates";
import { QuickPadWords } from "./quick-pad-words";
import "./cash-pad.css";

// The quick pad (design.md "Cash pad"; docs/flows/cash-entry-flow.md): the
// fastest way to log a payment just made, in cash or by card. It opens on a
// large number pad at the bottom of the screen, under the thumb; every other
// field is decided already and shown as one quiet line that can be tapped to
// change (Paid with: Cash or one of the person's cards). Save works with just
// an amount. An Apple Pay tap that came without its amount shows above
// Again: one tap picks it and Save finishes it. After Save the sheet shows
// the saved line with Undo, one-tap chips (a category, Shared) and one words
// box ("dinner, split with Joyce") that Ask reads into a change card; Add
// another keeps the pad open. Ask's "need a few words" reminder opens the
// pad on the list of payments still waiting for words. A Save that cannot
// reach the server waits on this device (cash-queue.js) and sends itself
// later. It ships in Ask's lazy route chunk, never on the first screen.

// The pad's three glyphs, drawn here (the lucide shapes) so this lazy chunk
// shares no icon code with the first screen's chunks.
function Glyph({ size, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const Check = ({ size = 16 }) => <Glyph size={size}><path d="M20 6 9 17l-5-5" /></Glyph>;
const X = ({ size = 16 }) => <Glyph size={size}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Glyph>;
const Delete = ({ size = 16 }) => <Glyph size={size}><path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" /><path d="m12 9 6 6" /><path d="m18 9-6 6" /></Glyph>;

const PERSON_KEY = "monies.cashPerson.v1";
const WALLET_KEY = "monies.cashWallet.v1";
// "Paid with" for the rest of the day on this device, per person: a
// convenience only (the server checks every card).
const WAY_KEY = "monies.padWay.v1";
const COMMON_CURRENCIES = ["SGD", "IDR", "JPY", "KRW", "VND", "THB", "MYR", "USD", "EUR", "GBP", "AUD", "HKD"];
// When a person has no cash history yet, the chips after Save start with
// these, where the household has them.
const FIRST_CATEGORY_CHIPS = ["Food & Drinks", "Transport", "Groceries", "Shopping"];

function readStored(key) {
  try {
    return JSON.parse(deviceStorage()?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    deviceStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
}

function firstPersonId(people, viewId) {
  if (people.some((person) => person.id === viewId)) return viewId;
  const remembered = readStored(PERSON_KEY);
  if (people.some((person) => person.id === remembered)) return remembered;
  return people[0]?.id ?? "";
}

// The card chosen today on this device for the person, or "" (cash).
function rememberedCard(personId, today) {
  const stored = readStored(WAY_KEY)?.[personId];
  return stored && stored.day === today && typeof stored.cardId === "string" ? stored.cardId : "";
}

const EMPTY_AFTER = { category: "", shared: false, splitExpenseId: "", busy: false, words: 0 };

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   people: Array<{ id: string, name: string }>,
 *   accounts: Array<{ id: string, name: string, kind: string, currency: string, ownerPersonId?: string, isJoint?: boolean, isActive?: boolean }>,
 *   categories: Array<{ name: string }>,
 *   viewId?: string,
 *   startWith?: "pad" | "words",
 *   startPersonId?: string,
 *   onChanged?: (month: string) => void,
 *   onTypeInstead?: () => void
 * }} props
 */
// `onTypeInstead`, from a new entry: the pad's quiet way out ("Type it
// instead") back to that entry, to type or say a sentence or scan a receipt.
export default function CashPadSheet({ open, onOpenChange, people, accounts, categories, viewId = "household", startWith = "pad", startPersonId = "", onChanged = () => {}, onTypeInstead = undefined }) {
  // Set by Type it instead: the page focuses its message box itself, so the
  // dialog does not hand focus back on its way out.
  const leavingToTypeRef = useRef(false);
  const { areTotalsVisible } = useMoneyPrivacy();
  const [today] = useState(() => todayInAppTimeZone());
  const [personId, setPersonId] = useState(() => firstPersonId(people, startPersonId || viewId));
  const person = people.find((item) => item.id === personId) ?? people[0];
  const [defaults, setDefaults] = useState(() => rememberedCashDefaults(personId));
  const [padText, setPadText] = useState("");
  const [currency, setCurrency] = useState(/** @type {string | null} */ (null));
  const [date, setDate] = useState(today);
  const [walletId, setWalletId] = useState(() => readStored(WALLET_KEY)?.[personId] ?? "");
  // "Paid with": "" is cash, else one of the person's cards.
  const [cardId, setCardId] = useState(() => rememberedCard(personId, today));
  const [tap, setTap] = useState(/** @type {any} */ (null));
  const [offer, setOffer] = useState(/** @type {any} */ (null));
  const [again, setAgain] = useState(/** @type {any} */ (null));
  // The details panel, and whether a wallet picked in it saves
  // (nextCashDetails: only when Save asked which wallet).
  const [detailsState, setDetailsState] = useState(/** @type {{ open: boolean, saveOnPick: boolean }} */ (DETAILS_CLOSED));
  const changeOpen = detailsState.open;
  const moveDetails = (event) => setDetailsState((current) => nextCashDetails(current, event));
  const [askWallet, setAskWallet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(/** @type {any} */ (null));
  const [after, setAfter] = useState(EMPTY_AFTER);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waiting, setWaiting] = useState(() => readCashQueue());
  // The list of payments that need a few words (Ask's reminder opens it).
  const [listOpen, setListOpen] = useState(startWith === "words");
  const [listRow, setListRow] = useState("");
  const [described, setDescribed] = useState(/** @type {Record<string, boolean>} */ ({}));
  // Bumped when a payment reaches the server, so the Again chips follow.
  const [sentCount, setSentCount] = useState(0);
  const requestIdRef = useRef(newCashRequestId());

  const activeCurrency = currency ?? defaults?.currency ?? "SGD";
  const zeroDecimal = isZeroDecimalCurrency(activeCurrency);
  const personAccounts = useMemo(() => {
    const rank = (account) => (account.kind === "cash" ? 0 : account.kind === "bank" ? 1 : 2);
    return accounts
      .filter((account) => account.isActive !== false && (account.ownerPersonId === personId || account.isJoint))
      .sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
  }, [accounts, personId]);
  const chosenWallet = walletId ? personAccounts.find((account) => account.id === walletId) : null;
  const wallet = chosenWallet ?? defaults?.wallet ?? null;
  const cards = defaults?.personId === personId ? defaults?.cards ?? [] : [];
  const card = cardId ? cards.find((item) => item.id === cardId) ?? null : null;
  const taps = defaults?.personId === personId ? defaults?.waitingTaps ?? [] : [];
  const categoryNames = useMemo(() => categories.map((category) => category.name), [categories]);

  // The defaults for the person: the server's, else the last read on this
  // device, so the pad opens with no signal too.
  useEffect(() => {
    if (!open || !personId) return undefined;
    const controller = new AbortController();
    setDefaults((current) => (current?.personId === personId ? current : rememberedCashDefaults(personId)));
    void requestCashDefaults(personId, { signal: controller.signal }).then((next) => {
      if (next && !controller.signal.aborted) {
        setDefaults(next);
        rememberCashDefaults(next);
      }
    });
    return () => controller.abort();
  }, [open, personId, sentCount]);

  // The page's refresh, read through a ref so the waiting-list effect below
  // runs once per opening, not on every render of the page around it.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const reportSent = useCallback((entry) => {
    setSentCount((count) => count + 1);
    onChangedRef.current(String(entry?.date ?? today).slice(0, 7));
  }, [today]);

  // Waiting payments: shown here, sent when the connection returns and when
  // the pad opens.
  useEffect(() => {
    if (!open) return undefined;
    const unsubscribe = subscribeCashQueue(setWaiting);
    const flush = () => {
      void flushCashQueue({ onSaved: reportSent }).then((count) => {
        if (count) setMessage(copy.sent(count));
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => {
      unsubscribe();
      window.removeEventListener("online", flush);
    };
  }, [open, reportSent]);

  const resetPad = useCallback(() => {
    setPadText("");
    setAgain(null);
    setTap(null);
    setOffer(null);
    setError("");
    setSaved(null);
    setAfter(EMPTY_AFTER);
    requestIdRef.current = newCashRequestId();
  }, []);

  const press = useCallback((key) => {
    setError("");
    setOffer(null);
    setPadText((current) => pressCashPadKey(current, key, activeCurrency));
  }, [activeCurrency]);

  // `answer`: the person's choice when a tap on this card waits ("tap": it
  // is that tap; "new": a separate payment). `pickedWalletId`: the wallet
  // just picked to answer Save's wallet question.
  async function save(answer = "", pickedWalletId = "") {
    if (saving) return;
    const asTap = tap ?? (answer === "tap" ? offer : null);
    const body = buildCashBody({
      requestId: requestIdRef.current,
      personId,
      padText,
      currency: activeCurrency,
      date,
      accountId: pickedWalletId || chosenWallet?.id || "",
      again: asTap ? null : again,
      cardId: card?.id ?? "",
      tapId: asTap?.id ?? "",
      newPayment: answer === "new"
    });
    if (!body) return;
    setSaving(true);
    setError("");
    setMessage("");
    setOffer(null);
    const label = { description: asTap?.merchant || again?.description || CASH_DEFAULT_DESCRIPTION, amountMinor: body.amountMinor, currency: activeCurrency };
    const result = await sendCashEntry(body);
    setSaving(false);
    writeStored(PERSON_KEY, personId);
    if (!(result.kind === "refused" && result.needsWallet)) moveDetails("sent");
    if (result.kind === "saved") {
      setSaved(result.entry);
      setTap(null);
      setAskWallet(false);
      reportSent(result.entry);
      return;
    }
    if (result.kind === "waiting") {
      keepWaitingCash({ requestId: body.requestId, body, label, queuedAt: new Date().toISOString() });
      const kept = readCashQueue().some((item) => item.requestId === body.requestId);
      setMessage(kept
        ? [copy.waitingSaved(savedWhat(label, areTotalsVisible)), result.error === "rate" ? copy.waitingRate(activeCurrency) : ""].filter(Boolean).join(" ")
        : copy.waitingNotKept);
      if (kept) resetPad();
      return;
    }
    if (result.offerTap) {
      // Nothing saved: is this the tap Apple Pay sent without its amount?
      setOffer(result.offerTap);
      return;
    }
    if (result.needsWallet) {
      setAskWallet(true);
      moveDetails("asked");
      setError(copy.walletQuestion);
      return;
    }
    setError(result.error);
  }

  // Digits, Backspace, "." and Enter on a keyboard (a wide screen).
  function onKeyDown(event) {
    if (saved || listOpen || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === "Backspace") press("back");
    else if (event.key === "." || event.key === ",") press(".");
    else if (event.key === "Enter") void save();
    else return;
    event.preventDefault();
  }

  function chooseWallet(id) {
    setWalletId(id);
    const stored = readStored(WALLET_KEY) ?? {};
    writeStored(WALLET_KEY, { ...stored, [personId]: id });
    setAskWallet(false);
    setError("");
    // Save asked for this wallet: the payment saves with it.
    if (detailsState.saveOnPick) void save("", id);
  }

  // "Paid with": Cash or a card, remembered for the rest of today here.
  function chooseWay(value) {
    const next = value === "cash" ? "" : value;
    setCardId(next);
    setTap(null);
    setOffer(null);
    setError("");
    const stored = readStored(WAY_KEY) ?? {};
    writeStored(WAY_KEY, { ...stored, [personId]: { day: today, cardId: next } });
  }

  function choosePerson(id) {
    setPersonId(id);
    setWalletId(readStored(WALLET_KEY)?.[id] ?? "");
    setCardId(rememberedCard(id, today));
    setTap(null);
    setOffer(null);
    setCurrency(null);
  }

  // A waiting tap: its shop and card are known; the pad needs the amount.
  function chooseTap(item) {
    setTap((current) => (current?.id === item.id ? null : item));
    setAgain(null);
    setOffer(null);
    setError("");
  }

  async function changeCategory(categoryName) {
    if (!saved) return { ok: false };
    setAfter((current) => ({ ...current, busy: true }));
    const result = await updateSavedEntryCategory({ entryId: saved.entryId, categoryName });
    setAfter((current) => ({ ...current, busy: false, ...(result.ok ? { category: categoryName } : {}) }));
    if (result.ok) onChanged(saved.date.slice(0, 7));
    else setError(copy.followUpFailed);
    return result;
  }

  async function share() {
    if (!saved || after.shared) return;
    setAfter((current) => ({ ...current, busy: true }));
    const suggestion = await requestSplitSuggestion({ entryId: saved.entryId });
    const result = await addSavedEntryToSplits({
      entryId: saved.entryId,
      splitGroupId: suggestion?.groupId ?? "",
      splitBasisPoints: suggestion?.basisPoints
    });
    setAfter((current) => ({ ...current, busy: false, ...(result.ok ? { shared: true, splitExpenseId: String(result.splitExpenseId ?? "") } : {}) }));
    if (result.ok) onChanged(saved.date.slice(0, 7));
    else setError(copy.followUpFailed);
  }

  // The words box saved its change: the saved line, the chips and the pages
  // follow it.
  function wordsSaved(change, entryId) {
    const update = change.save.find((step) => step.path === "/api/entries/update")?.body;
    const onSplits = change.save.some((step) => step.path === "/api/splits/expenses/add-usual");
    if (saved?.entryId === entryId) {
      if (update) setSaved((current) => ({ ...current, description: update.description, categoryName: update.categoryName }));
      setAfter((current) => ({ ...current, words: current.words + 1, ...(update ? { category: update.categoryName } : {}), ...(onSplits ? { shared: true } : {}) }));
    } else {
      setDescribed((current) => ({ ...current, [entryId]: true }));
    }
    onChanged(change.month);
  }

  function wordsUndone(change, entryId) {
    const update = (change.undo ?? []).find((step) => step.path === "/api/entries/update")?.body;
    if (saved?.entryId === entryId) {
      if (update) setSaved((current) => ({ ...current, description: update.description, categoryName: update.categoryName }));
      setAfter((current) => ({ ...current, category: "", shared: false }));
    } else {
      setDescribed((current) => ({ ...current, [entryId]: false }));
    }
    onChanged(change.month);
  }

  async function undo() {
    if (!saved) return;
    setAfter((current) => ({ ...current, busy: true }));
    const result = await undoSavedEntry({ entryId: saved.entryId, splitExpenseId: after.splitExpenseId || undefined });
    if (result.ok) {
      const month = saved.date.slice(0, 7);
      resetPad();
      setMessage(copy.undone);
      setSentCount((count) => count + 1);
      onChanged(month);
    } else {
      setAfter((current) => ({ ...current, busy: false }));
      setError(result.error ?? copy.followUpFailed);
    }
  }

  async function sendNow() {
    setMessage("");
    const count = await flushCashQueue({ onSaved: reportSent });
    if (count) setMessage(copy.sent(count));
  }

  const line = describeCashLine({
    walletName: tap ? tap.accountName : card ? card.name : wallet?.name ?? null,
    currency: activeCurrency,
    date,
    today,
    personName: person?.name ?? ""
  });
  const categoryChips = saved
    ? cashCategoryChips({
        current: saved.categoryName,
        usual: [...(defaults?.usualCategories ?? []), ...FIRST_CATEGORY_CHIPS],
        categoryNames
      })
    : [];
  const currencyChoices = [...new Set([activeCurrency, defaults?.currency, wallet?.currency, ...(defaults?.again ?? []).map((chip) => chip.currency), ...COMMON_CURRENCIES].filter(Boolean))];
  const pickerOptions = categories
    .filter((category) => category.name !== "Transfer")
    .map((category) => ({ value: category.name, label: category.name }));
  const canSave = Boolean(buildCashBody({ requestId: "x", personId, padText, currency: activeCurrency, date })) && !saving;
  const undescribed = defaults?.personId === personId ? defaults?.undescribed ?? [] : [];
  const month = (saved?.date ?? today).slice(0, 7);
  const otherName = people.find((item) => item.id !== personId)?.name ?? "";
  // The details panel takes the keys' place (design.md "Cash pad"): the
  // number keys and the amount's shortcuts step aside, and the amount stays
  // as one compact line above Save.
  const details = changeOpen && !listOpen && !saved;
  const askingWallet = details && askWallet && error === copy.walletQuestion;
  const amountText = groupCashPadText(padText);
  const wayRow = cards.length ? (
    <ChoiceRow
      name="way"
      label={copy.change.way}
      choices={payWayChoices(cards)}
      value={card?.id ?? "cash"}
      onChoose={chooseWay}
    />
  ) : null;
  const walletRow = card ? null : (
    <ChoiceRow
      name="wallet"
      label={copy.change.wallet}
      choices={personAccounts.map((account) => ({ value: account.id, label: account.name }))}
      value={wallet?.id ?? ""}
      onChoose={chooseWallet}
      disabled={saving}
    />
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cash-pad-backdrop" />
        <Dialog.Content
          className={`cash-pad${details ? " is-details" : ""}`}
          aria-describedby="cash-pad-description"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget instanceof HTMLElement ? event.currentTarget : null)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (leavingToTypeRef.current) event.preventDefault();
          }}
        >
          <header className="cash-pad-head">
            <Dialog.Title className="cash-pad-title">{copy.title}</Dialog.Title>
            <Dialog.Description id="cash-pad-description" className="sr-only">{copy.description}</Dialog.Description>
            {onTypeInstead && !saved && !listOpen ? (
              <button
                type="button"
                className="cash-pad-link cash-pad-type-instead"
                onClick={() => {
                  leavingToTypeRef.current = true;
                  onTypeInstead();
                }}
              >
                {copy.typeInstead}
              </button>
            ) : null}
            <Dialog.Close className="cash-pad-close" aria-label={copy.close}>
              <X size={20}/>
            </Dialog.Close>
          </header>

          {listOpen ? null : (
            <button
              type="button"
              className="cash-pad-line"
              aria-expanded={changeOpen}
              aria-label={`${copy.changeLine}: ${line.join(", ")}`}
              onClick={() => moveDetails("line")}
            >
              {line.map((part, index) => (
                <span key={`${index}-${part}`} className={!wallet && !card && !tap && index === 0 ? "cash-pad-line-ask" : undefined}>{part}</span>
              ))}
              <span className="cash-pad-line-caret" aria-hidden="true" />
            </button>
          )}

          {changeOpen && !listOpen ? (
            <div className="cash-pad-change" role="group" aria-label={copy.changeLine}>
              {askingWallet ? (
                <>
                  {/* Save's question, right above the wallets it asks about. */}
                  <p className="cash-pad-error" role="alert">{error}</p>
                  <p className="cash-pad-hint">{copy.walletHint}</p>
                  {walletRow}
                  {wayRow}
                </>
              ) : (
                <>
                  {askWallet ? <p className="cash-pad-hint">{copy.walletHint}</p> : null}
                  {wayRow}
                  {walletRow}
                </>
              )}
              <ChoiceRow
                name="currency"
                label={copy.change.currency}
                choices={currencyChoices.map((code) => ({ value: code, label: code }))}
                value={activeCurrency}
                onChoose={(code) => {
                  setCurrency(code);
                  setPadText((current) => (isZeroDecimalCurrency(code) ? current.split(".")[0] : current));
                }}
              />
              <ChoiceRow
                name="day"
                label={copy.change.day}
                choices={[{ value: today, label: copy.today }, { value: addDays(today, -1), label: copy.yesterday }]}
                value={date}
                onChoose={setDate}
              />
              {people.length > 1 ? (
                <ChoiceRow
                  name="person"
                  label={copy.change.person}
                  choices={people.map((item) => ({ value: item.id, label: item.name }))}
                  value={personId}
                  onChoose={choosePerson}
                />
              ) : null}
              <div className="cash-pad-change-foot">
                <button type="button" className="cash-pad-change-done" onClick={() => moveDetails("done")}>{copy.change.done}</button>
              </div>
            </div>
          ) : null}

          <div className="cash-pad-middle">
            {listOpen ? (
              <section className="cash-pad-words-list" aria-label={copy.list.title(undescribed.length)}>
                <p className="cash-pad-eyebrow">{undescribed.length ? copy.list.title(undescribed.filter((entry) => !described[entry.entryId]).length) : copy.list.none}</p>
                <ul>
                  {undescribed.map((entry) => (
                    <li key={entry.entryId} className={listRow === entry.entryId ? "is-open" : undefined}>
                      <button
                        type="button"
                        className="cash-pad-words-row"
                        aria-expanded={listRow === entry.entryId}
                        onClick={() => setListRow((current) => (current === entry.entryId ? "" : entry.entryId))}
                      >
                        <span>{quickRowLabel(entry, areTotalsVisible, today)}</span>
                        {described[entry.entryId]
                          ? <span className="cash-pad-chip is-done"><Check size={14}/>{copy.list.described}</span>
                          : <span className="cash-pad-words-add">{copy.list.describe}</span>}
                      </button>
                      {listRow === entry.entryId ? (
                        <QuickPadWords
                          entryId={entry.entryId}
                          personId={personId}
                          otherName={otherName}
                          month={entry.date.slice(0, 7)}
                          autoFocus
                          onSaved={(change) => wordsSaved(change, entry.entryId)}
                          onUndone={(change) => wordsUndone(change, entry.entryId)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : saved ? (
              <div className="cash-pad-saved" role="status">
                <p className="cash-pad-saved-line">
                  <Check size={18}/>
                  <span>{copy.saved(savedWhat({ description: saved.description, amountMinor: saved.paidAmountMinor, currency: saved.paidCurrency }, areTotalsVisible))}</span>
                </p>
                <div className="cash-pad-chips" aria-label={copy.categoryTitle}>
                  {categoryChips.map((name) => (name === after.category
                    ? <span key={name} className="cash-pad-chip is-done"><Check size={14}/>{name}</span>
                    : <button key={name} type="button" className="cash-pad-chip" disabled={after.busy} onClick={() => void changeCategory(name)}>{name}</button>))}
                  {after.category && !categoryChips.includes(after.category)
                    ? <span className="cash-pad-chip is-done"><Check size={14}/>{after.category}</span>
                    : null}
                  <CategoryPickerHost
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    anchor={(
                      <button type="button" className="cash-pad-chip" disabled={after.busy} onClick={() => setPickerOpen(true)}>{copy.moreCategories}</button>
                    )}
                    title={copy.categoryTitle}
                    options={pickerOptions}
                    value={after.category || saved.categoryName}
                    description={isPadDefaultDescription(saved.description) ? "" : saved.description}
                    onChoose={(name) => changeCategory(name)}
                  />
                  {people.length > 1 ? (
                    after.shared
                      ? <span className="cash-pad-chip is-done"><Check size={14}/>{copy.sharedDone}</span>
                      : <button type="button" className="cash-pad-chip" disabled={after.busy} onClick={() => void share()}>{copy.shared}</button>
                  ) : null}
                </div>
                <QuickPadWords
                  key={saved.entryId}
                  entryId={saved.entryId}
                  personId={personId}
                  otherName={otherName}
                  month={month}
                  onSaved={(change) => wordsSaved(change, saved.entryId)}
                  onUndone={(change) => wordsUndone(change, saved.entryId)}
                />
              </div>
            ) : (
              <>
                <output className="cash-pad-amount" aria-label={copy.amountLabel} aria-live="polite">
                  <span className="cash-pad-amount-sign">{formatCashAmount(0, activeCurrency).replace(/[\d.,\s]/g, "")}</span>
                  <span className={`cash-pad-amount-figure${padText ? "" : " is-empty"}${amountText.length > 12 ? " is-longer" : amountText.length > 9 ? " is-long" : ""}`}>{amountText}</span>
                </output>
                {tap ? <p className="cash-pad-again-chosen">{copy.taps.chosen(tap.merchant, tap.accountName)}</p> : null}
                {again && !tap ? <p className="cash-pad-again-chosen">{again.description}{again.categoryName ? ` · ${again.categoryName}` : ""}</p> : null}
                {offer ? (
                  <div className="cash-pad-offer" role="alert">
                    <p>{copy.offer.question(offer.merchant, offer.time)}</p>
                    <div className="cash-pad-chips">
                      <button type="button" className="cash-pad-chip is-on" disabled={saving} onClick={() => void save("tap")}>{copy.offer.yes}</button>
                      <button type="button" className="cash-pad-chip" disabled={saving} onClick={() => void save("new")}>{copy.offer.no}</button>
                    </div>
                  </div>
                ) : null}
                {taps.length && !offer && !details ? (
                  <div className="cash-pad-again" role="group" aria-label={copy.taps.title}>
                    <span className="cash-pad-eyebrow">{copy.taps.title}</span>
                    <div className="cash-pad-chips">
                      {taps.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`cash-pad-chip${tap?.id === item.id ? " is-on" : ""}`}
                          aria-pressed={tap?.id === item.id}
                          onClick={() => chooseTap(item)}
                        >
                          {tapButtonLabel(item)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {defaults?.again?.length && !tap && !offer && !details ? (
                  <div className="cash-pad-again" role="group" aria-label={copy.again}>
                    <span className="cash-pad-eyebrow">{copy.again}</span>
                    <div className="cash-pad-chips">
                      {defaults.again.map((chip) => (
                        <button
                          key={`${chip.description}-${chip.amountMinor}-${chip.currency}`}
                          type="button"
                          className={`cash-pad-chip${again === chip ? " is-on" : ""}`}
                          aria-pressed={again === chip}
                          onClick={() => {
                            setAgain(chip);
                            setCurrency(chip.currency);
                            setPadText(String(isZeroDecimalCurrency(chip.currency) ? chip.amountMinor / 100 : (chip.amountMinor / 100).toFixed(2)));
                          }}
                        >
                          {againChipLabel(chip, areTotalsVisible)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {message ? <p className="cash-pad-message" role="status">{message}</p> : null}
            {error && !askingWallet ? <p className="cash-pad-error" role="alert">{error}</p> : null}
            {waiting.length && !listOpen ? (
              <section className="cash-pad-waiting" aria-label={copy.waitingTitle}>
                <p className="cash-pad-eyebrow">{copy.waitingTitle}</p>
                <p className="cash-pad-hint">{copy.waitingDetail}</p>
                <ul>
                  {waiting.map((item) => (
                    <li key={item.requestId}>
                      <span>
                        {savedWhat(item.label, areTotalsVisible)}
                        {item.error ? <small className="cash-pad-waiting-error">{copy.notSent(item.error)}</small> : null}
                      </span>
                      <button type="button" className="cash-pad-link" onClick={() => removeWaitingCash(item.requestId)}>{copy.remove}</button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="cash-pad-link" onClick={() => void sendNow()}>{copy.sendNow}</button>
              </section>
            ) : null}
          </div>

          {listOpen ? (
            <div className="cash-pad-after-actions is-two">
              <button type="button" className="cash-pad-secondary" onClick={() => onOpenChange(false)}>{copy.done}</button>
              <button type="button" className="cash-pad-save" onClick={() => { setListOpen(false); resetPad(); }}>{copy.list.backToPad}</button>
            </div>
          ) : saved ? (
            <div className="cash-pad-after-actions">
              <button type="button" className="cash-pad-secondary" disabled={after.busy} onClick={() => void undo()}>{copy.undo}</button>
              <button type="button" className="cash-pad-secondary" onClick={() => onOpenChange(false)}>{copy.done}</button>
              <button type="button" className="cash-pad-save" onClick={() => { resetPad(); setMessage(""); }}>{copy.addAnother}</button>
            </div>
          ) : (
            <div className="cash-pad-keys">
              {details ? null : <div className="cash-pad-grid">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
                  <button key={key} type="button" className="cash-pad-key" onClick={() => press(key)}>{key}</button>
                ))}
                {zeroDecimal
                  ? <button type="button" className="cash-pad-key" aria-label={copy.keys.thousand} onClick={() => press("000")}>000</button>
                  : <button type="button" className="cash-pad-key" aria-label={copy.keys.point} onClick={() => press(".")}>.</button>}
                <button type="button" className="cash-pad-key" onClick={() => press("0")}>0</button>
                <button type="button" className="cash-pad-key" aria-label={copy.keys.back} onClick={() => press("back")}>
                  <Delete size={24}/>
                </button>
              </div>}
              <button type="button" className="cash-pad-save" disabled={!canSave} onClick={() => void save()}>
                {saving ? copy.saving : copy.save}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChoiceRow({ name, label, choices, value, onChoose, disabled = false }) {
  return (
    <div className="cash-pad-choice-row" data-choice={name}>
      <span className="cash-pad-eyebrow">{label}</span>
      <div className="cash-pad-chips">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={`cash-pad-chip${choice.value === value ? " is-on" : ""}`}
            aria-pressed={choice.value === value}
            disabled={disabled}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
