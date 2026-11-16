import * as Dialog from "@radix-ui/react-dialog";
import { Check, Delete, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CASH_DEFAULT_DESCRIPTION,
  addDays,
  formatCashAmount,
  groupCashPadText,
  isZeroDecimalCurrency,
  pressCashPadKey
} from "../domain/cash-entry";
import { addSavedEntryToSplits, requestSplitSuggestion, undoSavedEntry, updateSavedEntryCategory } from "./ask-api";
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
import { againChipLabel, buildCashBody, cashCategoryChips, describeCashLine, savedWhat } from "./cash-pad-model";
import { CategoryPickerHost } from "./category-picker-host";
import { cashPadCopy as copy } from "./copy/cash-pad-copy";
import { useMoneyPrivacy } from "./money-privacy";
import { todayInAppTimeZone } from "./app-dates";
import "./cash-pad.css";

// The cash pad (design.md "Cash pad"; docs/flows/cash-entry-flow.md): the
// fastest way to log a cash payment. It opens on a large number pad at the
// bottom of the screen, under the thumb; every other field is decided
// already and shown as one quiet line that can be tapped to change. Save
// works with just an amount. After Save the sheet shows the saved line with
// Undo and optional one-tap chips (a category, Shared, a note); Add another
// keeps the pad open. A Save that cannot reach the server waits on this
// device (cash-queue.js) and sends itself later. Lazy: loaded only when the
// person taps Cash.

const PERSON_KEY = "monies.cashPerson.v1";
const WALLET_KEY = "monies.cashWallet.v1";
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

function postNote(entryId, note) {
  return fetch("/api/entries/update-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId, note })
  }).then((response) => response.ok, () => false);
}

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   people: Array<{ id: string, name: string }>,
 *   accounts: Array<{ id: string, name: string, kind: string, currency: string, ownerPersonId?: string, isJoint?: boolean, isActive?: boolean }>,
 *   categories: Array<{ name: string }>,
 *   viewId?: string,
 *   onChanged?: (month: string) => void
 * }} props
 */
export default function CashPadSheet({ open, onOpenChange, people, accounts, categories, viewId = "household", onChanged = () => {} }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [today] = useState(() => todayInAppTimeZone());
  const [personId, setPersonId] = useState(() => firstPersonId(people, viewId));
  const person = people.find((item) => item.id === personId) ?? people[0];
  const [defaults, setDefaults] = useState(() => rememberedCashDefaults(personId));
  const [padText, setPadText] = useState("");
  const [currency, setCurrency] = useState(/** @type {string | null} */ (null));
  const [date, setDate] = useState(today);
  const [walletId, setWalletId] = useState(() => readStored(WALLET_KEY)?.[personId] ?? "");
  const [again, setAgain] = useState(/** @type {any} */ (null));
  const [changeOpen, setChangeOpen] = useState(false);
  const [askWallet, setAskWallet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(/** @type {any} */ (null));
  const [after, setAfter] = useState({ category: "", shared: false, splitExpenseId: "", note: "", noteOpen: false, noteSaved: false, busy: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waiting, setWaiting] = useState(() => readCashQueue());
  // Bumped when a payment reaches the server, so the Again chips follow.
  const [sentCount, setSentCount] = useState(0);
  const requestIdRef = useRef(newCashRequestId());
  const noteRef = useRef(null);

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
    setError("");
    setSaved(null);
    setAfter({ category: "", shared: false, splitExpenseId: "", note: "", noteOpen: false, noteSaved: false, busy: false });
    requestIdRef.current = newCashRequestId();
  }, []);

  const press = useCallback((key) => {
    setError("");
    setPadText((current) => pressCashPadKey(current, key, activeCurrency));
  }, [activeCurrency]);

  async function save() {
    if (saving) return;
    const body = buildCashBody({
      requestId: requestIdRef.current,
      personId,
      padText,
      currency: activeCurrency,
      date,
      accountId: chosenWallet?.id ?? "",
      again
    });
    if (!body) return;
    setSaving(true);
    setError("");
    setMessage("");
    const label = { description: again?.description || CASH_DEFAULT_DESCRIPTION, amountMinor: body.amountMinor, currency: activeCurrency };
    const result = await sendCashEntry(body);
    setSaving(false);
    writeStored(PERSON_KEY, personId);
    if (result.kind === "saved") {
      setSaved(result.entry);
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
    if (result.needsWallet) {
      setAskWallet(true);
      setChangeOpen(true);
      setError(copy.walletQuestion);
      return;
    }
    setError(result.error);
  }

  // Digits, Backspace, "." and Enter on a keyboard (a wide screen).
  function onKeyDown(event) {
    if (saved || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
  }

  function choosePerson(id) {
    setPersonId(id);
    setWalletId(readStored(WALLET_KEY)?.[id] ?? "");
    setCurrency(null);
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

  async function saveNote() {
    if (!saved) return;
    const text = after.note.trim();
    setAfter((current) => ({ ...current, busy: true }));
    const foreignLine = saved.storedNote && saved.note !== saved.storedNote ? String(saved.storedNote).split("\n")[0] : "";
    const ok = await postNote(saved.entryId, [foreignLine, text].filter(Boolean).join("\n"));
    setAfter((current) => ({ ...current, busy: false, noteOpen: !ok, ...(ok ? { noteSaved: true } : {}) }));
    if (ok) onChanged(saved.date.slice(0, 7));
    else setError(copy.followUpFailed);
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
    walletName: wallet?.name ?? null,
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cash-pad-backdrop" />
        <Dialog.Content
          className="cash-pad"
          aria-describedby="cash-pad-description"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget instanceof HTMLElement ? event.currentTarget : null)?.focus({ preventScroll: true });
          }}
        >
          <header className="cash-pad-head">
            <Dialog.Title className="cash-pad-title">{copy.title}</Dialog.Title>
            <Dialog.Description id="cash-pad-description" className="sr-only">{copy.description}</Dialog.Description>
            <Dialog.Close className="cash-pad-close" aria-label={copy.close}>
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <button
            type="button"
            className="cash-pad-line"
            aria-expanded={changeOpen}
            aria-label={`${copy.changeLine}: ${line.join(", ")}`}
            onClick={() => setChangeOpen((current) => !current)}
          >
            {line.map((part, index) => (
              <span key={`${index}-${part}`} className={!wallet && index === 0 ? "cash-pad-line-ask" : undefined}>{part}</span>
            ))}
            <span className="cash-pad-line-caret" aria-hidden="true" />
          </button>

          {changeOpen ? (
            <div className="cash-pad-change" role="group" aria-label={copy.changeLine}>
              {askWallet ? <p className="cash-pad-hint">{copy.walletHint}</p> : null}
              <ChoiceRow
                label={copy.change.wallet}
                choices={personAccounts.map((account) => ({ value: account.id, label: account.name }))}
                value={wallet?.id ?? ""}
                onChoose={chooseWallet}
              />
              <ChoiceRow
                label={copy.change.currency}
                choices={currencyChoices.map((code) => ({ value: code, label: code }))}
                value={activeCurrency}
                onChoose={(code) => {
                  setCurrency(code);
                  setPadText((current) => (isZeroDecimalCurrency(code) ? current.split(".")[0] : current));
                }}
              />
              <ChoiceRow
                label={copy.change.day}
                choices={[{ value: today, label: copy.today }, { value: addDays(today, -1), label: copy.yesterday }]}
                value={date}
                onChoose={setDate}
              />
              {people.length > 1 ? (
                <ChoiceRow
                  label={copy.change.person}
                  choices={people.map((item) => ({ value: item.id, label: item.name }))}
                  value={personId}
                  onChoose={choosePerson}
                />
              ) : null}
              <button type="button" className="cash-pad-change-done" onClick={() => setChangeOpen(false)}>{copy.change.done}</button>
            </div>
          ) : null}

          <div className="cash-pad-middle">
            {saved ? (
              <div className="cash-pad-saved" role="status">
                <p className="cash-pad-saved-line">
                  <Check size={18} aria-hidden="true" />
                  <span>{copy.saved(savedWhat({ description: saved.description, amountMinor: saved.paidAmountMinor, currency: saved.paidCurrency }, areTotalsVisible))}</span>
                </p>
                <div className="cash-pad-chips" aria-label={copy.categoryTitle}>
                  {categoryChips.map((name) => (name === after.category
                    ? <span key={name} className="cash-pad-chip is-done"><Check size={14} aria-hidden="true" />{name}</span>
                    : <button key={name} type="button" className="cash-pad-chip" disabled={after.busy} onClick={() => void changeCategory(name)}>{name}</button>))}
                  {after.category && !categoryChips.includes(after.category)
                    ? <span className="cash-pad-chip is-done"><Check size={14} aria-hidden="true" />{after.category}</span>
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
                    description={saved.description === CASH_DEFAULT_DESCRIPTION ? "" : saved.description}
                    onChoose={(name) => changeCategory(name)}
                  />
                  {people.length > 1 ? (
                    after.shared
                      ? <span className="cash-pad-chip is-done"><Check size={14} aria-hidden="true" />{copy.sharedDone}</span>
                      : <button type="button" className="cash-pad-chip" disabled={after.busy} onClick={() => void share()}>{copy.shared}</button>
                  ) : null}
                  {after.noteSaved
                    ? <span className="cash-pad-chip is-done"><Check size={14} aria-hidden="true" />{copy.noteSaved}</span>
                    : (
                      <button
                        type="button"
                        className="cash-pad-chip"
                        disabled={after.busy}
                        onClick={() => setAfter((current) => ({ ...current, noteOpen: true }))}
                      >
                        {copy.addNote}
                      </button>
                    )}
                </div>
                {after.noteOpen ? (
                  <form className="cash-pad-note" onSubmit={(event) => { event.preventDefault(); void saveNote(); }}>
                    <input
                      ref={noteRef}
                      autoFocus
                      className="cash-pad-note-input"
                      value={after.note}
                      maxLength={500}
                      placeholder={copy.notePlaceholder}
                      aria-label={copy.addNote}
                      onChange={(event) => setAfter((current) => ({ ...current, note: event.target.value }))}
                    />
                    <button type="submit" className="cash-pad-chip" disabled={after.busy || !after.note.trim()}>{copy.saveNote}</button>
                  </form>
                ) : null}
              </div>
            ) : (
              <>
                <output className="cash-pad-amount" aria-label={copy.amountLabel} aria-live="polite">
                  <span className="cash-pad-amount-sign">{formatCashAmount(0, activeCurrency).replace(/[\d.,\s]/g, "")}</span>
                  <span className={`cash-pad-amount-figure${padText ? "" : " is-empty"}`}>{groupCashPadText(padText)}</span>
                </output>
                {again ? <p className="cash-pad-again-chosen">{again.description}{again.categoryName ? ` · ${again.categoryName}` : ""}</p> : null}
                {defaults?.again?.length ? (
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
            {error ? <p className="cash-pad-error" role="alert">{error}</p> : null}
            {waiting.length ? (
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

          {saved ? (
            <div className="cash-pad-after-actions">
              <button type="button" className="cash-pad-secondary" disabled={after.busy} onClick={() => void undo()}>{copy.undo}</button>
              <button type="button" className="cash-pad-secondary" onClick={() => onOpenChange(false)}>{copy.done}</button>
              <button type="button" className="cash-pad-save" onClick={() => { resetPad(); setMessage(""); }}>{copy.addAnother}</button>
            </div>
          ) : (
            <div className="cash-pad-keys">
              <div className="cash-pad-grid">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
                  <button key={key} type="button" className="cash-pad-key" onClick={() => press(key)}>{key}</button>
                ))}
                {zeroDecimal
                  ? <button type="button" className="cash-pad-key" aria-label={copy.keys.thousand} onClick={() => press("000")}>000</button>
                  : <button type="button" className="cash-pad-key" aria-label={copy.keys.point} onClick={() => press(".")}>.</button>}
                <button type="button" className="cash-pad-key" onClick={() => press("0")}>0</button>
                <button type="button" className="cash-pad-key" aria-label={copy.keys.back} onClick={() => press("back")}>
                  <Delete size={24} aria-hidden="true" />
                </button>
              </div>
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

function ChoiceRow({ label, choices, value, onChoose }) {
  return (
    <div className="cash-pad-choice-row">
      <span className="cash-pad-eyebrow">{label}</span>
      <div className="cash-pad-chips">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={`cash-pad-chip${choice.value === value ? " is-on" : ""}`}
            aria-pressed={choice.value === value}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
